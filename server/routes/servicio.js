/**
 * routes/servicio.js — la puerta de `sincronizar.py`.
 *
 * NO pasa por el SSO: lo autentica un token de máquina (lib/servicio.js). Por
 * eso el alcance es mínimo — abrir una corrida, publicarle novedades, cerrarla.
 * Nada de borrar, nada de leer corridas ajenas, nada de tocar el IdP.
 *
 * El protocolo es de tres pasos y no de uno solo (un POST gigante con todo)
 * por dos razones concretas:
 *   1. una corrida que se cae a la mitad queda registrada como 'fallida' con su
 *      traceback, en vez de desaparecer sin dejar rastro;
 *   2. los lotes entran de a ~500 filas, que es lo que un body de 2 MB aguanta
 *      sin tener que subir el límite para todos los endpoints.
 */
import { Router } from 'express';
import { requireServicio } from '../lib/servicio.js';
import * as svc from '../lib/corridas.js';

const router = Router();
const asy = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireServicio());

/**
 * POST /api/servicio/corridas — abre una corrida.
 *
 * El body trae el modo, contra qué instancias se corrió y el VENDEDOR_MAP que
 * la rutina va a usar. Ese mapa se guarda con la corrida: es lo que permite
 * explicar, meses después, por qué a un cliente le tocó el código que le tocó.
 */
router.post('/corridas', asy(async (req, res) => {
  const corrida = await svc.abrirCorrida(req.body || {});
  console.log(`[sincro-odoo-depofis][servicio] corrida ${corrida.id} abierta · modo=${corrida.modo} origen=${corrida.origen}`);
  res.status(201).json({ corrida });
}));

/** POST /api/servicio/corridas/:id/novedades — un lote de filas evaluadas. */
router.post('/corridas/:id/novedades', asy(async (req, res) => {
  const id = idDe(req);
  const { insertadas } = await svc.publicarNovedades(id, req.body?.novedades);
  res.status(201).json({ insertadas });
}));

/**
 * POST /api/servicio/corridas/:id/cerrar — el punto final.
 *
 * Mientras una corrida no se cierre no aparece en la pantalla: `v_ultima_corrida`
 * sólo mira las completadas. Es lo que evita que alguien lea conteos a medio
 * publicar y crea que faltan cosas.
 */
router.post('/corridas/:id/cerrar', asy(async (req, res) => {
  const id = idDe(req);
  const cerrada = await svc.cerrarCorrida(id, req.body || {});
  console.log(`[sincro-odoo-depofis][servicio] corrida ${id} cerrada · estado=${cerrada.estado} · ${cerrada.duracion_ms} ms`);
  res.json({ corrida: cerrada });
}));

function idDe(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new svc.ErrorDeNegocio('id_invalido', 'Id de corrida inválido.');
  }
  return id;
}

export default router;
