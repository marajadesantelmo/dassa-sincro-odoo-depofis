# Sincro DEPOFIS → Odoo

Cuando se da de alta un cliente o un concepto en DEPOFIS, tiene que existir
también en Odoo. Este repo tiene las dos piezas que hacen eso:

- **`sincronizar.py`** — la rutina. Lee DEPOFIS (del espejo `depofis_mirror`,
  sólo lectura) y Odoo, compara, y crea o vincula en Odoo lo que falta. En modo
  simulación (el default) no escribe nada.
- **la app `sincro-odoo-depofis`** — la ventana. Muestra en
  `https://apps.dassa.com.ar/sincro-odoo-depofis/` lo que cada corrida sube o
  modifica en Odoo.

> **DEPOFIS no se escribe nunca.** En este repo no hay código ni credenciales
> para hacerlo. Lo único que se escribe es Odoo, y sólo con las dos llaves
> del freno puestas (`CLAUDE.md` § "El freno").

## Qué hace

| DEPOFIS | Odoo | Cómo se decide |
|---|---|---|
| `DASSA.Clientes` (activos) | `res.partner` | por Código DEPOFIS y después por CUIT: **alta** si no existe, **vincular** si existe por CUIT sin código |
| `DASSA.Concepfc` | `product.template` | por código = Referencia Interna: **alta** si no existe |

El **vendedor** de DEPOFIS se traduce al *Salesperson* y al check *Cliente
DASSA* de Odoo: cada comercial tiene un código propio y uno institucional (Enzo
Nieto es el 5 y el 15). El mapa está en `sincro/reglas.py`, verificado contra
los ~1950 clientes ya vinculados.

## Empezar

```bash
python -m unittest sincro.test_reglas sincro.test_odoo_client -v   # sin credenciales ni red
python sincronizar.py --sin-publicar                                 # simulación, deja el .json en salidas/
npm test                                                             # coherencia de configuración
```

Para correr la rutina hacen falta la API key de Odoo y el DSN del espejo
(`.env.example` dice cuáles).

## Estructura

```
sincronizar.py            la rutina
sincro/
  reglas.py               vendedor, IVA, CUIT, qué hacer con cada cliente — módulo puro
  config.py               credenciales y el freno de dos llaves
  espejo.py               DEPOFIS por depofis_mirror — sólo SELECT
  odoo_client.py          XML-RPC: lectura por allowlist, escritura cerrada y apagada por default
  publicar.py             manda la corrida a la app
  test_*.py               tests de las reglas y de la guarda de escritura
server/                   Express + SSO + la API que lee la pantalla
src/                      React + TS
sql/                      las migraciones del schema sincro_odoo_depofis
scripts/setup-idp.cjs     registro en el IdP y accesos
docs/DEPLOY.md            deploy y cron en el box
```

## Documentación

- **`CLAUDE.md`** — el modelo, las decisiones de diseño y los gotchas. Leerlo
  antes de tocar nada.
- **`docs/DEPLOY.md`** — deploy, primera escritura y cron.
- **`sql/README.md`** — las migraciones.

## Acceso

App restringida a Facundo, Santiago y Manuel. `node scripts/setup-idp.cjs --quien`
audita quién entra.
