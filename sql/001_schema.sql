-- 001_schema.sql · schema propio de la app "sincro-odoo-depofis".
--
-- Vive en Smart DASSA Central (txlotccsiqaypkzobkxm). No comparte cluster con
-- ninguna de las dos fuentes que compara la rutina — Odoo se lee por XML-RPC y
-- DEPOFIS por SQL Server —, así que acá no hay ningún JOIN entre sistemas: lo
-- que se guarda es el RESULTADO de la comparación, ya resuelto por la rutina.
--
-- Aplicar en orden: 001 → 002 → 010 → 020 → 030.

CREATE SCHEMA IF NOT EXISTS sincro_odoo_depofis;

COMMENT ON SCHEMA sincro_odoo_depofis IS
  'Corridas y novedades de la sincronizacion de maestros Odoo -> DEPOFIS. Owner: facundo@pymetech.com.ar';
