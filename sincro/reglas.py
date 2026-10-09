# -*- coding: utf-8 -*-
"""Las reglas de negocio de la sincronización DEPOFIS → Odoo.

Módulo puro: no lee archivos, no toca la red, no conoce ni Odoo ni Postgres.
Es lo que permite testearlo entero sin credenciales (`python -m unittest
sincro.test_reglas`) y lo que hace que un cambio de regla sea revisable en un
solo lugar.

LA DIRECCIÓN
────────────
DEPOFIS es el maestro: un cliente o un concepto que existe en DEPOFIS tiene que
existir también en Odoo. La rutina LEE DEPOFIS (el espejo `depofis_mirror`) y
ESCRIBE en Odoo. A DEPOFIS no se le escribe nunca (decisión de Facu,
2026-10-09) — en este repo no hay código que pueda hacerlo.
"""

from collections import namedtuple
import re

# ═══════════════════════════════════════════════════════════════════════════
#  VENDEDOR — código DEPOFIS → Salesperson de Odoo
# ═══════════════════════════════════════════════════════════════════════════
#
# En Odoo el vendedor de un cliente es el campo estándar `res.partner.user_id`
# ("Salesperson"). La pestaña DEPOFIS tiene además `is_dassa` ("Cliente
# DASSA"), que distingue al cliente institucional del cliente propio del
# comercial. En DEPOFIS cada comercial tiene DOS códigos en Clientes.vendedor:
#
#     código propio         →  Salesperson = el comercial, is_dassa = False
#     código institucional  →  Salesperson = el comercial, is_dassa = True
#
# VERIFICADO CONTRA DATOS REALES (2026-09-07, y de nuevo en el sentido inverso
# el 2026-10-09): cruzando los ~1950 clientes que ya tienen `depofis_code` en
# Odoo contra DEPOFIS, el mapa reproduce el 99,6 % de los casos. Las
# diferencias son carteras reasignadas en Odoo que DEPOFIS todavía no refleja.
#
#     uid  Salesperson                 propio  institucional
#      6   Manuel de la Arena             3         13
#      7   Santiago Aguirre Oliva         4         14
#      8   Francisco Urtubey              6         16
#     11   Guillermo Jorge                7         17
#     12   Alexis Dalpra                  8         18
#     13   Enzo Nieto                     5         15
#
# La regla observada es institucional = propio + 10, pero el mapa se escribe
# entero igual: si mañana entra un comercial con un par que no siga esa suma,
# una fórmula lo asignaría mal en silencio y una tabla no.
#
# Los códigos 0, 1, 2, 9 y 19 existen en DEPOFIS y NO tienen usuario en Odoo.
# El 0 es lo que se carga cuando el cliente no tiene comercial (376 de los
# vinculados están así y en Odoo no tienen Salesperson). Un cliente con
# cualquiera de esos códigos se da de alta igual, sin Salesperson, y la fila
# queda marcada.

Vendedor = namedtuple('Vendedor', ['nombre', 'propio', 'institucional'])

VENDEDOR_MAP = {
    6:  Vendedor('Manuel de la Arena', 3, 13),
    7:  Vendedor('Santiago Aguirre Oliva', 4, 14),
    8:  Vendedor('Francisco Urtubey', 6, 16),
    11: Vendedor('Guillermo Jorge', 7, 17),
    12: Vendedor('Alexis Dalpra', 8, 18),
    13: Vendedor('Enzo Nieto', 5, 15),
}


def vendedor_map_serializable():
    """El mapa como dict JSON, para guardarlo con la corrida.

    Se publica junto a cada corrida a propósito: así la pantalla puede explicar
    meses después por qué a un cliente le tocó tal Salesperson, aunque para
    entonces el mapa haya cambiado.
    """
    return {
        str(uid): {'nombre': v.nombre, 'propio': v.propio, 'institucional': v.institucional}
        for uid, v in VENDEDOR_MAP.items()
    }


ResultadoVendedor = namedtuple('ResultadoVendedor', ['uid', 'nombre', 'es_dassa', 'motivo'])


def vendedor_desde_depofis(codigo):
    """Código de `Clientes.vendedor` → Salesperson e `is_dassa` de Odoo.

    Devuelve un ResultadoVendedor. `uid` es None cuando el código no tiene
    usuario en Odoo, y entonces `motivo` explica por qué. `es_dassa` es None en
    ese caso: no se sabe, y no se inventa.
    """
    if codigo is None:
        return ResultadoVendedor(None, None, None, 'El cliente no tiene vendedor en DEPOFIS')
    codigo = int(codigo)
    for uid, v in VENDEDOR_MAP.items():
        if codigo == v.propio:
            return ResultadoVendedor(uid, v.nombre, False,
                                     f'Código {codigo} → {v.nombre} (propio)')
        if codigo == v.institucional:
            return ResultadoVendedor(uid, v.nombre, True,
                                     f'Código {codigo} → {v.nombre} (institucional, Cliente DASSA)')
    if codigo == 0:
        return ResultadoVendedor(None, None, None,
                                 'Sin vendedor en DEPOFIS (código 0): queda sin Salesperson en Odoo')
    return ResultadoVendedor(None, None, None,
                             f'El vendedor {codigo} de DEPOFIS no tiene usuario en Odoo: '
                             'queda sin Salesperson')


