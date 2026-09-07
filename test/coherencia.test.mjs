/**
 * test/coherencia.test.mjs — que los archivos de configuración digan lo mismo.
 *
 * El puerto de esta app aparece en cinco lugares (manifest, ecosystem, vite,
 * .env.example, server/index.js) y los roles en tres (manifest, setup-idp, los
 * routers). Que se desincronicen no rompe el build ni los tipos: rompe el
 * deploy, y se descubre en el box con la app arriba y andando mal.
 *
 * Corre sin dependencias ni base:  npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');
const manifest = JSON.parse(leer('manifest.json'));

const APP_KEY = 'sincro-odoo-depofis';
const PUERTO = 3038;

test('el app_key es el mismo en el manifest, el SDK y el basename del SPA', () => {
  assert.equal(manifest.app_key, APP_KEY);
  assert.match(leer('server/lib/sda.js'), new RegExp(`APP_KEY = '${APP_KEY}'`));
  assert.match(leer('src/App.tsx'), new RegExp(`basename="/${APP_KEY}"`));
  assert.match(leer('vite.config.ts'), new RegExp(`base: '/${APP_KEY}/'`));
});

test('el puerto es el mismo en los cinco lugares donde aparece', () => {
  assert.equal(manifest.port, PUERTO);
  assert.equal(manifest.processes[0].port, PUERTO);
  assert.match(manifest.processes[0].health, new RegExp(`:${PUERTO}/api/health`));
  assert.match(leer('ecosystem.config.cjs'), new RegExp(`PORT: ${PUERTO}`));
  assert.match(leer('vite.config.ts'), new RegExp(`localhost:${PUERTO}`));
  assert.match(leer('.env.example'), new RegExp(`PORT=${PUERTO}`));
  assert.match(leer('server/index.js'), new RegExp(`PORT \\|\\| '${PUERTO}'`));
});

test('el nombre pm2 es el mismo en el manifest y en el ecosystem', () => {
  const nombre = manifest.processes[0].pm2_name;
  assert.equal(nombre, 'dassa-sincro-odoo-depofis');
  assert.match(leer('ecosystem.config.cjs'), new RegExp(`name: '${nombre}'`));
});

test('cada rol del manifest resuelve a permisos declarados', () => {
  const permisos = new Set(manifest.permissions);
  const roles = manifest.roles.map((r) => r.key);
  assert.ok(roles.length > 0, 'el manifest tiene que declarar roles');

  for (const rol of roles) {
    const asignados = manifest.role_permissions[rol];
    assert.ok(Array.isArray(asignados) && asignados.length,
      `el rol "${rol}" no tiene permisos en role_permissions`);
    for (const p of asignados) {
      assert.ok(permisos.has(p), `el rol "${rol}" usa el permiso "${p}", que no está en permissions[]`);
    }
  }

  // Al revés también: un permiso que ningún rol otorga es un permiso muerto
  // que nadie puede ejercer.
  const otorgados = new Set(Object.values(manifest.role_permissions).flat());
  for (const p of permisos) {
    assert.ok(otorgados.has(p), `el permiso "${p}" no se lo otorga ningún rol`);
  }
});

test('los roles van como objetos {key,name,description}', () => {
  // Es lo que exige `validate-manifest.js` de la app madre. El ecosistema tiene
  // apps que los declaran como strings y fallan ese validador; acá no.
  for (const r of manifest.roles) {
    assert.equal(typeof r, 'object');
    for (const campo of ['key', 'name', 'description']) {
      assert.ok(r[campo], `al rol ${JSON.stringify(r)} le falta "${campo}"`);
    }
  }
});

test('el rol por default de setup-idp existe en el manifest', () => {
  const m = /const ROL = arg\('--rol'\) \|\| '([^']+)'/.exec(leer('scripts/setup-idp.cjs'));
  assert.ok(m, 'no se encontró el rol por default en setup-idp.cjs');
  assert.ok(manifest.roles.some((r) => r.key === m[1]),
    `setup-idp.cjs usa por default el rol "${m[1]}", que no está en el manifest`);
});

test('los permisos que exigen los routers están declarados', () => {
  const codigo = leer('server/routes/corridas.js');
  const usados = [...codigo.matchAll(/requirePermission\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(usados.length, 'los routers tienen que exigir algún permiso');
  for (const p of usados) {
    assert.ok(manifest.permissions.includes(p),
      `un router exige "${p}", que no está en permissions[] del manifest`);
  }
});

test('la app declara SSO obligatorio y proveedor madre', () => {
  assert.equal(manifest.auth.provider, 'smart-dassa-apps');
  assert.equal(manifest.auth.required, true);
  assert.equal(manifest.type, 'child_app');
  assert.equal(manifest.parent_app, 'smart-dassa-apps');
});

test('el header del token de servicio es el mismo en el manifest y en el server', () => {
  const integracion = manifest.integrations.find((i) => i.type === 'service_token');
  assert.ok(integracion, 'el manifest tiene que declarar la integración service_token');
  assert.match(leer('server/lib/servicio.js'), new RegExp(`req.get\\('${integracion.header}'\\)`));
  assert.match(leer('sincro/publicar.py'), new RegExp(`'${integracion.header}'`));
});

test('la ruta /api/servicio se monta ANTES del requireSession global', () => {
  // Si se montara después, el token de máquina no serviría: la rutina no tiene
  // cookie SSO y el requireSession la rechazaría antes de llegar al router.
  const idx = leer('server/index.js');
  const servicio = idx.indexOf("app.use('/api/servicio'");
  const sesion = idx.indexOf("app.use('/api', requireSession())");
  assert.ok(servicio > -1 && sesion > -1);
  assert.ok(servicio < sesion, '/api/servicio tiene que montarse antes del requireSession global');
});

test('el freno de la escritura sigue siendo de dos llaves', () => {
  // El requisito del proyecto: mientras esté en evaluación, no se escribe nada
  // en DEPOFIS por accidente. Si alguien saca una de las dos condiciones, este
  // test se cae.
  const config = leer('sincro/config.py');
  assert.match(config, /SINCRO_PERMITIR_APLICAR/);
  assert.match(config, /def resolver_modo\(pidio_aplicar\)/);
  // Sin el flag, siempre simulación.
  assert.match(config, /if not pidio_aplicar:\s*\n\s*return 'simulacion', None/);
  // Con el flag pero sin la variable, también simulación.
  assert.match(config, /if not aplicar_permitido\(\):\s*\n\s*return 'simulacion',/);
  // 'aplicacion' se devuelve en un solo lugar, y es después de las dos guardas.
  assert.equal((config.match(/return 'aplicacion'/g) || []).length, 1);
});

test('el .env.example deja la escritura deshabilitada', () => {
  assert.match(leer('.env.example'), /SINCRO_PERMITIR_APLICAR=no/);
});

test('una corrida de aplicación no puede leer del espejo', () => {
  // Decidir un alta contra la copia de ayer es como se duplica un cliente.
  // Lo chequean los dos lados, y los dos tienen que seguir chequeándolo.
  assert.match(leer('sincro/config.py'), /if modo == 'aplicacion':/);
  assert.match(leer('server/lib/corridas.js'), /aplicacion_sin_origen/);
});

test('el espejo lee de depofis_mirror y no del schema congelado', () => {
  // `depofis.clientes` existe, se parece, y está congelado desde 2026-05-10:
  // no tiene tipo_cl y sus conteos son fantasma. Leer de ahí da números
  // inventados sin que nada falle.
  const espejo = leer('sincro/espejo.py');
  assert.match(espejo, /^SCHEMA = 'depofis_mirror'$/m);
  // Ninguna consulta escribe el schema a mano.
  assert.doesNotMatch(espejo, /FROM depofis\./);
});

test('las migraciones SQL están completas y numeradas en orden', () => {
  const readme = leer('sql/README.md');
  for (const f of ['001_schema.sql', '002_roles.sql', '010_corridas.sql',
    '020_novedades.sql', '030_vistas.sql']) {
    assert.doesNotThrow(() => leer(`sql/${f}`), `falta sql/${f}`);
    assert.ok(readme.includes(f), `sql/README.md no documenta ${f}`);
  }
});
