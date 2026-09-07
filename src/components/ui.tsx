/**
 * components/ui.tsx — primitivas sin dependencias (Tailwind + React).
 *
 * Las mismas que usan las otras apps hijas, para que sincro-odoo-depofis se vea como el
 * resto del ecosistema. Lo propio de esta app son `BadgeModo`, `BadgeAccion`,
 * `BadgeNueva` y `CodigoVendedor`, abajo de todo.
 */
import type { PropsWithChildren, ReactNode } from 'react';
import type { AccionNovedad } from '../lib/types';

type Acento = 'slate' | 'rojo' | 'ambar' | 'azul' | 'verde' | 'violeta';

const ACENTO: Record<Acento, string> = {
  slate: 'bg-slate-50 border-slate-200',
  rojo: 'bg-rose-50 border-rose-200',
  ambar: 'bg-amber-50 border-amber-200',
  azul: 'bg-blue-50 border-blue-200',
  verde: 'bg-emerald-50 border-emerald-200',
  violeta: 'bg-violet-50 border-violet-200',
};

export function KPI({ titulo, valor, sub, acento = 'slate', titleAttr, onClick }: {
  titulo: string;
  valor: ReactNode;
  sub?: ReactNode;
  acento?: Acento;
  titleAttr?: string;
  onClick?: () => void;
}) {
  const contenido = (
    <>
      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-600">{titulo}</div>
      <div className="text-xl sm:text-2xl font-extrabold leading-tight text-slate-900">{valor}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </>
  );

  // Los KPI que filtran la tabla son botones de verdad, no divs con onClick:
  // se tabulan y se activan con el teclado.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={titleAttr}
        className={`text-left rounded-lg border p-3 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-dassa/40 ${ACENTO[acento]}`}
      >
        {contenido}
      </button>
    );
  }
  return <div className={`rounded-lg border p-3 ${ACENTO[acento]}`} title={titleAttr}>{contenido}</div>;
}

export function Chip({ label, activo, onClick, count, acento }: {
  label: string; activo: boolean; onClick: () => void; count?: number; acento?: 'error' | 'alerta' | 'ok';
}) {
  const inactivo = acento === 'error'
    ? 'bg-rose-100 hover:bg-rose-200 text-rose-800'
    : acento === 'alerta'
      ? 'bg-amber-100 hover:bg-amber-200 text-amber-800'
      : 'bg-slate-100 hover:bg-slate-200 text-slate-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors whitespace-nowrap ${
        activo ? 'bg-dassa text-white' : inactivo
      }`}
    >
      {label}
      {count != null && <span className={`ml-1 ${activo ? 'opacity-80' : 'opacity-70'}`}>({count})</span>}
    </button>
  );
}

export function Seccion({ titulo, accion, children, sub }: {
  titulo?: ReactNode; accion?: ReactNode; sub?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      {(titulo || accion) && (
        <header className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2 flex-wrap">
          <div>
            {titulo && <h3 className="font-bold text-sm text-slate-700">{titulo}</h3>}
            {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
          </div>
          {accion && <div className="ml-auto">{accion}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function TituloPagina({ titulo, sub, accion }: { titulo: ReactNode; sub?: ReactNode; accion?: ReactNode }) {
  return (
    <header className="flex items-end gap-3 flex-wrap">
      <div>
        <h2 className="text-lg sm:text-xl font-extrabold text-slate-800">{titulo}</h2>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
      {accion && <div className="ml-auto">{accion}</div>}
    </header>
  );
}

export function Vacio({ children }: PropsWithChildren) {
  return (
    <div className="text-center py-10 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg m-3">
      {children}
    </div>
  );
}

export function Cargando({ label = 'Cargando' }: { label?: string }) {
  return <div className="text-center py-8 text-slate-400 text-xs italic">{label}<span className="animate-pulse">…</span></div>;
}

export function BannerError({ children }: PropsWithChildren) {
  return <div className="bg-rose-100 border border-rose-300 text-rose-800 text-sm p-3 rounded">{children}</div>;
}

export function BannerInfo({ children }: PropsWithChildren) {
  return <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs p-2.5 rounded">{children}</div>;
}

export function BannerOk({ children }: PropsWithChildren) {
  return <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-2.5 rounded">{children}</div>;
}

export function BannerAlerta({ children }: PropsWithChildren) {
  return <div className="bg-amber-50 border border-amber-300 text-amber-900 text-xs p-2.5 rounded">{children}</div>;
}

export function Boton({ children, onClick, tipo = 'primario', disabled, type = 'button', title }: {
  children: ReactNode;
  onClick?: () => void;
  tipo?: 'primario' | 'secundario' | 'peligro';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const base = 'px-3 py-1.5 rounded-md text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const estilo = tipo === 'primario'
    ? 'bg-dassa text-white hover:bg-dassa-dark'
    : tipo === 'peligro'
      ? 'bg-white text-rose-700 border border-rose-300 hover:bg-rose-50'
      : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50';
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${estilo}`}>
      {children}
    </button>
  );
}

/**
 * Tabla con scroll horizontal propio: la página nunca scrollea de costado.
 *
 * `alto` (una clase `max-h-*` de Tailwind) le da además scroll vertical propio.
 * Es lo que hace falta para que los encabezados `sticky` se peguen al borde de
 * la tabla: sin un contenedor con scroll se pegarían al viewport y quedarían
 * tapados por el header de la app, que también es sticky.
 */
export function Tabla({ children, alto }: PropsWithChildren<{ alto?: string }>) {
  return (
    <div className={alto ? `overflow-auto ${alto}` : 'overflow-x-auto'}>
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  );
}

