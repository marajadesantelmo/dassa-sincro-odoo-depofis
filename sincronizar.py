#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sincroniza maestros de Odoo hacia DEPOFIS. Punto de entrada de la rutina.

    python sincronizar.py                       # SIMULACIÓN (default): no escribe nada
    python sincronizar.py --solo clientes       # sólo res.partner
    python sincronizar.py --solo conceptos      # sólo product.template
    python sincronizar.py --sin-publicar        # no manda nada a la app
    python sincronizar.py --aplicar             # ← escribe en DEPOFIS, si está permitido

🔒 `--aplicar` NO alcanza. Hacen falta las dos llaves:
     1. el flag `--aplicar`
     2. SINCRO_PERMITIR_APLICAR=si en el .env del box
   Con una sola, la corrida va en simulación y lo dice. Ver sincro/config.py.

QUÉ HACE
────────
Lee Odoo (solo lectura) y DEPOFIS, compara, y para cada registro decide una de
cuatro acciones: `alta` (falta en DEPOFIS y hay datos para crearlo), `omitido`
(no corresponde, con el motivo), `error` (se intentó y DEPOFIS lo rechazó) o
`fuera_alcance` (no es asunto de esta rutina — ver abajo).
El resultado se publica en la app `sincro-odoo-depofis`, que es donde se mira.

EL ALCANCE
──────────
Dos filtros, uno por maestro, y los dos por la misma razón: hay cosas en Odoo
que no son asunto de DEPOFIS.

· CLIENTES, NO PROVEEDORES. En Odoo clientes y proveedores conviven en
  `res.partner`; en DEPOFIS son dos tablas, `DASSA.Clientes` y `DASSA.Proveed`.
  Esta rutina sincroniza SÓLO clientes. Decisión de negocio: DEPOFIS no
  necesita estar al día en proveedores, ese maestro se administra en Odoo.

· CONCEPTOS, NO SUB-CONCEPTOS. Una Referencia Interna `padre-sufijo`
  (30055-30) es el tramo de días del concepto `padre`, una apertura que vive en
  Odoo. En DEPOFIS el concepto es uno solo y los días los resuelve `calcula`.

Los dos casos se registran como `fuera_alcance`, sin `requiere_atencion`, y la
pantalla los deja fuera de la vista por default: no se cuentan como pendientes
ni entran en ningún total del informe. Se publican igual —no se descartan en
silencio— para que la exclusión se pueda auditar: un filtro que no se ve no se
puede discutir. Las reglas y su verificación están en
`reglas.clasificar_alcance` y `reglas.concepto_padre`.

1) CLIENTES · res.partner → DASSA.Clientes
   Candidatos: is_company=True, vat cargado, depofis_code vacío en Odoo,
   y que pasen el filtro de alcance de arriba.
   Se omiten, con motivo:
     · CUIT ya presente en DASSA.Clientes.documento → el cliente ya existe en
       DEPOFIS y lo que falta es vincular `depofis_code` en Odoo. NO se
       duplica.
     · sin ninguna etiqueta que matchee una categoría DEPOFIS (tipo_cl): la
       categoría comercial es obligatoria para el alta.
   VENDEDOR — es el punto del proyecto. Sale de dos campos de Odoo:
     `user_id` (Salesperson) + `is_dassa` (el check "Cliente DASSA" de la
     pestaña DEPOFIS). Cada comercial tiene un código propio y uno
     institucional; is_dassa elige cuál. Ver sincro/reglas.py — el mapa está
     verificado contra los 1951 clientes ya vinculados.
     Si no hay Salesperson, `vendedor` queda NULL y la fila se marca "requiere
     atención": no se adivina, y el 0 de DEPOFIS no es "sin vendedor" sino un
     código real con 523 clientes.

2) CONCEPTOS · product.template → DASSA.Concepfc
   El código DEPOFIS ya está en Odoo como `default_code` (Referencia Interna),
   cargado en la migración original. Se evalúan los productos con Referencia
   Interna numérica que no existan todavía en Concepfc. Los sub-conceptos
   (`30055-30`) quedan fuera de alcance: ver arriba.
   La unidad de cálculo (`calcula`) se deriva del nombre replicando la regla
   que ya corre en producción en `update_prefacturacion_odoo.py`.

