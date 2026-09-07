# Deploy — `sincro-odoo-depofis`

Todo esto corre **en el box** (`app01`, `192.168.45.2`), con la VPN Fortinet
levantada. Los pasos marcados 🔐 necesitan `sudo`, que `facu` tiene **con
contraseña** (`sudo -n` falla), así que no se pueden automatizar.

> 🚨 En ningún paso de esta guía va `pm2 restart all`. Tira toda la producción
> de DASSA.

---

## 0. El puerto ya está verificado

**3038 libre en el box al 2026-09-07** (`ss -lnt`, y sin `proxy_pass` a ese
puerto en nginx). Ojo: 3036 y 3037 **sí** están tomados ahora — conciliación
y control-stock se deployaron desde que se escribió el inventario del
workspace, que quedó viejo. Si pasó tiempo desde entonces, re-chequear:

```bash
ss -lnt | grep -E ':30[0-9]{2}'
grep -rn "127.0.0.1:30" /etc/nginx/sites-enabled/ | sort -t: -k3
```

Si el 3038 está tomado, elegir otro y cambiarlo en los **cinco** lugares donde
aparece — `npm test` verifica que no quede ninguno desincronizado:

`manifest.json` (`port` y `processes[0]`) · `ecosystem.config.cjs` ·
`vite.config.ts` · `.env.example` · `server/index.js`

---

## 1. Repo

```bash
sudo -iu dassa
cd /home/dassa/dassa4/apps
gh repo clone marajadesantelmo/dassa-sincro-odoo-depofis sincro-odoo-depofis
cd sincro-odoo-depofis
```

⚠️ El `gh` del usuario `dassa` está autenticado como **`santiagoaguirreoliva`**.
Si el repo es privado y él no es colaborador, el clone falla con
`remote: Repository not found` — el mismo mensaje que si el repo no existiera.
Agregarlo como colaborador (*Write*) antes.

---

## 2. Base de datos

Elegí la contraseña del rol de la app y ponela en el SQL:

```bash
PG_PASS=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
echo "GUARDALA: $PG_PASS"
sed -i "s/CAMBIAR_ANTES_DE_APLICAR/$PG_PASS/" sql/002_roles.sql
```

Aplicá las 5 migraciones vía la Management API (no hace falta psql ni un DSN
admin — el box tampoco tiene `jq`, por eso el aplicador es Python):

```bash
export SUPABASE_MGMT_TOKEN='sbp_...'        # el PAT del inventario
python3 scripts/aplicar_sql.py              # dry-run
python3 scripts/aplicar_sql.py --apply
```

Y sacá la contraseña del archivo, que no tiene por qué quedar en el working tree:

```bash
git checkout sql/002_roles.sql
```

`PG_PASS` va después en `SINCRO_ODOO_DEPOFIS_PG_DSN` del `.env` (paso 3).

---