# ═══════════════════════════════════════════════════════════════════════════
#  CONDICIÓN DE IVA — DASSA.Tipo_iva.codigo → l10n_ar.afip.responsibility.type
# ═══════════════════════════════════════════════════════════════════════════
#
# Sólo las equivalencias directas. Medido sobre los clientes ya vinculados
# (2026-10-09): el 90 % tiene el campo VACÍO en Odoo, así que dejarlo vacío
# cuando no hay equivalencia es lo que ya pasa hoy, no una regresión.

IVA_A_ODOO = {
    1: 1,    # RESPONSABLE INSCRIPTO → IVA Responsable Inscripto
    3: 5,    # CONSUMIDOR FINAL      → Consumidor Final
    4: 6,    # MONOTRIBUTO           → Responsable Monotributo
    6: 4,    # EXENTO                → IVA Sujeto Exento
}


def iva_a_odoo(codigo_iva):
    """Devuelve el id de responsabilidad AFIP, o None si no hay equivalencia."""
    if codigo_iva is None:
        return None
    return IVA_A_ODOO.get(int(codigo_iva))


# ═══════════════════════════════════════════════════════════════════════════
#  CUIT
# ═══════════════════════════════════════════════════════════════════════════

def solo_digitos(s):
    return re.sub(r'\D', '', str(s or ''))


def formatear_cuit(digitos):
    """'30663148229' → '30-66314822-9'. Si no tiene 11 dígitos, lo devuelve tal cual."""
    d = solo_digitos(digitos)
    if len(d) == 11:
        return '{}-{}-{}'.format(d[0:2], d[2:10], d[10:11])
    return d


def cuit_valido(digitos):
    """11 dígitos y dígito verificador correcto (módulo 11, el de AFIP).

    Se chequea acá y no se deja que Odoo lo rechace: el módulo l10n_ar valida
    el CUIT al crear el contacto y un rechazo ahí sería un ERROR en la corrida,
    cuando en realidad es un dato a corregir en DEPOFIS.
    """
    d = solo_digitos(digitos)
    if len(d) != 11:
        return False
    pesos = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    resto = sum(int(a) * b for a, b in zip(d[:10], pesos)) % 11
    dv = 0 if resto == 0 else (9 if resto == 1 else 11 - resto)
    return dv == int(d[10])


# ═══════════════════════════════════════════════════════════════════════════
#  CLIENTES — qué hacer con cada cliente activo de DEPOFIS
# ═══════════════════════════════════════════════════════════════════════════
#
# Se busca primero por `depofis_code` y después por CUIT, en ese orden:
#
#   1. Algún contacto de Odoo ya tiene este clie_nro como Código DEPOFIS
#        → sin cambios. No se toca: la rutina sólo actualiza a los que les
#          falta el código (decisión de Facu, 2026-10-09).
#   2. CUIT inválido → OMITIDO. El CUIT es el único chequeo: es la única forma
#      de saber que no se está duplicando un contacto.
#   3. Ningún contacto de Odoo con ese CUIT → ALTA.
#   4. Un único contacto con ese CUIT, activo y sin Código DEPOFIS → VINCULAR.
#   5. Cualquier otra cosa es ambigua y se OMITE con el motivo:
#        · el CUIT ya está vinculado a OTRO clie_nro (cliente duplicado en
#          DEPOFIS — vincular este segundo dejaría dos códigos para un CUIT);
#        · más de un contacto sin código con ese CUIT (duplicado en Odoo);
#        · el único que hay está archivado.
#
# Sólo cuentan los contactos "comerciales" (sin parent_id): los contactos hijos
# heredan el CUIT y el Código DEPOFIS de la empresa, y contarlos haría que toda
# empresa con dos personas de contacto pareciera duplicada.

DecisionCliente = namedtuple('DecisionCliente', ['accion', 'partner_id', 'motivo'])


