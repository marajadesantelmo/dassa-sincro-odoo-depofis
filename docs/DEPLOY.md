# Deploy — `sincro-odoo-depofis`

Todo esto corre **en el box** (`app01`, `192.168.45.2`), con la VPN Fortinet
levantada, como `dassa` (`sudo -iu dassa && soy-facu`).

> 🚨 En ningún paso de esta guía va `pm2 restart all`. Tira toda la producción
> de DASSA.

La app **ya está deployada** (desde 2026-09-07): pm2 `dassa-sincro-odoo-depofis`,
puerto 3038, nginx en `apps.dassa.com.ar/sincro-odoo-depofis/`, registrada en el
IdP con Facundo y Santiago (`sincro-admin`) y Manuel (`sincro-lector`). Lo que
sigue es cómo se actualiza y cómo se pone a correr la rutina.

---

## 1. Actualizar el código

```bash
cd ~/dassa4/odoo/apps/sincro-odoo-depofis
git status -sb                       # sólo deberían aparecer AGENTS.md y package-lock.json sin trackear
git log --oneline origin/main..HEAD  # tiene que estar vacío: nadie commiteó en el box
git pull --ff-only
```

Si `git status` muestra cambios en archivos trackeados o el `log` no está
vacío, **parar**: alguien trabajó en el box sin pushear. Avisar antes de seguir.

---

## 2. Migraciones

Cada vez que cambia algo en `sql/`. Las migraciones son idempotentes y el
script las re-corre todas en orden:

```bash
export SUPABASE_MGMT_TOKEN='<el PAT sbp_ del inventario, COMPLETO>'
python3 scripts/aplicar_sql.py              # dry-run
python3 scripts/aplicar_sql.py --apply
unset SUPABASE_MGMT_TOKEN
npm run db:diag
```

---

## 3. Build y restart

```bash
npx tsc -p tsconfig.app.json --noEmit && npm run build    # 🚨 con &&, nunca con ;
pm2 restart dassa-sincro-odoo-depofis --update-env
curl -s localhost:3038/api/health
```

El health tiene que devolver `db: true` y `servicio_configurado: true`.

---

## 4. Python

La rutina necesita `psycopg2` (para leer el espejo) y nada más: **no** usa
`pyodbc`, ni driver ODBC, ni `openssl-legacy.cnf`, porque no se conecta al SQL
Server de DEPOFIS.

```bash
python3 -c "import psycopg2; print('psycopg2 ok')"
# si falla:  pip install --user psycopg2-binary
```

En el `.env` hacen falta `ODOO_KEY` (o `ODOO_API_KEY`), `SINCRO_ESPEJO_PG_DSN`
y `SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN`. Las variables `DEPOFIS_SERVER`,
`DEPOFIS_USER`, `DEPOFIS_PASSWORD` y `DEPOFIS_US_ADD` ya no se usan: **borrarlas
del `.env`**, que no queden credenciales de DEPOFIS en un lugar que no las
necesita.

Corrida de simulación a mano:

```bash
python3 sincronizar.py --origen manual --disparada-por <tu email>
```

Tiene que terminar en `estado: ok` y la corrida aparecer en la app.

---

## 5. El freno de la escritura en Odoo

```
SINCRO_PERMITIR_APLICAR=no     # simulación: no se escribe nada en Odoo
SINCRO_PERMITIR_APLICAR=si     # con --aplicar, la rutina escribe en Odoo
```

Hacen falta las dos cosas: la variable en `si` **y** el flag `--aplicar`. Con
una sola, la corrida va en simulación y lo avisa.

### La primera escritura: de a uno

```bash
# en el .env: SINCRO_PERMITIR_APLICAR=si
python3 sincronizar.py --aplicar --limite 1 --solo clientes --origen manual --disparada-por <tu email>
```

Escribe **un** registro y para. Abrir la corrida en la app, seguir el link al
contacto de Odoo y verificar a mano que quedó bien (nombre, CUIT, Código
DEPOFIS, Salesperson, Cliente DASSA, IVA). Recién entonces:

