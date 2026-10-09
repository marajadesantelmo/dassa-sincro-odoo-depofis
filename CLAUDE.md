# Sincro DEPOFIS → Odoo

> App hija de Smart DASSA Apps + la rutina Python que la alimenta.
> El repo, el `app_key` y el proceso pm2 se siguen llamando `sincro-odoo-depofis`
> por historia; **la dirección es DEPOFIS → Odoo**.
>
> **Estado (2026-10-09): versión 0.2 escrita y verificada en simulación ·
> app deployada desde 2026-09-07 con la 0.1 · falta deployar la 0.2, la
> primera escritura en Odoo y el cron.**

## 🧭 La dirección, y por qué este archivo se reescribió

DEPOFIS es el maestro. **Lo que se da de alta en DEPOFIS tiene que aparecer en
Odoo.** La rutina LEE DEPOFIS y ESCRIBE en Odoo. **A DEPOFIS no se le escribe
nada, nunca** (Facu, 2026-10-09).

La 0.1 (2026-09-07/08) se escribió **al revés**: comparaba Odoo contra DEPOFIS
para dar de alta en DEPOFIS, con INSERT por `EXEC (...) AT [DEPO50_DASSA]` sobre
el linked server FoxPro. Esa premisa era errónea. En la 0.2 se borró todo ese
camino — `sincro/depofis.py`, `sincro/vfp.py`, `scripts/probar_escritura.py`,
`docs/ESCRITURA-DEPOFIS.md` y el script legacy — y un test de `npm test`
verifica que no vuelva. Si algo en el historial de git habla de "alta en
DEPOFIS", es de la 0.1.

⚠️ **Quedó una secuela de la 0.1 en DEPOFIS:** el concepto **999999 `TESTING
FACUNDO`**, de la prueba de escritura del 2026-09-07. La rutina lo excluye; sacarlo
de `Concepfc` lo tiene que hacer quien administre DEPOFIS.

## Qué es esto

Dos piezas que se hablan por HTTP:

```
  DEPOFIS · espejo depofis_mirror ──┐
     (SÓLO LECTURA)                  ├─► sincronizar.py ──POST──► app sincro-odoo-depofis
  Odoo (XML-RPC) ◄──────────────────┘     (cron / a mano)            │
     lee siempre; escribe sólo                                        ▼
     con las dos llaves                              Postgres sincro_odoo_depofis.*
                                                                       │
                                                                       ▼
                                                        pantalla: lo que se sube a Odoo
```

**La app no dispara la sincronización ni escribe en Odoo.** Es la ventana:
muestra lo que la rutina publicó.

## Clientes · `DASSA.Clientes` → `res.partner`

Sólo los **activos** (`estado = 0`; los 1 y 2 son de 2024 para atrás). Para cada
uno, `reglas.decidir_cliente`:

| Situación en Odoo | Acción |
|---|---|
| Algún contacto ya tiene ese `clie_nro` como `depofis_code` | **nada** — no se publica, se cuenta como "ya sincronizado" |
| CUIT inválido (11 dígitos + dígito verificador) | **omitido** — se corrige en DEPOFIS |
| Ningún contacto comercial con ese CUIT | **alta** |
| Uno solo, activo, con ese CUIT y sin `depofis_code` | **vincular** |
| El CUIT ya está vinculado a OTRO código | **omitido** — cliente duplicado en DEPOFIS |
| Más de uno sin código / el único está archivado | **omitido** — duplicado o archivado en Odoo |

**El único chequeo que frena un alta es el CUIT** (Facu, 2026-10-09). Sin
vendedor o sin categoría, el cliente se da de alta igual y la fila se marca.

Sólo cuentan los contactos **comerciales** (`parent_id` vacío): los hijos heredan
CUIT y código de la empresa, y contarlos haría parecer duplicada a toda empresa
con dos personas de contacto.

### Qué se escribe

