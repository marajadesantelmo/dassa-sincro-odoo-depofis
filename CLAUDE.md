# Sincro Odoo → DEPOFIS

> App hija de Smart DASSA Apps + la rutina Python que la alimenta.
> Nace el 2026-09-07 a partir de `sincronizar_clientes_conceptos.py` (que queda
> como `sincronizar_clientes_conceptos.legacy.py`, sin tocar, para poder
> comparar).
>
> **Estado: rutina y app escritas · primera corrida real hecha (2026-09-07,
> Odoo producción + espejo) · sin deployar · NO escribe nada en DEPOFIS.**

## Qué es esto

Dos piezas que se hablan por HTTP, no una sola app:

```
  Odoo (XML-RPC, solo lectura) ─────────┐
                                         ├─► sincronizar.py ──POST──► app sincro-odoo-depofis
  DEPOFIS · espejo depofis_mirror ──────┤     (cron / a mano)            │
     para LEER (default)                 │                               ▼
  DEPOFIS · SQL Server ─────────────────┘            Postgres sincro_odoo_depofis.*
     sólo para ESCRIBIR, con las dos llaves                              │
                                                                         ▼
                                                            pantalla de novedades
```

**La app no dispara la sincronización.** Es la ventana: muestra lo que la
rutina publicó. Ver Decisiones #1.

## ✍️ Cómo se escribe en DEPOFIS — `INSERT INTO` no sirve

`DASSA.Clientes` y `DASSA.Concepfc` **no son tablas**: son vistas
`SELECT * FROM OPENQUERY([DEPO50_DASSA], ...)` sobre un linked server **VFPOLEDB**
(archivos FoxPro en `\\10.0.10.15\aplicaciones\sistemas`). El provider no expone
`IID_IRowsetChange`, así que ningún `INSERT INTO` entra — ni contra la vista ni
contra `OPENQUERY` directo (error 7301).

**La vía que funciona es pass-through**, mandándole el comando a FoxPro:

```sql
EXEC ('INSERT INTO Concepfc (...) VALUES (...)') AT [DEPO50_DASSA];
```

Es el mecanismo que **`dassa-orden` usa en producción** desde junio 2026 (1057
filas en `cordicar`), confirmado por Silvio de Syspro. `sincro/vfp.py` es un port
de su `vfp-builder.js`.

✅ **Verificado end-to-end el 2026-09-07**: se creó el concepto 999999
`TESTING FACUNDO` y se lo releyó por la vista.

Los cinco gotchas (sintaxis VFP, comillas simples, `autocommit`, las 38 columnas
NOT NULL, la fecha vacía `{}`) están en **`docs/ESCRITURA-DEPOFIS.md`**.

⚠️ **`Clientes` todavía no está resuelto**: tiene 60+ columnas y la rutina arma
18. Si es tan estricto con los nulls como `Concepfc`, el alta de cliente va a
fallar hasta que se releven sus columnas obligatorias. No es urgente — el informe
da 0 altas de cliente.

Dato de contexto: el script original **nunca escribió nada** (`us_add LIKE
'%ODOO%'` daba 0 filas). La premisa "la rutina da de alta en DEPOFIS" era una
intención que nadie había verificado hasta ahora.

## 🔒 Hoy no se sincroniza nada

Requisito explícito de Facundo al arrancar el proyecto (2026-09-07): dejar la
rutina lista y todo planteado, **sin sincronizar**. Primero pruebas, después se
habilita.

Lo que lo hace cumplir son **dos llaves separadas**, y hacen falta las dos:

1. el flag `--aplicar` en la línea de comandos, y
2. `SINCRO_PERMITIR_APLICAR=si` en el `.env` del box.

Con una sola, la corrida va en simulación **y lo dice** (no falla: igual sirve
ver qué habría hecho). Están separadas porque un flag se copia de un README o
queda pegado en una línea de cron vieja; la variable de entorno la pone alguien
que administra la máquina, a propósito. `.env.example` la deja en `no`, y un
test de `npm test` verifica que las dos guardas sigan estando.

El objeto que toca DEPOFIS también está partido en dos: `AccesoLectura` **no
tiene un solo método que escriba** y es el que se instancia en simulación;
`AccesoEscritura` hereda y agrega los INSERT. La garantía no es que nadie llame
al método: es que el método no existe.

## Acceso: tres personas