```bash
python3 sincronizar.py --aplicar --limite 10 --origen manual --disparada-por <tu email>   # unos pocos más
python3 sincronizar.py --aplicar --origen manual --disparada-por <tu email>                # el resto
```

La rutina no borra nunca. Si algo quedó mal, se corrige o archiva a mano en
Odoo; el contacto creado tiene el Código DEPOFIS cargado, así que la corrida
siguiente no lo vuelve a crear.

---

## 6. El cron

Como usuario `dassa`:

```bash
crontab -l > ~/crontab.bak-$(date +%F)
crontab -e
```

Cargado el 2026-10-09 (en el crontab de `dassa`):

```cron
# Sincro DEPOFIS -> Odoo · cada hora a los :30, L-V 8 a 20 (espejo y ETL corren a los :00). flock evita dos corridas a la vez.
30 8-20 * * 1-5 cd /home/dassa/dassa4/odoo/apps/sincro-odoo-depofis && flock -n /tmp/sincro-odoo-depofis.lock /usr/bin/python3 sincronizar.py --aplicar --origen cron >> logs/cron.log 2>&1
```

> La app vive en `~/dassa4/odoo/apps/` desde el 2026-10-12 (Santi juntó todo lo
> de Odoo ahí). `~/dassa4/apps/sincro-odoo-depofis` quedó como symlink, así que
> una línea de cron con la ruta vieja sigue andando.

**Cada hora y no una vez por día**: el ETL de prefacturación busca a los
clientes por CUIT en Odoo cada hora, así que un cliente nuevo de DEPOFIS tiene
que llegar a Odoo en menos de una hora. Una corrida sin nada que hacer tarda
~7 s y no escribe nada. `flock -n` saltea la corrida si la anterior sigue viva.

Escribe en Odoo (`--aplicar` + `SINCRO_PERMITIR_APLICAR=si`). Para volver a
simulación sin tocar el cron: `SINCRO_PERMITIR_APLICAR=no` en el `.env`.

Si una corrida se corta a mano (Ctrl-C) queda `en_curso` y sin `.json`. Se
cierra con el token de servicio:

```bash
TOKEN=$(grep '^SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN=' .env | cut -d= -f2-)
curl -s -X POST localhost:3038/api/servicio/corridas/<id>/cerrar   -H 'Content-Type: application/json' -H "x-sincro-odoo-depofis-token: $TOKEN"   -d '{"estado":"fallida","error":"Interrumpida a mano"}'
unset TOKEN
```

Si `which python3` no da `/usr/bin/python3` (o `psycopg2` está en otro
intérprete), poner en la línea del cron la ruta del que funcionó en el paso 4.

---

## Checklist de este cambio (0.1 → 0.2, DEPOFIS → Odoo)

Hecho el 2026-10-09:

- [x] `git pull --ff-only` limpio
- [x] `aplicar_sql.py --apply` (aplica `022` y rehace las vistas de `030`)
- [x] build, restart, health OK
- [x] corrida de simulación publicada (#12)
- [x] primera escritura con `--limite 1` (#14), verificada en Odoo
- [x] resto aplicado (#15 cortada a mano, #16 ok): 25 altas, 62 vinculaciones,
      3 conceptos — verificados contra DEPOFIS, 0 inconsistencias
- [x] cron cargado
- [ ] variables `DEPOFIS_*` borradas del `.env` (confirmar)

---

## Checklist 0.2.1 (historial + corridas cortadas)

Sin migraciones: el historial lee las tablas que ya existen.

- [ ] `git pull --ff-only` limpio
- [ ] `npx tsc -p tsconfig.app.json --noEmit && npm run build`, restart, health OK
- [ ] reconstruir la corrida 15 (una sola vez):
      `python3 scripts/reconstruir_corrida.py --corrida 15 --plantilla 14` (muestra:
      tienen que ser 54 — 18 altas y 36 vinculaciones — y ninguna descartada) y
      después lo mismo con `--aplicar`
- [ ] la portada muestra el historial: 25 + 62 + 3 de la primera sincronización
      más lo que hizo el cron desde entonces
