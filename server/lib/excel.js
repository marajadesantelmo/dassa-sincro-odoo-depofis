/**
 * server/lib/excel.js — el .xlsx descargable de una corrida.
 *
 * Es el reemplazo del `resultado_sincronizacion.xlsx` que escribía el script
 * original en el disco de quien lo corría. Ahora el archivo lo arma el server
 * desde la misma fuente que ve la pantalla, así que no pueden discrepar.
 *
 * `exceljs` sólo ESCRIBE. Nada de lo que entra a esta app viene de un archivo
 * subido por un usuario, así que acá no hay parser de entrada que blindar.
 */
import ExcelJS from 'exceljs';

const ROJO_DASSA = 'FFC8202C';

/** Columnas de la hoja de clientes. Cada fila es un cliente de DEPOFIS y lo
 *  que se hace (o se haría) con él en Odoo. */
const COLUMNAS_CLIENTE = [
  { header: 'clie_nro', key: 'depofis_id', width: 10 },
  { header: 'Nombre (DEPOFIS)', key: 'odoo_nombre', width: 42 },
  { header: 'CUIT', key: 'clave', width: 16 },
  { header: 'Acción', key: 'accion', width: 10 },
  { header: 'Ejecutada', key: 'ejecutada', width: 10 },
  { header: 'Nueva', key: 'es_nueva', width: 8 },
  { header: 'Requiere atención', key: 'requiere_atencion', width: 18 },
  { header: 'Vendedor DEPOFIS', key: 'vendedor_depofis', width: 17 },
  { header: 'Salesperson (Odoo)', key: 'vendedor_nombre', width: 24 },
  { header: 'Cliente DASSA', key: 'es_dassa', width: 14 },
  { header: 'Categoría DEPOFIS', key: 'categoria', width: 20 },
  { header: 'Contacto Odoo (id)', key: 'odoo_id', width: 18 },
  { header: 'Motivo', key: 'motivo', width: 60 },
];

const COLUMNAS_CONCEPTO = [
  { header: 'Código', key: 'clave', width: 12 },
  { header: 'Detalle (DEPOFIS)', key: 'odoo_nombre', width: 52 },
  { header: 'Acción', key: 'accion', width: 10 },
  { header: 'Ejecutada', key: 'ejecutada', width: 10 },
  { header: 'Nueva', key: 'es_nueva', width: 8 },
  { header: 'Requiere atención', key: 'requiere_atencion', width: 18 },
  { header: 'Grupo', key: 'grupo', width: 26 },
  { header: 'Producto Odoo (id)', key: 'odoo_id', width: 18 },
  { header: 'Motivo', key: 'motivo', width: 60 },
];

/** Las filas de Concepfc que no son conceptos (separadores, "NO USAR", la
 *  fila de prueba). Van aparte: no hay nada que auditar salvo el motivo. */
const COLUMNAS_FUERA = [
  { header: 'Código', key: 'clave', width: 14 },
  { header: 'Detalle', key: 'odoo_nombre', width: 52 },
  { header: 'Motivo', key: 'motivo', width: 80 },
];

function encabezar(hoja) {
  const fila = hoja.getRow(1);
  fila.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_DASSA } };
  fila.alignment = { vertical: 'middle' };
  fila.height = 20;
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
}

const si_no = (v) => (v === true ? 'SÍ' : v === false ? 'no' : '');

function filaCliente(n) {
  const d = (n.payload && n.payload.depofis) || {};
  return {
    depofis_id: n.depofis_id || '',
    odoo_nombre: n.odoo_nombre,
    clave: n.clave || '',
    accion: n.accion,
    ejecutada: si_no(n.ejecutada),
    es_nueva: n.es_nueva ? 'NUEVA' : '',
    requiere_atencion: n.requiere_atencion ? 'SÍ' : '',
    vendedor_depofis: n.vendedor_depofis == null ? '' : n.vendedor_depofis,
    vendedor_nombre: n.vendedor_nombre || '(sin Salesperson)',
    es_dassa: si_no(n.es_dassa),
    categoria: d.tipo_cl || '',
    odoo_id: n.odoo_id ?? '',
    motivo: n.motivo || '',
  };
}

function filaConcepto(n) {
  const d = (n.payload && n.payload.depofis) || {};
  return {
    clave: n.clave || '',
    odoo_nombre: n.odoo_nombre,
    accion: n.accion,
    ejecutada: si_no(n.ejecutada),
    es_nueva: n.es_nueva ? 'NUEVA' : '',
    requiere_atencion: n.requiere_atencion ? 'SÍ' : '',
    grupo: d.grupo || '',
    odoo_id: n.odoo_id ?? '',
    motivo: n.motivo || '',
  };
}

/** Portada: qué corrida es esta y en qué modo corrió. Sin esto, un .xlsx
 *  suelto en un mail no dice si lo que muestra ya se escribió en Odoo. */
