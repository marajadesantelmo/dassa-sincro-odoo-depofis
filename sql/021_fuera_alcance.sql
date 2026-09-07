-- 021_fuera_alcance.sql · la accion 'fuera_alcance'.
--
-- POR QUE
-- ───────
-- La rutina evaluaba 117 contactos de Odoo, de los cuales 62 eran proveedores
-- puros (EDESUR, Banco Santander, Claro, Telecentro, Exolgan…). Ninguno se daba
-- de alta, pero todos figuraban como 'omitido' con requiere_atencion = true, o
-- sea como trabajo pendiente que nadie iba a hacer nunca: el 53 % de la pantalla
-- era ruido.
--
-- En DEPOFIS los proveedores viven en DASSA.Proveed, que esta rutina no toca. La
-- decision de negocio es que ese maestro se administra en Odoo y DEPOFIS no
-- necesita estar al dia con el.
--
-- 'fuera_alcance' NO es un cuarto tipo de omision: es la marca de "este registro
-- no es asunto de esta rutina". Por eso nunca lleva requiere_atencion, y por eso
-- el resumen lo cuenta aparte en vez de sumarlo a `omitidos` — mezclarlos haria
-- que el numero de omisiones dejara de significar "pendiente".
--
-- Se guardan igual, en vez de descartarlos en silencio, para poder auditar el
-- filtro: si alguien pregunta por que tal proveedor no aparece, la respuesta
-- esta en la fila y no en el codigo.

ALTER TABLE sincro_odoo_depofis.novedad
  DROP CONSTRAINT IF EXISTS novedad_accion_check;

ALTER TABLE sincro_odoo_depofis.novedad
  ADD CONSTRAINT novedad_accion_check
  CHECK (accion IN ('alta', 'omitido', 'error', 'fuera_alcance'));

-- Una fila fuera de alcance no puede pedir atencion: es una contradiccion en
-- los terminos y la pantalla la mostraria en el filtro por default, que es
-- justo lo que este cambio viene a evitar.
ALTER TABLE sincro_odoo_depofis.novedad
  DROP CONSTRAINT IF EXISTS novedad_fuera_alcance_sin_atencion;

ALTER TABLE sincro_odoo_depofis.novedad
  ADD CONSTRAINT novedad_fuera_alcance_sin_atencion
  CHECK (accion <> 'fuera_alcance' OR requiere_atencion = false);

COMMENT ON COLUMN sincro_odoo_depofis.novedad.accion IS
  'alta | omitido | error | fuera_alcance. fuera_alcance = es proveedor, no cliente: '
  'no es trabajo pendiente sino un registro que esta rutina no sincroniza.';
