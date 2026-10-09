# -*- coding: utf-8 -*-
"""Rutina de sincronización de maestros DEPOFIS → Odoo.

    config       de dónde salen las credenciales, y el freno de dos llaves
    reglas       las reglas de negocio (vendedor, IVA, CUIT, qué hacer con cada
                 cliente, qué filas de Concepfc no son conceptos) — módulo puro
    espejo       DEPOFIS, por el espejo depofis_mirror — sólo lectura
    odoo_client  XML-RPC contra Odoo: lectura por allowlist, escritura cerrada
    publicar     manda el resultado a la app por /api/servicio/*

El punto de entrada es `sincronizar.py`, en la raíz del repo.
"""

# 0.2: se invirtió la dirección (era Odoo → DEPOFIS). Las vistas usan el
# prefijo para no comparar una corrida 0.2 contra una 0.1 (ver 030_vistas.sql).
VERSION = '0.2.0'
