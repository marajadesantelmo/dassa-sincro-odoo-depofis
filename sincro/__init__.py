# -*- coding: utf-8 -*-
"""Rutina de sincronización de maestros Odoo → DEPOFIS.

    config       de dónde salen las credenciales, y el freno de dos llaves
    reglas       las reglas de negocio (VENDEDOR_MAP, IVA, calcula) — módulo puro
    odoo_client  XML-RPC contra Odoo, solo lectura garantizada por allowlist
    depofis      SQL Server: AccesoLectura (simulación) / AccesoEscritura (aplicación)
    publicar     manda el resultado a la app por /api/servicio/*

El punto de entrada es `sincronizar.py`, en la raíz del repo.
"""

VERSION = '0.1.0'
