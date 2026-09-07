-- 020_novedades.sql · cada registro de Odoo que la corrida evaluó.
--
-- Se guardan TODAS las evaluaciones, no sólo las altas: saber por qué un
-- cliente NO se dio de alta es la mitad del valor de la pantalla. Lo que
-- distingue una novedad accionable de una omisión rutinaria es
-- `requiere_atencion`.

CREATE TABLE IF NOT EXISTS sincro_odoo_depofis.novedad (
  id            bigserial PRIMARY KEY,
  corrida_id    bigint NOT NULL REFERENCES sincro_odoo_depofis.corrida(id) ON DELETE CASCADE,

  tipo          text NOT NULL CHECK (tipo IN ('cliente', 'concepto')),

  odoo_id       integer NOT NULL,
  odoo_nombre   text NOT NULL,

  -- CUIT formateado para clientes, Referencia Interna para conceptos. Es la
  -- clave con la que se buscó en DEPOFIS.
  clave         text,

  -- 'alta'    → se creó (aplicacion) o se crearía (simulacion) en DEPOFIS
  -- 'omitido' → no corresponde crearlo; el motivo dice por qué
  -- 'error'   → se intentó y DEPOFIS lo rechazó
  accion        text NOT NULL CHECK (accion IN ('alta', 'omitido', 'error')),
  motivo        text,

  -- Marca lo que necesita que una persona haga algo (cargar el vendedor en
  -- Odoo, vincular el depofis_code, revisar una unidad de cálculo). Es el
  -- filtro por default de la pantalla.
  requiere_atencion boolean NOT NULL DEFAULT false,

  -- ─── El tramo vendedor, desarmado ──────────────────────────────────────
  -- Desarmado en columnas y no sólo dentro de `payload` porque es lo que se
  -- filtra y se ordena en la pantalla, y lo que hay que poder auditar: "a este
  -- cliente le tocó el 15 porque el Salesperson era Enzo y is_dassa estaba
  -- tildado".
  vendedor_uid      integer,   -- res.users.id de Odoo
  vendedor_nombre   text,      -- Salesperson tal como figura en Odoo
  es_dassa          boolean,   -- el check "Cliente DASSA" de la pestaña DEPOFIS
  vendedor_depofis  integer,   -- el código que va a DASSA.Clientes.vendedor

  -- Lo que se escribiría (o escribió) en DEPOFIS, columna por columna. Es el
  -- registro de auditoría: permite revisar el alta antes de habilitarla y
  -- reconstruir después qué se mandó exactamente.
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- clie_nro / codigo asignado, cuando la corrida fue de aplicación.
  depofis_id    text,

  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS novedad_corrida_idx   ON sincro_odoo_depofis.novedad (corrida_id, tipo, accion);
CREATE INDEX IF NOT EXISTS novedad_atencion_idx  ON sincro_odoo_depofis.novedad (corrida_id) WHERE requiere_atencion;
-- Para el cálculo de "es nueva": se busca el mismo odoo_id en la corrida anterior.
CREATE INDEX IF NOT EXISTS novedad_odoo_idx      ON sincro_odoo_depofis.novedad (tipo, odoo_id, corrida_id DESC);

COMMENT ON TABLE sincro_odoo_depofis.novedad IS
  'Cada registro de Odoo evaluado por una corrida, con la accion resuelta y su motivo.';
