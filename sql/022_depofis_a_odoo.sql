-- 022_depofis_a_odoo.sql · la sincronización cambia de dirección: DEPOFIS → Odoo.
--
-- POR QUE
-- ───────
-- La rutina se escribió como Odoo → DEPOFIS (dar de alta en DEPOFIS lo que
-- estaba en Odoo). El proyecto es al revés: DEPOFIS es el maestro, y lo que se
-- da de alta en DEPOFIS tiene que aparecer en Odoo. A DEPOFIS no se le escribe
-- nada (decisión de Facu, 2026-10-09).
--
-- Lo que cambia en la tabla de novedades:
--
--   · `odoo_id` deja de ser obligatorio. Una novedad ahora nace de un registro
--     de DEPOFIS, y un ALTA todavía no tiene id en Odoo (lo tiene recién cuando
--     se ejecuta). La clave de la fila pasa a ser `depofis_id` (clie_nro o
--     código de concepto).
--   · acción nueva 'vincular': el cliente ya existe en Odoo con el mismo CUIT y
--     le falta el Código DEPOFIS; se le escribe el código y se completan los
--     datos vacíos.
--   · `ejecutada`: si la escritura en Odoo se hizo. En simulación siempre es
--     false; en aplicación también puede serlo si la corrida tenía `--limite`.
--
-- `odoo_nombre` conserva el nombre de la columna pero ahora guarda el nombre
-- que trae DEPOFIS (razón social / detalle del concepto).

ALTER TABLE sincro_odoo_depofis.novedad
  ALTER COLUMN odoo_id DROP NOT NULL;

ALTER TABLE sincro_odoo_depofis.novedad
  ADD COLUMN IF NOT EXISTS ejecutada boolean NOT NULL DEFAULT false;

ALTER TABLE sincro_odoo_depofis.novedad
  DROP CONSTRAINT IF EXISTS novedad_accion_check;

ALTER TABLE sincro_odoo_depofis.novedad
  ADD CONSTRAINT novedad_accion_check
  CHECK (accion IN ('alta', 'vincular', 'omitido', 'error', 'fuera_alcance'));

-- Para el cálculo de "es nueva", que ahora compara por el registro de DEPOFIS.
CREATE INDEX IF NOT EXISTS novedad_depofis_idx
  ON sincro_odoo_depofis.novedad (tipo, depofis_id, corrida_id DESC);

COMMENT ON COLUMN sincro_odoo_depofis.novedad.accion IS
  'alta (se crea en Odoo) | vincular (existe en Odoo por CUIT, se le carga el Código DEPOFIS) | '
  'omitido (no se puede, el motivo dice por qué) | error | fuera_alcance (no es un concepto).';
COMMENT ON COLUMN sincro_odoo_depofis.novedad.odoo_id IS
  'Contacto/producto de Odoo. En vincular, el que se vincula; en alta, el creado (NULL si no se ejecutó).';
COMMENT ON COLUMN sincro_odoo_depofis.novedad.depofis_id IS
  'clie_nro o código de concepto de DEPOFIS: la clave de la fila.';
COMMENT ON COLUMN sincro_odoo_depofis.novedad.ejecutada IS
  'true = la escritura en Odoo se hizo y se verificó releyendo el registro.';
