# -*- coding: utf-8 -*-
"""Las reglas de negocio de la sincronización Odoo → DEPOFIS.

Módulo puro: no lee archivos, no toca la red, no conoce ni Odoo ni pyodbc.
Es lo que permite testearlo entero sin credenciales (`python -m unittest
sincro.test_reglas`) y lo que hace que un cambio de regla sea revisable en un
solo lugar.
"""

from collections import namedtuple
import re

# ═══════════════════════════════════════════════════════════════════════════
#  ALCANCE — esta rutina sincroniza CLIENTES. Los proveedores no.
# ═══════════════════════════════════════════════════════════════════════════
#
# En Odoo clientes y proveedores conviven en `res.partner`. En DEPOFIS no: son
# dos tablas distintas, `DASSA.Clientes` (1369 filas) y `DASSA.Proveed` (1609).
# Esta rutina escribe únicamente en Clientes, y la decisión de negocio es que
# **DEPOFIS no necesita estar actualizado en proveedores**: ese maestro se
# administra en Odoo y ahí se queda.
#
# Sin este filtro la rutina evaluaba 118 contactos, de los cuales 61 eran
# proveedores puros — EDESUR, Banco Santander, Claro, Telecentro, Starlink,
# Exolgan, la Cámara de Depósitos Fiscales. Ninguno se daba de alta (les falta
# la categoría comercial), pero todos aparecían en la pantalla como "omitido ·
# requiere atención", o sea como trabajo pendiente que nadie iba a hacer nunca.
# Un informe donde el 51 % de las filas es ruido entrena a no leerlo.
#
# LAS SEÑALES SON FACTURAS, NO `customer_rank` / `supplier_rank`
# ──────────────────────────────────────────────────────────────
# Los rank de Odoo son la respuesta obvia y son la equivocada, por los dos
# lados:
#
#   · En POSITIVO no sirven: de los 2187 contactos ya vinculados a DEPOFIS
#     —clientes reales y confirmados— el 85 % tiene customer_rank = 0. El rank
#     se incrementa al facturar EN ODOO, y DASSA factura por DEPOFIS.
#
#   · En NEGATIVO tampoco: `customer_rank > 0` no significa que se le haya
#     vendido algo. Medido sobre los 118 candidatos, 16 tienen customer_rank > 0
#     y CERO facturas de venta — entre ellos EL VISOR SRL (rank 2, 0 ventas,
#     5 compras) y NUEVO ESTIBAJE (rank 2, 0 ventas, 9 compras). Ese rank
#     fantasma les alcanzaba para "rescatarse" del filtro y volver a la
#     pantalla como omisiones pendientes. Era el agujero de la primera versión.
#
# Lo que sí es verdad verificable son los comprobantes: `account.move` por
# partner, `out_invoice`+`out_refund` contra `in_invoice`+`in_refund`. Medido
# sobre los mismos 118: los rank nunca se quedan cortos (0 casos con facturas
# de venta y customer_rank = 0), sólo sobran. O sea que las facturas son el
# subconjunto verdadero y el rank es ese subconjunto más ruido.
#
#   es_proveedor        tiene facturas de COMPRA y ninguna de venta
#                       ó el CUIT está en DASSA.Proveed y no en DASSA.Clientes
#
#   evidencia_cliente   el CUIT ya está en DASSA.Clientes  ·  tiene facturas de
#                       VENTA  ·  tiene Salesperson  ·  is_dassa  ·  tiene una
#                       etiqueta que es categoría comercial DEPOFIS
#
# Se excluye sólo cuando hay evidencia de proveedor Y ninguna de cliente. La
# asimetría es a propósito: dejar entrar un proveedor cuesta una fila de ruido,
# dejar afuera un cliente cuesta un alta que nunca se hace.
#
# VERIFICADO (2026-09-08): aplicada a los 2187 contactos ya vinculados a
# DEPOFIS, la regla **no excluye ninguno** (0 falsos negativos). Sobre los 118
# candidatos excluye 61 y rescata 6 que un filtro crudo por proveedor habría
# perdido — Claro, Telecentro, Depósitos Moreiro, GCR, Maqueleva y Traforlog,
# los seis ya presentes en DASSA.Clientes. De los 56 candidatos que están en
# DASSA.Proveed, ninguno tiene una sola factura de venta: las dos señales de
# proveedor coinciden en todos los casos en que ambas se pronuncian.

