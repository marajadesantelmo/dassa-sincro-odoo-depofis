#!/usr/bin/env node
/**
 * scripts/diag-db.mjs — ¿está la base como la app espera?
 *
 *   npm run db:diag
 *
 * Correrlo DESPUÉS de aplicar las migraciones de sql/ y ANTES de dar la app por
 * lista. Verifica, en orden: que el DSN conecte, que existan las dos tablas y
 * las cuatro vistas, que las columnas que la app consulta estén, y que el rol
 * pueda escribir (con un INSERT dentro de una transacción que se revierte).
 *
 * Es lo único que confirma que `002_roles.sql` se aplicó con los GRANT bien: un
 * SELECT anda con permisos de lectura solos, y el problema recién aparecería
 * cuando la rutina intente publicar su primera corrida.
 */
import 'dotenv/config';
import pg from 'pg';

const DSN = process.env.SINCRO_ODOO_DEPOFIS_PG_DSN;
if (!DSN) {
  console.error('✗ SINCRO_ODOO_DEPOFIS_PG_DSN no está en el .env.');
  process.exit(1);
}

const TABLAS = ['corrida', 'novedad'];
const VISTAS = ['v_corrida_anterior', 'v_novedad', 'v_corrida_resumen', 'v_ultima_corrida'];
// Las columnas que la app consulta por nombre. Si falta una, el error real
// aparecería como un 500 opaco en pantalla.
const COLUMNAS_CLAVE = {
  corrida: ['modo', 'origen', 'estado', 'vendedor_map', 'totales', 'duracion_ms'],
  novedad: ['tipo', 'accion', 'requiere_atencion', 'vendedor_uid', 'vendedor_nombre',
    'es_dassa', 'vendedor_depofis', 'payload', 'depofis_id'],
};

let fallas = 0;
const ok = (m) => console.log('✓ ' + m);
const mal = (m) => { fallas += 1; console.log('✗ ' + m); };

const cliente = new pg.Client({
  connectionString: DSN,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8000,
});

try {
  await cliente.connect();
  const quien = await cliente.query('SELECT current_user, current_database()');
  ok(`conecta · usuario=${quien.rows[0].current_user} db=${quien.rows[0].current_database}`);
} catch (e) {
  console.error('✗ no conecta:', e.message);
  console.error('  ⚠ Recordá que el DSN tiene que ir por el pooler aws-1-sa-east-1 (IPv4).');
  process.exit(1);
}

try {
  const s = await cliente.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sincro_odoo_depofis'");
  if (s.rowCount) ok('el schema sincro_odoo_depofis existe');
  else mal('falta el schema sincro_odoo_depofis — aplicá sql/001_schema.sql');

  const t = await cliente.query(
    `SELECT table_name, table_type FROM information_schema.tables
      WHERE table_schema = 'sincro_odoo_depofis'`);
  const presentes = new Map(t.rows.map((r) => [r.table_name, r.table_type]));

  for (const nombre of TABLAS) {
    if (presentes.get(nombre) === 'BASE TABLE') ok(`tabla ${nombre}`);
    else mal(`falta la tabla ${nombre}`);
  }
  for (const nombre of VISTAS) {
    if (presentes.has(nombre)) ok(`vista ${nombre}`);
    else mal(`falta la vista ${nombre} — aplicá sql/030_vistas.sql`);
  }

  for (const [tabla, columnas] of Object.entries(COLUMNAS_CLAVE)) {
    const c = await cliente.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'sincro_odoo_depofis' AND table_name = $1`, [tabla]);
    const hay = new Set(c.rows.map((r) => r.column_name));
    const faltan = columnas.filter((x) => !hay.has(x));
    if (faltan.length) mal(`${tabla}: faltan columnas ${faltan.join(', ')}`);
    else ok(`${tabla}: las ${columnas.length} columnas clave están`);
  }

  // La vista tiene que RESPONDER, aunque sea vacía. Que exista no alcanza: una
  // vista sobre una tabla sin permisos existe igual y explota al consultarla.
  const u = await cliente.query('SELECT * FROM sincro_odoo_depofis.v_ultima_corrida');
  ok(`v_ultima_corrida responde · ${u.rowCount ? 'hay corridas' : 'todavía no hay ninguna corrida'}`);

  // Escritura, y se revierte. Es lo único que prueba de verdad los GRANT.
  await cliente.query('BEGIN');
  try {
    const ins = await cliente.query(
      `INSERT INTO sincro_odoo_depofis.corrida (modo, origen, vendedor_map)
       VALUES ('simulacion', 'cli', '{}'::jsonb) RETURNING id`);
    await cliente.query(
      `INSERT INTO sincro_odoo_depofis.novedad (corrida_id, tipo, odoo_id, odoo_nombre, accion)
       VALUES ($1, 'cliente', 0, 'PRUEBA diag-db', 'omitido')`, [ins.rows[0].id]);
    ok('el rol puede escribir en corrida y novedad');
  } catch (e) {
    mal(`el rol NO puede escribir: ${e.message}`);
    console.log('  → revisá los GRANT de sql/002_roles.sql');
  } finally {
    await cliente.query('ROLLBACK');
  }
} finally {
  await cliente.end();
}

console.log('');
if (fallas) {
  console.log(`✗ ${fallas} problema(s). La app no va a andar bien así.`);
  process.exit(1);
}
console.log('✓ La base está lista. Falta que la rutina publique su primera corrida.');
