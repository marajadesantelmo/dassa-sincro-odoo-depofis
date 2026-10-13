/**
 * routes/sincronizados.js — el historial: todo lo que la rutina escribió en Odoo.
 *
 * Sólo lectura, igual que routes/corridas.js. Exige `sincro.ver`; la
 * exportación exige además `sincro.exportar`.
 */
import { Router } from 'express';
import { requirePermission } from '../lib/sda.js';
import * as svc from '../lib/corridas.js';
import { armarLibroHistorial, nombreArchivoHistorial } from '../lib/excel.js';

const router = Router();
const asy = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requirePermission('sincro.ver'));

/** GET /api/sincronizados — el historial entero; la pantalla filtra. */
router.get('/', asy(async (_req, res) => {
  res.json(await svc.listarSincronizados());
}));

/** GET /api/sincronizados/excel — el historial entero en .xlsx. */
router.get('/excel', requirePermission('sincro.exportar'), asy(async (_req, res) => {
  const { filas } = await svc.listarSincronizados();
  const buffer = await armarLibroHistorial(filas);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivoHistorial()}"`);
  res.send(Buffer.from(buffer));
}));

export default router;
