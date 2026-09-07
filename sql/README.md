# SQL — schema `sincro_odoo_depofis`

Migraciones versionadas de la app. **Se aplican en orden numérico**, una sola
vez, sobre **Smart DASSA Central** (`txlotccsiqaypkzobkxm`, sa-east-1).

| Archivo | Qué hace |
|---|---|
| `001_schema.sql` | crea el schema `sincro_odoo_depofis` |
| `002_roles.sql` | crea el rol `sincro_odoo_depofis_app` y le da los GRANT |
| `010_corridas.sql` | una fila por ejecución de `sincronizar.py` |
| `020_novedades.sql` | cada registro de Odoo que esa corrida evaluó |
| `030_vistas.sql` | `v_novedad` (con `es_nueva`), `v_corrida_resumen`, `v_ultima_corrida` |

## Por qué acá y no en el cluster de otra app

Porque no hay nada que joinear. A diferencia de `control-stock` —que vive en
este cluster **porque** `depofis_mirror` está acá y así puede generar el control
con un `INSERT ... SELECT`—, esta app no lee ninguna de las dos fuentes desde
Postgres: Odoo se lee por XML-RPC y DEPOFIS por SQL Server, los dos desde la
rutina Python. Lo que se guarda acá es el **resultado** de la comparación, ya
resuelto.

La consecuencia práctica: si un día hubiera que mudar `sincro_odoo_depofis` a otro
proyecto, alcanza con cambiar el DSN. No hay ninguna función SQL que dependa
de un vecino de cluster.

## Cómo aplicarlas

Desde el box, con la VPN levantada. Vía Management API (no hace falta psql):

```bash
for f in sql/0*.sql; do
  echo "── $f"
  jq -Rs '{query: .}' < "$f" > /tmp/q.json
  curl -sS -X POST "https://api.supabase.com/v1/projects/txlotccsiqaypkzobkxm/database/query" \
    -H "Authorization: Bearer $SUPABASE_MGMT_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @/tmp/q.json
  echo
done
```

⚠️ Antes de correr `002_roles.sql`, **cambiar la contraseña placeholder** del
rol y guardarla sólo en el `.env` del box.

## Después de aplicarlas

```bash
npm run db:diag
```

Confirma que las dos tablas y las cuatro vistas existen, que el rol puede
escribir, y que `v_ultima_corrida` responde (vacía, mientras no haya corridas).

## Sobre `es_nueva`

Se calcula en `v_novedad` comparando contra la corrida **completada** anterior.
Las corridas `fallida` se saltean a propósito: una que se cayó a los 3 segundos
no vio nada, y tomarla como referencia haría que todo pareciera nuevo en la
corrida siguiente.

En la primera corrida `anterior_id` va NULL y `es_nueva` da `false` para todo.
Es deliberado — marcar 117 filas como NUEVAS el primer día entrena a ignorar la
marca. La pantalla avisa "primera corrida" en vez de mentir.
