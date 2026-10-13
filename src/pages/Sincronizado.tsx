/**
 * pages/Sincronizado.tsx — el historial: todo lo que la rutina escribió en Odoo.
 *
 * Es la pantalla de inicio. Cada corrida horaria hace pocas cosas (o ninguna),
 * así que mirar sólo la última no dice qué pasó: esto junta las altas y las
 * vinculaciones de TODAS las corridas, las que se escribieron y verificaron
 * (`ejecutada`). Lo que no se pudo sincronizar vive en "Última corrida".
 *
 * El historial viene entero y se filtra en el navegador: son pocas filas por
 * día, y así cada filtro es instantáneo.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, ApiError, descargar, getArchivo } from '../lib/api';
import type { RespuestaSincronizados, Sincronizado as Fila, TipoNovedad } from '../lib/types';
import { fechaHora } from '../lib/format';
import type { ContextoLayout } from '../components/Layout';
import { LinkOdoo } from '../components/TablaNovedades';
import {
  BadgeAccion, BadgeDassa, BannerAlerta, BannerError, Boton, Cargando, Chip, KPI, Salesperson,
  Seccion, Tabla, Td, Th, TituloPagina, Vacio,
} from '../components/ui';

type FiltroAccion = 'todas' | 'alta' | 'vincular';

/** 'YYYY-MM-DD' en hora de Buenos Aires, para comparar con los <input type="date">. */
function diaLocal(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

const soloDigitos = (s: string) => s.replace(/\D/g, '');

export default function Sincronizado() {
  const { me } = useOutletContext<ContextoLayout>();

  const [filas, setFilas] = useState<Fila[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoNovedad>('cliente');
  const [accion, setAccion] = useState<FiltroAccion>('todas');
  const [buscar, setBuscar] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [bajando, setBajando] = useState(false);

  useEffect(() => {
    api.get<RespuestaSincronizados>('/api/sincronizados')
      .then((r) => { setFilas(r.filas); setTruncado(r.truncado); })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, []);

  const totales = useMemo(() => ({
    altasClientes: filas.filter((f) => f.tipo === 'cliente' && f.accion === 'alta').length,
    vinculaciones: filas.filter((f) => f.tipo === 'cliente' && f.accion === 'vincular').length,
    conceptos: filas.filter((f) => f.tipo === 'concepto').length,
    sinSalesperson: filas.filter((f) => f.tipo === 'cliente' && f.accion === 'alta' && f.vendedor_uid == null).length,
    ultima: filas[0]?.sincronizado_en ?? null,
  }), [filas]);

  const visibles = useMemo(() => {
    const texto = buscar.trim().toLowerCase();
    const digitos = soloDigitos(texto);
    return filas.filter((f) => {
      if (f.tipo !== tipo) return false;
      if (accion !== 'todas' && f.accion !== accion) return false;
      const dia = diaLocal(f.sincronizado_en);
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
      if (!texto) return true;
      return f.odoo_nombre.toLowerCase().includes(texto)
        || (digitos.length > 0 && (soloDigitos(f.clave || '').includes(digitos) || (f.depofis_id || '') === digitos));
    });
  }, [filas, tipo, accion, buscar, desde, hasta]);

  const cuentaTipo = (t: TipoNovedad) => filas.filter((f) => f.tipo === t).length;
  const delTipo = filas.filter((f) => f.tipo === tipo);

  async function exportar() {
    setBajando(true);
    try {
      const { blob, nombre } = await getArchivo('/api/sincronizados/excel');
      descargar(blob, nombre || 'sincro-historial.xlsx');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBajando(false);
    }
  }

  if (cargando) return <Cargando label="Cargando el historial" />;
  if (error) return <BannerError>{error}</BannerError>;

  const puedeExportar = me.permissions.includes('sincro.exportar');
  const hayFiltros = buscar || desde || hasta || accion !== 'todas';

  return (
    <>
      <TituloPagina
        titulo="Sincronizado"
        sub="Todo lo que la rutina dio de alta o vinculó en Odoo, de todas las corridas"
        accion={puedeExportar && filas.length > 0 ? (
          <Boton tipo="secundario" onClick={exportar} disabled={bajando}>
            {bajando ? 'Generando…' : '⬇ Excel'}
          </Boton>
        ) : undefined}
      />

      {truncado && (
        <BannerAlerta>
          El historial superó el tope de filas del servidor y se muestran sólo las más recientes.
        </BannerAlerta>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <KPI titulo="Clientes dados de alta" valor={totales.altasClientes} acento="verde"
             sub={totales.sinSalesperson ? `${totales.sinSalesperson} sin Salesperson al darse de alta` : 'creados en Odoo'} />
        <KPI titulo="Clientes vinculados" valor={totales.vinculaciones}
             sub="existían en Odoo, se les cargó el Código DEPOFIS" />
        <KPI titulo="Conceptos dados de alta" valor={totales.conceptos} sub="productos creados en Odoo" />
        <KPI titulo="Total" valor={filas.length} sub="escrituras en Odoo verificadas" />
        <KPI titulo="Última sincronización" valor={<span className="text-base">{totales.ultima ? fechaHora(totales.ultima) : '—'}</span>}
             sub={<Link to="/ultima" className="underline">ver la última corrida</Link>} />
      </div>

      <Seccion
        titulo={
          <span className="flex items-center gap-1">
            {(['cliente', 'concepto'] as const).map((t) => (
              <button key={t} type="button" onClick={() => { setTipo(t); setAccion('todas'); }}
                      className={`px-2 py-1 rounded-md text-xs font-bold ${tipo === t ? 'bg-dassa text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>
                {t === 'cliente' ? 'Clientes' : 'Conceptos'} ({cuentaTipo(t)})
              </button>
            ))}
          </span>
        }
        sub={tipo === 'cliente' ? 'DASSA.Clientes → res.partner' : 'DASSA.Concepfc → product.template'}
        accion={
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {tipo === 'cliente' && (
              <>
                <Chip label="Todas" activo={accion === 'todas'} count={delTipo.length} onClick={() => setAccion('todas')} />
                <Chip label="Altas" activo={accion === 'alta'} acento="ok"
                      count={delTipo.filter((f) => f.accion === 'alta').length} onClick={() => setAccion('alta')} />
                <Chip label="Vinculados" activo={accion === 'vincular'}
                      count={delTipo.filter((f) => f.accion === 'vincular').length} onClick={() => setAccion('vincular')} />
              </>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-2 px-3 py-2 border-b border-slate-100 text-xs">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase font-bold text-slate-500">Buscar</span>
            <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)}
                   placeholder={tipo === 'cliente' ? 'nombre, CUIT o clie_nro' : 'nombre o código'}
                   className="border border-slate-300 rounded px-2 py-1 w-56" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase font-bold text-slate-500">Desde</span>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                   className="border border-slate-300 rounded px-2 py-1" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase font-bold text-slate-500">Hasta</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
                   className="border border-slate-300 rounded px-2 py-1" />
          </label>
          {hayFiltros && (
            <button type="button" className="text-dassa underline font-semibold pb-1"
                    onClick={() => { setBuscar(''); setDesde(''); setHasta(''); setAccion('todas'); }}>
              limpiar filtros
            </button>
          )}
          <span className="ml-auto text-slate-400 pb-1">{visibles.length} de {delTipo.length}</span>
        </div>

        {!filas.length ? (
          <Vacio>Todavía no se sincronizó nada en Odoo.</Vacio>
        ) : !visibles.length ? (
          <Vacio>Ninguna fila con estos filtros.</Vacio>
        ) : (
          <Tabla alto="max-h-[70vh]">
            <thead>
              <tr>
                <Th sticky>Fecha</Th>
                <Th sticky align="right">Corrida</Th>
                {tipo === 'cliente' ? (
                  <>
                    <Th sticky align="center">Acción</Th>
                    <Th sticky align="right">clie_nro</Th>
                    <Th sticky>Cliente (DEPOFIS)</Th>
                    <Th sticky>CUIT</Th>
                    <Th sticky align="center">Vendedor DEPOFIS</Th>
                    <Th sticky>Salesperson</Th>
                    <Th sticky align="center">Cliente DASSA</Th>
                    <Th sticky align="right">Contacto Odoo</Th>
                  </>
                ) : (
                  <>
                    <Th sticky>Código</Th>
                    <Th sticky>Concepto (DEPOFIS)</Th>
                    <Th sticky>Grupo</Th>
                    <Th sticky align="right">Producto Odoo</Th>
                  </>
                )}
                <Th sticky>Detalle</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap text-[11px] text-slate-600">{fechaHora(f.sincronizado_en)}</Td>
                  <Td align="right">
                    <Link to={`/corridas/${f.corrida_id}`} className="font-mono text-[11px] text-dassa underline">
                      #{f.corrida_id}
                    </Link>
                  </Td>
                  {tipo === 'cliente' ? (
                    <>
                      <Td align="center"><BadgeAccion accion={f.accion} /></Td>
                      <Td align="right" className="font-mono text-[11px] text-slate-500 tabular-nums">{f.depofis_id || '—'}</Td>
                      <Td className="font-medium max-w-[300px] truncate" title={f.odoo_nombre}>{f.odoo_nombre}</Td>
                      <Td className="font-mono text-[11px] whitespace-nowrap">{f.clave || '—'}</Td>
                      <Td align="center" className="font-mono font-bold tabular-nums">{f.vendedor_depofis ?? '—'}</Td>
                      <Td><Salesperson nombre={f.vendedor_nombre} /></Td>
                      <Td align="center"><BadgeDassa es={f.es_dassa} /></Td>
                      <Td align="right"><LinkOdoo id={f.odoo_id} model="res.partner" /></Td>
                    </>
                  ) : (
                    <>
                      <Td className="font-mono text-[11px] whitespace-nowrap">{f.clave || '—'}</Td>
                      <Td className="font-medium max-w-[360px] truncate" title={f.odoo_nombre}>{f.odoo_nombre}</Td>
                      <Td className="text-slate-500 max-w-[200px] truncate">{f.payload.depofis?.grupo || '—'}</Td>
                      <Td align="right"><LinkOdoo id={f.odoo_id} model="product.template" /></Td>
                    </>
                  )}
                  <Td className="text-slate-500 text-[11px] max-w-[380px] truncate" title={f.motivo || ''}>
                    {f.motivo || '—'}
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
