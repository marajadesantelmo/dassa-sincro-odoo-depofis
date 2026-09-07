# -*- coding: utf-8 -*-
"""Constructor de comandos Visual FoxPro para el linked server [DEPO50_DASSA].

PORTADO DE `dassa-orden/server/lib/vfp-builder.js`, que es la implementación de
referencia del ecosistema y la única que escribe en DEPOFIS en producción.
No inventamos nada acá: se replica lo que ya funciona.

═══════════════════════════════════════════════════════════════════════════
POR QUÉ NO SE PUEDE HACER UN `INSERT INTO` NORMAL
═══════════════════════════════════════════════════════════════════════════

`DEPOFIS.DASSA.*` son vistas `SELECT * FROM OPENQUERY([DEPO50_DASSA], ...)`
sobre un linked server VFPOLEDB (archivos FoxPro). Intentar escribir así falla:

    INSERT INTO DEPOFIS.DASSA.Concepfc ...          -> error 7301
    INSERT INTO OPENQUERY([DEPO50_DASSA], ...) ...  -> error 7301

    "Cannot obtain the required interface (IID_IRowsetChange) from OLE DB
     provider VFPOLEDB"

El provider no expone la interfaz de rowset escribible, así que SQL Server no
tiene por dónde mandar el INSERT. **La vía que funciona es pass-through**: el
comando viaja como STRING y lo ejecuta FoxPro del otro lado.

    EXEC ('INSERT INTO Concepfc (...) VALUES (...)') AT [DEPO50_DASSA];

Mecanismo confirmado por Silvio (Syspro) a `dassa-orden` en el mail del
2026-06-11, y en producción desde entonces (1057 filas de cordicar escritas así).

SINTAXIS VFP — no es T-SQL
──────────────────────────
    fechas   {^2026-06-30}   ·  fecha vacía {}
    strings  "TEXTO"          (comillas DOBLES)
    igualdad ==               (en el WHERE, igualdad exacta)

Y NINGUNA comilla simple en el comando: la simple delimita el literal del
`EXEC (...)` de SQL Server, así que una sola rompe todo. `vfp_string()` las
elimina y `envolver_exec_at()` aborta si igual quedó alguna.

SIN TRANSACCIONES
─────────────────
VFPOLEDB no soporta la interfaz transaccional (error 7390). La conexión va en
`autocommit=True` y cada comando es definitivo. No hay rollback: la integridad
se consigue verificando después, no deshaciendo.
"""

import re

LINKED_SERVER = 'DEPO50_DASSA'

# Whitelist de caracteres permitidos dentro de un string VFP. Todo lo demás se
# reemplaza por espacio. Cubre nombres de empresa, descripciones de concepto y
# grupos. NO incluye comilla doble (delimitador VFP) ni simple (delimitador del
# EXEC de SQL Server).
_INSEGUROS = re.compile(r'[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñÜü .,;:()/#%&+@*_-]')


