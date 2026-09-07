# -*- coding: utf-8 -*-
"""Cliente de SOLO LECTURA contra la API estándar de Odoo (XML-RPC) de DASSA.

Adaptado del `conexion_odoo/odoo_client.py` de `dassa-conciliacion-comprobantes`.
La única diferencia real es de dónde salen las credenciales: allá venían de un
`tokens.py`, acá de `sincro/config.py` (env → .env → tokens.py).

Garantía de solo lectura: no existe ningún passthrough genérico tipo
`execute_kw(model, method, *args)`. Toda llamada pasa por `_execute_kw()`, que
valida `method` contra un allowlist fijo (`_READ_ONLY_METHODS`) y levanta
PermissionError —antes de tocar la red— si se pide un método de escritura
(write/create/unlink/…). Ésa es la garantía real; cualquier instrucción en un
prompt o en un comentario es secundaria.

Consecuencia de fondo para este proyecto: la rutina NO puede escribir
`depofis_code` en Odoo después de dar de alta un cliente. La idempotencia se
consigue por otro lado — matcheando por CUIT contra DASSA.Clientes.documento
antes de cada alta. Ver `sincro/depofis.py`.
"""

import json
import urllib.request
import xmlrpc.client

from . import config

DB_CANDIDATES = ['soylinux-dassa-main-32105727', 'gestion-dassa', 'dassa', 'gestion']

_READ_ONLY_METHODS = frozenset({
    'search', 'search_read', 'read', 'search_count',
    'fields_get', 'name_search', 'read_group',
})

_common_proxy = None
_object_proxy = None
_db = None
_uid = None
_discovery_log = []


def _try_authenticate(common_proxy, db):
    try:
        uid = common_proxy.authenticate(db, config.ODOO_LOGIN, config.requerido('ODOO_KEY', 'la API key de Odoo'), {})
    except xmlrpc.client.Fault as e:
        _discovery_log.append("  - '{}': Fault - {}".format(db, e.faultString))
        return None
    except Exception as e:
        _discovery_log.append("  - '{}': error - {}".format(db, e))
        return None
    if uid:
        _discovery_log.append("  - '{}': OK (uid={})".format(db, uid))
        return uid
    _discovery_log.append("  - '{}': authenticate devolvio False".format(db))
    return None


def _listar_bases_via_web():
    """Intenta /web/database/list (JSON-RPC). Devuelve [] si no está disponible."""
    payload = json.dumps({'jsonrpc': '2.0', 'method': 'call', 'params': {}, 'id': 1}).encode('utf-8')
    req = urllib.request.Request(
        '{}/web/database/list'.format(config.ODOO_URL),
        data=payload,
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
    except Exception:
        return []
    result = body.get('result')
    return result if isinstance(result, list) else []


def _discover_db_and_authenticate(common_proxy):
    global _discovery_log
    _discovery_log = []

    if config.ODOO_DB:
        uid = _try_authenticate(common_proxy, config.ODOO_DB)
        if uid:
            return config.ODOO_DB, uid
        raise RuntimeError(
            "ODOO_DB='{}' está configurado pero no se pudo autenticar.\n{}"
            .format(config.ODOO_DB, "\n".join(_discovery_log)))

    for db in _listar_bases_via_web():
        uid = _try_authenticate(common_proxy, db)
        if uid:
            return db, uid

    for db in DB_CANDIDATES:
        uid = _try_authenticate(common_proxy, db)
        if uid:
            return db, uid

    raise RuntimeError(
        "No se pudo autenticar contra Odoo con ningun nombre de base de datos.\n"
        "Intentos:\n" + "\n".join(_discovery_log) +
        "\n\nSugerencia: poner ODOO_DB=<nombre correcto> en el .env.")


def _ensure_connected():
    global _common_proxy, _object_proxy, _db, _uid
    if _uid is not None:
        return
    _common_proxy = xmlrpc.client.ServerProxy('{}/xmlrpc/2/common'.format(config.ODOO_URL))
    _db, _uid = _discover_db_and_authenticate(_common_proxy)
    _object_proxy = xmlrpc.client.ServerProxy('{}/xmlrpc/2/object'.format(config.ODOO_URL))


def _execute_kw(model, method, *args, **kwargs):
    if method not in _READ_ONLY_METHODS:
        raise PermissionError(
            "Metodo '{}' no permitido: este cliente es de solo lectura. "
            "Metodos permitidos: {}".format(method, sorted(_READ_ONLY_METHODS)))
    _ensure_connected()
    return _object_proxy.execute_kw(
        _db, _uid, config.requerido('ODOO_KEY', 'la API key de Odoo'),
        model, method, list(args), kwargs)


def search(model, domain, offset=0, limit=None, order=None):
    kwargs = {'offset': offset}
    if limit is not None:
        kwargs['limit'] = limit
    if order is not None:
        kwargs['order'] = order
    return _execute_kw(model, 'search', domain, **kwargs)


def search_read(model, domain, fields=None, offset=0, limit=None, order=None):
    kwargs = {'offset': offset}
    if fields is not None:
        kwargs['fields'] = fields
    if limit is not None:
        kwargs['limit'] = limit
    if order is not None:
        kwargs['order'] = order
    return _execute_kw(model, 'search_read', domain, **kwargs)


def read(model, ids, fields=None):
    kwargs = {}
    if fields is not None:
        kwargs['fields'] = fields
    return _execute_kw(model, 'read', ids, **kwargs)


def search_count(model, domain):
    return _execute_kw(model, 'search_count', domain)


def fields_get(model, attributes=('string', 'type', 'relation', 'help')):
    return _execute_kw(model, 'fields_get', **{'attributes': list(attributes)})


def name_search(model, name='', domain=None, operator='ilike', limit=100):
    # Odoo >=17 renombró el parámetro de dominio de 'args' a 'domain'.
    kwargs = {'name': name, 'domain': domain or [], 'operator': operator, 'limit': limit}
    return _execute_kw(model, 'name_search', **kwargs)


def read_group(model, domain, fields, groupby, offset=0, limit=None, orderby=None, lazy=True):
    kwargs = {'offset': offset, 'lazy': lazy}
    if limit is not None:
        kwargs['limit'] = limit
    if orderby is not None:
        kwargs['orderby'] = orderby
    return _execute_kw(model, 'read_group', domain, fields, groupby, **kwargs)


def info_conexion():
    _ensure_connected()
    return {'url': config.ODOO_URL, 'db': _db, 'uid': _uid, 'login': config.ODOO_LOGIN}