def decidir_cliente(clie_nro, cuit_digitos, codigos_en_odoo, partners_por_cuit):
    """`codigos_en_odoo`: set de los Códigos DEPOFIS (str) ya cargados en Odoo.
    `partners_por_cuit`: {cuit_digitos: [{'id', 'depofis_code', 'active'}, …]},
    sólo contactos comerciales.

    `accion` es 'sin_cambios' | 'alta' | 'vincular' | 'omitido'.
    """
    if str(clie_nro) in codigos_en_odoo:
        return DecisionCliente('sin_cambios', None, None)

    if not cuit_valido(cuit_digitos):
        return DecisionCliente(
            'omitido', None,
            'CUIT inválido o vacío en DEPOFIS ({}): sin CUIT válido no se puede saber si el '
            'cliente ya existe en Odoo. Se corrige en DEPOFIS.'.format(cuit_digitos or 'vacío'))

    candidatos = partners_por_cuit.get(cuit_digitos, [])
    if not candidatos:
        return DecisionCliente('alta', None, None)

    con_otro_codigo = [p for p in candidatos if p.get('depofis_code')]
    if con_otro_codigo:
        codigos = ', '.join(sorted({str(p['depofis_code']).strip() for p in con_otro_codigo}))
        return DecisionCliente(
            'omitido', None,
            'El CUIT ya está vinculado en Odoo al Código DEPOFIS {}: este cliente parece '
            'duplicado en DEPOFIS. Vincularlo dejaría dos códigos para el mismo CUIT.'
            .format(codigos))

    activos = [p for p in candidatos if p.get('active', True)]
    if len(activos) > 1:
        return DecisionCliente(
            'omitido', None,
            'Hay {} contactos en Odoo con este CUIT y sin Código DEPOFIS (ids {}): están '
            'duplicados en Odoo. Fusionarlos antes de vincular.'
            .format(len(activos), ', '.join(str(p['id']) for p in activos)))
    if not activos:
        return DecisionCliente(
            'omitido', None,
            'El único contacto de Odoo con este CUIT está archivado (id {}): '
            'desarchivarlo y la próxima corrida lo vincula.'.format(candidatos[0]['id']))

    return DecisionCliente('vincular', activos[0]['id'], None)


# ═══════════════════════════════════════════════════════════════════════════
#  CLIENTES — completar datos sin pisar nada
# ═══════════════════════════════════════════════════════════════════════════

def es_vacio(valor):
    """Vacío para Odoo: False, None, '' o [] (un many2one vacío llega como False)."""
    if valor is None or valor is False:
        return True
    if isinstance(valor, str):
        return not valor.strip()
    if isinstance(valor, (list, tuple)):
        return len(valor) == 0
    return False


def completar_vacios(actual, deseado):
    """Lo que hay que escribir en un contacto que se VINCULA.

    Sólo los campos que en Odoo están vacíos: lo que alguien cargó a mano
    nunca se pisa. `depofis_code` siempre va (es lo que falta, por definición).

    `is_dassa` es un booleano y "vacío" no existe para él, así que sigue al
    Salesperson: se escribe sólo si se está escribiendo `user_id`.
    """
    vals = {}
    for campo, valor in deseado.items():
        if campo == 'is_dassa' or es_vacio(valor):
            continue
        if campo == 'depofis_code' or es_vacio(actual.get(campo)):
            vals[campo] = valor
    if 'user_id' in vals and 'is_dassa' in deseado:
        vals['is_dassa'] = bool(deseado['is_dassa'])
    return vals


# ═══════════════════════════════════════════════════════════════════════════
#  CONCEPTOS — qué filas de Concepfc NO son conceptos
# ═══════════════════════════════════════════════════════════════════════════
#
# Medido el 2026-10-09: de los 21 códigos de Concepfc que no existen en Odoo,
# sólo 3 son conceptos reales. El resto es estructura de la tabla:
#
#   · separadores de sección: "----IMPORTACION MARITIMA----" (40000, 20000…)
#   · filas sin detalle, y el código 0
#   · conceptos marcados "NO USAR"
#   · filas borradas (`us_del` cargado)
#   · el 999999 "TESTING FACUNDO", que quedó de la prueba de escritura del
#     2026-09-07 — sacarlo de DEPOFIS lo tiene que hacer quien lo administre
#
# Quedan FUERA DE ALCANCE —se publican con el motivo, no se descartan en
# silencio— para que la exclusión se pueda auditar.

CODIGOS_EXCLUIDOS = {
    999999: 'Fila de prueba (TESTING) que quedó cargada en DEPOFIS el 2026-09-07',
}


def excluir_concepto(codigo, detalle, us_del=None):
    """Devuelve el motivo si esta fila de Concepfc no es un concepto; si no, None."""
    d = (detalle or '').strip()
    if codigo is None or int(codigo) <= 0:
        return 'Código 0 o vacío: no es un concepto'
    if int(codigo) in CODIGOS_EXCLUIDOS:
        return CODIGOS_EXCLUIDOS[int(codigo)]
    if (us_del or '').strip():
        return 'Concepto borrado en DEPOFIS'
    if not d:
        return 'Sin detalle: no es un concepto'
    if d.startswith('-'):
        return 'Separador de sección de la lista de conceptos, no un concepto'
    if 'NO USAR' in d.upper():
        return 'Marcado "NO USAR" en DEPOFIS'
    return None
