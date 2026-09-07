-- 030_vistas.sql · lo que lee la pantalla.
--
-- La app no arma "qué es nuevo" en Node: lo resuelve acá, porque comparar una
-- corrida contra la anterior es una operación de conjuntos y el motor de la
-- base la hace con un índice. Node sólo pagina y pinta.

-- ─── Corrida anterior ────────────────────────────────────────────────────
-- "La anterior" es la corrida COMPLETADA inmediatamente previa, sin importar
-- el modo: lo que importa es si el registro ya lo habíamos visto, no si esa
-- vez se escribió o no. Las fallidas se excluyen — una corrida que se cayó a
-- los 3 segundos no vio nada, y tomarla como referencia haría que todo
-- pareciera nuevo en la corrida siguiente.
CREATE OR REPLACE VIEW sincro_odoo_depofis.v_corrida_anterior AS
SELECT
  id AS corrida_id,
  LAG(id) OVER (ORDER BY iniciada_en, id) AS anterior_id
FROM sincro_odoo_depofis.corrida
WHERE estado IN ('ok', 'con_errores');

COMMENT ON VIEW sincro_odoo_depofis.v_corrida_anterior IS
  'Para cada corrida completada, la corrida completada previa. Base del calculo de es_nueva.';

-- ─── Novedades, con la marca de nueva ────────────────────────────────────
-- `es_nueva` = este registro de Odoo no figuraba en la corrida anterior.
--
-- En la PRIMERA corrida no hay con qué comparar y `es_nueva` da false para
-- todo: es deliberado. Marcar 117 filas como NUEVAS el primer día es ruido que
-- entrena a ignorar la marca. La pantalla avisa "primera corrida" mirando
-- `anterior_id`, que va NULL.
CREATE OR REPLACE VIEW sincro_odoo_depofis.v_novedad AS
SELECT
  n.id,
  n.corrida_id,
  n.tipo,
  n.odoo_id,
  n.odoo_nombre,
  n.clave,
  n.accion,
  n.motivo,
  n.requiere_atencion,
  n.vendedor_uid,
  n.vendedor_nombre,
  n.es_dassa,
  n.vendedor_depofis,
  n.payload,
  n.depofis_id,
  n.creado_en,
  ca.anterior_id,
  (
    ca.anterior_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sincro_odoo_depofis.novedad p
       WHERE p.corrida_id = ca.anterior_id
         AND p.tipo = n.tipo
         AND p.odoo_id = n.odoo_id
    )
  ) AS es_nueva
FROM sincro_odoo_depofis.novedad n
LEFT JOIN sincro_odoo_depofis.v_corrida_anterior ca ON ca.corrida_id = n.corrida_id;

-- ─── Resumen por corrida ─────────────────────────────────────────────────
-- Los conteos salen de las filas y no de `corrida.totales`: ese jsonb lo
-- escribe la rutina y sirve para auditar lo que ella creyó haber hecho, pero
-- lo que la pantalla muestra tiene que salir de lo que efectivamente quedó
-- guardado. Si algún día difieren, el que miente es el jsonb.
CREATE OR REPLACE VIEW sincro_odoo_depofis.v_corrida_resumen AS
SELECT
  c.id,
  c.modo,
  c.origen,
  c.disparada_por,
  c.estado,
  c.iniciada_en,
  c.terminada_en,
  c.duracion_ms,
  c.odoo_db,
  c.fuente,
  c.fuente_sincronizada_en,
  c.depofis_server,
  c.vendedor_map,
  c.error,
  c.version_rutina,
  ca.anterior_id,
  COUNT(n.id)                                                          AS evaluados,
  COUNT(n.id) FILTER (WHERE n.tipo = 'cliente')                        AS clientes,
  COUNT(n.id) FILTER (WHERE n.tipo = 'concepto')                       AS conceptos,
  COUNT(n.id) FILTER (WHERE n.accion = 'alta')                         AS altas,
  COUNT(n.id) FILTER (WHERE n.accion = 'alta' AND n.tipo = 'cliente')  AS altas_clientes,
  COUNT(n.id) FILTER (WHERE n.accion = 'alta' AND n.tipo = 'concepto') AS altas_conceptos,
  COUNT(n.id) FILTER (WHERE n.accion = 'omitido')                      AS omitidos,
  COUNT(n.id) FILTER (WHERE n.accion = 'error')                        AS errores,
  COUNT(n.id) FILTER (WHERE n.requiere_atencion)                       AS requieren_atencion,
  -- Clientes que se darían de alta SIN vendedor resuelto. Es el número que
  -- mide el trabajo pendiente en Odoo, y el que la pantalla pone arriba.
  COUNT(n.id) FILTER (
    WHERE n.tipo = 'cliente' AND n.accion = 'alta' AND n.vendedor_depofis IS NULL
  ) AS altas_sin_vendedor
FROM sincro_odoo_depofis.corrida c
LEFT JOIN sincro_odoo_depofis.novedad n ON n.corrida_id = c.id
LEFT JOIN sincro_odoo_depofis.v_corrida_anterior ca ON ca.corrida_id = c.id
GROUP BY c.id, ca.anterior_id;

-- ─── Última corrida completada ───────────────────────────────────────────
-- Es lo que abre la pantalla principal. Se excluyen las 'en_curso': mostrar
-- una corrida a medio publicar haría que los conteos bailen mientras se mira.
CREATE OR REPLACE VIEW sincro_odoo_depofis.v_ultima_corrida AS
SELECT * FROM sincro_odoo_depofis.v_corrida_resumen
WHERE estado IN ('ok', 'con_errores')
ORDER BY iniciada_en DESC, id DESC
LIMIT 1;