Facundo, Santiago y Manuel. Lo hace cumplir la tabla `user_app_access` del IdP
(política madre-hijas, regla #8: sin fila no entra nadie, ni un superadmin), no
una lista en un archivo. Auditarlo:

```bash
node scripts/setup-idp.cjs --quien        # quién tiene acceso hoy
node scripts/setup-idp.cjs --diag <email> # por qué alguien no entra
```

| Persona | Email |
|---|---|
| Facundo Lastra | `facundo@pymetech.com.ar` |
| Santiago Aguirre Oliva | `santiago@dassa.com.ar` |
| Manuel de la Arena | `manuel@dassa.com.ar` |

## El criterio de vendedor — el corazón del proyecto

En Odoo el vendedor de un cliente **no está en la pestaña DEPOFIS**. Esa pestaña
tiene exactamente tres campos: `depofis_code`, `depofis_auto_invoice_mode` e
`is_dassa`. El vendedor es el campo estándar `res.partner.user_id`
(*Salesperson*, many2one a `res.users`).

El código que va a `DASSA.Clientes.vendedor` sale de combinar los dos:

| | `is_dassa` destildado | `is_dassa` tildado |
|---|---|---|
| Manuel de la Arena (uid 6) | 3 | 13 |
| Santiago Aguirre Oliva (7) | 4 | 14 |
| Enzo Nieto (13) | **5** | **15** |
| Francisco Urtubey (8) | 6 | 16 |
| Guillermo Jorge (11) | 7 | 17 |
| Alexis Dalpra (12) | 8 | 18 |

**Verificado, no inferido** (2026-09-07): se cruzaron los 1951 `res.partner` que
tienen `depofis_code` contra `depofis_mirror.clientes.vendedor`. De los **1369**
que además tienen un Salesperson mapeado, el mapa acierta **1360**.

Las 9 diferencias son carteras reasignadas en Odoo que DEPOFIS todavía no
refleja — 4 clientes que hoy son de Francisco siguen con el 3 (de Manuel), 1 de
Guillermo/DASSA quedó con el 7, dos de Alexis cruzados. Ninguna contradice el
mapa: en todas, el código viejo es el de OTRO comercial, no un segundo código
del mismo.

La regla observada es **institucional = propio + 10**, y hay un test que lo
verifica; pero el mapa se escribe entero igual, porque si mañana entra un
comercial cuyo par no siga esa suma, una fórmula lo asignaría mal en silencio.

Que ése es el camino correcto lo confirma el propio módulo DEPOFIS de Odoo:
`depofis.prefactura.salesperson_id` está definido como
`related='partner_id.user_id'` e `is_dassa` como `related='partner_id.is_dassa'`.
Verificado sobre 300 prefacturas: 0 discrepancias.

**Sin Salesperson, el vendedor queda NULL.** No se cae a un default. El `0` de
DEPOFIS *no* significa "sin vendedor": es un código real con 523 clientes
asignados, así que un cero se leería como un dato bueno. La fila sale marcada
"requiere atención" y la pantalla la cuenta aparte.

## El informe de estado (primera corrida real · 2026-09-07)

Odoo de producción contra el espejo `depofis_mirror` (sincronizado ese día a las
08:00). Es el número de verdad, con el catálogo real de `tipo_cl` y de
`Concepfc`.

### Clientes: **0 altas** de 117 candidatos

| | |
|---|---|
| 65 | **sin etiqueta** que corresponda a una categoría comercial de DEPOFIS |
| 52 | **el CUIT ya está en DEPOFIS**: el cliente existe, falta vincular su Código DEPOFIS en Odoo |
| **0** | altas |

**No hay ni un cliente para dar de alta.** Todo el "backlog" es trabajo de datos
en Odoo: vincular 52 códigos y clasificar 65 contactos.

Y encima, de los 117, **87 no tienen Salesperson asignado**. Los 30 que sí lo
tienen resuelven código sin problema (Enzo 12 → 5, Alexis 7 → 18 y 3 → 8,
Guillermo 5 → 17 y 3 → 7), que es la confirmación en vivo de que el criterio de
vendedor funciona.

### Conceptos: **8 altas** de 345

259 ya existen en `Concepfc` y 78 tienen Referencia Interna no numérica. Los 8
que faltan:

| código | calcula | |
|---|---|---|
| 20333, 20334, 20335 | `Dias` | almacenaje de contenedor 40' HC — la regla los resuelve bien |
| 20121 – 20125 | `Nada` | ⚠️ **REVISAR** — "BAJADA DE MERCADERÍA A PISO … DE 0 A N DÍAS": hablan de días pero no dicen "Almacenaje", así que caen fuera de la regla de `update_prefacturacion_odoo.py` y no se adivina la unidad |

**Los 5 marcados son la única decisión de negocio pendiente del lado conceptos.**
Alguien tiene que decir si esos cinco se cobran por día o por evento.

### Qué se hace con esto

El orden correcto es: primero limpiar Odoo (Salesperson y categoría), después
habilitar la escritura. Al revés, la rutina daría de alta clientes sin vendedor
y habría que corregirlos a mano en DEPOFIS.

## Puerto y proceso

- pm2: `dassa-sincro-odoo-depofis` · puerto **3038** · Vite dev: **5188**
- ✅ **3038 verificado LIBRE en el box el 2026-09-07** (`ss -lnt`, y sin
  `proxy_pass` a ese puerto en nginx).
- Ocupados en 30xx ese día: 3001, 3002, 3006, 3010, 3011, 3015, 3020, 3030-3037,
  3040, 3048, 3050, 3052, 3055, 3060, 3061, 3062, 3065, 3070, 3071, 3099.
  **3036 y 3037 ya están tomados** (conciliación-proveedores y control-stock se
  deployaron desde la última vez que se escribió el inventario), y aparecieron
  3061, 3062, 3070 y 3071 que no figuran en `03-inventario-ecosistema.md`. El
  inventario del workspace está desactualizado: verificar siempre en el box.
- 🚨 **NUNCA `pm2 restart all`**: tira toda la producción de DASSA.

## Archivos críticos

| Archivo | Por qué |
|---|---|
| `sincro/reglas.py` | **el criterio.** VENDEDOR_MAP, IVA, unidad de cálculo. Módulo puro: sin red, sin archivos, sin pyodbc. Se testea solo. |
| `sincro/config.py` | **el freno.** `resolver_modo()` es lo único que puede devolver `'aplicacion'`. |
| `sincro/depofis.py` | `AccesoLectura` vs `AccesoEscritura`. Si alguien agrega un INSERT a la clase de lectura, rompe la garantía. |
| `sincro/odoo_client.py` | allowlist de métodos: cualquier escritura levanta `PermissionError` **antes** de tocar la red. |
| `sincronizar.py` | la rutina. Decide `alta` / `omitido` / `error` para cada registro. |
| `server/lib/corridas.js` | el dominio de la app. Los routers no escriben SQL. |
| `sql/030_vistas.sql` | `es_nueva` y los conteos. La pantalla no los recalcula. |

## Comandos

```bash
# la rutina
python sincronizar.py                     # SIMULACIÓN desde el ESPEJO — el default
python sincronizar.py --solo clientes
python sincronizar.py --fuente origen     # simular leyendo el SQL Server (necesita pyodbc)
python sincronizar.py --sin-publicar      # sólo el .json local, en salidas/
python -m unittest sincro.test_reglas -v  # 24 tests, sin credenciales

# simular necesita psycopg2 (espejo). Sólo aplicar necesita pyodbc:
#   pip install --user pyodbc   ← no hace falta sudo en el box

# la app
npm run db:diag       # ¿está la base como la app espera?
npm test              # coherencia manifest / puertos / roles / el freno
npm run dev           # vite + node --watch
npm run build         # tsc --noEmit && vite build
node scripts/setup-idp.cjs --quien
pm2 restart dassa-sincro-odoo-depofis --update-env
```

## Decisiones que conviene no revertir sin pensarlas

1. **La app no dispara la rutina.** Podría: un botón que hiciera `spawn` de
   Python. No se hizo. Mientras el proyecto esté en evaluación, sincronizar
   tiene que ser una acción del servidor —con su `.env` y su cron— y no un
   click de alguien que quiso ver qué pasaba. La app tampoco tiene una sola ruta
   de escritura fuera de `/api/servicio/*`, que es de la rutina.

2. **La rutina sigue siendo Python.** Es el lenguaje del script original y de
   todas las rutinas de datos de DASSA, y el patrón "rutina Python + app Node
   que la recibe por token de servicio" ya existe en el ecosistema
   (`control-stock` ↔ `update_mensual.py`). Portarla a Node habría significado
   reescribir reglas de negocio que ya funcionan para ganar nada.

2b. **Se LEE del espejo, se ESCRIBE en el origen.** Es la regla de datos de
   DASSA (`02-instructivo-acceso-operacion.md` §4: las apps nuevas usan el
   espejo, no el origen), y acá además tiene una consecuencia práctica grande:
   una corrida de simulación no necesita `pyodbc`, ni el driver ODBC, ni
   credenciales del SQL Server — sólo `psycopg2` y el rol lector. O sea que el
   informe se puede generar desde cualquier máquina.
   El límite está marcado y lo chequean los dos lados: `config.resolver_fuente()`
   fuerza `origen` en cualquier corrida de aplicación, y el server la rechaza con
   `aplicacion_sin_origen` si igual llegara. Decidir un alta contra una copia de
   ayer es exactamente cómo se duplica un cliente.
   El costo es que el informe puede estar hasta un día atrasado; por eso la
   corrida guarda `fuente_sincronizada_en` y la pantalla lo dice con la hora.

3. **El `VENDEDOR_MAP` se guarda con cada corrida**, en `corrida.vendedor_map`.
   No se referencia una tabla de configuración. Es lo que permite explicar, en
   marzo, por qué a un cliente le tocó el 15 en enero, aunque el mapa haya
   cambiado. Con una tabla mutable, cambiar el mapa reescribiría el pasado.

4. **Se guardan también las omisiones, no sólo las altas.** Saber *por qué* un
   cliente no se dio de alta es la mitad del valor de la pantalla — y es lo que
   convirtió esta app en una herramienta de limpieza de datos de Odoo, que
   resultó ser el trabajo grande de verdad.

5. **`es_nueva` se calcula contra la corrida anterior, en SQL.** Comparar dos
   corridas es una operación de conjuntos; Node sólo pagina y pinta. Las
   corridas `fallida` se saltean: una que se cayó a los 3 segundos no vio nada, y
   tomarla como referencia haría que todo pareciera nuevo la vez siguiente.

6. **En la primera corrida nada se marca NUEVA.** Marcar 117 filas como nuevas
   el primer día entrena a ignorar la marca. La pantalla dice "es la primera
   corrida" en vez de mentir.

7. **La idempotencia es por CUIT, no por una marca en Odoo.** El cliente de Odoo
   es de solo lectura (por allowlist), así que la rutina no puede escribir
   `depofis_code` allá después de dar un alta. Compara contra
   `DASSA.Clientes.documento` antes de cada INSERT. Correrla dos veces no
   duplica nada; lo que sí pasa es que un cliente ya cargado aparece en todas
   las corridas como "falta vincular", hasta que alguien lo vincule en Odoo.

8. **Si la app está caída, la rutina no aborta.** Sigue, y deja el resultado en
   `salidas/corrida_<sello>.json`. La rutina existe para saber qué pasa entre
   Odoo y DEPOFIS; que la ventana esté caída no es motivo para no mirar.

## Gotchas

- **`fields_get('product.template')` se consulta para ver si existe
  `depofis_calcula`**, que hoy NO existe. Si algún día lo agregan, el dato del
  sistema le gana a la derivación por nombre sin tocar código. Pedir un campo
  inexistente hace fallar el `search_read` entero, no sólo ese campo.
- **Odoo devuelve `False` para los campos vacíos**, no `None` ni `''`. Un
  many2one llega como `[id, "display_name"]`, no como un id suelto — de ahí sale
  `user_id[0]` en `resolver_vendedor`.
- **`clie_nro` no es identity**: se calcula con `MAX(clie_nro)+1`. Eso no
  protege de dos rutinas corriendo a la vez. No las hagas correr a la vez.
- **La conexión a DEPOFIS va en `autocommit=True`, y es obligatorio.** Sin eso,
  pyodbc abre una transacción implícita, el comando se vuelve distribuido y
  VFPOLEDB lo rechaza (error 7390). Consecuencia: **no hay rollback contra
  DEPOFIS**. Cada escritura es definitiva al ejecutarse, por eso la rutina va de
  a una fila y **verifica después** en vez de intentar "todo o nada".
- **`us_add` es `char(10)` y lleva el marcador de la app** (`'ODOO'`), igual que
  `'ORDEN_APP'` en dassa-orden. Es lo que hace auditable la automatización y lo
  que acota el DELETE. El `ALLTRIM` en el WHERE no es opcional: la columna viene
  con blancos de cola y el `==` de FoxPro es exacto.
- **FoxPro no acepta null en ninguna columna.** Un INSERT parcial da error 7412
  (`Field IMPORTE does not accept null values`). `Concepfc` se manda con sus 38
  columnas; los defaults salen del valor más frecuente de cada una.
- **La consola de Windows es cp1252 y rompe con acentos y flechas.** La rutina
  fuerza UTF-8 en stdout/stderr al arrancar; si escribís un script suelto que
  imprima `→` o `✓`, acordate de `PYTHONIOENCODING=utf-8`.
- **Conectarse al SQL de DEPOFIS desde Linux tiene tres trampas**, las tres
  aprendidas mirando cómo lo hace `depofis-mirror`, que es el ETL que ya lee esa
  base desde el box todos los días:
  1. **Sin nombre de instancia.** Va `101.44.8.58,1436`, no
     `101.44.8.58\SQLEXPRESS_X86,1436`: la forma con instancia necesita al SQL
     Browser en UDP 1434, que desde Linux no responde. (En Windows sí anda, y
     por eso los scripts viejos la usan — copiarla al box no funciona.)
  2. **Sin cifrado**: `Encrypt=no;TrustServerCertificate=yes`. El mirror usa
     `encrypt: false, trustServerCertificate: true`. Como no se cifra, **no hace
     falta ningún `openssl-legacy.cnf`**: la vuelta del TLS 1.0 con OpenSSL 3 no
     aplica.
  3. **El driver del box es el `ODBC Driver 18 for SQL Server`**, no el 17 ni el
     `SQL Server` de Windows. El 18 cifra por default, de ahí el punto 2.
- **`pyodbc` NO está instalado en app01** (verificado 2026-09-07). No hace falta
  `sudo`: hay wheel manylinux y el box llega a PyPI, así que
  `pip install --user pyodbc` alcanza. Y para las corridas de simulación ni
  siquiera hace falta: ésas leen el espejo con `psycopg2`.
- **`dassa_integracion_odoo_depofis` no corre en app01** — el propio directorio
  tiene un `ESTE-PROYECTO-NO-CORRE-ACA-EN-APP01.txt`: el ETL diario corre en
  **dc01** por Task Scheduler. Es de donde salió el script original, y es la
  razón por la que la rutina fuerza UTF-8 en stdout (la consola de Windows es
  cp1252 y revienta con la flecha del título).
- **El box clona con la identidad de `santiagoaguirreoliva`** (el `gh` del
  usuario `dassa` está autenticado con esa cuenta). Un repo privado nuevo donde
  Facundo sea el único colaborador falla con `remote: Repository not found` — el
  mismo mensaje que si el repo no existiera. Agregar a `santiagoaguirreoliva`
  como colaborador (*Write*) antes de clonar.
- **`npm install` está roto desde la red de la oficina** (FortiGate + inspección
  SSL sobre `registry.npmjs.org`). El build se hace en el box, o desde otra red.

## Lo que NO se pudo verificar

1. ~~Nada contra el SQL Server de DEPOFIS.~~ ✅ **Probado el 2026-09-07** con
   las credenciales reales: la LECTURA del origen funciona y sus números
   coinciden exactamente con el espejo (26 categorías, 278 conceptos, 1992
   CUITs, próximo `clie_nro` 2022) — lo que valida la decisión de leer del
   espejo. La ESCRITURA está bloqueada por el provider VFPOLEDB, ver arriba.
2. **`npx tsc --noEmit` y `npm run build`** — sin `node_modules` (`npm install`
   está roto desde la red de la oficina). El `npm test` de coherencia sí corre:
   no necesita dependencias.
3. **El SSO end-to-end**: la app todavía no está registrada en el IdP.

## Lo que NO se tocó

**A Odoo se le leyó** (`search_read`, `fields_get`, `read_group`) y nada más; al
espejo Postgres también, con el rol `smartdassa_satellite_reader`. En el box sólo
se leyó (`ss`, `ls`, `cat` de config ajena). Ningún cambio en nginx, pm2, el IdP
ni Supabase.

**Contra DEPOFIS sí se intentó escribir**, el 2026-09-07 y a pedido explícito:
tres intentos de insertar un concepto de prueba (999999 / `TESTING FACUNDO`).
Los tres fueron rechazados por el provider VFPOLEDB y **no quedó ninguna fila**
— verificado después con un `COUNT(*)`: el código 999999 sigue sin existir. La
tabla quedó exactamente como estaba.

> Nota: consultar `pm2 list` como `facu` levanta un daemon pm2 propio en
> `/home/facu/.pm2`, separado del de `dassa` que corre la producción. Quedó
> apagado (`PM2_HOME=/home/facu/.pm2 pm2 kill`). El de `dassa` no se tocó.
