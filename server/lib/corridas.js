/**
 * server/lib/corridas.js — el dominio de la app.
 *
 * Todo lo que la pantalla y la rutina pueden hacer contra la base pasa por
 * acá. Los routers no escriben SQL.
 *
 * La app es, deliberadamente, un LECTOR: no dispara la sincronización ni toca
 * Odoo ni DEPOFIS. Lo único que escribe son las corridas que le publica
 * `sincronizar.py` por /api/servicio/*. Ver CLAUDE.md § Decisiones #1.
 */
import { query, enTransaccion } from './db.js';
import { ErrorDeNegocio } from './errores.js';

export { ErrorDeNegocio };

// Tope de filas por página. Una corrida completa hoy son ~460 novedades
// (117 clientes + ~340 conceptos), así que con este tope entra entera en una
// sola respuesta y la tabla ordena y filtra en el navegador.
const LIMITE_MAX = 1000;

const CAMPOS_NOVEDAD = `
  id, corrida_id, tipo, odoo_id, odoo_nombre, clave, accion, motivo,
  requiere_atencion, vendedor_uid, vendedor_nombre, es_dassa, vendedor_depofis,
  payload, depofis_id, es_nueva, anterior_id, creado_en
`;

// ─── Lectura ───────────────────────────────────────────────────────────────

export async function listarCorridas({ limite = 50 } = {}) {
  const r = await query(
    `SELECT * FROM sincro_odoo_depofis.v_corrida_resumen
      ORDER BY iniciada_en DESC, id DESC
      LIMIT $1`,
    [Math.min(Math.max(limite, 1), 200)],
  );
  return r.rows;
}

export async function traerCorrida(id) {
  const r = await query('SELECT * FROM sincro_odoo_depofis.v_corrida_resumen WHERE id = $1', [id]);
  return r.rows[0] || null;
}

/** La última corrida completada. `null` si todavía no corrió ninguna. */
export async function ultimaCorrida() {
  const r = await query('SELECT * FROM sincro_odoo_depofis.v_ultima_corrida');
  return r.rows[0] || null;
}

/**
 * Las novedades de una corrida.
 *
 * Los filtros se aplican en SQL y no en el navegador porque son los mismos que
 * usa la exportación a Excel: si vivieran sólo en el frontend, el .xlsx bajaría
 * distinto de lo que se ve en pantalla.
 */