def vfp_string(valor, max_len=None):
    """Sanea un valor para usarlo entre comillas dobles VFP."""
    if valor is None:
        return '""'
    s = str(valor)
    s = re.sub(r'[\r\n\t]', ' ', s)
    s = s.replace('"', ' ').replace("'", ' ')
    s = _INSEGUROS.sub(' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    if max_len:
        s = s[:max_len]
    return '"{}"'.format(s)


def vfp_fecha(valor):
    """Fecha -> literal VFP {^YYYY-MM-DD}. Vacía -> {}.

    ⚠️ '1899-12-30' es el centinela de fecha VACÍA de FoxPro. Mandarla como
    `{^1899-12-30}` sería una fecha REAL de 1899 (`EMPTY()` daría .F.) y DEPOFIS
    la leería como "fecha cargada". La vacía de verdad es `{}`. Este gotcha lo
    pagó `dassa-orden` antes que nosotros.
    """
    if valor is None or valor == '':
        return '{}'
    s = str(valor)[:10]
    if s == '1899-12-30':
        return '{}'
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', s)
    if not m:
        raise ValueError('vfp_fecha: formato inválido "{}" (esperado YYYY-MM-DD)'.format(valor))
    return '{{^{}}}'.format(s)


def vfp_numero(valor):
    """Número validado. Los vacíos van como 0, que es lo que espera FoxPro."""
    if valor is None or valor == '':
        return '0'
    n = float(valor)
    if n != n or n in (float('inf'), float('-inf')):
        raise ValueError('vfp_numero: "{}" no es finito'.format(valor))
    return str(int(n)) if float(n).is_integer() else repr(n)


def envolver_exec_at(comando_vfp, linked_server=LINKED_SERVER):
    """Envuelve un comando VFP en el `EXEC (...) AT [linked server]`.

    Aborta si quedó una comilla simple: rompería el literal de SQL Server y
    sería, además, el vector de inyección obvio.
    """
    if "'" in comando_vfp:
        raise ValueError('vfp: el comando contiene comilla simple — abortado')
    return "EXEC ('{}') AT [{}];".format(comando_vfp, linked_server)


# ═══════════════════════════════════════════════════════════════════════════
# CONCEPFC — las 38 columnas, porque FoxPro no acepta nulls en NINGUNA
# ═══════════════════════════════════════════════════════════════════════════
#
# Un INSERT parcial se rechaza con:
#     "Field IMPORTE does not accept null values." (error 7412)
#
# Verificado sobre las 279 filas de la tabla: **ninguna columna tiene un solo
# null**. Así que el INSERT manda las 38 sí o sí, y las que la rutina no deriva
# de Odoo van con el default de abajo.
#
# Los defaults no son inventados: son el valor MÁS FRECUENTE de cada columna en
# los conceptos que ya existen. Entre paréntesis, sobre cuántas de 279 filas.

TIPOS_CONCEPFC = {
    'codigo': 'num', 'detalle': 'char', 'calcula': 'char', 'grupo': 'char',
    'us_add': 'char', 'fecha_add': 'date', 'hora_add': 'char',
    'importe': 'num', 'tipo': 'num', 'fact_estib': 'char', 'contador': 'char',
    'cantidad': 'num', 'cta_contab': 'num', 'gravado': 'char', 'dias': 'char',
    'comision': 'char', 'fecha_calm': 'num', 'fecha_calh': 'num', 'costo': 'num',
    'print_fech': 'num', 'inclu_est': 'num', 'impvalmin': 'num',
    'us_mod': 'char', 'fecha_mod': 'date', 'hora_mod': 'char',
    'us_del': 'char', 'fecha_del': 'date', 'hora_del': 'char',
    'perc_iibb': 'char', 'val_fijo': 'num', 'usafcmens': 'num', 'moneda': 'char',
    'perc_iva': 'char', 'referencia': 'char', 'esdescto': 'num',
    'print_dat': 'num', 'print_dias': 'num', 'consolida': 'num',
}

# ⚠️ DECISIÓN DE NEGOCIO PENDIENTE, no técnica: `gravado`, `moneda`, `importe`
# y `cta_contab` determinan cómo se factura el concepto. Para una fila de prueba
# da lo mismo; para un concepto REAL, esto lo tiene que firmar facturación antes
# de habilitar el alta automática. Un concepto con `gravado` equivocado saca mal
# el IVA de cada factura que lo use.
DEFAULTS_CONCEPFC = {
    'importe': 0,          # (236/279) el precio se carga después, en el convenio
    'tipo': 0,             # (274/279)
    'fact_estib': 'N',     # (279/279) unánime
    'contador': 'N',       # (212/279)
    'cantidad': 0,         # (279/279) unánime
    'cta_contab': 0,       # (276/279) cuenta contable: la asigna administración
    'gravado': 'S',        # (251/279) ⚠️ IVA — el default es "gravado"
    'dias': 'N',           # (267/279)
    'comision': 'S',       # (268/279)
    'fecha_calm': 1,       # (278/279)
    'fecha_calh': 1,       # (276/279)
    'costo': 0,            # (278/279)
    'print_fech': 0,       # (274/279)
    'inclu_est': 0,        # (278/279)
    'impvalmin': 0,        # (252/279)
    'perc_iibb': 'N',      # (279/279) unánime
    'val_fijo': 0,         # (279/279) unánime
    'usafcmens': 0,        # (277/279)
    'moneda': 'ARP',       # (278/279)
    'perc_iva': 'N',       # (279/279) unánime
    'referencia': '',      # (279/279) unánime
    'esdescto': 0,         # (277/279)
    'print_dat': 0,        # (278/279)
    'print_dias': 0,       # (278/279)
    'consolida': 0,        # (279/279) unánime
    # Auditoría de modificación y borrado: vacías en una fila recién creada.
    # Las fechas van como '' y `vfp_fecha` las traduce a `{}` (la fecha vacía de
    # FoxPro), NO a 1899-12-30 — que sería una fecha real de 1899.
    'us_mod': '', 'fecha_mod': '', 'hora_mod': '',
    'us_del': '', 'fecha_del': '', 'hora_del': '',
}


def campos_concepfc(payload):
    """Completa el payload de la rutina con los defaults, para las 38 columnas."""
    campos = dict(DEFAULTS_CONCEPFC)
    campos.update(payload)
    faltan = set(TIPOS_CONCEPFC) - set(campos)
    if faltan:
        raise ValueError('vfp: faltan columnas de Concepfc: {}'.format(sorted(faltan)))
    return campos

TIPOS_CLIENTES = {
    'clie_nro': 'num', 'apellido': 'char', 'direccion': 'char', 'localidad': 'char',
    'provincia': 'char', 'cpostal': 'char', 'telefono': 'char', 'tipo_cl': 'char',
    'tipo_doc': 'char', 'documento': 'char', 'iva': 'num', 'vendedor': 'num',
    'consolida': 'num', 'email': 'char', 'estado': 'num',
    'us_add': 'char', 'fecha_add': 'date', 'hora_add': 'char',
}


def _serializar(tipo, valor):
    if tipo == 'num':
        return vfp_numero(valor)
    if tipo == 'date':
        return vfp_fecha(valor)
    return vfp_string(valor)


def construir_insert(tabla, campos, tipos):
    """`EXEC ('INSERT INTO <tabla> (cols) VALUES (vals)') AT [DEPO50_DASSA];`

    Las columnas se validan contra `tipos`: una columna desconocida es un error,
    no algo que se manda a ver qué pasa. Es la misma defensa que `assertColumns`
    en el builder de dassa-orden.

    Un `vendedor` en None se omite de la lista de columnas en vez de mandarse
    como 0 — el 0 de DEPOFIS es un vendedor real, no "sin vendedor".
    """
    columnas = []
    valores = []
    for col, val in campos.items():
        if col not in tipos:
            raise ValueError('vfp: columna desconocida "{}" para {}'.format(col, tabla))
        if not re.match(r'^[a-z_][a-z0-9_]*$', col, re.I):
            raise ValueError('vfp: identificador inválido "{}"'.format(col))
        if val is None and tipos[col] == 'num':
            continue  # se omite: FoxPro deja el default de la columna
        columnas.append(col)
        valores.append(_serializar(tipos[col], val))

    return envolver_exec_at('INSERT INTO {} ({}) VALUES ({})'.format(
        tabla, ', '.join(columnas), ', '.join(valores)))


def construir_select_por_codigo(tabla, columna, valor):
    """SELECT de verificación, también pass-through.

    Se podría leer por la vista (que sí funciona), pero se lee por el mismo
    camino que se escribió: si el INSERT dijo OK y este SELECT no lo encuentra,
    el problema está en la escritura y no en un desfase de la vista.
    """
    return envolver_exec_at('SELECT * FROM {} WHERE {} = {}'.format(
        tabla, columna, vfp_numero(valor)))


def construir_delete_por_codigo(tabla, columna, valor, us_add):
    """DELETE acotado por `us_add`, como el de dassa-orden.

    El `ALLTRIM` no es adorno: `us_add` es char(10) y viene con blancos de cola,
    así que `==` sin ALLTRIM no matchea nunca. Y el guard por us_add es lo que
    garantiza que un borrado sólo pueda tocar filas que creó esta app, nunca las
    que cargó una persona desde DEPOFIS.
    """
    return envolver_exec_at('DELETE FROM {} WHERE {} = {} AND ALLTRIM(us_add) == {}'.format(
        tabla, columna, vfp_numero(valor), vfp_string(us_add)))
