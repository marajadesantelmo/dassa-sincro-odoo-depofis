# -*- coding: utf-8 -*-
"""Cliente XML-RPC contra la API estándar de Odoo de DASSA.

Adaptado del `conexion_odoo/odoo_client.py` de `dassa-conciliacion-comprobantes`.
La única diferencia real es de dónde salen las credenciales: allá venían de un
`tokens.py`, acá de `sincro/config.py` (env → .env → tokens.py).

Dos vías, y la diferencia importa:

  · LECTURA — todo pasa por `_execute_kw()`, que valida `method` contra un
    allowlist fijo (`_READ_ONLY_METHODS`) y levanta PermissionError —antes de
    tocar la red— si se pide cualquier otra cosa. No hay passthrough genérico.

  · ESCRITURA — sólo `crear()` y `escribir()`, y sólo sobre lo que esta rutina
    tiene que escribir: `create` de `res.partner` / `product.template` y
    `write` de `res.partner`, cada uno con su lista cerrada de CAMPOS. Nada de
    `unlink`, nada de otro modelo, nada de un campo que no esté en la lista.
    Además está APAGADA hasta que `sincronizar.py` llama a
    `habilitar_escritura()`, cosa que sólo hace en modo aplicación (las dos
    llaves de `config.resolver_modo`). En simulación la escritura no es que
    no se use: levanta PermissionError.

La garantía es el código, no un comentario: si mañana alguien quiere escribir
otro campo, tiene que agregarlo acá, a la vista de un review.
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
        uid = common_proxy.authenticate(db, config.ODOO_LOGIN, config.odoo_key(), {})
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
        _db, _uid, config.odoo_key(), model, method, list(args), kwargs)


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


# ─── Escritura ─────────────────────────────────────────────────────────────

# Lo único que esta rutina puede escribir en Odoo. Modelo → campos permitidos.
_CREATE_PERMITIDO = {
    'res.partner': frozenset({
        'name', 'vat', 'is_company', 'depofis_code', 'user_id', 'is_dassa',
        'l10n_latam_identification_type_id', 'l10n_ar_afip_responsibility_type_id',
        'street', 'city', 'zip', 'phone', 'email', 'country_id', 'category_id', 'lang',
    }),
    'product.template': frozenset({
        'name', 'default_code', 'type', 'sale_ok', 'purchase_ok', 'taxes_id',
        'categ_id', 'list_price', 'invoice_policy',
    }),
}

# `write` sólo sobre contactos, y sólo para VINCULAR: el código más los datos
# que estén vacíos (ver reglas.completar_vacios). Ni `name` ni `vat` están: a
# un contacto existente no se le cambia la identidad.
_WRITE_PERMITIDO = {
    'res.partner': frozenset({
        'depofis_code', 'user_id', 'is_dassa',
        'l10n_latam_identification_type_id', 'l10n_ar_afip_responsibility_type_id',
        'street', 'city', 'zip', 'phone', 'email', 'country_id', 'category_id',
    }),
}

_escritura_habilitada = False


def habilitar_escritura():
    """Sólo lo llama `sincronizar.py`, y sólo en modo aplicación."""
    global _escritura_habilitada
    _escritura_habilitada = True


def _validar_escritura(permitido, model, vals, operacion):
    if not _escritura_habilitada:
        raise PermissionError(
            "Escritura en Odoo deshabilitada ({} {}): la corrida no está en modo aplicación."
            .format(operacion, model))
    campos = permitido.get(model)
    if campos is None:
        raise PermissionError("{} sobre '{}' no está permitido.".format(operacion, model))
    fuera = sorted(set(vals) - campos)
    if fuera:
        raise PermissionError(
            "{} de '{}' con campos no permitidos: {}".format(operacion, model, fuera))


def crear(model, vals):
    """`create` de un registro. Devuelve el id nuevo."""
    _validar_escritura(_CREATE_PERMITIDO, model, vals, 'create')
    _ensure_connected()
    nuevo = _object_proxy.execute_kw(_db, _uid, config.odoo_key(), model, 'create', [vals], {})
    # Odoo 17+ acepta una lista y puede devolver una lista de ids.
    return nuevo[0] if isinstance(nuevo, list) else nuevo


def escribir(model, ids, vals):
    """`write` sobre registros existentes."""
    _validar_escritura(_WRITE_PERMITIDO, model, vals, 'write')
    _ensure_connected()
    return _object_proxy.execute_kw(_db, _uid, config.odoo_key(), model, 'write', [list(ids), vals], {})


def info_conexion():
    _ensure_connected()
    return {'url': config.ODOO_URL, 'db': _db, 'uid': _uid, 'login': config.ODOO_LOGIN}
