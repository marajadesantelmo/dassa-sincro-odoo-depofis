/**
 * components/TablaNovedades.tsx — la tabla de la pantalla principal.
 *
 * Cada fila es un registro de DEPOFIS y lo que la rutina hace (o haría) con él
 * en Odoo. Dos juegos de columnas: clientes y conceptos muestran cosas
 * distintas y meterlos en una sola tabla dejaría la mitad de las celdas vacías.
 *
 * El orden se resuelve en el navegador: la corrida entera ya está en memoria.
 */
import { useMemo, useState } from 'react';
import type { Novedad, TipoNovedad } from '../lib/types';
import {
  BadgeAccion, BadgeDassa, BadgeNueva, Salesperson, Tabla, Td, Th, ThOrden, Vacio,
} from './ui';

type Dir = 'asc' | 'desc';

const ODOO_URL = 'https://gestion.dassa.com.ar';

/** Link a la ficha en Odoo. El formato `/web#id=` es el viejo, pero Odoo 19
 *  lo sigue redirigiendo y no depende del id de la acción de cada menú. */
function LinkOdoo({ id, model }: { id: number | null; model: string }) {
  if (id == null) return <span className="text-slate-300">—</span>;
  return (
    <a href={`${ODOO_URL}/web#id=${id}&model=${model}&view_type=form`} target="_blank" rel="noreferrer"
       className="font-mono text-[11px] text-dassa underline tabular-nums">
      {id}
    </a>
  );
}

/** Valor por el que se ordena cada columna. Se saca de la fila y no del DOM. */
function valorDe(n: Novedad, campo: string): string | number {
  switch (campo) {
    case 'nombre': return n.odoo_nombre.toLowerCase();
    case 'clave': return n.clave || '';
    case 'depofis_id': return Number(n.depofis_id) || 0;
    case 'accion': return n.accion;
    case 'vendedor_depofis': return n.vendedor_depofis ?? 999;
    // Los sin Salesperson van al final en ascendente.
    case 'salesperson': return n.vendedor_nombre?.toLowerCase() || 'zzz';
    case 'grupo': return n.payload.depofis?.grupo || '';
    default: return n.odoo_nombre.toLowerCase();
  }
}

export default function TablaNovedades({ novedades, tipo }: { novedades: Novedad[]; tipo: TipoNovedad }) {
  const [orden, setOrden] = useState(tipo === 'cliente' ? 'nombre' : 'clave');
  const [dir, setDir] = useState<Dir>('asc');

  const ordenadas = useMemo(() => {
    const copia = [...novedades];
    copia.sort((a, b) => {
      const va = valorDe(a, orden);
      const vb = valorDe(b, orden);
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return copia;
  }, [novedades, orden, dir]);

  function ordenarPor(campo: string) {
    if (campo === orden) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setOrden(campo); setDir('asc'); }
  }

  if (!novedades.length) {
    return <Vacio>Ninguna fila con estos filtros.</Vacio>;
  }

  const props = { orden, dir, onOrden: ordenarPor, sticky: true };

  return (
    <Tabla alto="max-h-[70vh]">
      <thead>
        <tr>
          <Th sticky>{/* marcas */}</Th>
          {tipo === 'cliente' ? (
            <>
              <ThOrden campo="depofis_id" align="right" {...props}>clie_nro</ThOrden>
              <ThOrden campo="nombre" {...props}>Cliente (DEPOFIS)</ThOrden>
              <ThOrden campo="clave" {...props}>CUIT</ThOrden>
              <ThOrden campo="accion" align="center" {...props}>En Odoo</ThOrden>
              <ThOrden campo="vendedor_depofis" align="center" {...props}>Vendedor DEPOFIS</ThOrden>
              <ThOrden campo="salesperson" {...props}>Salesperson</ThOrden>
              <Th align="center" sticky>Cliente DASSA</Th>
              <Th align="right" sticky>Contacto Odoo</Th>
            </>
          ) : (
            <>
              <ThOrden campo="clave" {...props}>Código</ThOrden>
              <ThOrden campo="nombre" {...props}>Concepto (DEPOFIS)</ThOrden>
              <ThOrden campo="accion" align="center" {...props}>En Odoo</ThOrden>
              <ThOrden campo="grupo" {...props}>Grupo</ThOrden>
              <Th align="right" sticky>Producto Odoo</Th>
            </>
          )}
          <Th sticky>Motivo</Th>
        </tr>
      </thead>
      <tbody>
        {ordenadas.map((n) => (
          <tr
            key={n.id}
            className={n.requiere_atencion ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50'}
          >
            <Td className="whitespace-nowrap">
              {n.es_nueva && <BadgeNueva />}
              {n.requiere_atencion && <span className="ml-1" title="Requiere que alguien haga algo">⚠</span>}
            </Td>

            {n.tipo === 'cliente' ? (
              <>
                <Td align="right" className="font-mono text-[11px] text-slate-500 tabular-nums">{n.depofis_id || '—'}</Td>
                <Td className="font-medium max-w-[320px] truncate" title={n.odoo_nombre}>{n.odoo_nombre}</Td>
                <Td className="font-mono text-[11px] whitespace-nowrap">{n.clave || '—'}</Td>
                <Td align="center" className="whitespace-nowrap">
                  <BadgeAccion accion={n.accion} tipo={n.tipo} />
                  {n.ejecutada && <span className="ml-1 text-emerald-700" title="Hecho y verificado en Odoo">✓</span>}
                </Td>
                <Td align="center" className="font-mono font-bold tabular-nums">{n.vendedor_depofis ?? '—'}</Td>
                <Td><Salesperson nombre={n.vendedor_nombre} /></Td>
                <Td align="center"><BadgeDassa es={n.es_dassa} /></Td>
                <Td align="right"><LinkOdoo id={n.odoo_id} model="res.partner" /></Td>
              </>
            ) : (
              <>
                <Td className="font-mono text-[11px] whitespace-nowrap">{n.clave || '—'}</Td>
                <Td className="font-medium max-w-[360px] truncate" title={n.odoo_nombre}>{n.odoo_nombre}</Td>
                <Td align="center" className="whitespace-nowrap">
                  <BadgeAccion accion={n.accion} tipo={n.tipo} />
                  {n.ejecutada && <span className="ml-1 text-emerald-700" title="Hecho y verificado en Odoo">✓</span>}
                </Td>
                <Td className="text-slate-500 max-w-[200px] truncate" title={n.payload.depofis?.grupo}>
                  {n.payload.depofis?.grupo || '—'}
                </Td>
                <Td align="right"><LinkOdoo id={n.odoo_id} model="product.template" /></Td>
              </>
            )}

            <Td className="text-slate-500 text-[11px] max-w-[420px]" title={n.motivo || ''}>
              {n.motivo || '—'}
            </Td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );
}