function hojaResumen(libro, corrida) {
  const hoja = libro.addWorksheet('Corrida');
  hoja.columns = [{ width: 26 }, { width: 60 }];

  const t = corrida.totales || {};
  const tc = t.clientes || {};
  const tk = t.conceptos || {};
  const filas = [
    ['Corrida', `#${corrida.id}`],
    ['Modo', corrida.modo === 'aplicacion'
      ? 'APLICACIÓN — lo marcado como ejecutado SÍ se escribió en Odoo'
      : 'SIMULACIÓN — no se escribió nada en Odoo'],
    ['Estado', corrida.estado],
    ['Origen', corrida.origen],
    ['Disparada por', corrida.disparada_por || '(automática)'],
    ['Inicio', corrida.iniciada_en],
    ['Fin', corrida.terminada_en],
    ['Odoo', corrida.odoo_db || ''],
    ['DEPOFIS leído de', `espejo (${corrida.depofis_server || 'depofis_mirror'}) — sólo lectura`],
    ['Espejo actualizado al', corrida.fuente_sincronizada_en || '—'],
    [],
    ['A sincronizar en Odoo', corrida.a_sincronizar],
    ['  · altas de clientes', corrida.altas_clientes],
    ['  · clientes a vincular', corrida.vinculaciones],
    ['  · altas de conceptos', corrida.altas_conceptos],
    ['Ejecutadas', corrida.ejecutadas],
    ['Altas sin Salesperson', corrida.altas_sin_vendedor],
    ['Omitidos (no se pueden)', corrida.omitidos],
    ['Errores', corrida.errores],
    [],
    ['Clientes ya sincronizados', tc.sin_cambios ?? ''],
    ['Clientes inactivos (no se miran)', tc.inactivos ?? ''],
    ['Conceptos ya en Odoo', tk.sin_cambios ?? ''],
    ['Filas de Concepfc que no son conceptos', corrida.fuera_alcance_conceptos],
  ];
  for (const f of filas) hoja.addRow(f);

  hoja.getColumn(1).font = { bold: true, size: 10 };
  hoja.getRow(2).font = { bold: true, color: { argb: corrida.modo === 'aplicacion' ? ROJO_DASSA : 'FF1D4ED8' } };
  return hoja;
}

export async function armarLibro({ corrida, novedades }) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sincro DEPOFIS → Odoo · DASSA';
  libro.created = new Date();

  hojaResumen(libro, corrida);

  // Lo que quedó fuera de alcance va en su propia hoja, no mezclado en Clientes
  // y Conceptos: se exporta todo, pero cada cosa donde corresponde.
  const enAlcance = novedades.filter((n) => n.accion !== 'fuera_alcance');
  const fuera = novedades.filter((n) => n.accion === 'fuera_alcance');

  const hojaC = libro.addWorksheet('Clientes');
  hojaC.columns = COLUMNAS_CLIENTE;
  enAlcance.filter((n) => n.tipo === 'cliente').forEach((n) => hojaC.addRow(filaCliente(n)));
  encabezar(hojaC);

  const hojaK = libro.addWorksheet('Conceptos');
  hojaK.columns = COLUMNAS_CONCEPTO;
  enAlcance.filter((n) => n.tipo === 'concepto').forEach((n) => hojaK.addRow(filaConcepto(n)));
  encabezar(hojaK);

  if (fuera.length) {
    const hojaF = libro.addWorksheet('No son conceptos');
    hojaF.columns = COLUMNAS_FUERA;
    fuera.forEach((n) => hojaF.addRow({
      odoo_nombre: n.odoo_nombre,
      clave: n.clave || '',
      motivo: n.motivo || '',
    }));
    encabezar(hojaF);
  }

  // El mapeo usado va en el libro: sin él, el pase de "Vendedor DEPOFIS" a
  // Salesperson no tiene explicación para quien abra el archivo en otra máquina.
  const hojaV = libro.addWorksheet('Mapeo vendedores');
  hojaV.columns = [
    { header: 'uid Odoo', key: 'uid', width: 10 },
    { header: 'Salesperson', key: 'nombre', width: 28 },
    { header: 'Código propio → Cliente DASSA = no', key: 'propio', width: 32 },
    { header: 'Código institucional → Cliente DASSA = sí', key: 'institucional', width: 38 },
  ];
  for (const [uid, v] of Object.entries(corrida.vendedor_map || {})) {
    hojaV.addRow({ uid: Number(uid), nombre: v.nombre, propio: v.propio, institucional: v.institucional });
  }
  encabezar(hojaV);

  return libro.xlsx.writeBuffer();
}

export function nombreArchivo(corrida) {
  const fecha = new Date(corrida.iniciada_en).toISOString().slice(0, 10);
  return `Sincro DEPOFIS-Odoo ${fecha} corrida ${corrida.id} (${corrida.modo}).xlsx`;
}