ResultadoAlcance = namedtuple('ResultadoAlcance', ['en_alcance', 'motivo', 'senales'])


def clasificar_alcance(cuit_digitos, facturas_venta, facturas_compra,
                       tiene_salesperson, es_dassa, tiene_categoria_depofis,
                       cuits_proveedores, cuits_clientes):
    """¿Este contacto de Odoo es un cliente de DASSA, o un proveedor?

    `facturas_venta` / `facturas_compra` son la CANTIDAD de comprobantes de
    cada lado en Odoo (ver `sincronizar.py:contar_facturas`), no los rank.

    Devuelve un ResultadoAlcance. `en_alcance=False` significa "es un proveedor
    y no hay ni un indicio de que además sea cliente": la rutina lo registra
    como `fuera_alcance` y no lo cuenta como pendiente.

    `senales` lista los indicios encontrados, para que la pantalla pueda
    explicar la exclusión en vez de hacerla desaparecer sin más.
    """
    ventas = int(facturas_venta or 0)
    compras = int(facturas_compra or 0)
    cuit = cuit_digitos or ''

    proveedor = []
    if compras > 0 and ventas == 0:
        proveedor.append('en Odoo tiene {} factura(s) de compra y ninguna de venta'
                         .format(compras))
    if cuit and cuit in cuits_proveedores and cuit not in cuits_clientes:
        proveedor.append('el CUIT está en DASSA.Proveed y no en DASSA.Clientes')

    cliente = []
    # La evidencia más fuerte, y la que le gana a todo: ya está en el maestro de
    # clientes de DEPOFIS. Un contacto así no puede quedar fuera de alcance
    # aunque Odoo lo trate como proveedor — lo que corresponde para él es la
    # omisión "ya existe, falta vincular el depofis_code", que sí es trabajo
    # pendiente y real.
    if cuit and cuit in cuits_clientes:
        cliente.append('el CUIT ya está en DASSA.Clientes')
    if ventas > 0:
        cliente.append('tiene {} factura(s) de venta en Odoo'.format(ventas))
    if tiene_salesperson:
        cliente.append('tiene Salesperson asignado')
    if es_dassa:
        cliente.append('está marcado como Cliente DASSA')
    if tiene_categoria_depofis:
        cliente.append('tiene una categoría comercial de DEPOFIS')

    if proveedor and not cliente:
        return ResultadoAlcance(
            False,
            'Proveedor, no cliente: {}. Los proveedores viven en DASSA.Proveed y se '
            'administran en Odoo — quedan fuera del alcance de esta sincronización.'
            .format(' y '.join(proveedor)),
            proveedor)

    if proveedor:
        # Comprado y vendido a la vez: un transportista al que además se le
        # factura depósito. Entra, pero la señal queda registrada.
        return ResultadoAlcance(
            True,
            'Es también proveedor ({}), pero hay evidencia de cliente: {}.'
            .format(proveedor[0], ' · '.join(cliente)),
            proveedor + cliente)

    return ResultadoAlcance(True, None, cliente)


