/**
 * server/index.js — servidor de la app hija "sincro-odoo-depofis".
 *
 * App hija registrada en Smart DASSA Apps (IdP):
 *   app_key: sincro-odoo-depofis · public_url: https://apps.dassa.com.ar/sincro-odoo-depofis/
 *
 * Sigue la política madre-hijas:
 *   - usa @dassa/apps-sdk/express (regla #5)
 *   - expone /__sso/consume con consumeTicket() (regla #4)
 *   - sin login propio, sin tabla users (regla #1)
 *   - denegación por default y fail-loud al boot (reglas #7 y #8)
 *
 * La única excepción al SSO es /api/servicio/*, que autentica a
 * `sincronizar.py` con un token de máquina. Ver server/lib/servicio.js.
 *
 * 🔒 Acceso restringido a tres personas (Facundo, Santiago, Manuel). Lo que lo
 * hace cumplir NO es una lista en un archivo: es la tabla `user_app_access` del
 * IdP, que deniega por default a quien no tenga fila. Auditarlo con
 * `node scripts/setup-idp.cjs --quien`.
 */
// Carga el .env del cwd antes de que cualquier módulo lea process.env.
// Los secretos NO se pasan por el `env:` de pm2: ahí quedan visibles con
// `ps auxe` para cualquier usuario del box.
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { consumeTicket, requireSession, whoami, logout } from './lib/sda.js';
import { dbConfigurada, ping, cerrarPool } from './lib/db.js';
import { servicioConfigurado } from './lib/servicio.js';
import { ErrorDeNegocio } from './lib/errores.js';
import meRouter from './routes/me.js';
import corridasRouter from './routes/corridas.js';
import servicioRouter from './routes/servicio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '../dist');
const PORT = parseInt(process.env.PORT || '3038', 10);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ─── Seguridad ───────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Vite inyecta estilos en línea para los componentes.
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const ORIGENES = (process.env.CORS_ORIGIN || 'http://localhost:5188')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ORIGENES.includes(origin)) return cb(null, true);
    console.warn('[sincro-odoo-depofis][CORS] origen rechazado:', origin);
    return cb(null, false);
  },
  credentials: true,
}));

// ─── Rate limit ──────────────────────────────────────────────────────────
// La app la miran tres personas: el límite general es holgado y no molesta a
// nadie, pero corta un scrapeo.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { error: 'rate_limited', message: 'Demasiadas solicitudes. Esperá unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const ssoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'sso_rate_limited', message: 'Demasiados intentos de inicio de sesión.' },
  standardHeaders: true,
  legacyHeaders: false,
});
// La rutina publica una corrida en pocos POST: abrir, dos o tres lotes, cerrar.
// Un límite propio y chico evita que un bucle mal escrito en el script llene la
// tabla, sin depender de que el script se porte bien.
const servicioLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: { error: 'servicio_rate_limited', message: 'Demasiadas publicaciones seguidas.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);
app.use('/__sso/', ssoLimiter);
app.use('/api/servicio/', servicioLimiter);

// Un lote de ~500 novedades con su payload pesa ~1 MB.
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─── Health (público, antes del SSO) ─────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    app: 'sincro-odoo-depofis',
    env: process.env.NODE_ENV || 'development',
    db_configurada: dbConfigurada(),
    db: await ping(),
    servicio_configurado: servicioConfigurado(),
    ts: new Date().toISOString(),
  });
});

// ─── Versión del frontend (para avisar de un deploy nuevo) ───────────────
let _version = null;
function versionFront() {
  if (_version) return _version;
  try {
    _version = createHash('sha1').update(readFileSync(join(DIST_DIR, 'index.html'))).digest('hex').slice(0, 12);
  } catch { _version = 'dev'; }
  return _version;
}
app.get('/api/version', (_req, res) => res.json({ version: versionFront() }));

// ─── SSO ─────────────────────────────────────────────────────────────────
app.get('/__sso/consume', consumeTicket());
app.get('/__sso/whoami', whoami());
app.get('/__sso/logout', logout());

// ─── API de máquina ──────────────────────────────────────────────────────
// Va ANTES del requireSession() global: `sincronizar.py` no tiene cookie SSO.
// Su propio middleware la autentica con el token de servicio.
app.use('/api/servicio', servicioRouter);

// ─── API protegida ───────────────────────────────────────────────────────
// Denegación por default: de acá para abajo todo exige sesión. Los permisos
// finos van en cada router.
app.use('/api', requireSession());
app.use('/api/me', meRouter);
app.use('/api/corridas', corridasRouter);

// ─── Frontend estático ───────────────────────────────────────────────────
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1h' }));
  // El SPA maneja su propio routing: cualquier ruta que no sea /api ni /__sso
  // devuelve el index.
  app.get(/^\/(?!api\/|__sso\/).*/, (_req, res) => res.sendFile(join(DIST_DIR, 'index.html')));
} else {
  console.warn('[sincro-odoo-depofis] dist/ no existe — corré `npm run build` antes de servir el frontend.');
}

// ─── Errores ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;

  // Lo que es una regla de negocio se le cuenta al usuario tal cual: "esa
  // corrida ya está cerrada", "el lote viene vacío". Es lo que le permite
  // entender qué pasó sin llamar a Sistemas.
  if (err instanceof ErrorDeNegocio) {
    return res.status(err.status || 400).json({ error: err.codigo, message: err.message });
  }

  console.error('[sincro-odoo-depofis] error:', err);

  // Los errores de conexión a la base también se muestran, con su causa. Un
  // 500 mudo hace que el usuario piense que rompió algo él.
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT' || /timeout|pool/i.test(err?.message || '')) {
    return res.status(503).json({
      error: 'base_no_disponible',
      message: 'No se puede conectar con la base. Reintentá en un minuto.',
    });
  }

  res.status(500).json({ error: 'error_interno', message: 'Algo falló procesando la solicitud.' });
});

// ─── Arranque ────────────────────────────────────────────────────────────
// Fail-loud parcial: sin base la app levanta igual (el SSO y el health tienen
// que responder para que el IdP y Fortaleza la vean), pero lo grita en el log,
// porque en ese estado no puede mostrar una sola corrida.
if (!dbConfigurada()) {
  console.error('[sincro-odoo-depofis] ⚠ SINCRO_ODOO_DEPOFIS_PG_DSN NO configurado.');
  console.error('[sincro-odoo-depofis]   La app levanta, pero toda consulta va a fallar.');
}
if (!servicioConfigurado()) {
  console.warn('[sincro-odoo-depofis] ⚠ SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN ausente o corto (<32).');
  console.warn('[sincro-odoo-depofis]   `sincronizar.py` no va a poder publicar ninguna corrida.');
}

const server = app.listen(PORT, () => {
  console.log(`[sincro-odoo-depofis] escuchando en :${PORT} · env=${process.env.NODE_ENV || 'development'}`);
});

function apagar(sig) {
  console.log(`[sincro-odoo-depofis] ${sig} — cerrando`);
  server.close(async () => {
    await cerrarPool();
    process.exit(0);
  });
  // Si algo queda colgado, no dejamos el proceso zombie eternamente.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));
