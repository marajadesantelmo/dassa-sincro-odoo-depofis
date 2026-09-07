/**
 * server/lib/servicio.js — autenticación de máquina para `sincronizar.py`.
 *
 * El SSO de DASSA es de personas: emite tickets para un navegador. La rutina
 * corre por cron, sin navegador y sin usuario, así que necesita otra puerta.
 *
 * Es una puerta angosta a propósito:
 *   · un solo header, un solo secreto, comparado en tiempo constante;
 *   · habilita SÓLO /api/servicio/* — abrir una corrida, publicarle novedades
 *     y cerrarla. No puede borrar corridas ni leer nada de otra app;
 *   · si la variable no está seteada, las rutas devuelven 503 en vez de quedar
 *     abiertas. Un secreto ausente NUNCA es un secreto que valida.
 */
import { timingSafeEqual } from 'node:crypto';

const TOKEN = process.env.SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN || '';

export function servicioConfigurado() {
  return TOKEN.length >= 32;
}

/**
 * Compara sin filtrar la longitud ni el contenido por el tiempo de respuesta.
 * `timingSafeEqual` exige buffers del mismo largo, así que la diferencia de
 * longitud se resuelve antes — y por eso se compara contra el largo esperado,
 * no entre sí.
 */
function tokenValido(recibido) {
  const a = Buffer.from(recibido || '', 'utf8');
  const b = Buffer.from(TOKEN, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireServicio() {
  return (req, res, next) => {
    if (!servicioConfigurado()) {
      return res.status(503).json({
        error: 'servicio_no_configurado',
        message: 'SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN no está seteado en el box.',
      });
    }

    const header = req.get('x-sincro-odoo-depofis-token') || '';
    if (!tokenValido(header)) {
      console.warn('[sincro-odoo-depofis][servicio] token inválido desde', req.ip);
      return res.status(401).json({ error: 'no_autorizado', message: 'Token de servicio inválido.' });
    }

    req.servicio = true;
    return next();
  };
}
