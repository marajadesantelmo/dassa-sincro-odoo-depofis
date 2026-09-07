-- 010_corridas.sql · una fila por ejecución de `sincronizar.py`.
--
-- La corrida es la unidad de todo: las novedades no existen sueltas, existen
-- "según la corrida del martes". Es lo que permite comparar dos corridas y
-- decir qué es NUEVO — que es de lo que se trata la app.

CREATE TABLE IF NOT EXISTS sincro_odoo_depofis.corrida (
  id             bigserial PRIMARY KEY,

  -- 'simulacion': la rutina lee las dos puntas y calcula qué haría, sin
  -- escribir una sola fila en DEPOFIS. Es el modo por default y con el que
  -- arranca el proyecto.
  -- 'aplicacion': además ejecuta los INSERT. Requiere las dos llaves
  -- (--aplicar Y SINCRO_PERMITIR_APLICAR=si); ver sincro/config.py.
  modo           text NOT NULL CHECK (modo IN ('simulacion', 'aplicacion')),

  origen         text NOT NULL DEFAULT 'cli' CHECK (origen IN ('cron', 'cli', 'manual')),
  -- Email de quien la disparó, o NULL si fue el cron. No es una FK a `users`:
  -- esa tabla vive en el IdP, en otro cluster (política madre-hijas, regla #1).
  disparada_por  text,

  estado         text NOT NULL DEFAULT 'en_curso'
                 CHECK (estado IN ('en_curso', 'ok', 'con_errores', 'fallida')),

  iniciada_en    timestamptz NOT NULL DEFAULT now(),
  terminada_en   timestamptz,
  duracion_ms    integer,

  -- Contra qué instancia se corrió. Si mañana alguien apunta la rutina a una
  -- base de prueba de Odoo, la corrida queda marcada y no se confunde con las
  -- de producción.
  odoo_db        text,
  odoo_uid       integer,
  depofis_server text,

  -- De dónde se LEYÓ DEPOFIS (no confundir con `origen`, que es quién disparó):
  --   'espejo' → depofis_mirror en Smart DASSA Central. Es una copia diaria, así
  --              que un informe puede decir "falta dar de alta" de un cliente
  --              que se cargó esta mañana. Por eso se guarda también la
  --              frescura, y la pantalla la muestra.
  --   'origen' → el SQL Server. Obligatorio para cualquier corrida de
  --              aplicación: verificar contra una copia si un CUIT ya existe es
  --              exactamente cómo se duplica un cliente.
  fuente         text NOT NULL DEFAULT 'espejo' CHECK (fuente IN ('espejo', 'origen')),
  fuente_sincronizada_en timestamptz,

  -- El mapeo vendedor que la corrida USÓ, tal cual. Se guarda en vez de
  -- referenciar una tabla de configuración a propósito: así la pantalla puede
  -- explicar por qué a un cliente le tocó el código 15 en marzo aunque hoy el
  -- mapa diga otra cosa. Sin esto, cambiar el mapa reescribiría el pasado.
  vendedor_map   jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Conteos por tipo/acción, calculados por la rutina al cerrar.
  totales        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- El traceback si la corrida se cayó. Es lo que se muestra en pantalla en
  -- vez de un "falló" mudo.
  error          text,

  version_rutina text
);

CREATE INDEX IF NOT EXISTS corrida_iniciada_idx ON sincro_odoo_depofis.corrida (iniciada_en DESC);
CREATE INDEX IF NOT EXISTS corrida_modo_idx     ON sincro_odoo_depofis.corrida (modo, iniciada_en DESC);

COMMENT ON TABLE  sincro_odoo_depofis.corrida IS 'Una ejecucion de sincronizar.py.';
COMMENT ON COLUMN sincro_odoo_depofis.corrida.vendedor_map IS
  'El VENDEDOR_MAP efectivamente usado: {"<uid odoo>": {"nombre": "...", "propio": N, "institucional": N+10}}';

-- Idempotencia: si la tabla ya existía de una corrida anterior de este archivo,
-- el CREATE TABLE IF NOT EXISTS de arriba no agrega columnas nuevas.
ALTER TABLE sincro_odoo_depofis.corrida
  ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'espejo';
ALTER TABLE sincro_odoo_depofis.corrida
  ADD COLUMN IF NOT EXISTS fuente_sincronizada_en timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corrida_fuente_check') THEN
    ALTER TABLE sincro_odoo_depofis.corrida
      ADD CONSTRAINT corrida_fuente_check CHECK (fuente IN ('espejo', 'origen'));
  END IF;
END
$$;
