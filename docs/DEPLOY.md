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
cd ~/dassa4/apps/sincro-odoo-depofis
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

```cron
# Sincro DEPOFIS → Odoo · lunes a viernes 08:30.
# A los :30 para no pisarse con el ETL de dassa_integracion_odoo_depofis (corre a los :00).
30 8 * * 1-5 cd /home/dassa/dassa4/apps/sincro-odoo-depofis && /usr/bin/python3 sincronizar.py --origen cron >> logs/cron.log 2>&1
```

Así corre en **simulación**. Cuando se decida escribir todos los días, se
agrega `--aplicar` a esa línea, con `SINCRO_PERMITIR_APLICAR=si` en el `.env`.

Si `which python3` no da `/usr/bin/python3` (o `psycopg2` está en otro
intérprete), poner en la línea del cron la ruta del que funcionó en el paso 4.

---

## Checklist de este cambio (0.1 → 0.2, DEPOFIS → Odoo)

- [ ] `git pull --ff-only` limpio
- [ ] `aplicar_sql.py --apply` (aplica `022` y rehace las vistas de `030`)
- [ ] `npx tsc -p tsconfig.app.json --noEmit && npm run build`, restart, health OK
- [ ] variables `DEPOFIS_*` borradas del `.env`
- [ ] corrida de simulación publicada; en la app se ven altas y vinculaciones
- [ ] primera escritura con `--limite 1`, verificada a mano en Odoo
- [ ] cron cargado