- **Alta**: `name`, `vat` (sólo dígitos), `is_company`, `lang es_AR`,
  `depofis_code`, tipo de documento CUIT, condición de IVA, dirección, ciudad,
  CP, teléfono, email, país (AR), Salesperson + `is_dassa`, etiqueta.
- **Vincular**: `depofis_code` + **sólo los campos que en Odoo estén vacíos**
  (`reglas.completar_vacios`). Lo que alguien cargó a mano no se pisa.
  `is_dassa` sigue al Salesperson: se escribe sólo si se completa `user_id`.
- **A un cliente ya vinculado no se le toca nada**, aunque en DEPOFIS cambie
  (Facu, 2026-10-09: "sólo actualiza los datos de clientes cuando les falte el
  depofis_code").

### Mapeos — todos sacados de los ~1950 clientes ya vinculados (2026-10-09)

- **Vendedor → Salesperson + Cliente DASSA.** El mapa de `reglas.VENDEDOR_MAP`,
  leído al revés: código propio → comercial con `is_dassa=False`, institucional
  (propio + 10) → comercial con `is_dassa=True`. Los códigos **0, 1, 2, 9, 19** no
  tienen usuario en Odoo → alta **sin Salesperson**, fila marcada.

  | uid | Salesperson | propio | institucional |
  |---|---|---|---|
  | 6 | Manuel de la Arena | 3 | 13 |
  | 7 | Santiago Aguirre Oliva | 4 | 14 |
  | 8 | Francisco Urtubey | 6 | 16 |
  | 11 | Guillermo Jorge | 7 | 17 |
  | 12 | Alexis Dalpra | 8 | 18 |
  | 13 | Enzo Nieto | 5 | 15 |

- **IVA** (`Tipo_iva.codigo` → `l10n_ar.afip.responsibility.type`): 1 → Resp.
  Inscripto (1), 3 → Consumidor Final (5), 4 → Monotributo (6), 6 → Exento (4).
  Cualquier otro queda vacío — que es como está el **90 %** de los vinculados.
- **Documento**: `C.U.I.T.` y `C.U.I.L.` van como CUIT (id 4), igual que los existentes.
- **Etiqueta**: la de Odoo cuyo nombre sea igual al `tipo_cl`. Sólo coincide en ~20 %
  de los vinculados (las etiquetas de Odoo son otra taxonomía), así que **no se
  exige**.
- **País**: Argentina si `pais` es `ARGENTINA` o vacío.

## Conceptos · `DASSA.Concepfc` → `product.template`

El código de DEPOFIS es la **Referencia Interna** (`default_code`). Lo que falta
se da de alta igual que los ~250 que ya están: `type=service`, `sale_ok`,
`invoice_policy=order`, **IVA 21%** (impuestos **64** y **219**, uno por compañía:
DASSA y Dassa Blue — se verifican contra Odoo al arrancar), `categ_id` = la
categoría con el nombre del `grupo`, `list_price` = `importe`.

`reglas.excluir_concepto` deja **fuera de alcance** lo que no es un concepto:
separadores (`----IMPORTACION MARITIMA----`), detalle vacío, código 0, "NO
USAR", borrados (`us_del`) y el 999999. Un concepto **no gravado** (`gravado ≠
'S'`) se **omite**: ninguno de los existentes es no gravado, y el impuesto lo
tiene que decidir una persona.

## 🔒 El freno

Para que la rutina escriba una sola cosa en Odoo hacen falta **dos llaves**:

1. el flag `--aplicar`, y
2. `SINCRO_PERMITIR_APLICAR=si` en el `.env` del box.

Con una sola, simulación (y lo avisa). Y la escritura está cerrada en
`sincro/odoo_client.py`:

- `crear()` sólo para `res.partner` y `product.template`; `escribir()` sólo
  para `res.partner`. Cada uno con su **lista cerrada de campos**; en el `write`
  no están ni `name` ni `vat`. No existe `unlink`.
- Las dos funciones levantan `PermissionError` hasta que `sincronizar.py` llama
  a `habilitar_escritura()`, cosa que hace en un único lugar y sólo en modo
  aplicación. Tests: `sincro/test_odoo_client.py` y `test/coherencia.test.mjs`.
- Antes de cada escritura se vuelve a preguntar a Odoo (¿apareció mientras
  corría?) y después se **relee** el registro para verificar el código. Sólo
  entonces la fila queda `ejecutada = true` (✓ en la pantalla).
- `--limite N` corta después de N escrituras. **La primera vez, `--limite 1`.**

DEPOFIS no tiene freno porque no hay nada que frenar: el espejo se abre con
`set_session(readonly=True)` y no hay credenciales del SQL Server.

## Qué muestra la pantalla

Por default **sólo lo que se sube o se modifica en Odoo**: altas, vinculaciones
y los errores al intentarlo (Facu, 2026-10-09). Lo que no se puede sincronizar
("No se pueden") y lo que no es un concepto ("No son conceptos") va detrás de
filtros separados. Lo que ya está sincronizado no se publica fila por fila: se
cuenta en `corrida.totales` y la pantalla lo muestra como un número.

## El informe de hoy (simulación del 2026-10-09)

| | |
|---|---|
| Clientes activos en DEPOFIS | 1538 (más 503 inactivos que no se miran) |
| Ya vinculados en Odoo | 1451 |
| **Altas de cliente** | **25** — 3 sin Salesperson (COMWORKS, SAVINO DEL BENE, CONSTRUCTORA TORRE) |
| **A vincular** | **61** |
| No se pueden | 1 — MERCURIA S.R.L., dos contactos duplicados en Odoo (ids 52096 y 52165) |
| **Altas de concepto** | **3** — 20604 VERIFICACION SENASA, 30065 ALMACENAJE DE VEHÍCULO X DIA (MOTO), 30339 TOMA DE CONTENIDO |
| Conceptos ya en Odoo / que no son conceptos | 259 / 18 |

## Puerto y proceso

- pm2: `dassa-sincro-odoo-depofis` · puerto **3038** · Vite dev: **5188**
- nginx: `location ^~ /sincro-odoo-depofis/` en `apps-dassa.conf`
- 🚨 **NUNCA `pm2 restart all`**: tira toda la producción de DASSA.

## Archivos críticos

| Archivo | Por qué |
|---|---|
| `sincro/reglas.py` | **el criterio.** `decidir_cliente`, `completar_vacios`, `excluir_concepto`, el vendedor, el IVA, el CUIT. Módulo puro, testeado sin red. |
| `sincro/odoo_client.py` | **la guarda.** Qué se puede escribir en Odoo. Agregar un campo es tocar acá, a la vista de un review. |
| `sincro/config.py` | **el freno.** `resolver_modo()` es lo único que puede devolver `'aplicacion'`. |
| `sincro/espejo.py` | DEPOFIS. Sólo SELECT, sesión read-only, nunca `SELECT *` (la tabla trae `usuario`/`password`). |
| `sincronizar.py` | la rutina: decide, escribe (si corresponde), verifica y publica. |
| `server/lib/corridas.js` | el dominio de la app. Los routers no escriben SQL. |
| `sql/030_vistas.sql` | `es_nueva` y los conteos. La pantalla no los recalcula. |

## Comandos

```bash
# la rutina
python sincronizar.py --sin-publicar        # simulación, sólo el .json en salidas/
python sincronizar.py --solo clientes
python sincronizar.py --aplicar --limite 1  # con SINCRO_PERMITIR_APLICAR=si: escribe UNO
python -m unittest sincro.test_reglas sincro.test_odoo_client -v

# la app
npm test              # coherencia: puertos, roles, acciones, el freno, DEPOFIS sin escritura
npm run db:diag
npm run build         # tsc --noEmit && vite build
node scripts/setup-idp.cjs --quien
```

## Decisiones que conviene no revertir sin pensarlas

1. **La app no dispara la rutina ni escribe en Odoo.** Escribir en Odoo tiene que
   ser una acción del servidor —con su `.env` y su cron— y no un click.
2. **DEPOFIS sólo se lee, y del espejo.** No es una preferencia: es la regla de
   datos de DASSA y la decisión del proyecto. El costo es hasta una hora de
   atraso (el espejo sincroniza cada hora); la corrida guarda
   `fuente_sincronizada_en` y la pantalla lo dice.
3. **La idempotencia es el `depofis_code`.** Un alta lo deja cargado, así que la
   corrida siguiente ve al cliente como sincronizado. Correrla dos veces no
   duplica nada — y además se re-chequea Odoo justo antes de cada escritura.
4. **Vincular no pisa.** Sólo completa campos vacíos. Un dato que alguien cargó
   en Odoo vale más que el de DEPOFIS para esta rutina.
5. **Ante la duda, omitir con motivo.** CUIT ya vinculado a otro código,
   contactos duplicados, archivados: ninguno se resuelve solo. Elegir uno
   "probable" es como se terminan fusionando dos clientes distintos.
6. **El `VENDEDOR_MAP` se guarda con cada corrida** (`corrida.vendedor_map`):
   explica en marzo por qué a un cliente le tocó tal Salesperson en enero.
7. **`es_nueva` se calcula en SQL contra la corrida anterior**, por
   `depofis_id`. Las corridas 0.1 no cuentan como "anterior" (iban al revés):
   la primera 0.2 se presenta como primera corrida.
8. **Si la app está caída, la rutina no aborta.** Sigue, y deja el resultado en
   `salidas/corrida_<sello>.json`.

### 🩹 Lecciones de la 0.1 que siguen valiendo

- **Una acción nueva se agrega en cuatro lugares**: el CHECK (`sql/022`), la
  rutina, `ACCIONES` en `server/lib/corridas.js` (+ el filtro del router) y
  `AccionNovedad` en `src/lib/types.ts`. Cuando se sumó `fuera_alcance` faltó el
  server, el lote rebotaba con 400 y la corrida quedaba `en_curso` para siempre.
  Ahora hay un test que compara los cuatro.
- **Una corrida que se abrió siempre se cierra** (`publicar.py`): si el envío
  falla, como `fallida`, para que no quede colgada ni sirva de "anterior".
- **`aplicar_sql.py` re-corre todas las migraciones.** Por eso el CHECK de `021`
  es `NOT VALID`: si no, una re-aplicación con filas `vincular` cortaría ahí.

## Gotchas

- **Odoo devuelve `False` para los campos vacíos**, no `None` ni `''`. Un
  many2one llega como `[id, "nombre"]`. `reglas.es_vacio` cubre los tres.
- **El módulo l10n_ar valida el CUIT al crear el contacto.** Por eso el dígito
  verificador se chequea antes (`reglas.cuit_valido`): un CUIT malo es un dato
  a corregir en DEPOFIS, no un error de la corrida.
- **`depofis_mirror`, no `depofis`**: el segundo está congelado desde
  2026-05-10. Hay un test que lo cuida.
- **La API key de Odoo es la personal de Facundo**: las altas aparecen creadas
  por él. Migrar a un usuario de servicio es cambiar `ODOO_KEY`.
- **La consola de Windows es cp1252**: la rutina fuerza UTF-8 en stdout.
- **`npm install` está roto desde la red de la oficina** (FortiGate). El build se
  hace en el box.
- **El box clona con la identidad de `santiagoaguirreoliva`** (el `gh` de `dassa`).

## Lo que NO se verificó todavía

1. **Una escritura real en Odoo.** Todo lo de la 0.2 se probó en simulación
   contra Odoo de producción y el espejo, más `tsc` y `vite build` en el box. La
   primera escritura tiene que ser con `--limite 1` y revisada a mano.
2. **La pantalla con datos 0.2**: necesita el deploy y las migraciones.
3. **El lint** tiene dos errores que ya estaban en la 0.1 (`_next` sin usar en
   `server/index.js`, `setState` en el effect de `Novedades.tsx`); no se tocaron.
