#!/usr/bin/env node
'use strict';
/**
 * scripts/setup-idp.cjs — registra la app en Smart DASSA Apps y otorga accesos.
 *
 * Hace lo mismo que `POST /api/admin/apps/register` (que exige sesión de
 * superadmin en el navegador), pero directo contra el Postgres local del IdP,
 * igual que `sync-viajes-app.js` y `grant-tincho-admin-marketing.js`.
 *
 * CommonJS (.cjs) a propósito: este repo es ESM, pero el `pg` que se usa es el
 * del IdP, que es CommonJS.
 *
 * Corre EN EL BOX, como usuario `dassa` (necesita leer el .env del IdP):
 *
 *   sudo -iu dassa
 *   cd /home/dassa/dassa4/apps/sincro-odoo-depofis
 *
 *   node scripts/setup-idp.cjs                              # dry-run: qué haría
 *   node scripts/setup-idp.cjs --apply                      # registra la app
 *   node scripts/setup-idp.cjs --buscar apellido            # busca usuarios
 *   node scripts/setup-idp.cjs --quien                      # QUIÉN tiene acceso hoy
 *   node scripts/setup-idp.cjs --diag <email>               # por qué no entra
 *   node scripts/setup-idp.cjs --grant <email> --rol sincro-lector --apply
 *   node scripts/setup-idp.cjs --revocar <email> --apply    # sacarle el acceso
 *
 * Es idempotente: se puede correr las veces que haga falta.
 *
 * 🔒 Esta app es de ACCESO RESTRINGIDO (Facundo, Santiago y Manuel). Quien
 *    manda es la tabla `user_app_access` del IdP: el SSO niega por default a
 *    quien no tenga fila. `--quien` audita que siga siendo así.
 */
const fs = require('fs');
const path = require('path');

const IDP = '/home/dassa/dassa4/apps/smart-dassa-apps';
const { Client } = require(path.join(IDP, 'apps', 'api', 'node_modules', 'pg'));

// ─── .env del IdP ────────────────────────────────────────────────────────
const envRaw = fs.readFileSync(path.join(IDP, '.env'), 'utf8');
const env = {};
envRaw.split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
});
const dsn = `postgresql://${env.PG_USER}:${encodeURIComponent(env.PG_PASSWORD || '')}@${env.PG_HOST}:${env.PG_PORT}/${env.PG_DB}`;

// ─── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
const BUSCAR = arg('--buscar');
const GRANT = arg('--grant');
const REVOCAR = arg('--revocar');
const DIAG = arg('--diag');
const QUIEN = argv.includes('--quien');
const ROL = arg('--rol') || 'sincro-lector';

/**
 * Quiénes tienen que poder entrar, y nadie más.
 *
 * Requisito de Facundo (2026-09-07): esta app es de acceso restringido — él,
 * Santiago y Manuel. Esta lista NO es lo que lo hace cumplir: lo que manda es
 * la tabla `user_app_access` del IdP, y el SSO deniega por default a quien no
 * tenga fila (ver la política madre-hijas, regla #8). Acá está para que
 * `--quien` pueda comparar contra ella y avisar si aparece alguien de más.
 *
 * Los tres emails están confirmados contra `res.users` de Odoo, que es la misma
 * cuenta corporativa que usa el IdP.
 */
const AUTORIZADOS = [
  { nombre: 'Facundo Lastra', email: 'facundo@pymetech.com.ar' },
  { nombre: 'Santiago Aguirre Oliva', email: 'santiago@dassa.com.ar' },
  { nombre: 'Manuel de la Arena', email: 'manuel@dassa.com.ar' },
];

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const APP_KEY = manifest.app_key;

/**
 * Claves de rol, venga `roles` como strings o como objetos {key,name}.
 *
 * El ecosistema tiene las dos formas: dassa-orden y trafico-manager usan
 * objetos (que es lo que exige `validate-manifest.js` de la app madre) y los
 * scaffolds más nuevos usan strings. Esta app usa objetos; el helper acepta
 * ambas para que el script siga sirviendo si se copia a otra app.
 */
function clavesDeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return roles.map((r) => (typeof r === 'string' ? r : r && r.key)).filter(Boolean);
}
const PUBLIC_URL = (manifest.public_urls && manifest.public_urls[0]) || 'https://apps.dassa.com.ar/sincro-odoo-depofis/';

(async () => {
  const c = new Client({ connectionString: dsn });
  await c.connect();
  try {
    // ── modo búsqueda ────────────────────────────────────────────────────
    if (BUSCAR) {
      const r = await c.query(
        `SELECT email, full_name, status, deleted_at FROM public.users
          WHERE email ILIKE $1 OR full_name ILIKE $1
          ORDER BY (deleted_at IS NULL) DESC, full_name LIMIT 25`,
        ['%' + BUSCAR + '%']
      );
      if (!r.rows.length) console.log(`Sin coincidencias para "${BUSCAR}".`);
      for (const u of r.rows) {
        // El borrado se marca aparte: un usuario borrado queda igual en
        // 'suspended', así que la columna status sola no lo delata.
        const marca = u.deleted_at
          ? `BORRADO ${new Date(u.deleted_at).toISOString().slice(0, 10)}`
          : u.status;
        console.log(`  ${String(u.email).padEnd(38)} ${String(u.full_name || '-').padEnd(30)} ${marca}`);
      }
      return;
    }

    // ── modo auditoría: quién tiene acceso a esta app ────────────────────
    // Es lo que responde "¿sigue siendo sólo para las 3 personas?". Correrlo
    // después de cada grant, y cada tanto.
    if (QUIEN) {
      const a = await c.query('SELECT id, active FROM public.apps WHERE app_key=$1', [APP_KEY]);
      if (!a.rows.length) {
        console.log(`La app "${APP_KEY}" no está registrada todavía.`);
        return;
      }
      console.log(`Acceso a "${APP_KEY}"${a.rows[0].active ? '' : '  ⚠ APP INACTIVA'}\n`);

      const r = await c.query(
        `SELECT u.email, u.full_name, u.status, u.deleted_at,
                uaa.app_role, uaa.enabled, uaa.expires_at, uaa.granted_at
           FROM public.user_app_access uaa
           JOIN public.users u ON u.id = uaa.user_id
          WHERE uaa.app_id = $1
          ORDER BY u.email`,
        [a.rows[0].id]
      );

      if (!r.rows.length) {
        console.log('  Nadie tiene acceso todavía. La app no le aparece a ningún usuario.');
        return;
      }

      // Un acceso puede existir y no servir: deshabilitado, vencido, o sobre un
      // usuario borrado. Se marcan, porque "tiene fila" no es "puede entrar".
      const efectivos = [];
      for (const x of r.rows) {
        const vencido = x.expires_at && new Date(x.expires_at) < new Date();
        const vivo = x.enabled && !vencido && !x.deleted_at && x.status === 'active';
        if (vivo) efectivos.push(String(x.email).toLowerCase());
        const notas = [
          x.enabled ? null : 'DESHABILITADO',
          vencido ? 'VENCIDO' : null,
          x.deleted_at ? 'USUARIO BORRADO' : null,
          x.status !== 'active' ? `status=${x.status}` : null,
        ].filter(Boolean);
        console.log(`  ${vivo ? '✓' : '✗'} ${String(x.email).padEnd(36)} ${String(x.app_role).padEnd(24)}`
          + `${notas.length ? '  ← ' + notas.join(', ') : ''}`);
      }

      // Contraste contra la lista de autorizados.
      console.log(`\n  ${efectivos.length} con acceso EFECTIVO de ${r.rows.length} fila(s).`);
      const esperados = AUTORIZADOS.filter((x) => x.email).map((x) => x.email.toLowerCase());
      const sinConfirmar = AUTORIZADOS.filter((x) => !x.email).map((x) => x.nombre);

      const deMas = efectivos.filter((e) => !esperados.includes(e));
      const faltan = esperados.filter((e) => !efectivos.includes(e));

      if (deMas.length) {
        console.log('\n  ⚠ TIENEN ACCESO Y NO ESTÁN EN LA LISTA DE AUTORIZADOS:');
        for (const e of deMas) console.log(`      ${e}   → revocar: node scripts/setup-idp.cjs --revocar ${e} --apply`);
      }
      if (faltan.length) {
        console.log('\n  Autorizados que todavía NO tienen acceso:');
        for (const e of faltan) console.log(`      ${e}`);
      }
      if (sinConfirmar.length) {
        console.log(`\n  Sin email confirmado en la lista (${sinConfirmar.join(', ')}):`);
        console.log('      buscalos con --buscar y completá AUTORIZADOS en este script,');
        console.log('      así este chequeo puede detectar accesos de más.');
      }
      if (!deMas.length && !faltan.length && !sinConfirmar.length) {
        console.log('\n  ✓ El acceso coincide exactamente con la lista de autorizados.');
      }
      return;
    }

    // ── modo revocar ─────────────────────────────────────────────────────
    if (REVOCAR) {
      const a = await c.query('SELECT id FROM public.apps WHERE app_key=$1', [APP_KEY]);
      if (!a.rows.length) throw new Error(`La app "${APP_KEY}" no está registrada.`);
      const u = await c.query(
        `SELECT id, email, full_name FROM public.users
          WHERE lower(email)=lower($1) ORDER BY (deleted_at IS NULL) DESC LIMIT 1`,
        [REVOCAR]
      );
      if (!u.rows.length) throw new Error(`El usuario ${REVOCAR} no existe en el IdP.`);

      const cur = await c.query(
        'SELECT app_role, enabled FROM public.user_app_access WHERE user_id=$1 AND app_id=$2',
        [u.rows[0].id, a.rows[0].id]
      );
      if (!cur.rows.length) {
        console.log(`[OK] ${REVOCAR} no tiene acceso a "${APP_KEY}" · nada que hacer`);
        return;
      }
      console.log(`[REVOCAR] ${REVOCAR} · rol actual "${cur.rows[0].app_role}" (enabled=${cur.rows[0].enabled})`);
      if (!APPLY) { console.log('\n(DRY-RUN — sin cambios. Agregá --apply.)'); return; }

      // Se borra la fila en vez de dejarla enabled=false: el SSO trata las dos
      // igual, pero una fila muerta confunde a `--quien` y a quien audite.
      await c.query('DELETE FROM public.user_app_access WHERE user_id=$1 AND app_id=$2',
        [u.rows[0].id, a.rows[0].id]);
      console.log(`✓ Acceso revocado: ${REVOCAR} ya no ve "${APP_KEY}"`);
      console.log('  (si tenía una sesión abierta, le dura hasta que venza — máximo 60 min)');
      return;
    }

    // ── modo diagnóstico ─────────────────────────────────────────────────
    // Recorre, en orden, todo lo que tiene que estar bien para que alguien
    // pueda entrar. Se detiene mentalmente en el primer ✗: ése es el problema.
    if (DIAG) {
      console.log(`Diagnóstico de acceso · ${DIAG} → app "${APP_KEY}"\n`);
      let ok = true;

      const u = await c.query(
        `SELECT id, email, full_name, status, deleted_at, last_login_at, created_at
           FROM public.users WHERE lower(email)=lower($1)
          -- Tras volver a invitar a alguien borrado quedan DOS filas con el
          -- mismo email (el índice único es parcial). Gana la viva.
          ORDER BY (deleted_at IS NULL) DESC, created_at DESC
          LIMIT 1`,
        [DIAG]
      );
      if (!u.rows.length) {
        console.log(`✗ El usuario ${DIAG} NO existe en el IdP.`);
        const parecidos = await c.query(
          `SELECT email, full_name, status FROM public.users
            WHERE email ILIKE $1 OR full_name ILIKE $1 ORDER BY email LIMIT 10`,
          ['%' + String(DIAG).split('@')[0] + '%']
        );
        if (parecidos.rows.length) {
          console.log('\n  Usuarios parecidos:');
          for (const p of parecidos.rows) console.log(`    ${String(p.email).padEnd(38)} ${p.full_name || '-'} · ${p.status}`);
        }
        return;
      }
      const usuario = u.rows[0];
      const fecha = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');
      console.log(`✓ Usuario existe · ${usuario.email} · ${usuario.full_name || '-'}`);
      console.log(`  creado ${fecha(usuario.created_at)} · último login ${fecha(usuario.last_login_at)}`);

      // `deleted_at` primero: borrar un usuario también lo deja en 'suspended',
      // así que sin este chequeo los dos casos se ven igual — y reactivarlo NO
      // alcanza, porque el login exige deleted_at IS NULL.
      if (usuario.deleted_at) {
        ok = false;
        console.log(`✗ El usuario está BORRADO (deleted_at = ${fecha(usuario.deleted_at)}).`);
        console.log('    Reactivarlo no alcanza: el login exige deleted_at IS NULL.');
        console.log('    Esto lo tiene que resolver un superadmin del IdP, no este script.');
      } else if (usuario.status === 'active') {
        console.log(`✓ Estado: ${usuario.status}`);
      } else {
        ok = false;
        console.log(`✗ Estado: ${usuario.status} — solo un usuario "active" puede entrar a alguna app.`);
        console.log('    No es un problema de esta app: un usuario así no entra a NINGUNA.');
      }

      // Quién y cuándo. Sin esto uno se queda con "está suspendida" y no sabe
      // si fue a propósito.
      const hist = await c.query(
        `SELECT a.action, a.created_at, a.metadata, act.email AS actor
           FROM public.audit_log a
           LEFT JOIN public.users act ON act.id = a.actor_user_id
          WHERE a.target_type = 'user' AND a.target_id = $1
          ORDER BY a.created_at DESC
          LIMIT 8`,
        [usuario.id]
      );
      if (hist.rows.length) {
        console.log('\n  Historial del usuario en el IdP:');
        for (const h of hist.rows) {
          console.log(`    ${fecha(h.created_at)}  ${String(h.action).padEnd(10)} por ${h.actor || '(desconocido)'}`);
        }
      } else {
        console.log('\n  (sin registros en audit_log para este usuario)');
      }

      const a = await c.query(
        'SELECT id, active, roles, role_permissions FROM public.apps WHERE app_key=$1',
        [APP_KEY]
      );
      if (!a.rows.length) {
        console.log(`✗ La app "${APP_KEY}" no está registrada. Corré: node scripts/setup-idp.cjs --apply`);
        return;
      }
      const app = a.rows[0];
      console.log(app.active ? `✓ App registrada y activa · id=${app.id}` : `✗ La app está registrada pero INACTIVA (active=false)`);
      if (!app.active) ok = false;

      const acc = await c.query(
        `SELECT app_role, enabled, expires_at FROM public.user_app_access
          WHERE user_id=$1 AND app_id=$2`,
        [usuario.id, app.id]
      );
      if (!acc.rows.length) {
        ok = false;
        console.log('✗ NO tiene acceso otorgado a esta app — es lo que hay que arreglar:');
        console.log(`    node scripts/setup-idp.cjs --grant ${usuario.email} --rol sincro-lector --apply`);
      } else {
        const ac = acc.rows[0];
        console.log(ac.enabled ? `✓ Acceso otorgado · rol "${ac.app_role}"` : `✗ Acceso otorgado pero DESHABILITADO (enabled=false) · rol "${ac.app_role}"`);
        if (!ac.enabled) ok = false;
        if (ac.expires_at && new Date(ac.expires_at) < new Date()) {
          ok = false;
          console.log(`✗ El acceso VENCIÓ el ${new Date(ac.expires_at).toISOString().slice(0, 10)}`);
        }

        // El rol tiene que existir en el manifest sincronizado, y resolver a
        // permisos: sin permisos, el SSO la deja entrar pero la app devuelve 403.
        const rolesApp = clavesDeRoles(app.roles);
        if (!rolesApp.includes(ac.app_role)) {
          ok = false;
          console.log(`✗ El rol "${ac.app_role}" no existe en la app. Roles válidos: ${rolesApp.join(', ') || '(ninguno)'}`);
          console.log('    Sincronizá el manifest: node scripts/setup-idp.cjs --apply');
        }
        const permisos = (app.role_permissions || {})[ac.app_role] || [];
        if (permisos.length) {
          console.log(`✓ El rol resuelve a ${permisos.length} permisos: ${permisos.join(', ')}`);
        } else {
          ok = false;
          console.log(`✗ El rol "${ac.app_role}" no tiene permisos asignados — entraría y la app le devolvería 403.`);
        }
        const base = ['sincro.ver'];
        if (permisos.length && !base.some((p) => permisos.includes(p))) {
          ok = false;
          console.log(`✗ Le falta alguno de los permisos base (${base.join(' o ')}): la API rechaza todo.`);
        }
      }

      console.log('\n' + (ok ? '✓ Debería poder entrar. Si igual no puede, que cierre sesión en apps.dassa.com.ar y vuelva a entrar (la cookie vieja no tiene el permiso nuevo).' : '✗ Hay algo que arreglar, arriba.'));
      return;
    }

    // ── modo grant ───────────────────────────────────────────────────────
    if (GRANT) {
      if (!clavesDeRoles(manifest.roles).includes(ROL)) {
        throw new Error(`El rol "${ROL}" no está en el manifest. Válidos: ${clavesDeRoles(manifest.roles).join(', ')}`);
      }
      // `deleted_at IS NULL` no es opcional: borrar un usuario en el IdP es un
      // soft-delete y el índice único de email es PARCIAL. Sin este filtro se le
      // otorga acceso a una cuenta muerta y el script informa éxito — que es
      // exactamente lo que pasó con maria@dassa.com.ar.
      const u = await c.query(
        `SELECT id, full_name, status FROM public.users
          WHERE lower(email)=lower($1) AND deleted_at IS NULL`,
        [GRANT]
      );
      if (!u.rows.length) {
        const borrado = await c.query(
          `SELECT deleted_at FROM public.users
            WHERE lower(email)=lower($1) AND deleted_at IS NOT NULL
            ORDER BY deleted_at DESC LIMIT 1`,
          [GRANT]
        );
        if (borrado.rows.length) {
          throw new Error(
            `El usuario ${GRANT} está BORRADO en el IdP (${new Date(borrado.rows[0].deleted_at).toISOString().slice(0, 10)}).\n`
            + '  Darle acceso no sirve: no puede iniciar sesión.\n'
            + '  Hay que volver a invitarlo desde el panel del IdP, y recién después correr este grant.'
          );
        }
        throw new Error(`El usuario ${GRANT} no existe en el IdP. Buscalo con --buscar.`);
      }
      if (u.rows[0].status === 'suspended' || u.rows[0].status === 'archived') {
        throw new Error(`El usuario ${GRANT} está "${u.rows[0].status}": reactivalo antes de darle acceso.`);
      }
      if (u.rows[0].status !== 'active') {
        // 'invited' es lo normal en el onboarding: el acceso queda pre-otorgado
        // y sirve apenas acepte la invitación.
        console.log(`⚠ Estado "${u.rows[0].status}" — el acceso queda pre-otorgado para cuando acepte.`);
      }
      const a = await c.query('SELECT id FROM public.apps WHERE app_key=$1', [APP_KEY]);
      if (!a.rows.length) throw new Error(`La app "${APP_KEY}" no está registrada todavía. Corré primero: node scripts/setup-idp.cjs --apply`);

      const userId = u.rows[0].id;
      const appId = a.rows[0].id;
      console.log(`[USER] ${GRANT} · ${u.rows[0].full_name || '-'} · ${u.rows[0].status}`);

      const cur = await c.query(
        'SELECT app_role, enabled FROM public.user_app_access WHERE user_id=$1 AND app_id=$2',
        [userId, appId]
      );
      if (cur.rows.length && cur.rows[0].app_role === ROL && cur.rows[0].enabled === true) {
        console.log(`[OK] Ya tiene acceso con rol ${ROL} · nada que hacer`);
        return;
      }
      console.log(cur.rows.length
        ? `[ACCESS] Actual: ${cur.rows[0].app_role} (enabled=${cur.rows[0].enabled}) → ${ROL}`
        : `[ACCESS] No tenía acceso → se crea con rol ${ROL}`);

      if (!APPLY) { console.log('\n(DRY-RUN — sin cambios. Agregá --apply.)'); return; }

      await c.query(
        `INSERT INTO public.user_app_access (user_id, app_id, app_role, enabled, granted_at)
         VALUES ($1,$2,$3,true,now())
         ON CONFLICT (user_id, app_id) DO UPDATE
            SET app_role = EXCLUDED.app_role, enabled = true`,
        [userId, appId, ROL]
      );
      console.log(`✓ Acceso otorgado: ${GRANT} → ${APP_KEY} (${ROL})`);
      return;
    }

    // ── modo registro de la app ──────────────────────────────────────────
    console.log(`[manifest] app_key=${APP_KEY} · ${manifest.name}`);
    console.log(`[manifest] public_url=${PUBLIC_URL} · puerto=${manifest.port}`);
    console.log(`[manifest] roles=${clavesDeRoles(manifest.roles).join(', ')}`);
    console.log(`[manifest] permisos=${(manifest.permissions || []).join(', ')}`);

    const existente = await c.query('SELECT id, app_key, sso_secret, active FROM public.apps WHERE app_key=$1', [APP_KEY]);
    if (existente.rows.length) {
      console.log(`\n[db] La app YA está registrada (id=${existente.rows[0].id}, active=${existente.rows[0].active}).`);
      console.log('     Se van a actualizar nombre, url, roles y permisos. El sso_secret NO se toca.');
    } else {
      console.log('\n[db] La app no está registrada: se crea y se genera un sso_secret nuevo.');
    }

    if (!APPLY) { console.log('\n(DRY-RUN — sin cambios. Agregá --apply.)'); return; }

    // Solo se genera secret si la app es nueva: regenerarlo dejaría fuera de
    // servicio cualquier sesión viva y obligaría a editar el .env otra vez.
    const ssoSecret = existente.rows.length
      ? existente.rows[0].sso_secret
      : require('crypto').randomBytes(32).toString('hex');

    const r = await c.query(
      `INSERT INTO public.apps
         (app_key, name, description, icon_url, public_url, sso_endpoint, sso_secret, type,
          roles, permissions, role_permissions, active, manifest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,true,$12::jsonb)
       ON CONFLICT (app_key) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description, icon_url=EXCLUDED.icon_url,
         public_url=EXCLUDED.public_url, sso_endpoint=EXCLUDED.sso_endpoint,
         type=EXCLUDED.type, roles=EXCLUDED.roles, permissions=EXCLUDED.permissions,
         role_permissions=EXCLUDED.role_permissions, manifest=EXCLUDED.manifest, updated_at=now()
       RETURNING id, app_key, sso_secret`,
      [
        APP_KEY, manifest.name, manifest.description || null, manifest.icon || null,
        PUBLIC_URL, (manifest.auth && manifest.auth.sso_endpoint) || '/__sso/consume',
        ssoSecret, manifest.type || 'child_app',
        JSON.stringify(manifest.roles || []),
        JSON.stringify(manifest.permissions || []),
        JSON.stringify(manifest.role_permissions || {}),
        JSON.stringify(manifest),
      ]
    );

    const app = r.rows[0];
    console.log(`\n✓ App registrada · id=${app.id}`);
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log('Pegá esta línea en el .env de la app (y NO la compartas):');
    console.log(`DASSA_APPS_SSO_SECRET=${app.sso_secret}`);
    console.log('─────────────────────────────────────────────────────────────');
    console.log('\nDespués: node scripts/setup-idp.cjs --grant <email> --rol sincro-lector --apply');
  } finally {
    await c.end();
  }
})().catch((e) => { console.error('\n✗ ' + e.message); process.exit(1); });
