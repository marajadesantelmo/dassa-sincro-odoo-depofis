/**
 * pages/Novedades.tsx — la pantalla principal.
 *
 * Sin `:id` en la URL muestra la última corrida; con `:id`, esa. Es la misma
 * pantalla porque es la misma información: una corrida vieja no se lee distinto
 * de la de hoy, y así se puede mandar por mail el link de una corrida puntual.
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

type Filtro = 'todas' | 'altas' | 'atencion' | 'nuevas' | 'omitidas' | 'errores' | 'proveedores';

export default function Novedades() {
  const { me } = useOutletContext<ContextoLayout>();
  const { id } = useParams();

  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoNovedad>('cliente');
  const [filtro, setFiltro] = useState<Filtro>('todas');
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
  // entera ya está en memoria (~460 filas) y cada click sería un viaje de red.
  // El .xlsx sí lo arma el server, sin filtros: es el registro completo.
  const visibles = useMemo(() => {
    const delTipo = novedades.filter((n) => n.tipo === tipo);
    // Los proveedores NO entran en ninguna vista salvo la suya. "Todas" quiere
    // decir "todas las que esta rutina analiza", no "todas las filas que hay":
    // con 62 proveedores sobre 117 contactos, incluirlos convertía la pantalla
    // principal en una lista que nadie iba a leer.
    const enAlcance = delTipo.filter((n) => n.accion !== 'fuera_alcance');
    switch (filtro) {
      case 'altas': return enAlcance.filter((n) => n.accion === 'alta');
      case 'atencion': return enAlcance.filter((n) => n.requiere_atencion);
      case 'nuevas': return enAlcance.filter((n) => n.es_nueva);
      case 'omitidas': return enAlcance.filter((n) => n.accion === 'omitido');
      case 'errores': return enAlcance.filter((n) => n.accion === 'error');
      case 'proveedores': return delTipo.filter((n) => n.accion === 'fuera_alcance');
      default: return enAlcance;
    }
  }, [novedades, tipo, filtro]);

  const cuenta = useMemo(() => {
    const delTipo = novedades.filter((n) => n.tipo === tipo);
    const t = delTipo.filter((n) => n.accion !== 'fuera_alcance');
    return {
      todas: t.length,
      altas: t.filter((n) => n.accion === 'alta').length,
      atencion: t.filter((n) => n.requiere_atencion).length,
      nuevas: t.filter((n) => n.es_nueva).length,
      omitidas: t.filter((n) => n.accion === 'omitido').length,
      errores: t.filter((n) => n.accion === 'error').length,
      proveedores: delTipo.filter((n) => n.accion === 'fuera_alcance').length,
    };
  }, [novedades, tipo]);

  // Cambiar de solapa con el filtro "Proveedores" puesto dejaría una tabla
  // vacía sin explicación: los conceptos nunca quedan fuera de alcance.
  function cambiarTipo(t: TipoNovedad) {
    setTipo(t);
    if (filtro === 'proveedores') setFiltro('todas');
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

  // Estado inicial del proyecto: la app está deployada y la rutina todavía no
  // corrió. No es un error y no debería verse como uno.
  if (!corrida) {
    return (
      <>
        <TituloPagina titulo="Novedades" sub="Todavía no hay ninguna corrida publicada" />
        <Vacio>
          <p className="font-semibold text-slate-500">La rutina todavía no corrió.</p>
          <p className="mt-2 text-xs max-w-lg mx-auto">
            Esta pantalla se llena cuando <code className="font-mono">sincronizar.py</code> publica su
            primera corrida. Mientras tanto no hay nada que mirar — y no hay nada
            escrito en DEPOFIS.
          </p>
          <p className="mt-2 text-xs">
            <Link to="/ayuda" className="text-dassa underline font-semibold">Cómo se dispara la rutina</Link>
          </p>
        </Vacio>
      </>
    );
  }

  const esUltima = !id;
  const puedeExportar = me.permissions.includes('sincro.exportar');

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

      {/* Lo primero que hay que saber al abrir la pantalla: si esto ya se
          escribió o no. Con el proyecto en evaluación, siempre es lo segundo. */}
      {corrida.modo === 'simulacion' ? (
        <BannerInfo>
          <strong>Simulación.</strong> Nada de esto se escribió en DEPOFIS: es lo que la rutina
          <em> haría</em> si se la habilitara. Las {corrida.altas} altas de abajo están calculadas,
          no ejecutadas.
        </BannerInfo>
      ) : (
        <BannerAlerta>
          <strong>Aplicación.</strong> Las {corrida.altas} altas de esta corrida SÍ se escribieron
          en DEPOFIS.
        </BannerAlerta>
      )}

      {/* De dónde salió el lado DEPOFIS. Con el espejo, el informe se arma
          sobre una copia diaria: decirlo con la fecha evita que alguien lea
          "falta dar de alta" de un cliente que se cargó esta mañana. */}
      {corrida.fuente === 'espejo' && (
        <BannerInfo>
          El lado DEPOFIS se leyó del <strong>espejo</strong> (`depofis_mirror`), no del SQL Server.
          {corrida.fuente_sincronizada_en
            ? <> Última sincronización del espejo: <strong>{fechaHora(corrida.fuente_sincronizada_en)}</strong>.</>
            : null}
          {' '}Lo que se haya cargado en DEPOFIS después de esa hora todavía no se ve acá.
        </BannerInfo>
      )}

      {corrida.estado === 'fallida' && corrida.error && (
        <BannerError>
          <p className="font-bold">La corrida falló.</p>
          <pre className="mt-1 text-[10px] whitespace-pre-wrap font-mono max-h-40 overflow-auto">{corrida.error}</pre>
        </BannerError>
      )}

      {corrida.anterior_id == null && (
        <BannerInfo>
          Es la primera corrida: no hay una anterior contra la cual comparar, así que todavía
          no hay nada marcado como <strong>NUEVA</strong>. A partir de la próxima, la marca
          señala lo que apareció desde la última vez.
        </BannerInfo>
      )}

      {corrida.altas_sin_vendedor > 0 && (
        <BannerAlerta>
          <strong>{corrida.altas_sin_vendedor} de las {corrida.altas_clientes} altas de cliente
          quedarían sin vendedor.</strong>{' '}
          Son contactos sin <em>Salesperson</em> asignado en Odoo. La rutina no inventa un
          código: los daría de alta con <code className="font-mono">vendedor</code> en NULL.
          Se arregla cargando el Salesperson en la ficha del contacto en Odoo, antes de
          habilitar la escritura.{' '}
          <button type="button" className="underline font-semibold"
                  onClick={() => { setTipo('cliente'); setFiltro('atencion'); }}>
            Ver cuáles
          </button>
        </BannerAlerta>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KPI titulo="Analizados" valor={corrida.en_alcance}
             sub={corrida.fuera_alcance
               ? `${corrida.fuera_alcance} proveedores excluidos`
               : 'registros de Odoo mirados'} />
        <KPI titulo="Altas" valor={corrida.altas} acento="verde"
             sub={`${corrida.altas_clientes} clientes · ${corrida.altas_conceptos} conceptos`} />
        <KPI titulo="Omitidos" valor={corrida.omitidos} sub="ya existían o les falta un dato" />
        <KPI titulo="Requieren atención" valor={corrida.requieren_atencion}
             acento={corrida.requieren_atencion ? 'ambar' : 'slate'}
             sub="alguien tiene que hacer algo" />
        <KPI titulo="Sin vendedor" valor={corrida.altas_sin_vendedor}
             acento={corrida.altas_sin_vendedor ? 'ambar' : 'slate'}
             sub="altas de cliente sin Salesperson" />
        <KPI titulo="Errores" valor={corrida.errores}
             acento={corrida.errores ? 'rojo' : 'slate'}
             sub="DEPOFIS los rechazó" />
      </div>

      <Seccion
        titulo={
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => cambiarTipo('cliente')}
                    className={`px-2 py-1 rounded-md text-xs font-bold ${tipo === 'cliente' ? 'bg-dassa text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>
              Clientes ({corrida.clientes - corrida.fuera_alcance})
            </button>
            <button type="button" onClick={() => cambiarTipo('concepto')}
                    className={`px-2 py-1 rounded-md text-xs font-bold ${tipo === 'concepto' ? 'bg-dassa text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>
              Conceptos ({corrida.conceptos})
            </button>
          </span>
        }
        sub={tipo === 'cliente'
          ? 'res.partner → DASSA.Clientes · sólo clientes: los proveedores van a DASSA.Proveed y no se sincronizan'
          : 'product.template → DASSA.Concepfc · el código es la Referencia Interna de Odoo'}
        accion={
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Chip label="Todas" activo={filtro === 'todas'} count={cuenta.todas} onClick={() => setFiltro('todas')} />
            <Chip label="Altas" activo={filtro === 'altas'} count={cuenta.altas} onClick={() => setFiltro('altas')} acento="ok" />
            <Chip label="Nuevas" activo={filtro === 'nuevas'} count={cuenta.nuevas} onClick={() => setFiltro('nuevas')} />
            <Chip label="Atención" activo={filtro === 'atencion'} count={cuenta.atencion} onClick={() => setFiltro('atencion')} acento="alerta" />
            <Chip label="Omitidas" activo={filtro === 'omitidas'} count={cuenta.omitidas} onClick={() => setFiltro('omitidas')} />
            {cuenta.errores > 0 && (
              <Chip label="Errores" activo={filtro === 'errores'} count={cuenta.errores} onClick={() => setFiltro('errores')} acento="error" />
            )}
            {/* Separado del resto a propósito: no es un filtro más sobre el
                trabajo pendiente, es la puerta a lo que quedó afuera. Está para
                poder auditar la exclusión, no para trabajar desde ahí. */}
            {cuenta.proveedores > 0 && (
              <>
                <span className="text-slate-300 select-none">|</span>
                <Chip label="Proveedores" activo={filtro === 'proveedores'} count={cuenta.proveedores}
                      onClick={() => setFiltro('proveedores')} />
              </>
            )}
          </div>
        }
      >
        {filtro === 'proveedores' && (
          <BannerInfo>
            <strong>Estos contactos quedaron fuera del análisis.</strong> Son proveedores: en
            DEPOFIS viven en <code className="font-mono">DASSA.Proveed</code>, que esta rutina no
            toca. El maestro de proveedores se administra en Odoo y no necesita estar espejado
            en DEPOFIS. Se listan para poder revisar el filtro — si alguno de éstos es en
            realidad un cliente, se corrige en Odoo asignándole el <em>Salesperson</em> o la
            etiqueta de categoría comercial, y en la próxima corrida entra.
          </BannerInfo>
        )}
        <TablaNovedades novedades={visibles} tipo={tipo} />
      </Seccion>
    </>
  );
}
