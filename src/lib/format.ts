/**
 * lib/format.ts — formateo para pantalla.
 *
 * Las fechas se muestran en la zona del navegador. El server las manda como
 * timestamptz en ISO, así que el navegador ya sabe convertirlas y no hace falta
 * fijar la zona a mano: quien mira esto está en Buenos Aires o quiere ver su
 * propia hora.
 */

export function fechaHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function duracion(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/**
 * Cómo se lee el vendedor de una fila.
 *
 * Devuelve las dos mitades por separado porque la pantalla las pinta distinto:
 * el nombre es el dato de Odoo y el código es lo que va a DEPOFIS, y confundir
 * uno con otro es exactamente lo que esta app tiene que evitar.
 */
export function vendedorLegible(n: {
  vendedor_nombre: string | null;
  es_dassa: boolean | null;
  vendedor_depofis: number | null;
}): { nombre: string; codigo: string; cual: string; resuelto: boolean } {
  const nombre = n.vendedor_nombre || 'sin Salesperson';
  if (n.vendedor_depofis == null) {
    return { nombre, codigo: '—', cual: '', resuelto: false };
  }
  return {
    nombre,
    codigo: String(n.vendedor_depofis),
    cual: n.es_dassa ? 'institucional' : 'propio',
    resuelto: true,
  };
}
