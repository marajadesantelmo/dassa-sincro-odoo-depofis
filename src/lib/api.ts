/**
 * lib/api.ts — cliente HTTP contra el backend de sincro-odoo-depofis.
 *
 * El backend vive en el mismo origin que el SPA (base /sincro-odoo-depofis/). Todas las
 * llamadas mandan la cookie SSO firmada con credentials: 'include'.
 * Un 401 lanza ApiUnauthorizedError para que el Layout mande al refresh del IdP.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, ''); // "/sincro-odoo-depofis"

export class ApiUnauthorizedError extends Error {
  constructor() { super('unauthorized'); this.name = 'ApiUnauthorizedError'; }
}
export class ApiForbiddenError extends Error {
  constructor() { super('forbidden'); this.name = 'ApiForbiddenError'; }
}
export class ApiError extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, message: string) {
    super(message);
    this.status = status;
    this.codigo = codigo;
    this.name = 'ApiError';
  }
}

export function ssoRefreshUrl(next = '/'): string {
  const destino = `${BASE}${next.startsWith('/') ? next : '/' + next}`;
  return `https://apps.dassa.com.ar/sso/refresh?app=sincro-odoo-depofis&next=${encodeURIComponent(destino)}`;
}

/** Extrae `{error, message}` del cuerpo, con un fallback legible. */
function mensajeDe(body: unknown, path: string, status: number): { codigo: string; mensaje: string } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    return {
      codigo: typeof b.error === 'string' ? b.error : 'error',
      mensaje: typeof b.message === 'string' ? b.message : `${path} → HTTP ${status}`,
    };
  }
  return { codigo: 'error', mensaje: `${path} → HTTP ${status}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (r.status === 401) throw new ApiUnauthorizedError();
  if (r.status === 403) throw new ApiForbiddenError();

  let body: unknown;
  try { body = r.status === 204 ? null : await r.json(); } catch { body = null; }

  if (!r.ok) {
    const { codigo, mensaje } = mensajeDe(body, path, r.status);
    throw new ApiError(r.status, codigo, mensaje);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
};

/**
 * GET que devuelve un archivo en vez de JSON.
 *
 * Si el servidor falla, la respuesta SÍ es JSON: se detecta por el content-type
 * en vez de asumir, así un error se muestra con su mensaje en lugar de bajar un
 * .xlsx corrupto de 40 bytes.
 */
export async function getArchivo(path: string): Promise<{ blob: Blob; nombre: string | null }> {
  const r = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (r.status === 401) throw new ApiUnauthorizedError();
  if (r.status === 403) throw new ApiForbiddenError();

  if (!r.ok || (r.headers.get('content-type') || '').includes('application/json')) {
    let payload: unknown = null;
    try { payload = await r.json(); } catch { /* cuerpo no-JSON: cae al fallback */ }
    const { codigo, mensaje } = mensajeDe(payload, path, r.status);
    throw new ApiError(r.status, codigo, mensaje);
  }

  // El nombre lo decide el server (lleva la fecha, el id y el modo).
  const cd = r.headers.get('content-disposition') || '';
  const m = /filename="([^"]+)"/.exec(cd);
  return { blob: await r.blob(), nombre: m ? m[1] : null };
}

/** Dispara la descarga de un blob con el nombre dado. */
export function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar en el mismo tick cancela la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