# ═══════════════════════════════════════════════════════════════════════════
#  VENDEDOR — el mapeo pedido
# ═══════════════════════════════════════════════════════════════════════════
#
# En Odoo el vendedor de un cliente NO está en la pestaña DEPOFIS: es el campo
# estándar `res.partner.user_id` ("Salesperson", many2one a res.users). Lo que
# sí está en esa pestaña es `is_dassa` ("Cliente DASSA"), que distingue al
# cliente institucional de la empresa del cliente propio del comercial.
#
# Cada comercial tiene DOS códigos en DASSA.Clientes.vendedor, y cuál va se
# decide con is_dassa:
#
#     is_dassa = False  →  código propio          (Enzo Nieto  → 5)
#     is_dassa = True   →  código institucional   (Enzo Nieto  → 15)
#
# VERIFICADO CONTRA DATOS REALES (2026-09-07). No es un criterio inferido: se
# cruzaron los 1951 clientes que ya tienen `depofis_code` en Odoo contra
# `DASSA.Clientes.vendedor`, y el mapa reproduce el 99,6 % de los casos. Las ~8
# discrepancias son carteras reasignadas en Odoo que DEPOFIS todavía no refleja
# (p. ej. 4 clientes que hoy son de Francisco siguen con el 3, de Manuel), no
# errores del mapa.
#
#     uid  Salesperson                 propio  institucional   verificados
#      6   Manuel de la Arena             3         13            76
#      7   Santiago Aguirre Oliva         4         14           137
#      8   Francisco Urtubey              6         16            71
#     11   Guillermo Jorge                7         17           502
#     12   Alexis Dalpra                  8         18           177
#     13   Enzo Nieto                     5         15           406
#
# La regla observada es institucional = propio + 10, pero el mapa se escribe
# entero igual: si mañana entra un comercial con un par que no siga esa suma,
# una fórmula lo asignaría mal en silencio y una tabla no.
#
# Los códigos 0, 1, 2, 9 y 19 existen en DEPOFIS y NO tienen usuario en Odoo
# (0 = sin vendedor, 523 clientes). No se mapean: ver `resolver_vendedor`.

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
    meses después por qué a un cliente le tocó el 15, aunque para entonces el
    mapa haya cambiado.
    """
    return {
        str(uid): {'nombre': v.nombre, 'propio': v.propio, 'institucional': v.institucional}
        for uid, v in VENDEDOR_MAP.items()
    }


ResultadoVendedor = namedtuple('ResultadoVendedor', ['codigo', 'uid', 'nombre', 'motivo'])


def resolver_vendedor(user_id, is_dassa):
    """`user_id`: la tupla (id, nombre) que devuelve Odoo para un many2one, o False.

    Devuelve un ResultadoVendedor. `codigo` es None cuando no se puede resolver,
    y entonces `motivo` explica por qué.

    Nunca se cae a un valor por defecto. El 0 de DEPOFIS no es "sin vendedor":
    es un código real con 523 clientes asignados, así que ponerlo cuando no
    sabemos sería inventar una cartera. Un NULL se ve, un 0 se confunde con un
    dato bueno.
    """
    if not user_id:
        return ResultadoVendedor(None, None, None,
                                 'El contacto no tiene Salesperson asignado en Odoo')

    uid, nombre = user_id[0], user_id[1]
    v = VENDEDOR_MAP.get(uid)
    if v is None:
        return ResultadoVendedor(
            None, uid, nombre,
            f'El Salesperson "{nombre}" (uid {uid}) no está en el mapeo de vendedores DEPOFIS')

    codigo = v.institucional if is_dassa else v.propio
    cual = 'institucional (Cliente DASSA)' if is_dassa else 'propio'
    return ResultadoVendedor(codigo, uid, nombre, f'{v.nombre} → código {cual} {codigo}')


# ═══════════════════════════════════════════════════════════════════════════
#  CONDICIÓN DE IVA
# ═══════════════════════════════════════════════════════════════════════════
#
# l10n_ar.afip.responsibility.type (id de Odoo) → DASSA.Tipo_iva.codigo.
# Las categorías sin equivalente directo (Proveedor/Cliente del Exterior, IVA
# Liberado, Sujeto no Categorizado) se mapean por juicio de negocio; están
# marcadas abajo y conviene revisarlas si aparece un caso real.

IVA_MAP = {
    1: 1,    # IVA Responsable Inscripto -> RESPONSABLE INSCRIPTO
    4: 6,    # IVA Sujeto Exento -> EXENTO
    5: 3,    # Consumidor Final -> CONSUMIDOR FINAL
    6: 4,    # Responsable Monotributo -> MONOTRIBUTO
    7: 0,    # Sujeto no Categorizado -> S/D                    (aproximado)
    8: 5,    # Proveedor del Exterior -> NO GRAVADO             (aproximado)
    9: 5,    # Cliente del Exterior -> NO GRAVADO               (aproximado)
    10: 6,   # IVA Liberado Ley 19.640 -> EXENTO                (aproximado)
    13: 4,   # Monotributista Social -> MONOTRIBUTO
    15: 5,   # IVA No Alcanzado -> NO GRAVADO
    16: 4,   # Monotributo Trabajador Independiente Promovido -> MONOTRIBUTO
}

# Si el campo viene vacío en Odoo se asume Responsable Inscripto. Es lo que
# pide la Descripción de Proyecto, y es el caso del 90 % de la cartera.
IVA_DEFAULT = 1

# Ids de IVA_MAP cuya equivalencia es un juicio de negocio y no un calco: si
# aparecen, la novedad se marca para revisar en vez de darse por buena.
IVA_APROXIMADOS = {7, 8, 9, 10}


def resolver_iva(afip_responsibility_type_id):
    """Devuelve (codigo, aproximado). `aproximado=True` marca la fila para revisar."""
    if not afip_responsibility_type_id:
        return IVA_DEFAULT, False
    tid = afip_responsibility_type_id[0]
    if tid not in IVA_MAP:
        return IVA_DEFAULT, True
    return IVA_MAP[tid], tid in IVA_APROXIMADOS


# ═══════════════════════════════════════════════════════════════════════════
#  CUIT
# ═══════════════════════════════════════════════════════════════════════════

def solo_digitos(s):
    return re.sub(r'\D', '', str(s or ''))


def formatear_cuit(vat):
    """CUIT de Odoo (con o sin guiones) → formato DEPOFIS 'XX-XXXXXXXX-X'.

    Devuelve (formateado, valido). Con `valido=False` el CUIT no tiene 11
    dígitos y la fila se marca para revisar: sin CUIT bien formado no se puede
    verificar si el cliente ya existe en DEPOFIS, que es la única defensa
    contra duplicarlo.
    """
    d = solo_digitos(vat)
    if len(d) == 11:
        return '{}-{}-{}'.format(d[0:2], d[2:10], d[10:11]), True
    return d[:13], False


# ═══════════════════════════════════════════════════════════════════════════
#  CONCEPTOS — unidad de cálculo
# ═══════════════════════════════════════════════════════════════════════════
#
# `depofis_calcula` no existe como campo en Odoo, pero sólo hace falta el dato
# para los conceptos de Almacenaje. Se deriva del nombre replicando la regla que
# YA corre en producción en `update_prefacturacion_odoo.py` (almacenaje_mask /
# contenedor_mask), donde la Cantidad se calcula exactamente así. No es una
# regla nueva: es la misma, escrita en el otro sentido.

def resolver_calcula(nombre_producto):
    """Devuelve (calcula, revisar).

    - nombre con "Almacenaje" y "Contenedor"  → 'Dias'
    - nombre con "Almacenaje" sin "Contenedor" → 'Dias * M3' (almacenaje de
      mercadería: Cantidad = Días × Volumen)
    - cualquier otro                           → 'Nada'

    `revisar=True` cuando el nombre sugiere un concepto por período (dice
    "Dias"/"Días") pero NO dice "Almacenaje": ese caso queda fuera de la regla
    de producción — p. ej. "Bajada de Mercadería a Piso ... de 0 a 30 días" — y
    se deja en 'Nada' marcado, en vez de adivinar una unidad de cálculo que
    después multiplicaría mal una factura.
    """
    n = (nombre_producto or '').upper()
    if 'ALMACENAJE' in n:
        return ('Dias', False) if 'CONTENEDOR' in n else ('Dias * M3', False)
    if 'DIAS' in n or 'DÍAS' in n:
        return 'Nada', True
    return 'Nada', False


# ═══════════════════════════════════════════════════════════════════════════
#  CATEGORÍA COMERCIAL
# ═══════════════════════════════════════════════════════════════════════════

def resolver_categoria(category_ids, categoria_por_id):
    """Primera etiqueta de Odoo que matchee una categoría DEPOFIS (tipo_cl).

    Odoo permite varias etiquetas por contacto y DEPOFIS acepta una sola, así
    que se toma la primera que matchee. Devuelve (nombre, ambiguo): `ambiguo`
    avisa que había más de una categoría válida y alguien eligió por el cliente.
    """
    encontradas = [categoria_por_id[cid] for cid in (category_ids or []) if cid in categoria_por_id]
    if not encontradas:
        return None, False
    return encontradas[0], len(encontradas) > 1
