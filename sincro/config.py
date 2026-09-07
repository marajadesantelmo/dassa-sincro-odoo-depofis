# -*- coding: utf-8 -*-
"""Configuración de la rutina: de dónde salen las credenciales y el freno.

Orden de precedencia para cada valor:
  1. variable de entorno
  2. el `.env` de la app (el mismo que lee el server Node)
  3. `tokens.py` al lado del script — es como funcionan hoy todas las rutinas
     Python de DASSA, y se mantiene para no romper una corrida a mano

Sin dependencias: el `.env` se parsea acá en 15 líneas antes que sumar
python-dotenv, porque `pip install` desde la red de la oficina choca con el
mismo FortiGate que rompe npm (ver CLAUDE.md del workspace).
"""

import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ─── .env ──────────────────────────────────────────────────────────────────

def _leer_env(ruta):
    valores = {}
    if not os.path.exists(ruta):
        return valores
    with open(ruta, 'r', encoding='utf-8') as f:
        for linea in f:
            linea = linea.strip()
            if not linea or linea.startswith('#') or '=' not in linea:
                continue
            clave, _, valor = linea.partition('=')
            valores[clave.strip()] = valor.strip().strip('"').strip("'")
    return valores


_ENV_ARCHIVO = _leer_env(os.path.join(RAIZ, '.env'))

# ─── tokens.py (fallback histórico) ────────────────────────────────────────

_TOKENS = {}
try:
    sys.path.insert(0, RAIZ)
    import tokens as _t  # noqa: E402
    _TOKENS = {
        'ODOO_KEY': getattr(_t, 'odoo_key', None),
        'ODOO_DB': getattr(_t, 'odoo_db', None),
        'DEPOFIS_USER': getattr(_t, 'username', None),
        'DEPOFIS_PASSWORD': getattr(_t, 'password', None),
    }
    _TOKENS = {k: v for k, v in _TOKENS.items() if v}
except ImportError:
    pass


def valor(clave, default=None):
    """El valor de una clave, con la precedencia documentada arriba."""
    return os.environ.get(clave) or _ENV_ARCHIVO.get(clave) or _TOKENS.get(clave) or default


def requerido(clave, para_que):
    v = valor(clave)
    if not v:
        raise SystemExit(
            'Falta {}: {}.\n'
            '  Ponelo en el .env de la app, como variable de entorno, o en tokens.py.'
            .format(clave, para_que))
    return v


# ─── Odoo (solo lectura) ───────────────────────────────────────────────────

ODOO_URL = valor('ODOO_URL', 'https://gestion.dassa.com.ar')
ODOO_DB = valor('ODOO_DB')  # opcional: si falta, el cliente la descubre

# El login y la key aceptan DOS nombres cada uno. `conciliacion-proveedores` —la
# otra app del ecosistema que lee este mismo Odoo— los llama `ODOO_USER` y
# `ODOO_API_KEY`, y conviene poder copiar un `.env` de una app a la otra sin
# tener que renombrar nada. Gana el nombre propio si están los dos.
ODOO_LOGIN = valor('ODOO_LOGIN') or valor('ODOO_USER', 'facundo@pymetech.com.ar')


def odoo_key():
    """La API key de Odoo, con el mismo doble nombre."""
    return valor('ODOO_KEY') or requerido('ODOO_API_KEY', 'la API key de Odoo')

# ─── DEPOFIS ───────────────────────────────────────────────────────────────
#
# Dos fuentes, para dos cosas distintas:
#
#   · ESPEJO  (`depofis_mirror.*` en Smart DASSA Central) — para LEER. Es la
#     fuente por default de las corridas de simulación, y es lo que manda la
#     regla de datos de DASSA: las apps nuevas leen el espejo, no el origen.
#   · ORIGEN  (el SQL Server) — obligatorio para ESCRIBIR. Una corrida de
#     aplicación no puede usar el espejo: verificar contra una copia de ayer si
#     un CUIT ya existe es exactamente cómo se duplica un cliente.
#
# ⚠️ SERVER va como "host,puerto", SIN el nombre de instancia: desde Linux la
# forma con instancia necesita al SQL Browser en UDP 1434 y no responde.

DEPOFIS_SERVER = valor('DEPOFIS_SERVER', '101.44.8.58,1436')

FUENTES = ('espejo', 'origen')


def resolver_fuente(pedida, modo):
    """Devuelve (fuente, aviso). Nunca deja una aplicación leyendo del espejo.

    El default es `espejo` para simular y `origen` para aplicar. Si alguien pide
    explícitamente el espejo para una corrida de aplicación, se corrige a origen
    y se avisa — no se falla, pero tampoco se le hace caso: el alta se decide
    contra el dato vivo o no se decide.
    """
    if modo == 'aplicacion':
        if pedida == 'espejo':
            return 'origen', (
                'Se pidió leer del espejo en una corrida de APLICACIÓN. Se usa el origen: '
                'chequear contra una copia si un CUIT ya existe es como se duplica un cliente.')
        return 'origen', None
    return (pedida or 'espejo'), None

# ─── La app ────────────────────────────────────────────────────────────────

SINCRO_API_URL = valor('SINCRO_API_URL', 'http://127.0.0.1:3038')


# ═══════════════════════════════════════════════════════════════════════════
#  EL FRENO
# ═══════════════════════════════════════════════════════════════════════════
#
# Hacen falta DOS cosas para que la rutina escriba una sola fila en DEPOFIS:
#
#   1. el flag `--aplicar` en la línea de comandos, y
#   2. la variable de entorno SINCRO_PERMITIR_APLICAR=si
#
# Están separadas a propósito. El flag lo puede tipear cualquiera —o copiar de
# un README, o dejarlo pegado en una línea de cron de una prueba vieja—; la
# variable vive en el .env del box y ponerla es una decisión deliberada de quien
# administra la máquina. Mientras el proyecto esté en evaluación, la variable
# queda en "no" y `--aplicar` se rechaza con un mensaje que explica por qué.
#
# El default de todo, si no se pasa nada, es SIMULACIÓN.

def aplicar_permitido():
    return str(valor('SINCRO_PERMITIR_APLICAR', 'no')).strip().lower() in ('si', 'sí', 'yes', 'true', '1')


def resolver_modo(pidio_aplicar):
    """Devuelve ('simulacion' | 'aplicacion', aviso).

    Nunca devuelve 'aplicacion' sin las dos llaves. Cuando se pidió aplicar y
    falta la variable, devuelve simulación CON un aviso — no un error: la
    corrida igual sirve, y lo que hay que ver es qué habría hecho.
    """
    if not pidio_aplicar:
        return 'simulacion', None
    if not aplicar_permitido():
        return 'simulacion', (
            'Se pidió --aplicar pero SINCRO_PERMITIR_APLICAR no está en "si": '
            'la corrida va en SIMULACIÓN y no escribe nada en DEPOFIS. '
            'Para habilitar la escritura hay que setear esa variable en el .env del box.')
    return 'aplicacion', None
