/**
 * pages/Corridas.tsx — el histórico.
 *
 * Una fila por corrida, la más nueva arriba. Sirve para dos cosas concretas:
 * ver si la rutina siguió corriendo (una fecha vieja arriba de todo es la
 * señal de que el cron se cayó), y abrir una corrida puntual para comparar.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Corrida } from '../lib/types';
import { duracion, fechaHora } from '../lib/format';
import {
  BadgeEstado, BadgeModo, BannerError, Cargando, Seccion, Tabla, Td, Th, TituloPagina, Vacio,
} from '../components/ui';

export default function Corridas() {
  const [corridas, setCorridas] = useState<Corrida[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ corridas: Corrida[] }>('/api/corridas?limite=100')
      .then((r) => setCorridas(r.corridas))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) return <Cargando label="Cargando el histórico" />;
  if (error) return <BannerError>{error}</BannerError>;

  return (
    <>
      <TituloPagina
        titulo="Corridas"
        sub="Cada ejecución de la rutina, la más reciente arriba"
      />

      <Seccion>
        {!corridas.length ? (
          <Vacio>Todavía no corrió la rutina ni una vez.</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Cuándo</Th>
                <Th>Modo</Th>
                <Th>Estado</Th>
                <Th>Origen</Th>
                <Th align="right">Evaluados</Th>
                <Th align="right">Altas</Th>
                <Th align="right">Omitidos</Th>
                <Th align="right">Atención</Th>
                <Th align="right">Sin vendedor</Th>
                <Th align="right">Errores</Th>
                <Th align="right">Duración</Th>
              </tr>
            </thead>
            <tbody>
              {corridas.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <Link to={`/corridas/${c.id}`} className="text-dassa font-bold hover:underline">
                      {c.id}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">{fechaHora(c.iniciada_en)}</Td>
                  <Td><BadgeModo modo={c.modo} /></Td>
                  <Td><BadgeEstado estado={c.estado} /></Td>
                  <Td className="text-slate-500 text-[11px]">
                    {c.origen === 'cron' ? 'automática' : (c.disparada_por || c.origen)}
                  </Td>
                  <Td align="right" className="tabular-nums">{c.evaluados}</Td>
                  <Td align="right" className="tabular-nums font-semibold text-emerald-700">{c.altas}</Td>
                  <Td align="right" className="tabular-nums text-slate-500">{c.omitidos}</Td>
                  <Td align="right" className={`tabular-nums ${c.requieren_atencion ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}>
                    {c.requieren_atencion}
                  </Td>
                  <Td align="right" className={`tabular-nums ${c.altas_sin_vendedor ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}>
                    {c.altas_sin_vendedor}
                  </Td>
                  <Td align="right" className={`tabular-nums ${c.errores ? 'text-rose-700 font-semibold' : 'text-slate-400'}`}>
                    {c.errores}
                  </Td>
                  <Td align="right" className="text-slate-500 text-[11px] whitespace-nowrap">
                    {duracion(c.duracion_ms)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Seccion>
    </>
  );
}
