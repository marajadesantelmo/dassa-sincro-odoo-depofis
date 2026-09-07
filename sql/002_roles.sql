-- 002_roles.sql · rol de la app.
--
-- `sincro_odoo_depofis_app` es el único rol que usa el server: R/W sobre su propio
-- schema y nada más. No necesita leer `depofis_mirror` ni `depofis.*` — la
-- rutina Python compara contra el SQL Server de origen y publica el resultado
-- ya resuelto.
--
-- ⚠️ Cambiar la contraseña antes de aplicar esto en producción y dejarla sólo
-- en el `.env` del box. El literal de acá es un placeholder.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sincro_odoo_depofis_app') THEN
    CREATE ROLE sincro_odoo_depofis_app LOGIN PASSWORD 'CAMBIAR_ANTES_DE_APLICAR';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA sincro_odoo_depofis TO sincro_odoo_depofis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sincro_odoo_depofis TO sincro_odoo_depofis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sincro_odoo_depofis TO sincro_odoo_depofis_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA sincro_odoo_depofis
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sincro_odoo_depofis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sincro_odoo_depofis
  GRANT USAGE, SELECT ON SEQUENCES TO sincro_odoo_depofis_app;
