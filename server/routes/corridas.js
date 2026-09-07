/**
 * routes/corridas.js — lo que lee la pantalla.
 *
 * Todas las rutas exigen `sincro.ver`; la exportación exige además
 * `sincro.exportar`. No hay una sola ruta de escritura acá: la app no dispara
 * la sincronización (ver CLAUDE.md § Decisiones #1). Lo único que escribe es
 * `/api/servicio/*`, que es de la rutina y no de las personas.
 */
import { Router } from 'express';
import { requirePermission } from '../lib/sda.js';
import * as svc from '../lib/corridas.js';
import { armarLibro, nombreArchivo } from '../lib/excel.js';

const router = Router();
const asy = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requirePermission('sincro.ver'));

/** Los filtros de la tabla, tal como llegan del querystring. */
function filtrosDe(req) {
  const tipo = req.query.tipo === 'cliente' || req.query.tipo === 'concepto' ? req.query.tipo : null;
  const accion = ['alta', 'omitido', 'error'].includes(req.query.accion) ? req.query.accion : null;
  return {
    tipo,
    accion,
    atencion: req.query.atencion === 'true',
    nuevas: req.query.nuevas === 'true',
  };
}

function idDe(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new svc.ErrorDeNegocio('id_invalido', 'Id de corrida inválido.');
  }
  return id;
}

/**
 * GET /api/corridas/resumen — la pantalla principal: última corrida + novedades.
 *
 * Va declarada ANTES de `/:id`: Express toma la primera que matchea, y con el
 * orden invertido "resumen" entraría como id y devolvería id_invalido.
 *
 * Devuelve `corrida: null` cuando todavía no corrió ninguna, en vez de 404: no
 * es un error, es el estado inicial del proyecto y la pantalla tiene algo
 * concreto que decir al respecto.
 */
router.get('/resumen', asy(async (_req, res) => {
  res.json(await svc.resumen());
}));

/** GET /api/corridas — el histórico. */
router.get('/', asy(async (req, res) => {
  const limite = Number(req.query.limite) || 50;
  res.json({ corridas: await svc.listarCorridas({ limite }) });
}));

/** GET /api/corridas/:id — la cabecera de una corrida puntual. */
router.get('/:id', asy(async (req, res) => {
  const corrida = await svc.traerCorrida(idDe(req));
  if (!corrida) throw new svc.ErrorDeNegocio('corrida_inexistente', 'Esa corrida no existe.', 404);
  res.json({ corrida });
}));

/** GET /api/corridas/:id/novedades — las filas, con los filtros aplicados. */
router.get('/:id/novedades', asy(async (req, res) => {
  const id = idDe(req);
  const corrida = await svc.traerCorrida(id);
  if (!corrida) throw new svc.ErrorDeNegocio('corrida_inexistente', 'Esa corrida no existe.', 404);
  res.json({ novedades: await svc.listarNovedades(id, filtrosDe(req)) });
}));

/**
 * GET /api/corridas/:id/excel — la corrida entera en .xlsx.
 *
 * Ignora los filtros de pantalla a propósito: el archivo es el registro
 * completo de la corrida. Filtrar es una decisión de quien mira, no del
 * documento que se archiva.
 */
router.get('/:id/excel', requirePermission('sincro.exportar'), asy(async (req, res) => {
  const id = idDe(req);
  const corrida = await svc.traerCorrida(id);
  if (!corrida) throw new svc.ErrorDeNegocio('corrida_inexistente', 'Esa corrida no existe.', 404);

  const novedades = await svc.listarNovedades(id, {});
  const buffer = await armarLibro({ corrida, novedades });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo(corrida)}"`);
  res.send(Buffer.from(buffer));
}));

export default router;
