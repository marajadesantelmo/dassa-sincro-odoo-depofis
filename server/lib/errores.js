/**
 * server/lib/errores.js — el error que SÍ se le cuenta al usuario.
 *
 * Separado del dominio para que lo puedan lanzar tanto `corridas.js` como los
 * routers sin que ninguno tenga que importar al otro.
 */
export class ErrorDeNegocio extends Error {
  constructor(codigo, message, status = 400) {
    super(message);
    this.name = 'ErrorDeNegocio';
    this.codigo = codigo;
    this.status = status;
  }
}
