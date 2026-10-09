/**
 * pages/Novedades.tsx — la pantalla principal.
 *
 * Sin `:id` en la URL muestra la última corrida; con `:id`, esa. Es la misma
 * pantalla porque es la misma información: una corrida vieja no se lee distinto
 * de la de hoy, y así se puede mandar por mail el link de una corrida puntual.
 *
 * Por default muestra SÓLO lo que se sube o se modifica en Odoo (altas,
 * vinculaciones, y los errores al intentarlo). Lo que no se puede sincronizar
 * (omitidos) y lo que no es asunto de la rutina (fuera de alcance) queda detrás
 * de su propio filtro, separado: está para auditar, no para trabajar desde ahí.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { api, ApiError, descargar, getArchivo } from '../lib/api';
import type { Corrida, Novedad, RespuestaResumen, TipoNovedad } from '../lib/types';
import { duracion, fechaHora } from '../lib/format';
import type { ContextoLayout } from '../components/Layout';
import TablaNovedades from '../components/TablaNovedades';
import {
  BadgeEstado, BadgeModo, BannerAlerta, BannerError, BannerInfo, Boton, Cargando,
  Chip, KPI, Seccion, TituloPagina, Vacio,
} from '../components/ui';

type Filtro = 'sincronizar' | 'altas' | 'vincular' | 'atencion' | 'nuevas' | 'omitidas' | 'fuera';

const SE_SINCRONIZA = new Set(['alta', 'vincular', 'error']);

export default function Novedades() {
  const { me } = useOutletContext<ContextoLayout>();
  const { id } = useParams();

  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoNovedad>('cliente');
  const [filtro, setFiltro] = useState<Filtro>('sincronizar');
  const [bajando, setBajando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      if (id) {
        const [c, n] = await Promise.all([
          api.get<{ corrida: Corrida }>(`/api/corridas/${id}`),
          api.get<{ novedades: Novedad[] }>(`/api/corridas/${id}/novedades`),
        ]);
        setCorrida(c.corrida);
        setNovedades(n.novedades);
      } else {
        const r = await api.get<RespuestaResumen>('/api/corridas/resumen');
        setCorrida(r.corrida);
        setNovedades(r.novedades);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Los filtros se aplican acá y no pidiéndole otra vez al server: la corrida
  // entera ya está en memoria y cada click sería un viaje de red. El .xlsx sí
  // lo arma el server, y va sin filtros: es el registro completo.
  const visibles = useMemo(() => {
    const delTipo = novedades.filter((n) => n.tipo === tipo);
    const aSincronizar = delTipo.filter((n) => SE_SINCRONIZA.has(n.accion));
    switch (filtro) {
      case 'altas': return aSincronizar.filter((n) => n.accion === 'alta');
      case 'vincular': return aSincronizar.filter((n) => n.accion === 'vincular');
      case 'atencion': return aSincronizar.filter((n) => n.requiere_atencion);
      case 'nuevas': return aSincronizar.filter((n) => n.es_nueva);
      case 'omitidas': return delTipo.filter((n) => n.accion === 'omitido');
      case 'fuera': return delTipo.filter((n) => n.accion === 'fuera_alcance');
      default: return aSincronizar;
    }
  }, [novedades, tipo, filtro]);

  const cuenta = useMemo(() => {
    const delTipo = novedades.filter((n) => n.tipo === tipo);
    const t = delTipo.filter((n) => SE_SINCRONIZA.has(n.accion));
    return {
      sincronizar: t.length,
      altas: t.filter((n) => n.accion === 'alta').length,
      vincular: t.filter((n) => n.accion === 'vincular').length,
      atencion: t.filter((n) => n.requiere_atencion).length,
      nuevas: t.filter((n) => n.es_nueva).length,
      omitidas: delTipo.filter((n) => n.accion === 'omitido').length,
      fuera: delTipo.filter((n) => n.accion === 'fuera_alcance').length,
    };
  }, [novedades, tipo]);

  const porTipo = useMemo(() => ({
    cliente: novedades.filter((n) => n.tipo === 'cliente' && SE_SINCRONIZA.has(n.accion)).length,
    concepto: novedades.filter((n) => n.tipo === 'concepto' && SE_SINCRONIZA.has(n.accion)).length,
  }), [novedades]);

  // Un filtro que no existe en la otra solapa (vincular es sólo de clientes,
  // fuera de alcance sólo de conceptos) dejaría la tabla vacía sin explicación.
  function cambiarTipo(t: TipoNovedad) {
    setTipo(t);
    if (filtro === 'vincular' || filtro === 'fuera') setFiltro('sincronizar');
  }

  async function exportar() {
    if (!corrida) return;
    setBajando(true);
    try {
      const { blob, nombre } = await getArchivo(`/api/corridas/${corrida.id}/excel`);
      descargar(blob, nombre || `sincro-corrida-${corrida.id}.xlsx`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBajando(false);
    }
  }

  if (cargando) return <Cargando label="Buscando la última corrida" />;
  if (error) return <BannerError>{error}</BannerError>;

  if (!corrida) {
    return (
      <>
        <TituloPagina titulo="Novedades" sub="Todavía no hay ninguna corrida publicada" />
        <Vacio>
          <p className="font-semibold text-slate-500">La rutina todavía no corrió.</p>
          <p className="mt-2 text-xs max-w-lg mx-auto">
            Esta pantalla se llena cuando <code className="font-mono">sincronizar.py</code> publica su
            primera corrida. Mientras tanto no hay nada que mirar — y no se escribió nada en Odoo.
          </p>
          <p className="mt-2 text-xs">
            <Link to="/ayuda" className="text-dassa underline font-semibold">Cómo se dispara la rutina</Link>
          </p>
        </Vacio>
      </>
    );
  }

  // Una corrida 0.1 iba al revés (Odoo → DEPOFIS). Se puede abrir desde el
  // historial, pero hay que decirlo: sus filas no significan lo mismo.
  const esVieja = (corrida.version_rutina || '').startsWith('0.1.');
  const esUltima = !id;
  const puedeExportar = me.permissions.includes('sincro.exportar');
  const tc = corrida.totales?.clientes || {};
  const tk = corrida.totales?.conceptos || {};

  return (
    <>
      <TituloPagina
        titulo={<>Novedades <span className="text-slate-400 font-normal text-base">· corrida #{corrida.id}</span></>}
        sub={
          <>
            {fechaHora(corrida.iniciada_en)} · {corrida.origen === 'cron' ? 'automática' : corrida.disparada_por || 'manual'}
            {' · '}{duracion(corrida.duracion_ms)}
            {!esUltima && <> · <Link to="/" className="text-dassa underline">ver la última</Link></>}
          </>
        }
        accion={
          <div className="flex items-center gap-2">
            <BadgeModo modo={corrida.modo} />
            <BadgeEstado estado={corrida.estado} />
            {puedeExportar && (
              <Boton tipo="secundario" onClick={exportar} disabled={bajando}>
                {bajando ? 'Generando…' : '⬇ Excel'}
              </Boton>
            )}
          </div>
        }
      />

      {esVieja && (
        <BannerAlerta>
          <strong>Corrida de la versión anterior (Odoo → DEPOFIS).</strong> Esa versión comparaba en
          el sentido contrario y sus filas no significan lo mismo que las de ahora. Se conserva como
          registro histórico.
        </BannerAlerta>
      )}

      {/* Lo primero que hay que saber al abrir la pantalla: si esto ya se
          escribió en Odoo o no. */}
      {corrida.modo === 'simulacion' ? (
        <BannerInfo>
          <strong>Simulación.</strong> Nada de esto se escribió en Odoo: es lo que la rutina
          <em> haría</em>. DEPOFIS sólo se lee — la rutina no puede escribirle.
        </BannerInfo>
      ) : (
        <BannerAlerta>
          <strong>Aplicación.</strong> {corrida.ejecutadas} de {corrida.a_sincronizar} cambios se
          escribieron en Odoo y se verificaron (marcados con ✓).
          {corrida.ejecutadas < corrida.a_sincronizar && ' El resto no se ejecutó (tope --limite).'}
        </BannerAlerta>
      )}

      <BannerInfo>
        DEPOFIS se leyó del <strong>espejo</strong> (<code className="font-mono">depofis_mirror</code>).
        {corrida.fuente_sincronizada_en
          ? <> Última sincronización del espejo: <strong>{fechaHora(corrida.fuente_sincronizada_en)}</strong>.</>
          : null}
        {' '}Lo que se haya cargado en DEPOFIS después de esa hora todavía no se ve acá.
      </BannerInfo>

      {corrida.estado === 'fallida' && corrida.error && (
        <BannerError>
          <p className="font-bold">La corrida falló.</p>
          <pre className="mt-1 text-[10px] whitespace-pre-wrap font-mono max-h-40 overflow-auto">{corrida.error}</pre>
        </BannerError>
      )}

      {corrida.anterior_id == null && !esVieja && (
        <BannerInfo>
          Es la primera corrida: no hay una anterior contra la cual comparar, así que todavía
          no hay nada marcado como <strong>NUEVA</strong>.
        </BannerInfo>
      )}

      {corrida.altas_sin_vendedor > 0 && (
        <BannerAlerta>
          <strong>{corrida.altas_sin_vendedor} de las {corrida.altas_clientes} altas de cliente
          entran a Odoo sin Salesperson.</strong>{' '}
          Su vendedor en DEPOFIS (0, 1, 2, 9 o 19) no tiene usuario en Odoo. Se dan de alta igual;
          el Salesperson hay que asignarlo a mano en la ficha del contacto.{' '}
          <button type="button" className="underline font-semibold"
                  onClick={() => { setTipo('cliente'); setFiltro('atencion'); }}>
            Ver cuáles
          </button>
        </BannerAlerta>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KPI titulo="Altas en Odoo" valor={corrida.altas} acento="verde"
             sub={`${corrida.altas_clientes} clientes · ${corrida.altas_conceptos} conceptos`} />
        <KPI titulo="A vincular" valor={corrida.vinculaciones}
             sub="existen en Odoo por CUIT, sin Código DEPOFIS" />
        <KPI titulo="Sin Salesperson" valor={corrida.altas_sin_vendedor}
             acento={corrida.altas_sin_vendedor ? 'ambar' : 'slate'}
             sub="altas de cliente" />
        <KPI titulo="No se pueden" valor={corrida.omitidos}
             acento={corrida.omitidos ? 'ambar' : 'slate'}
             sub="CUIT inválido o duplicados" />
        <KPI titulo="Errores" valor={corrida.errores}
             acento={corrida.errores ? 'rojo' : 'slate'}
             sub="Odoo los rechazó" />
        <KPI titulo="Ya sincronizados" valor={(tc.sin_cambios ?? 0) + (tk.sin_cambios ?? 0)}
             sub={`${tc.sin_cambios ?? 0} clientes · ${tk.sin_cambios ?? 0} conceptos`} />
      </div>

      <Seccion
        titulo={
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => cambiarTipo('cliente')}
                    className={`px-2 py-1 rounded-md text-xs font-bold ${tipo === 'cliente' ? 'bg-dassa text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>
              Clientes ({porTipo.cliente})
            </button>
            <button type="button" onClick={() => cambiarTipo('concepto')}
                    className={`px-2 py-1 rounded-md text-xs font-bold ${tipo === 'concepto' ? 'bg-dassa text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>
              Conceptos ({porTipo.concepto})
            </button>
          </span>
        }
        sub={tipo === 'cliente'
          ? `DASSA.Clientes → res.partner · sólo clientes activos${tc.inactivos ? ` (${tc.inactivos} inactivos no se miran)` : ''}`
          : 'DASSA.Concepfc → product.template · el código es la Referencia Interna de Odoo'}
        accion={
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Chip label="A sincronizar" activo={filtro === 'sincronizar'} count={cuenta.sincronizar} onClick={() => setFiltro('sincronizar')} />
            <Chip label="Altas" activo={filtro === 'altas'} count={cuenta.altas} onClick={() => setFiltro('altas')} acento="ok" />
            {tipo === 'cliente' && (
              <Chip label="Vincular" activo={filtro === 'vincular'} count={cuenta.vincular} onClick={() => setFiltro('vincular')} />
            )}
            <Chip label="Nuevas" activo={filtro === 'nuevas'} count={cuenta.nuevas} onClick={() => setFiltro('nuevas')} />
            <Chip label="Atención" activo={filtro === 'atencion'} count={cuenta.atencion} onClick={() => setFiltro('atencion')} acento="alerta" />
            {/* Separado del resto a propósito: no es trabajo de sincronización,
                es lo que no entra. Está para revisarlo, no para trabajar desde ahí. */}
            {(cuenta.omitidas > 0 || cuenta.fuera > 0) && <span className="text-slate-300 select-none">|</span>}
            {cuenta.omitidas > 0 && (
              <Chip label="No se pueden" activo={filtro === 'omitidas'} count={cuenta.omitidas}
                    onClick={() => setFiltro('omitidas')} acento="alerta" />
            )}
            {cuenta.fuera > 0 && (
              <Chip label="No son conceptos" activo={filtro === 'fuera'} count={cuenta.fuera}
                    onClick={() => setFiltro('fuera')} />
            )}
          </div>
        }
      >
        {filtro === 'omitidas' && (
          <BannerInfo>
            <strong>Estos registros de DEPOFIS no se pueden sincronizar solos.</strong> El motivo de
            cada fila dice qué hay que corregir: un CUIT inválido se corrige en DEPOFIS; un contacto
            duplicado en Odoo se fusiona en Odoo. En la próxima corrida entran solos.
          </BannerInfo>
        )}
        {filtro === 'fuera' && (
          <BannerInfo>
            <strong>Estas filas de Concepfc no son conceptos:</strong> separadores de sección
            (<code className="font-mono">----IMPORTACION MARITIMA----</code>), filas sin detalle,
            conceptos marcados “NO USAR” y la fila de prueba 999999. No se llevan a Odoo.
          </BannerInfo>
        )}
        <TablaNovedades key={tipo} novedades={visibles} tipo={tipo} />
      </Seccion>
    </>
  );
}