export async function listarNovedades(corridaId, opciones = {}) {
  const { tipo, accion, atencion, nuevas, limite = LIMITE_MAX } = opciones;
  const cond = ['corrida_id = $1'];
  const params = [corridaId];

  if (tipo) { params.push(tipo); cond.push(`tipo = $${params.length}`); }
  if (accion) { params.push(accion); cond.push(`accion = $${params.length}`); }
  if (atencion) cond.push('requiere_atencion');
  if (nuevas) cond.push('es_nueva');

  params.push(Math.min(Math.max(limite, 1), LIMITE_MAX));

  const r = await query(
    `SELECT ${CAMPOS_NOVEDAD}
       FROM sincro_odoo_depofis.v_novedad
      WHERE ${cond.join(' AND ')}
      ORDER BY requiere_atencion DESC, es_nueva DESC, tipo, odoo_nombre
      LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

/**
 * Lo que abre la pantalla principal: la última corrida y sus novedades.
 *
 * Va en una sola llamada a propósito. La alternativa —pedir la corrida y
 * después las novedades— deja un parpadeo en el que la pantalla muestra
 * conteos de una corrida y filas de otra, si alguien publicó una nueva en el
 * medio.
 */
export async function resumen() {
  const corrida = await ultimaCorrida();
  if (!corrida) return { corrida: null, novedades: [] };
  const novedades = await listarNovedades(corrida.id, {});
  return { corrida, novedades };
}

// ─── Escritura (sólo /api/servicio/*) ──────────────────────────────────────

const MODOS = ['simulacion', 'aplicacion'];
const ORIGENES = ['cron', 'cli', 'manual'];
const FUENTES = ['espejo', 'origen'];
const ESTADOS_FINALES = ['ok', 'con_errores', 'fallida'];
const ACCIONES = ['alta', 'omitido', 'error'];
const TIPOS = ['cliente', 'concepto'];

export async function abrirCorrida(datos) {
  const {
    modo, origen = 'cli', disparada_por = null,
    odoo_db = null, odoo_uid = null, depofis_server = null,
    fuente = 'espejo', fuente_sincronizada_en = null,
    vendedor_map = {}, version_rutina = null,
  } = datos || {};

  if (!MODOS.includes(modo)) {
    throw new ErrorDeNegocio('modo_invalido', `modo debe ser uno de: ${MODOS.join(', ')}`);
  }
  if (!ORIGENES.includes(origen)) {
    throw new ErrorDeNegocio('origen_invalido', `origen debe ser uno de: ${ORIGENES.join(', ')}`);
  }
  if (!FUENTES.includes(fuente)) {
    throw new ErrorDeNegocio('fuente_invalida', `fuente debe ser una de: ${FUENTES.join(', ')}`);
  }
  // Una corrida de aplicación leída del espejo sería una decisión de alta
  // tomada contra una copia de ayer. La rutina ya lo impide en
  // `config.resolver_fuente()`; el server lo vuelve a chequear porque es la
  // clase de error que no se puede descubrir después.
  if (modo === 'aplicacion' && fuente !== 'origen') {
    throw new ErrorDeNegocio(
      'aplicacion_sin_origen',
      'Una corrida de aplicación tiene que leer del origen, no del espejo.',
      422,
    );
  }

  const r = await query(
    `INSERT INTO sincro_odoo_depofis.corrida
       (modo, origen, disparada_por, odoo_db, odoo_uid, depofis_server,
        fuente, fuente_sincronizada_en, vendedor_map, version_rutina)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
     RETURNING id, modo, origen, fuente, estado, iniciada_en`,
    [
      modo, origen, disparada_por, odoo_db,
      Number.isInteger(odoo_uid) ? odoo_uid : null,
      depofis_server,
      fuente,
      fuente_sincronizada_en,
      JSON.stringify(vendedor_map || {}),
      version_rutina,
    ],
  );
  return r.rows[0];
}

/**
 * Publica un lote de novedades.
 *
 * Todo el lote va en una transacción: media corrida publicada es peor que
 * ninguna, porque los conteos de la pantalla saldrían de un resultado
 * incompleto sin que nada lo indique.
 */
export async function publicarNovedades(corridaId, novedades) {
  const corrida = await query('SELECT id, estado FROM sincro_odoo_depofis.corrida WHERE id = $1', [corridaId]);
  if (!corrida.rows.length) {
    throw new ErrorDeNegocio('corrida_inexistente', 'Esa corrida no existe.', 404);
  }
  // Una corrida cerrada es un registro histórico: si se le pudieran agregar
  // filas después, los conteos que alguien ya miró cambiarían solos.
  if (corrida.rows[0].estado !== 'en_curso') {
    throw new ErrorDeNegocio('corrida_cerrada', 'Esa corrida ya está cerrada: no admite más novedades.', 409);
  }
  if (!Array.isArray(novedades) || !novedades.length) {
    throw new ErrorDeNegocio('lote_vacio', 'El lote no trae novedades.');
  }
  if (novedades.length > LIMITE_MAX) {
    throw new ErrorDeNegocio('lote_grande', `Máximo ${LIMITE_MAX} novedades por lote.`, 413);
  }

  // Se valida el lote ENTERO antes de abrir la transacción: así una fila mal
  // formada devuelve 400 sin haber escrito nada ni haber tomado una conexión
  // del pool, que es compartido con todo el ecosistema.
  for (const n of novedades) {
    if (!TIPOS.includes(n?.tipo)) throw new ErrorDeNegocio('tipo_invalido', `tipo debe ser: ${TIPOS.join(' | ')}`);
    if (!ACCIONES.includes(n?.accion)) throw new ErrorDeNegocio('accion_invalida', `accion debe ser: ${ACCIONES.join(' | ')}`);
    if (!Number.isInteger(n?.odoo_id)) throw new ErrorDeNegocio('odoo_id_invalido', 'odoo_id debe ser entero.');
  }

  return enTransaccion(async (c) => {
    for (const n of novedades) {
      await c.query(
        `INSERT INTO sincro_odoo_depofis.novedad
           (corrida_id, tipo, odoo_id, odoo_nombre, clave, accion, motivo, requiere_atencion,
            vendedor_uid, vendedor_nombre, es_dassa, vendedor_depofis, payload, depofis_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [
          corridaId, n.tipo, n.odoo_id, String(n.odoo_nombre || '').slice(0, 300),
          n.clave != null ? String(n.clave).slice(0, 60) : null,
          n.accion, n.motivo != null ? String(n.motivo).slice(0, 500) : null,
          Boolean(n.requiere_atencion),
          Number.isInteger(n.vendedor_uid) ? n.vendedor_uid : null,
          n.vendedor_nombre != null ? String(n.vendedor_nombre).slice(0, 120) : null,
          typeof n.es_dassa === 'boolean' ? n.es_dassa : null,
          Number.isInteger(n.vendedor_depofis) ? n.vendedor_depofis : null,
          JSON.stringify(n.payload || {}),
          n.depofis_id != null ? String(n.depofis_id).slice(0, 40) : null,
        ],
      );
    }
    return { insertadas: novedades.length };
  });
}

export async function cerrarCorrida(corridaId, datos) {
  const { estado, totales = {}, error = null } = datos || {};
  if (!ESTADOS_FINALES.includes(estado)) {
    throw new ErrorDeNegocio('estado_invalido', `estado debe ser uno de: ${ESTADOS_FINALES.join(', ')}`);
  }

  // El WHERE exige 'en_curso': cerrar dos veces la misma corrida no puede
  // pisar el resultado de la primera.
  const r = await query(
    `UPDATE sincro_odoo_depofis.corrida
        SET estado = $2,
            totales = $3::jsonb,
            error = $4,
            terminada_en = now(),
            duracion_ms = (EXTRACT(EPOCH FROM (now() - iniciada_en)) * 1000)::int
      WHERE id = $1 AND estado = 'en_curso'
      RETURNING id, estado, terminada_en, duracion_ms`,
    [corridaId, estado, JSON.stringify(totales || {}), error],
  );
  if (!r.rows.length) {
    const existe = await query('SELECT estado FROM sincro_odoo_depofis.corrida WHERE id = $1', [corridaId]);
    if (!existe.rows.length) throw new ErrorDeNegocio('corrida_inexistente', 'Esa corrida no existe.', 404);
    throw new ErrorDeNegocio('corrida_cerrada', `Esa corrida ya está en estado "${existe.rows[0].estado}".`, 409);
  }
  return r.rows[0];
}
