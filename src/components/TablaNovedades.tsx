/**
 * components/TablaNovedades.tsx — la tabla de la pantalla principal.
 *
 * Dos juegos de columnas: clientes y conceptos muestran cosas distintas y
 * meterlos en una sola tabla obligaría a dejar la mitad de las celdas vacías.
 *
 * El orden se resuelve en el navegador: la corrida entera ya está en memoria.
 */
import { useMemo, useState } from 'react';
import type { Novedad, TipoNovedad } from '../lib/types';
import { vendedorLegible } from '../lib/format';
import {
  BadgeAccion, BadgeDassa, BadgeNueva, CodigoVendedor, Tabla, Td, Th, ThOrden, Vacio,
} from './ui';

type Dir = 'asc' | 'desc';

/** Valor por el que se ordena cada columna. Se saca de la fila y no del DOM
 *  para que el orden sea el mismo que usa el .xlsx. */
function valorDe(n: Novedad, campo: string): string | number {
  switch (campo) {
    case 'odoo_nombre': return n.odoo_nombre.toLowerCase();
    case 'clave': return n.clave || '';
    case 'accion': return n.accion;
    case 'vendedor': return n.vendedor_nombre?.toLowerCase() || 'zzz';
    // Los sin resolver van al final en ascendente: son los que hay que mirar,
    // pero mirarlos es tarea del filtro "requieren atención", no del orden.
    case 'vendedor_depofis': return n.vendedor_depofis ?? 999;
    case 'calcula': return n.payload.calcula || '';
    case 'grupo': return n.payload.grupo || '';
    case 'clie_nro': return n.payload.clie_nro ?? 0;
    default: return n.odoo_nombre.toLowerCase();
  }
}

export default function TablaNovedades({ novedades, tipo }: { novedades: Novedad[]; tipo: TipoNovedad }) {
  const [orden, setOrden] = useState(tipo === 'cliente' ? 'odoo_nombre' : 'clave');
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
          <ThOrden campo="odoo_nombre" {...props}>Nombre en Odoo</ThOrden>
          <ThOrden campo="clave" {...props}>{tipo === 'cliente' ? 'CUIT' : 'Ref. Interna'}</ThOrden>
          <ThOrden campo="accion" align="center" {...props}>Acción</ThOrden>
          {tipo === 'cliente' ? (
            <>
              <ThOrden campo="vendedor" {...props}>Salesperson (Odoo)</ThOrden>
              <Th align="center" sticky>Cliente DASSA</Th>
              <ThOrden campo="vendedor_depofis" align="center" {...props}>Vendedor DEPOFIS</ThOrden>
              <ThOrden campo="clie_nro" align="right" {...props}>clie_nro</ThOrden>
            </>
          ) : (
            <>
              <ThOrden campo="calcula" {...props}>Unidad de cálculo</ThOrden>
              <ThOrden campo="grupo" {...props}>Grupo</ThOrden>
            </>
          )}
          <Th sticky>Motivo</Th>
        </tr>
      </thead>
      <tbody>
        {ordenadas.map((n) => {
          const v = vendedorLegible(n);
          return (
            <tr
              key={n.id}
              className={n.requiere_atencion ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50'}
            >
              <Td className="whitespace-nowrap">
                {n.es_nueva && <BadgeNueva />}
                {n.requiere_atencion && <span className="ml-1" title="Requiere que alguien haga algo">⚠</span>}
              </Td>
              <Td className="font-medium max-w-[320px] truncate" title={n.odoo_nombre}>
                {n.odoo_nombre}
              </Td>
              <Td className="font-mono text-[11px] whitespace-nowrap">{n.clave || '—'}</Td>
              <Td align="center"><BadgeAccion accion={n.accion} /></Td>

              {n.tipo === 'cliente' ? (
                <>
                  <Td className={v.resuelto ? '' : 'text-slate-400 italic'}>{v.nombre}</Td>
                  <Td align="center"><BadgeDassa es={n.es_dassa} /></Td>
                  <Td align="center">
                    <CodigoVendedor codigo={n.vendedor_depofis} cual={v.cual} />
                  </Td>
                  <Td align="right" className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {n.depofis_id || n.payload.clie_nro || '—'}
                  </Td>
                </>
              ) : (
                <>
                  <Td className="font-mono text-[11px]">{n.payload.calcula || '—'}</Td>
                  <Td className="text-slate-500 max-w-[200px] truncate" title={n.payload.grupo}>
                    {n.payload.grupo || '—'}
                  </Td>
                </>
              )}

              <Td className="text-slate-500 text-[11px] max-w-[420px]" title={n.motivo || ''}>
                {n.motivo || '—'}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Tabla>
  );
}