// Las clases van escritas enteras: Tailwind escanea el código como texto y no
// genera nada que se arme con template strings (`text-${align}` sale vacío).
const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/**
 * Con `border-collapse: collapse` el borde inferior de un `<th>` sticky se
 * despega al scrollear: el borde pertenece a la celda, no al thead, y queda
 * pintado en la posición original. Se reemplaza por un box-shadow, que sí
 * viaja con el elemento.
 */
const STICKY = 'sticky top-0 z-10 shadow-[inset_0_-1px_0_0_rgb(203,213,225)]';

export function Th({ children, align = 'left', sticky = false }: PropsWithChildren<{
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}>) {
  return (
    <th className={`px-2 py-1.5 bg-slate-100 text-slate-600 font-bold text-[10px] uppercase tracking-wide whitespace-nowrap ${ALIGN[align]} ${sticky ? STICKY : 'border-b border-slate-200'}`}>
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className = '', title }: PropsWithChildren<{
  align?: 'left' | 'right' | 'center';
  className?: string;
  title?: string;
}>) {
  return (
    <td title={title} className={`px-2 py-1 border-b border-slate-100 ${ALIGN[align]} ${className}`}>
      {children}
    </td>
  );
}

/**
 * Encabezado que ordena la tabla al hacerle click.
 *
 * El orden se resuelve en el navegador: la corrida entera ya está en memoria
 * (~460 filas) y ordenar contra la base sería un viaje de red por click.
 */
export function ThOrden({ children, campo, orden, dir, onOrden, align = 'left', sticky = false }: PropsWithChildren<{
  campo: string;
  orden: string;
  dir: 'asc' | 'desc';
  onOrden: (campo: string) => void;
  align?: 'left' | 'right' | 'center';
  sticky?: boolean;
}>) {
  const activo = orden === campo;
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={`px-0 py-0 bg-slate-100 whitespace-nowrap ${ALIGN[align]} ${sticky ? STICKY : 'border-b border-slate-200'}`}>
      <button
        type="button"
        onClick={() => onOrden(campo)}
        aria-sort={activo ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`w-full px-2 py-1.5 flex items-center gap-1 ${justify} font-bold text-[10px] uppercase tracking-wide transition-colors ${
          activo ? 'text-dassa' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        {children}
        {/* El indicador ocupa lugar siempre, así el encabezado no salta de
            ancho al cambiar de columna ordenada. */}
        <span className={activo ? 'opacity-100' : 'opacity-25'}>
          {activo ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

// ─── Propias de sincro-odoo-depofis ───────────────────────────────────────────────

/**
 * Simulación vs aplicación.
 *
 * Es el badge más importante de la app: dice si lo que se está mirando ya se
 * escribió en DEPOFIS o si es una previsualización. Por eso simulación va en
 * azul informativo y aplicación en el rojo de la marca — no al revés: el rojo
 * marca lo que tiene consecuencias.
 */
export function BadgeModo({ modo }: { modo: 'simulacion' | 'aplicacion' }) {
  return modo === 'aplicacion'
    ? <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold border bg-dassa text-white border-dassa-dark whitespace-nowrap">APLICACIÓN</span>
    : <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold border bg-blue-100 text-blue-800 border-blue-200 whitespace-nowrap">SIMULACIÓN</span>;
}

export function BadgeEstado({ estado }: { estado: string }) {
  const estilo = estado === 'ok'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : estado === 'con_errores'
      ? 'bg-amber-100 text-amber-900 border-amber-300'
      : estado === 'fallida'
        ? 'bg-rose-100 text-rose-800 border-rose-300'
        : 'bg-slate-100 text-slate-600 border-slate-300';
  const texto = estado === 'con_errores' ? 'CON ERRORES' : estado.toUpperCase().replace('_', ' ');
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${estilo}`}>{texto}</span>;
}

export function BadgeAccion({ accion }: { accion: AccionNovedad }) {
  // `fuera_alcance` va en gris apagado y con otra etiqueta: no es una acción
  // que la rutina tomó sobre un cliente, es "esto no era asunto nuestro".
  if (accion === 'fuera_alcance') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border bg-slate-50 text-slate-400 border-slate-200 whitespace-nowrap">
        PROVEEDOR
      </span>
    );
  }
  const estilo = accion === 'alta'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : accion === 'error'
      ? 'bg-rose-100 text-rose-800 border-rose-300'
      : 'bg-slate-100 text-slate-600 border-slate-300';
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap ${estilo}`}>{accion.toUpperCase()}</span>;
}

export function BadgeNueva() {
  return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border bg-violet-100 text-violet-800 border-violet-200 whitespace-nowrap">NUEVA</span>;
}

export function BadgeDassa({ es }: { es: boolean | null }) {
  if (es == null) return <span className="text-slate-300">—</span>;
  return es
    ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border bg-dassa/10 text-dassa-dark border-dassa/30 whitespace-nowrap">DASSA</span>
    : <span className="text-slate-400 text-[10px]">propio</span>;
}

/**
 * El código que va a DASSA.Clientes.vendedor.
 *
 * Cuando no se pudo resolver muestra un guión en ámbar y NO un 0: el 0 de
 * DEPOFIS es un código real con 523 clientes asignados, así que un cero acá se
 * leería como un dato bueno.
 */
export function CodigoVendedor({ codigo, cual }: { codigo: number | null; cual?: string }) {
  if (codigo == null) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border bg-amber-100 text-amber-900 border-amber-300 whitespace-nowrap"
            title="No se pudo resolver: el cliente se daría de alta sin vendedor">
        sin resolver
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="font-mono font-bold text-slate-900 tabular-nums">{codigo}</span>
      {cual && <span className="text-[10px] text-slate-400">{cual}</span>}
    </span>
  );
}
