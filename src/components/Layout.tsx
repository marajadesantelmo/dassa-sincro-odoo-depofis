/**
 * components/Layout.tsx — header, navegación y carga de /api/me.
 *
 * Mismo header que el resto de las apps hijas: rojo DASSA, botón a la app
 * madre, email y rol a la derecha. Las páginas reciben el usuario por el
 * contexto del Outlet.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { api, ApiForbiddenError, ApiUnauthorizedError, ssoRefreshUrl } from '../lib/api';
import type { Me } from '../lib/types';
import { BannerError, Cargando } from './ui';

/**
 * Por qué no se pudo entrar. Importa distinguirlos: son problemas distintos y
 * la acción que los resuelve es distinta.
 *
 *   · `sin-sesion` (401) — no hay cookie o venció. Se arregla entrando.
 *   · `sin-acceso` (403) — hay sesión, pero el IdP no le dio acceso a ESTA app
 *     (denegación por default: sin fila en `user_app_access` no entra nadie, ni
 *     un superadmin). Volver a loguearse NO lo arregla, y ofrecerle un link de
 *     login es mandarlo a dar vueltas.
 */
type Falla = 'sin-sesion' | 'sin-acceso' | 'otro';

const NAV = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors';

export default function Layout() {
  const [me, setMe] = useState<Me | null>(null);
  const [falla, setFalla] = useState<Falla | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api.get<Me>('/api/me')
      .then(setMe)
      .catch((err) => {
        setMe(null);
        if (err instanceof ApiUnauthorizedError) setFalla('sin-sesion');
        else if (err instanceof ApiForbiddenError) setFalla('sin-acceso');
        else { setFalla('otro'); setDetalle(String(err?.message || err)); }
      })
      .finally(() => setCargando(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <header className="bg-dassa text-white px-3 sm:px-6 py-2 flex items-center gap-3 shadow-md sticky top-0 z-30">
        <a
          href="https://apps.dassa.com.ar"
          target="_top"
          className="inline-flex items-center gap-1.5 rounded-md bg-white/15 hover:bg-white/25 px-2 py-1 text-xs font-semibold"
        >
          🏠 <span className="hidden sm:inline">Apps DASSA</span>
        </a>

        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">🔄</span>
          <Link to="/" className="font-extrabold tracking-tight text-sm sm:text-base truncate hover:opacity-90">
            Sincro Odoo <span className="opacity-70">→</span> DEPOFIS
          </Link>
        </div>

        <nav className="flex items-center gap-1.5 ml-2">
          <NavLink
            to="/corridas"
            className={({ isActive }) => `${NAV} ${isActive ? 'bg-white text-dassa' : 'bg-white/15 text-white hover:bg-white/25'}`}
            title="Todas las corridas de la rutina"
          >
            🗂️ <span className="hidden sm:inline">Corridas</span>
          </NavLink>
          <NavLink
            to="/vendedores"
            className={({ isActive }) => `${NAV} ${isActive ? 'bg-white text-dassa' : 'bg-white/15 text-white hover:bg-white/25'}`}
            title="Cómo se traduce el vendedor de Odoo al código de DEPOFIS"
          >
            👤 <span className="hidden sm:inline">Vendedores</span>
          </NavLink>
          <NavLink
            to="/ayuda"
            className={({ isActive }) => `${NAV} ${isActive ? 'bg-white text-dassa' : 'bg-white/15 text-white hover:bg-white/25'}`}
            title="Qué hace la rutina y qué significa cada cosa"
          >
            📖 <span className="hidden sm:inline">Ayuda</span>
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2 text-xs">
          {me && <span className="hidden md:inline truncate max-w-[180px]">{me.email}</span>}
          {me && <span className="bg-white/20 px-2 py-0.5 rounded-full whitespace-nowrap">{me.role}</span>}
          {me && <a href="/sincro-odoo-depofis/__sso/logout" className="text-white/80 hover:text-white text-[11px] underline">salir</a>}
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-4 space-y-4">
        {cargando && <Cargando label="Verificando sesión" />}

        {!cargando && !me && falla === 'sin-sesion' && (
          <BannerError>
            Sin sesión activa ·{' '}
            <a href={ssoRefreshUrl('/')} className="underline font-semibold">
              Iniciar sesión vía Apps DASSA
            </a>
          </BannerError>
        )}

        {/* 403: tiene sesión pero no tiene acceso otorgado a esta app. Acá NO
            va un link de login — no arregla nada y sólo lo hace dar vueltas. */}
        {!cargando && !me && falla === 'sin-acceso' && (
          <BannerError>
            <p className="font-bold">Todavía no tenés acceso a Sincro Odoo → DEPOFIS.</p>
            <p className="mt-1 text-xs">
              Tu sesión de Apps DASSA está bien: lo que falta es que te habiliten esta app.
              Volver a iniciar sesión no lo resuelve.
            </p>
            <p className="mt-1 text-xs">
              Es una app de acceso restringido. Pedíselo a Sistemas —{' '}
              <a href="mailto:facundo@pymetech.com.ar?subject=Acceso%20a%20Sincro%20Odoo"
                 className="underline font-semibold">facundo@pymetech.com.ar</a>
              {' '}— y contale con qué mail entrás.
            </p>
          </BannerError>
        )}

        {!cargando && !me && falla === 'otro' && (
          <BannerError>
            No se pudo verificar la sesión: {detalle} ·{' '}
            <a href={ssoRefreshUrl('/')} className="underline font-semibold">
              reintentar
            </a>
          </BannerError>
        )}
        {me && <Outlet context={{ me } satisfies ContextoLayout} />}
      </main>

      <footer className="text-center text-[10px] text-slate-400 py-4">
        dassa-sincro-odoo-depofis · maestros de Odoo contra DEPOFIS · la rutina corre aparte, esto es la ventana
      </footer>
    </div>
  );
}

export interface ContextoLayout {
  me: Me;
}
