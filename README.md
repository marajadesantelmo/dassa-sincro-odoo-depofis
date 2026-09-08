# Sincro Odoo → DEPOFIS

Cuando se da de alta un cliente o un concepto en Odoo, tarde o temprano tiene
que existir también en DEPOFIS. Este repo tiene las dos piezas que hacen eso:

- **`sincronizar.py`** — la rutina. Lee Odoo y DEPOFIS, compara, y decide qué
  falta. En modo simulación (el default) no escribe nada.
- **la app `sincro-odoo-depofis`** — la ventana. Muestra las novedades de cada corrida
  en `https://apps.dassa.com.ar/sincro-odoo-depofis/`.

> **Hoy la rutina no sincroniza nada.** Corre en simulación: muestra lo que
> haría. Habilitar la escritura necesita dos cambios deliberados en el servidor
> (`CLAUDE.md` § "Hoy no se sincroniza nada").

## Qué compara

| Odoo | DEPOFIS | Cómo se decide |
|---|---|---|
| `res.partner` (empresas con CUIT, sin Código DEPOFIS) | `DASSA.Clientes` | por CUIT; hace falta además una categoría comercial |
| `product.template` (con Referencia Interna numérica) | `DASSA.Concepfc` | por código |

El **vendedor** sale de dos campos de Odoo: el *Salesperson* del contacto y el
check *Cliente DASSA* de la pestaña DEPOFIS. Cada comercial tiene un código
propio y uno institucional, y `Cliente DASSA` elige cuál — Enzo Nieto es el 5 si
está destildado y el 15 si está tildado. El mapa completo está en
`sincro/reglas.py`, verificado contra los 1951 clientes ya vinculados.

## Empezar

```bash
python -m unittest sincro.test_reglas -v   # 43 tests, sin credenciales ni red
python sincronizar.py --help
```

Para correr la rutina de verdad hacen falta las credenciales de Odoo y del SQL
de DEPOFIS (`.env.example` dice cuáles y de dónde salen).

## Estructura

```
sincronizar.py            la rutina
sincro/
  reglas.py               VENDEDOR_MAP, IVA, unidad de cálculo — módulo puro
  config.py               credenciales y el freno de dos llaves
  odoo_client.py          XML-RPC solo lectura (allowlist de métodos)
  depofis.py              SQL Server: AccesoLectura / AccesoEscritura
  publicar.py             manda la corrida a la app
  test_reglas.py          los tests de las reglas
server/                   Express + SSO + la API que lee la pantalla
src/                      React + TS
sql/                      las migraciones del schema sincro_odoo_depofis
scripts/setup-idp.cjs     registro en el IdP y accesos
docs/DEPLOY.md            cómo se pone en marcha, paso por paso
```

## Documentación

- **`CLAUDE.md`** — el criterio de vendedor, las decisiones de diseño, los
  gotchas y qué falta verificar. Leerlo antes de tocar nada.
- **`docs/DEPLOY.md`** — deploy en el box.
- **`sql/README.md`** — las migraciones y por qué viven en ese cluster.

## Acceso

App restringida a Facundo, Santiago y Manuel. `node scripts/setup-idp.cjs --quien`
audita quién entra.