## 3. `.env`

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # LOCAL_SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN
chmod 600 .env
```

Completar además:

- `SINCRO_ODOO_DEPOFIS_PG_DSN` — con la contraseña del paso 2. **Por el pooler
  `aws-1-sa-east-1`**: el direct connection es IPv6-only y el VPS no rutea IPv6;
  y es `aws-1-`, no `aws-0-` (ése da "Tenant or user not found").
- `ODOO_KEY` — la API key de Odoo. Hoy es la **personal de Facundo**, la misma
  que usa `conciliacion-proveedores`. Si se rota, esta rutina deja de leer Odoo.
  Migrar a un usuario de servicio es cambiar esta línea; no toca código.
- `DEPOFIS_USER` / `DEPOFIS_PASSWORD` — las del SQL de DEPOFIS.
- `SINCRO_PERMITIR_APLICAR` — **dejarla en `no`.** Ver §7.

`DASSA_APPS_SSO_SECRET` sale del paso 4.

---

## 4. Registrar la app en el IdP

```bash
node scripts/setup-idp.cjs                 # dry-run: qué haría
node scripts/setup-idp.cjs --apply         # registra y devuelve el sso_secret
```

Pegar el `DASSA_APPS_SSO_SECRET` que imprime en el `.env`.

Después, los accesos — **sin esto la app no le aparece a nadie**:

```bash
node scripts/setup-idp.cjs --grant facundo@pymetech.com.ar --rol sincro-admin  --apply
node scripts/setup-idp.cjs --grant santiago@dassa.com.ar   --rol sincro-admin  --apply
node scripts/setup-idp.cjs --grant manuel@dassa.com.ar     --rol sincro-lector --apply
node scripts/setup-idp.cjs --quien         # confirmar que son ésos y nadie más
```

(El rol de Manuel es una sugerencia: `sincro-lector` ve y exporta, que es lo que
necesita para revisar. Si quiere el admin, `--grant` de nuevo con el otro rol.)

---

## 5. Python

**Para el informe (simulación) alcanza con `psycopg2`.** La corrida lee DEPOFIS
del espejo `depofis_mirror`, así que no necesita `pyodbc`, ni driver ODBC, ni
las credenciales del SQL Server.

```bash
python3 -c "import psycopg2; print('psycopg2 ok')"
# si falta:  pip install --user psycopg2-binary
```

Probar la corrida **antes** de configurar el cron:

```bash
python3 sincronizar.py --sin-publicar
```

Tiene que terminar en `estado: ok` y dejar un `salidas/corrida_<sello>.json`.

### Sólo para el día que se habilite la escritura

Ahí sí hace falta `pyodbc`. **No necesita `sudo`**: hay wheel manylinux y el box
llega a PyPI.

```bash
pip install --user pyodbc
python3 -c "import pyodbc; print(pyodbc.drivers())"
```

app01 tiene **`ODBC Driver 18 for SQL Server`** (verificado 2026-09-07). Tres
cosas que hay que respetar, y que ya están en `sincro/depofis.py` — se sacaron de
cómo lo hace `depofis-mirror`, el ETL que lee esa base desde el box a diario:

1. `SERVER=101.44.8.58,1436` — **sin** el nombre de instancia. La forma
   `host\SQLEXPRESS_X86,1436` necesita al SQL Browser en UDP 1434 y desde Linux
   no responde.
2. `Encrypt=no;TrustServerCertificate=yes`. El Driver 18 cifra por default y el
   handshake falla contra el 2014.
3. Como no se cifra, **no hace falta ningún `openssl-legacy.cnf`**.

Probar la conexión al origen **sin escribir nada** (sigue siendo simulación):

```bash
python3 sincronizar.py --fuente origen --sin-publicar --solo clientes
```

Ese comando hace el mismo viaje de conexión que haría un `--aplicar`, pero no
tiene forma de escribir: el objeto que se instancia es `AccesoLectura`.

---

## 6. Build y arranque

```bash
npm install                 # desde el box; desde la red de la oficina falla (FortiGate)
npx tsc --noEmit && npm run build    # 🚨 con &&, nunca con ;
npm run db:diag             # ¿está la base como la app espera?
pm2 start ecosystem.config.cjs
pm2 save
curl -s localhost:3038/api/health | jq
```

El health tiene que devolver `db: true` y `servicio_configurado: true`.

---

## 7. El freno de la escritura

**Dejarlo puesto.** Mientras el proyecto esté en evaluación:

```
SINCRO_PERMITIR_APLICAR=no
```

Con esa variable en `no`, `--aplicar` se rechaza y la corrida va en simulación
igual, avisando por qué. Es la mitad del freno; la otra mitad es el flag.

El camino de escritura **funciona** (verificado 2026-09-07, ver
`docs/ESCRITURA-DEPOFIS.md`), pero antes de habilitarlo faltan dos cosas de
negocio: que facturación firme los defaults de `Concepfc` (`gravado`, `moneda`,
`cta_contab`) y relevar las columnas obligatorias de `Clientes`.

Habilitar la escritura es:

1. probar el camino: `python scripts/probar_escritura.py --confirmar` y después
   `--borrar --confirmar`. Si esa fila entra y se va, el mecanismo funciona.
2. `SINCRO_PERMITIR_APLICAR=si` en el `.env`
3. correr la rutina con `--aplicar`

y **antes de eso**, mirar en la app cuántas altas quedarían sin vendedor: si el
número no es cero, se están por crear clientes sin comercial asignado.

---

## 8. nginx 🔐

```bash
sudo cp /etc/nginx/sites-available/apps.dassa.com.ar{,.bak-$(date +%F)}
```

Agregar dentro del `server` de `apps.dassa.com.ar`:

```nginx
location /sincro-odoo-depofis/ {
    proxy_pass http://127.0.0.1:3038/;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "upgrade";
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. El cron de la rutina

**Recién cuando la app esté verificada y el equipo haya mirado un par de
corridas a mano.** No va como proceso pm2: un pm2 con `cron_restart` *reinicia*
la app, no ejecuta una tarea.

```bash
crontab -e   # como usuario dassa
```

```cron
# Sincro Odoo → DEPOFIS · informe diario a las 08:30 (hora de Buenos Aires).
# Después de las 08:00, que es cuando sincroniza depofis_mirror: si corre antes,
# el informe se arma sobre la foto de ayer.
30 8 * * * cd /home/dassa/dassa4/apps/sincro-odoo-depofis && /usr/bin/python3 sincronizar.py --origen cron >> logs/cron.log 2>&1
```

Sin `--aplicar`: la corrida diaria es de simulación. Cuando se habilite la
escritura, se agrega el flag **a esa línea**, después de que la variable del
`.env` esté puesta.

---

## Checklist

- [x] Puerto 3038 verificado libre en el box (2026-09-07)
- [ ] Migraciones de `sql/` aplicadas, contraseña del rol cambiada
- [ ] `.env` completo, `chmod 600`, `SINCRO_PERMITIR_APLICAR=no`
- [ ] App registrada en el IdP y accesos otorgados a las tres personas
- [ ] `node scripts/setup-idp.cjs --quien` → exactamente esas tres
- [ ] `python3 sincronizar.py --sin-publicar` termina en `estado: ok`
- [ ] (sólo para escribir, más adelante) `pip install --user pyodbc` y
      `--fuente origen` probado
- [ ] `npx tsc --noEmit && npm run build` limpio
- [ ] `npm run db:diag` sin fallas
- [ ] `npm test` y `python -m unittest sincro.test_reglas` en verde
- [ ] pm2 arriba, `pm2 save`, health en 200
- [ ] nginx con backup del vhost, `nginx -t` OK
- [ ] Las tres personas entraron y vieron la primera corrida
- [ ] Cron **recién después** de todo lo anterior
