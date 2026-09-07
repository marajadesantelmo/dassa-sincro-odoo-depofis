# Cómo se escribe en DEPOFIS

> Verificado end-to-end contra producción el **2026-09-07**: se creó el concepto
> 999999 `TESTING FACUNDO` y se lo releyó por la vista. Funciona.

## La regla en una línea

**`INSERT INTO` no sirve. Hay que mandar el comando a FoxPro con
`EXEC ('<comando VFP>') AT [DEPO50_DASSA]`.**

## Por qué

`DEPOFIS.DASSA.Clientes` y `.Concepfc` **no son tablas**. Son vistas:

```sql
CREATE VIEW [DASSA].[Concepfc]
AS SELECT [Concepfc].* FROM OPENQUERY([DEPO50_DASSA], 'SELECT * FROM [Concepfc]') AS Concepfc
```

`DEPO50_DASSA` es un linked server con provider **VFPOLEDB** apuntando a
`\\10.0.10.15\aplicaciones\sistemas`: DEPOFIS son archivos FoxPro en un share, y
el SQL Server es una ventana sobre ellos.

Escribir por SQL Server directo falla, porque el provider no expone la interfaz
de rowset escribible:

```
INSERT INTO DEPOFIS.DASSA.Concepfc ...          -> 7301 IID_IRowsetChange
INSERT INTO OPENQUERY([DEPO50_DASSA], ...) ...  -> 7301 IID_IRowsetChange
```

Con pass-through el INSERT no lo hace SQL Server: se lo manda como **string** a
FoxPro, que sí sabe escribir sus propios archivos.

## De dónde salió esto

De **`dassa-orden`**, la app del ecosistema que ya escribe en DEPOFIS en
producción (1057 filas en `cordicar` con `us_add = 'ORDEN_APP'`). El mecanismo se
lo confirmó **Silvio, de Syspro, por mail el 2026-06-11**, y está implementado en
`dassa-orden/server/lib/vfp-builder.js` + `depofis-writer.js`.

`sincro/vfp.py` de este repo es un port de ese builder. **No inventamos nada:**
se replica lo que ya funciona, incluidos los gotchas que ellos ya pagaron.

## Los cinco gotchas, todos verificados acá

**1. Sintaxis VFP, no T-SQL.**

```
fechas    {^2026-09-07}     ·  fecha vacía  {}
strings   "TEXTO"              (comillas DOBLES)
igualdad  ==                   (exacta, en el WHERE)
```

**2. Ninguna comilla simple en el comando.** La simple delimita el literal del
`EXEC (...)`; una sola rompe todo. `vfp_string()` las elimina y
`envolver_exec_at()` aborta si igual quedó alguna. Es también la defensa contra
inyección: los valores vienen de Odoo, que lo carga gente.

**3. `autocommit=True` es obligatorio.** Sin eso pyodbc abre una transacción
implícita, el comando se vuelve distribuido y VFPOLEDB lo rechaza:

```
7390: does not support the required transaction interface
```

**Consecuencia: no hay rollback.** Cada comando es definitivo. La integridad se
consigue **verificando después**, no deshaciendo — por eso `AccesoEscritura`
tiene `verificar()` y el script de prueba relee siempre.

**4. FoxPro no acepta null en NINGUNA columna.** Un INSERT parcial da:

```
7412: Field IMPORTE does not accept null values.
```

Verificado: las 279 filas de `Concepfc` no tienen un solo null en ninguna de sus
38 columnas. Así que el INSERT manda **las 38**. Las que la rutina no deriva de
Odoo salen de `vfp.DEFAULTS_CONCEPFC`, y esos defaults son el **valor más
frecuente** de cada columna en los conceptos que ya existen — no valores
inventados.

**5. La fecha vacía es `{}`, no `1899-12-30`.** Ese es el centinela con el que
FoxPro *guarda* una fecha vacía, pero mandarlo como `{^1899-12-30}` sería una
fecha real de 1899 (`EMPTY()` daría falso) y DEPOFIS la leería como "fecha
cargada". Gotcha heredado de `dassa-orden`.

## `us_add` — el marcador de auditoría

Es `char(10)` y **sí admite un marcador de aplicación**. Conviven dos usos:

| valor | qué es |
|---|---|
| `'9'`, `'28'`, `'16'`… | id del usuario de DEPOFIS que cargó la fila a mano |
| `'ORDEN_APP'` | lo que escribe `dassa-orden` (1057 filas en cordicar) |
| `'ODOO'` | lo que escribe esta rutina |

El marcador es lo que hace auditable la automatización —
`WHERE ALLTRIM(us_add) == "ODOO"` contesta "qué creó la rutina"— y es además el
**guard del DELETE**: esta app sólo puede borrar filas que ella creó, nunca una
que cargó una persona. Con un id de usuario real esa separación se perdería.

⚠️ El `ALLTRIM` no es adorno: la columna viene con blancos de cola y el `==` de
FoxPro es exacto. Sin `ALLTRIM` no matchea nunca.

## Estado de la prueba

```
python scripts/probar_escritura.py --confirmar        # crea el 999999
python scripts/probar_escritura.py --borrar --confirmar   # lo saca
```

Corrido el 2026-09-07: la fila entró, se verificó por pass-through y por la
vista. `Concepfc` pasó de 278 a 279 códigos distintos.

## Lo que falta antes de habilitar el alta automática

**1. Los defaults de facturación los tiene que firmar alguien de negocio.**
`gravado='S'`, `moneda='ARP'`, `importe=0`, `cta_contab=0` son el caso más común,
pero un concepto con `gravado` equivocado saca mal el IVA de cada factura que lo
use. Para una fila de prueba da igual; para los 8 conceptos reales, no.

**2. `Clientes` todavía no está resuelto.** Tiene **60+ columnas** y la rutina
arma 18. Si `Clientes` es tan estricto como `Concepfc` con los nulls —y no hay
razón para pensar lo contrario— el alta de un cliente va a fallar igual que
falló la primera de concepto. Hay que hacer el mismo trabajo: relevar las
columnas obligatorias y sus defaults reales.
**No es urgente**: el informe del 2026-09-07 da 0 altas de cliente.
