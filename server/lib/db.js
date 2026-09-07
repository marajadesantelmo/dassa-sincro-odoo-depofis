/**
 * server/lib/db.js — pool contra Smart DASSA Central, schema `sincro_odoo_depofis`.
 *
 * ⚠️ El DSN tiene que ir por el pooler IPv4 `aws-1-sa-east-1` — el direct
 * connection (`db.<ref>.supabase.co`) es IPv6-only y el VPS no rutea IPv6.
 * Y es `aws-1-`, no `aws-0-`: ese devuelve "Tenant or user not found".
 */
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const DSN = process.env.SINCRO_ODOO_DEPOFIS_PG_DSN;

// `max: 2` no es tacañería: el cupo del pooler es compartido por TODO el
// ecosistema y ya hubo un incidente de agotamiento (S6, 2026-06-12). Esta app
// la miran tres personas y la escribe una rutina que corre una vez por día.
export const pool = new Pool({
  connectionString: DSN,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Publicar una corrida son unos pocos INSERT por lote. Con el default (sin
  // límite) una consulta trabada dejaría la conexión colgada.
  statement_timeout: 30000,
});

pool.on('error', (err) => console.error('[sincro-odoo-depofis][db] pool error:', err.message));

export function dbConfigurada() {
  return Boolean(DSN);
}

export async function query(text, params) {
  const inicio = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.LOG_QUERIES === 'true') {
      console.log('[sincro-odoo-depofis][db]', {
        text: text.replace(/\s+/g, ' ').slice(0, 90),
        ms: Date.now() - inicio,
        rows: res.rowCount,
      });
    }
    return res;
  } catch (err) {
    console.error('[sincro-odoo-depofis][db] error:', {
      text: text.replace(/\s+/g, ' ').slice(0, 90),
      error: err.message,
    });
    throw err;
  }
}

/** Corre `fn` dentro de una transacción, con COMMIT/ROLLBACK garantizados. */
export async function enTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const salida = await fn(cliente);
    await cliente.query('COMMIT');
    return salida;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => { /* la conexión ya murió */ });
    throw err;
  } finally {
    cliente.release();
  }
}

export async function ping() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function cerrarPool() {
  await pool.end().catch(() => { /* apagando igual */ });
}