IDEMPOTENCIA
────────────
El cliente de Odoo es de SOLO LECTURA, así que la rutina no puede marcar allá
que un registro ya se sincronizó. Lo que la hace idempotente es que compara
contra DEPOFIS antes de cada alta: si el CUIT (o el código de concepto) ya
está, se omite. Correrla dos veces no duplica nada.
"""

import argparse
import io
import os
import sys
import traceback
from datetime import datetime

RAIZ = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, RAIZ)

# La salida va en UTF-8 sí o sí. En Linux ya lo es, pero la consola de Windows
# usa cp1252 y revienta con un UnicodeEncodeError en el primer print que lleve
# una flecha o un acento raro — y las rutinas Python de DASSA corren
# históricamente en Windows (dc01, Task Scheduler). Un crash de encoding en la
# línea 1 es la peor forma de perder una corrida.
for _flujo in ('stdout', 'stderr'):
    _s = getattr(sys, _flujo)
    if hasattr(_s, 'buffer') and (getattr(_s, 'encoding', '') or '').lower() not in ('utf-8', 'utf8'):
        setattr(sys, _flujo, io.TextIOWrapper(_s.buffer, encoding='utf-8', errors='replace'))

from sincro import VERSION, config, depofis, espejo, reglas   # noqa: E402
from sincro import odoo_client as odoo                        # noqa: E402
from sincro.publicar import Publicador                        # noqa: E402

# `us_add` es char(10) y SÍ admite un marcador de aplicación: es la convención
# del ecosistema. `dassa-orden` escribe 'ORDEN_APP' ahí y tiene 1057 filas así en
# cordicar, contra los us_add numéricos ('9', '28', '16'…) que son ids de usuario
# de las personas que cargan por DEPOFIS.
#
# El marcador es lo que hace auditable la automatización: `WHERE ALLTRIM(us_add)
# == "ODOO"` contesta "qué creó la rutina" de un saque, y es además el guard del
# DELETE — una fila cargada por una persona nunca puede ser borrada por esta app.
# Con un id de usuario real esa separación se pierde.
US_ADD = config.valor('DEPOFIS_US_ADD', 'ODOO')[:10]

PROVINCIA = 'N/D'        # así se carga hoy en DEPOFIS
CONSOLIDA = 0            # depofis_consolida_id no existe todavía en Odoo


def log(msg=''):
    print(msg, flush=True)


def titulo(t):
    log('\n' + '=' * 74)
    log('  ' + t)
    log('=' * 74)


# ═══════════════════════════════════════════════════════════════════════════
#  CLIENTES
# ═══════════════════════════════════════════════════════════════════════════

CAMPOS_PARTNER = [
    'id', 'name', 'vat', 'category_id', 'user_id', 'is_dassa',
    'l10n_ar_afip_responsibility_type_id', 'street', 'city', 'zip', 'phone', 'email',
]

# Los comprobantes que deciden si un contacto es cliente o proveedor. No se usan
# `customer_rank`/`supplier_rank`: sobran por los dos lados, y ese ruido fue lo
# que dejo pasar a EL VISOR, LOMAS METAL, NUEVO ESTIBAJE y TERMINAL 4 en la
# primera version del filtro. Ver reglas.clasificar_alcance.
FACTURA_VENTA = ['out_invoice', 'out_refund']
FACTURA_COMPRA = ['in_invoice', 'in_refund']

# Odoo arma un IN con toda la lista de ids y el server tiene limite de tamano de
# request. 500 por vuelta es lo que ya usa `dassa-conciliacion-comprobantes`.
LOTE_IDS = 500


def contar_facturas(partner_ids, move_types):
    """{partner_id: cantidad de comprobantes} para los tipos pedidos.

    Un `read_group` por lote en vez de un `search_count` por contacto: son 118
    candidatos y seria un round-trip XML-RPC por cabeza. Las anuladas no
    cuentan: una factura cancelada no prueba ninguna relacion comercial.
    """
    conteo = {}
    for i in range(0, len(partner_ids), LOTE_IDS):
        grupos = odoo.read_group(
            'account.move',
            [('partner_id', 'in', partner_ids[i:i + LOTE_IDS]),
             ('move_type', 'in', move_types),
             ('state', '!=', 'cancel')],
            fields=['partner_id'], groupby=['partner_id'])
        for g in grupos:
            if g.get('partner_id'):
                conteo[g['partner_id'][0]] = g['partner_id_count']
    return conteo


def procesar_clientes(acceso, modo, pub, ahora):
    titulo('CLIENTES · res.partner → DASSA.Clientes')

    categorias_depofis = acceso.categorias()
    log('Categorías DEPOFIS en uso (tipo_cl): {}'.format(len(categorias_depofis)))

    etiquetas = odoo.search_read('res.partner.category', [], fields=['id', 'name'])
    categoria_por_id = {
        c['id']: c['name'].strip()
        for c in etiquetas if c['name'].strip() in categorias_depofis
    }
    log('Etiquetas de Odoo que matchean una categoría DEPOFIS: {}'.format(len(categoria_por_id)))

    cuits = acceso.cuits_existentes()
    log('CUITs ya cargados en DASSA.Clientes: {}'.format(len(cuits)))

    # El maestro de proveedores. Se lee para EXCLUIR, no para escribir: esta
    # rutina no toca Proveed. Ver reglas.clasificar_alcance.
    cuits_proveedores = acceso.cuits_proveedores()
    log('CUITs cargados en DASSA.Proveed (sólo para excluir): {}'.format(len(cuits_proveedores)))

    siguiente = acceso.proximo_clie_nro()
    log('Próximo clie_nro a asignar: {}'.format(siguiente))

    candidatos = odoo.search_read(
        'res.partner',
        [('is_company', '=', True), ('vat', '!=', False), ('depofis_code', '=', False)],
        fields=CAMPOS_PARTNER,
        order='name',
    )
    log('\n{} empresa(s) en Odoo con CUIT y sin depofis_code.'.format(len(candidatos)))

    # El alcance se decide con comprobantes reales, asi que se traen antes del
    # bucle: dos read_group para los 118, en vez de 236 search_count.
    ids_candidatos = [p['id'] for p in candidatos]
    ventas = contar_facturas(ids_candidatos, FACTURA_VENTA)
    compras = contar_facturas(ids_candidatos, FACTURA_COMPRA)
    log('Comprobantes en Odoo: {} con facturas de venta, {} con facturas de compra.\n'
        .format(len(ventas), len(compras)))

    conteo = {'alta': 0, 'omitido': 0, 'error': 0, 'sin_vendedor': 0, 'fuera_alcance': 0}

    for p in candidatos:
        nombre = (p['name'] or '').strip()
        cuit_fmt, cuit_ok = reglas.formatear_cuit(p['vat'])
        cuit_digitos = reglas.solo_digitos(p['vat'])

        base = {
            'tipo': 'cliente', 'odoo_id': p['id'], 'odoo_nombre': nombre, 'clave': cuit_fmt,
        }

        # El vendedor se resuelve SIEMPRE, incluso para las filas que se van a
        # omitir: es lo que permite ver en la pantalla, de un vistazo, a qué
        # comercial pertenece cada cliente que quedó afuera.
        v = reglas.resolver_vendedor(p['user_id'], bool(p['is_dassa']))
        vend = {
            'vendedor_uid': v.uid,
            'vendedor_nombre': v.nombre,
            'es_dassa': bool(p['is_dassa']),
            'vendedor_depofis': v.codigo,
        }

        # ── Alcance: ¿es un cliente, o un proveedor? ───────────────────────
        # Va PRIMERO. Es la única decisión que no es "qué le falta a este
        # contacto para darse de alta" sino "este contacto no es asunto de esta
        # rutina". Registrar un proveedor como omisión pendiente sería pedir un
        # trabajo que nadie tiene que hacer.
        categoria, categoria_ambigua = reglas.resolver_categoria(p['category_id'], categoria_por_id)
        alcance = reglas.clasificar_alcance(
            cuit_digitos,
            ventas.get(p['id'], 0), compras.get(p['id'], 0),
            bool(p['user_id']), bool(p['is_dassa']), bool(categoria),
            cuits_proveedores, cuits,
        )
        if not alcance.en_alcance:
            pub.agregar(dict(base, **vend, accion='fuera_alcance', requiere_atencion=False,
                             payload={}, motivo=alcance.motivo))
            conteo['fuera_alcance'] += 1
            continue

        # ── Omisiones ──────────────────────────────────────────────────────
        if cuit_digitos in cuits:
            pub.agregar(dict(base, **vend, accion='omitido', requiere_atencion=True, payload={},
                             motivo='El CUIT ya existe en DEPOFIS: el cliente está cargado y lo que '
                                    'falta es vincular su Código DEPOFIS en Odoo'))
            conteo['omitido'] += 1
            continue

        if not cuit_ok:
            pub.agregar(dict(base, **vend, accion='omitido', requiere_atencion=True, payload={},
                             motivo='El CUIT no tiene 11 dígitos ({}): sin CUIT válido no se puede '
                                    'verificar si el cliente ya existe'.format(p['vat'])))
            conteo['omitido'] += 1
            continue

        if not categoria:
            pub.agregar(dict(base, **vend, accion='omitido', requiere_atencion=True, payload={},
                             motivo='Sin etiqueta que corresponda a una categoría comercial de '
                                    'DEPOFIS (tipo_cl): es obligatoria para el alta'))
            conteo['omitido'] += 1
            continue

        # ── Alta ───────────────────────────────────────────────────────────
        iva, iva_aprox = reglas.resolver_iva(p['l10n_ar_afip_responsibility_type_id'])

        payload = {
            'clie_nro': siguiente,
            'apellido': nombre[:80],
            'direccion': (p['street'] or '')[:50],
            'localidad': (p['city'] or '')[:30],
            'provincia': PROVINCIA,
            'cpostal': (p['zip'] or '')[:8],
            'telefono': (p['phone'] or '')[:30],
            'tipo_cl': categoria[:20],
            'tipo_doc': 'C.U.I.T.',
            'documento': cuit_fmt,
            'iva': iva,
            'vendedor': v.codigo,
            'consolida': CONSOLIDA,
            'email': (p['email'] or '')[:200],
            'estado': 0,
            'us_add': US_ADD,
            'fecha_add': ahora.strftime('%Y-%m-%d'),
            'hora_add': ahora.strftime('%H:%M:%S'),
        }

        avisos = [v.motivo]
        if alcance.motivo:
            # Entró, pero también es proveedor. Queda dicho en la fila: es el
            # caso en que conviene que una persona confirme antes del alta.
            avisos.append(alcance.motivo)
        atencion = v.codigo is None
        if v.codigo is None:
            conteo['sin_vendedor'] += 1
        if iva_aprox:
            avisos.append('Condición de IVA mapeada por aproximación: revisar')
            atencion = True
        if categoria_ambigua:
            avisos.append('El contacto tiene más de una categoría DEPOFIS: se tomó "{}"'.format(categoria))
            atencion = True

        if modo == 'aplicacion':
            try:
                nro = acceso.alta_cliente(payload)
                cuits.add(cuit_digitos)
                siguiente += 1
                conteo['alta'] += 1
                pub.agregar(dict(base, **vend, accion='alta', requiere_atencion=atencion,
                                 payload=payload, depofis_id=str(nro),
                                 motivo=' · '.join(avisos)))
            except Exception as e:
                # No hay rollback: el linked server FoxPro no soporta
                # transacciones (ver sincro/depofis.py). Se registra el error y
                # se sigue con el próximo — cada alta es independiente y las que
                # ya entraron, entraron.
                conteo['error'] += 1
                pub.agregar(dict(base, **vend, accion='error', requiere_atencion=True,
                                 payload=payload, motivo=str(e)[:500]))
        else:
            # En simulación el clie_nro igual avanza: así la pantalla muestra
            # qué número le tocaría a cada uno, en el orden en que se crearían.
            siguiente += 1
            conteo['alta'] += 1
            pub.agregar(dict(base, **vend, accion='alta', requiere_atencion=atencion,
                             payload=payload, motivo=' · '.join(avisos)))

    log('Fuera de alcance (proveedores): {}  ·  evaluados como cliente: {}'.format(
        conteo['fuera_alcance'], len(candidatos) - conteo['fuera_alcance']))
    log('Altas: {}  ·  omitidos: {}  ·  errores: {}'.format(
        conteo['alta'], conteo['omitido'], conteo['error']))
    if conteo['sin_vendedor']:
        log('⚠ {} alta(s) SIN vendedor resuelto — hay que cargar el Salesperson en Odoo.'
            .format(conteo['sin_vendedor']))
    return conteo


# ═══════════════════════════════════════════════════════════════════════════
#  CONCEPTOS
# ═══════════════════════════════════════════════════════════════════════════

def procesar_conceptos(acceso, modo, pub, ahora):
    titulo('CONCEPTOS · product.template → DASSA.Concepfc')

    codigos = acceso.codigos_concepto()
    log('Conceptos ya cargados en DASSA.Concepfc: {}'.format(len(codigos)))

    # `depofis_calcula` no existe hoy en Odoo. Se pregunta igual: si algún día
    # lo agregan, el dato del sistema le gana a la derivación por nombre, y
    # esto lo detecta solo sin tocar código.
    campos_producto = ['id', 'name', 'default_code', 'categ_id']
    tiene_calcula = 'depofis_calcula' in odoo.fields_get('product.template')
    if tiene_calcula:
        campos_producto.append('depofis_calcula')
        log('Odoo tiene el campo depofis_calcula: tiene prioridad sobre la derivación por nombre.')

    productos = odoo.search_read(
        'product.template', [('default_code', '!=', False)],
        fields=campos_producto, order='default_code',
    )
    log('\n{} producto(s) en Odoo con Referencia Interna cargada.\n'.format(len(productos)))

    conteo = {'alta': 0, 'omitido': 0, 'error': 0, 'fuera_alcance': 0}

    for prod in productos:
        codigo = str(prod['default_code']).strip()
        nombre = (prod['name'] or '').strip()
        base = {'tipo': 'concepto', 'odoo_id': prod['id'], 'odoo_nombre': nombre, 'clave': codigo}

        # ── Alcance: los sub-conceptos no son conceptos ────────────────────
        # `30055-30` es el tramo "0 a 30 días" del concepto 30055, una apertura
        # que vive en Odoo. En DEPOFIS el concepto es uno solo y los días los
        # resuelve `calcula`. Van PRIMERO y como `fuera_alcance`, no como
        # omisión: no le falta nada a este producto, simplemente no es asunto
        # de esta rutina. Ver reglas.concepto_padre.
        padre = reglas.concepto_padre(codigo)
        if padre:
            pub.agregar(dict(base, accion='fuera_alcance', requiere_atencion=False, payload={},
                             motivo='Sub-concepto del {}: el sufijo "-{}" es el tramo de días, '
                                    'una apertura que existe en Odoo y no en DEPOFIS, donde el '
                                    'concepto es uno solo y los días los resuelve el cálculo.'
                                    .format(padre, codigo.split('-')[1])))
            conteo['fuera_alcance'] += 1
            continue

        if not codigo.isdigit():
            pub.agregar(dict(base, accion='omitido', requiere_atencion=False, payload={},
                             motivo='La Referencia Interna no es numérica: no puede ser un código '
                                    'de Concepfc'))
            conteo['omitido'] += 1
            continue

        if codigo in codigos:
            pub.agregar(dict(base, accion='omitido', requiere_atencion=False, payload={},
                             motivo='El código ya existe en Concepfc'))
            conteo['omitido'] += 1
            continue

        propio = (prod.get('depofis_calcula') or '').strip() if tiene_calcula else ''
        if propio:
            calcula, revisar = propio, False
            motivo = 'calcula = {} (tomado de Odoo)'.format(calcula)
        else:
            calcula, revisar = reglas.resolver_calcula(nombre)
            motivo = 'calcula = {} (derivado del nombre)'.format(calcula)
        if revisar:
            motivo += " · REVISAR: el nombre sugiere un concepto por días pero no dice 'Almacenaje', " \
                      'que es lo que activa la regla de producción'

        payload = {
            'codigo': int(codigo),
            'detalle': nombre[:120],
            'calcula': calcula[:15],
            'grupo': (prod['categ_id'][1] if prod.get('categ_id') else '')[:30],
            'us_add': US_ADD,
            'fecha_add': ahora.strftime('%Y-%m-%d'),
            'hora_add': ahora.strftime('%H:%M:%S'),
        }

        if modo == 'aplicacion':
            try:
                acceso.alta_concepto(payload)
                codigos.add(codigo)
                conteo['alta'] += 1
                pub.agregar(dict(base, accion='alta', requiere_atencion=revisar,
                                 payload=payload, depofis_id=codigo, motivo=motivo))
            except Exception as e:
                # Sin rollback posible: ver el comentario en procesar_clientes.
                conteo['error'] += 1
                pub.agregar(dict(base, accion='error', requiere_atencion=True,
                                 payload=payload, motivo=str(e)[:500]))
        else:
            conteo['alta'] += 1
            pub.agregar(dict(base, accion='alta', requiere_atencion=revisar,
                             payload=payload, motivo=motivo))

    log('Fuera de alcance (sub-conceptos): {}  ·  evaluados como concepto: {}'.format(
        conteo['fuera_alcance'], len(productos) - conteo['fuera_alcance']))
    log('Altas: {}  ·  omitidos: {}  ·  errores: {}'.format(
        conteo['alta'], conteo['omitido'], conteo['error']))
    return conteo


# ═══════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    ap = argparse.ArgumentParser(description='Sincroniza maestros de Odoo hacia DEPOFIS.')
    ap.add_argument('--aplicar', action='store_true',
                    help='escribe en DEPOFIS (además necesita SINCRO_PERMITIR_APLICAR=si)')
    ap.add_argument('--solo', choices=['clientes', 'conceptos'],
                    help='corre sólo una de las dos mitades')
    ap.add_argument('--fuente', choices=list(config.FUENTES), default=None,
                    help='de dónde se LEE DEPOFIS: espejo (default al simular) u origen '
                         '(el SQL Server; obligatorio al aplicar)')
    ap.add_argument('--origen', choices=['cron', 'cli', 'manual'], default='cli',
                    help='quién dispara la corrida (no confundir con --fuente)')
    ap.add_argument('--disparada-por', default=None,
                    help='email de quien la dispara; vacío si la corre el cron')
    ap.add_argument('--sin-publicar', action='store_true',
                    help='no manda el resultado a la app (queda sólo el .json local)')
    args = ap.parse_args()

    modo, aviso = config.resolver_modo(args.aplicar)
    fuente, aviso_fuente = config.resolver_fuente(args.fuente, modo)
    avisos = [a for a in (aviso, aviso_fuente) if a]

    titulo('SINCRONIZACIÓN DE MAESTROS ODOO → DEPOFIS  ·  v{}'.format(VERSION))
    log('Modo:   {}'.format(
        'APLICACIÓN — se van a ESCRIBIR altas en DEPOFIS' if modo == 'aplicacion'
        else 'SIMULACIÓN — no se escribe nada en DEPOFIS'))
    log('Fuente: {}'.format(
        'ORIGEN — el SQL Server de DEPOFIS' if fuente == 'origen'
        else 'ESPEJO — depofis_mirror en Smart DASSA Central (solo lectura)'))
    for a in avisos:
        log('\n⚠ ' + a)
    if avisos:
        log('')

    ahora = datetime.now()
    sello = ahora.strftime('%Y-%m-%d_%H%M%S')
    salida = os.path.join(RAIZ, 'salidas', 'corrida_{}.json'.format(sello))

    pub = Publicador(salida_local=(None if args.sin_publicar else salida))
    if args.sin_publicar:
        pub.activo = False
        pub.salida_local = salida

    log('\nConectando a Odoo…')
    info = odoo.info_conexion()
    log('  {} · db={} · uid={}'.format(info['url'], info['db'], info['uid']))

    if fuente == 'espejo':
        log('Conectando al espejo (depofis_mirror)…')
        acceso = espejo.AccesoEspejo()
        sincronizado_en = acceso.sincronizado_en()
        descripcion_fuente = 'depofis_mirror @ smart-dassa-central'
        log('  conectado · espejo actualizado al {}'.format(sincronizado_en))
    else:
        log('Conectando al SQL de DEPOFIS ({})…'.format(config.DEPOFIS_SERVER))
        acceso = depofis.abrir(modo)
        sincronizado_en = None
        descripcion_fuente = config.DEPOFIS_SERVER
        log('  conectado · acceso: {}'.format(type(acceso).__name__))

    pub.abrir({
        'modo': modo,
        'origen': args.origen,
        'disparada_por': args.disparada_por,
        'odoo_db': info['db'],
        'odoo_uid': info['uid'],
        'fuente': fuente,
        'fuente_sincronizada_en': sincronizado_en,
        'depofis_server': descripcion_fuente,
        'vendedor_map': reglas.vendedor_map_serializable(),
        'version_rutina': VERSION,
    })

    totales = {}
    estado = 'ok'
    error = None
    try:
        if args.solo != 'conceptos':
            totales['clientes'] = procesar_clientes(acceso, modo, pub, ahora)
        if args.solo != 'clientes':
            totales['conceptos'] = procesar_conceptos(acceso, modo, pub, ahora)
        if any(t.get('error') for t in totales.values()):
            estado = 'con_errores'
    except Exception:
        estado = 'fallida'
        error = traceback.format_exc()
        log('\n✗ La corrida falló:\n' + error)
    finally:
        acceso.cerrar()

    totales['modo'] = modo
    totales['fuente'] = fuente
    totales['avisos'] = avisos
    pub.cerrar(estado, totales, error)

    titulo('FIN · estado: {}'.format(estado))
    log('Duración: {:.1f} s'.format((datetime.now() - ahora).total_seconds()))
    if modo == 'simulacion':
        log('\nNo se escribió NADA en DEPOFIS. Para ver el detalle, entrá a la app:')
        log('  https://apps.dassa.com.ar/sincro-odoo-depofis/')

    return 0 if estado in ('ok', 'con_errores') else 1


if __name__ == '__main__':
    sys.exit(main())
