/**
 * server/lib/sda.js — init del SDK oficial @dassa/apps-sdk/express.
 *
 * Política madre-hijas (regla firme #5): toda app hija usa el SDK oficial.
 * Sin login propio, sin tabla `users`, sin JWT casero.
 *
 * App registrada en Smart DASSA Apps:
 *   app_key: sincro-odoo-depofis · public_url: https://apps.dassa.com.ar/sincro-odoo-depofis/
 *
 * El SDK es CommonJS; en ESM el import default toma module.exports.
 */
import 'dotenv/config';
import dassaApps from '@dassa/apps-sdk/express.js';

const APP_KEY = 'sincro-odoo-depofis';

function requerido(clave) {
  const v = process.env[clave];
  if (!v || v.length < 32) throw new Error(`[sda] env ${clave} requerido (>= 32 chars)`);
  return v;
}

dassaApps.init({
  appKey: APP_KEY,
  ssoServerUrl: process.env.DASSA_APPS_SSO_URL || 'http://127.0.0.1:3040',
  ssoServerPublicUrl: process.env.DASSA_APPS_SSO_PUBLIC_URL || 'https://apps.dassa.com.ar',
  ssoSecret: requerido('DASSA_APPS_SSO_SECRET'),
  sessionSecret: requerido('LOCAL_SESSION_SECRET'),
  sessionTtlMinutes: parseInt(process.env.SSO_SESSION_TTL_MIN || '60', 10),
  cookieName: process.env.SSO_COOKIE_NAME || 'sincro_odoo_depofis_sso_session',
});

export const consumeTicket = dassaApps.consumeTicket;
export const requireSession = dassaApps.requireSession;
export const requirePermission = dassaApps.requirePermission;
export const whoami = dassaApps.whoami;
export const logout = dassaApps.logout;

export default dassaApps;
