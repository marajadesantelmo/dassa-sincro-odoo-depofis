#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sincroniza maestros de DEPOFIS hacia Odoo. Punto de entrada de la rutina.

    python sincronizar.py                       # SIMULACIÓN (default): no escribe nada
    python sincronizar.py --solo clientes       # sólo Clientes → res.partner
    python sincronizar.py --solo conceptos      # sólo Concepfc → product.template
    python sincronizar.py --sin-publicar        # no manda nada a la app
    python sincronizar.py --aplicar             # ← escribe en ODOO, si está permitido
    python sincronizar.py --aplicar --limite 1  # escribe UN registro y para (la primera vez)

🔒 `--aplicar` NO alcanza. Hacen falta las dos llaves:
     1. el flag `--aplicar`
     2. SINCRO_PERMITIR_APLICAR=si en el .env del box
   Con una sola, la corrida va en simulación y lo dice. Ver sincro/config.py.

LA DIRECCIÓN
────────────
DEPOFIS es el maestro. Un cliente o concepto dado de alta en DEPOFIS tiene que
existir en Odoo. La rutina LEE DEPOFIS —del espejo `depofis_mirror`, nunca del
SQL Server— y ESCRIBE en Odoo. A DEPOFIS no se le escribe nada: en este repo no
hay código que pueda hacerlo (decisión de Facu, 2026-10-09).

QUÉ HACE
────────
1) CLIENTES · DASSA.Clientes (activos, estado = 0) → res.partner
   Ver reglas.decidir_cliente. Por cada cliente:
     · ya hay un contacto con su clie_nro como Código DEPOFIS → nada. A los
       clientes ya vinculados no se les actualiza ningún dato.
     · no existe en Odoo (ni por código ni por CUIT) → ALTA del contacto, con
       el Salesperson y el check "Cliente DASSA" traducidos del vendedor.
       Sin vendedor o sin categoría se da de alta igual y la fila se marca.
     · existe un contacto con su CUIT y sin Código DEPOFIS → VINCULAR: se le
       escribe el código y se completan SÓLO los datos que tenga vacíos.
     · CUIT inválido, CUIT ya vinculado a otro código, duplicados en Odoo →
       OMITIDO con el motivo. El único chequeo que frena es el CUIT.

2) CONCEPTOS · DASSA.Concepfc → product.template
   El código de DEPOFIS es la Referencia Interna (`default_code`) de Odoo. Los
   códigos que no estén se dan de ALTA como servicio de venta, igual que los
   que ya están. Separadores, filas en blanco, "NO USAR" y la fila de prueba
   999999 quedan FUERA DE ALCANCE. Ver reglas.excluir_concepto.

Lo que no cambia nada (clientes ya vinculados, conceptos ya presentes) no se
publica fila por fila: se cuenta en los totales de la corrida. La app muestra
lo que se sube o se modifica en Odoo.

IDEMPOTENCIA
────────────
Un alta deja el Código DEPOFIS cargado en Odoo, así que en la corrida
siguiente ese cliente ya cae en "sin cambios". Antes de cada escritura se
vuelve a preguntar a Odoo (por si alguien lo cargó a mano mientras la rutina
corría) y después se relee el registro para verificar que quedó.
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
# una flecha o un acento raro. Un crash de encoding en la línea 1 es la peor
# forma de perder una corrida.
for _flujo in ('stdout', 'stderr'):
    _s = getattr(sys, _flujo)
    if hasattr(_s, 'buffer') and (getattr(_s, 'encoding', '') or '').lower() not in ('utf-8', 'utf8'):
        setattr(sys, _flujo, io.TextIOWrapper(_s.buffer, encoding='utf-8', errors='replace'))

from sincro import VERSION, config, espejo, reglas            # noqa: E402
from sincro import odoo_client as odoo                        # noqa: E402
from sincro.publicar import Publicador                        # noqa: E402

# Los dos "IVA 21%" de venta, uno por compañía (DASSA y Dassa Blue). Son los que
# tienen los ~250 conceptos DEPOFIS que ya están en Odoo (medido 2026-10-09).
# Se verifican contra Odoo al arrancar: si alguien los cambia, la corrida de
# conceptos se cae con un mensaje claro en vez de crear productos mal gravados.
IMPUESTOS_IVA_21 = [64, 219]

# Las cosas que se piden a Odoo de cada contacto que se va a vincular: los
# campos que `reglas.completar_vacios` podría completar.
CAMPOS_COMPLETABLES = [
    'user_id', 'l10n_latam_identification_type_id', 'l10n_ar_afip_responsibility_type_id',
    'street', 'city', 'zip', 'phone', 'email', 'country_id', 'category_id',
]


# Para el motivo de las filas: la pantalla la leen personas, no desarrolladores.
NOMBRE_CAMPO = {
    'user_id': 'Salesperson', 'l10n_latam_identification_type_id': 'tipo de documento',
    'l10n_ar_afip_responsibility_type_id': 'condición de IVA', 'street': 'dirección',
    'city': 'ciudad', 'zip': 'código postal', 'phone': 'teléfono', 'email': 'email',
    'country_id': 'país', 'category_id': 'etiqueta',
}


def log(msg=''):
    print(msg, flush=True)


def titulo(t):
    log('\n' + '=' * 74)
    log('  ' + t)
    log('=' * 74)


class Escritor:
    """Lleva la cuenta de las escrituras y aplica el tope de `--limite`.

    En simulación no escribe nunca: `puede()` da False y la fila se publica
    como lo que se HARÍA. En aplicación, cada escritura cuenta contra el tope;
    las que no entran se publican igual, marcadas como no ejecutadas.
    """

    def __init__(self, modo, limite):
        self.modo = modo
        self.limite = limite
        self.hechas = 0

    def puede(self):
        if self.modo != 'aplicacion':
            return False
        return self.limite is None or self.hechas < self.limite

    def motivo_no_ejecutada(self):
        if self.modo != 'aplicacion':
            return None
        return 'No se ejecutó: se alcanzó el tope de --limite {}'.format(self.limite)


def cargar_odoo_partners():
    """Todos los contactos con lo necesario para decidir. Uno solo search_read:
    son ~10.700 filas con 5 campos, y hacerlo por cliente serían 1.500 viajes."""
    filas = odoo.search_read(
        'res.partner', ['|', ('active', '=', True), ('active', '=', False)],
        fields=['id', 'vat', 'depofis_code', 'parent_id', 'active'])
    codigos = {str(p['depofis_code']).strip() for p in filas if p['depofis_code']}
    por_cuit = {}
    for p in filas:
        if p['parent_id'] or not p['vat']:
            continue
        por_cuit.setdefault(reglas.solo_digitos(p['vat']), []).append(p)
    return codigos, por_cuit


def id_unico(model, domain, que):
    filas = odoo.search_read(model, domain, fields=['id'])
    if len(filas) != 1:
        raise RuntimeError('Se esperaba exactamente un {} en Odoo y hay {}.'.format(que, len(filas)))
    return filas[0]['id']


# ═══════════════════════════════════════════════════════════════════════════
#  CLIENTES
# ═══════════════════════════════════════════════════════════════════════════

def procesar_clientes(acceso, escritor, pub):
    titulo('CLIENTES · DASSA.Clientes → res.partner')

    clientes, inactivos = acceso.clientes()
    log('Clientes activos en DEPOFIS: {}  (inactivos, no se miran: {})'.format(len(clientes), inactivos))

    codigos, por_cuit = cargar_odoo_partners()
    log('Contactos en Odoo con Código DEPOFIS: {}  ·  CUITs distintos en Odoo: {}'
        .format(len(codigos), len(por_cuit)))

    tipo_cuit = id_unico('l10n_latam.identification.type',
                         [('name', '=', 'CUIT'), ('country_id.code', '=', 'AR')], 'tipo de documento CUIT')
    argentina = id_unico('res.country', [('code', '=', 'AR')], 'país AR')
    etiquetas = {t['name'].strip().upper(): t['id']
                 for t in odoo.search_read('res.partner.category', [], fields=['id', 'name'])}

    conteo = {'alta': 0, 'vincular': 0, 'omitido': 0, 'error': 0,
              'sin_cambios': 0, 'inactivos': inactivos, 'sin_vendedor': 0, 'ejecutadas': 0}

    # Primero se decide todo; después se leen de una vez los contactos a
    # vincular, para saber qué tienen vacío.
    decisiones = [(c, reglas.decidir_cliente(c.clie_nro, c.cuit, codigos, por_cuit)) for c in clientes]
    ids_vincular = [d.partner_id for _, d in decisiones if d.accion == 'vincular']
    actuales = {p['id']: p for p in (odoo.read('res.partner', ids_vincular, fields=CAMPOS_COMPLETABLES + ['name'])
                                     if ids_vincular else [])}

    for c, d in decisiones:
        if d.accion == 'sin_cambios':
            conteo['sin_cambios'] += 1
            continue

        v = reglas.vendedor_desde_depofis(c.vendedor)
        afip = reglas.iva_a_odoo(c.iva)
        etiqueta = etiquetas.get(c.tipo_cl.upper()) if c.tipo_cl else None
        base = {
            'tipo': 'cliente', 'odoo_id': d.partner_id, 'odoo_nombre': c.nombre,
            'clave': reglas.formatear_cuit(c.cuit), 'depofis_id': str(c.clie_nro),
            'vendedor_depofis': c.vendedor, 'vendedor_uid': v.uid,
            'vendedor_nombre': v.nombre, 'es_dassa': v.es_dassa,
        }
        info = {'tipo_cl': c.tipo_cl, 'iva_depofis': c.iva, 'fecha_alta': c.fecha_alta,
                'etiqueta': c.tipo_cl if etiqueta else None}

        if d.accion == 'omitido':
            conteo['omitido'] += 1
            pub.agregar(dict(base, accion='omitido', requiere_atencion=True,
                             payload={'depofis': info}, motivo=d.motivo))
            continue

        # Lo que este cliente de DEPOFIS dice que tiene que haber en Odoo.
        deseado = {
            'depofis_code': str(c.clie_nro),
            'l10n_latam_identification_type_id': tipo_cuit,
            'l10n_ar_afip_responsibility_type_id': afip or False,
            'street': c.direccion, 'city': c.localidad, 'zip': c.cpostal,
            'phone': c.telefono, 'email': c.email,
            'country_id': argentina if c.pais.upper() in ('', 'ARGENTINA') else False,
            'user_id': v.uid or False,
            'is_dassa': bool(v.es_dassa),
            'category_id': [(6, 0, [etiqueta])] if etiqueta else False,
        }

        if d.accion == 'alta':
            vals = {k: x for k, x in deseado.items() if not reglas.es_vacio(x) or k == 'is_dassa'}
            vals.update({'name': c.nombre, 'vat': c.cuit, 'is_company': True, 'lang': 'es_AR'})
            avisos = [v.motivo]
            if v.uid is None:
                conteo['sin_vendedor'] += 1
            if not etiqueta:
                avisos.append('Sin etiqueta: la categoría "{}" no existe como etiqueta en Odoo'
                              .format(c.tipo_cl) if c.tipo_cl else 'Sin categoría en DEPOFIS')
            fila = dict(base, accion='alta', requiere_atencion=v.uid is None,
                        payload={'odoo': vals, 'depofis': info})
            ejecutar_alta_cliente(escritor, fila, vals, avisos, conteo, pub)
        else:  # vincular
            actual = actuales.get(d.partner_id, {})
            vals = reglas.completar_vacios(actual, deseado)
            completados = [NOMBRE_CAMPO.get(k, k) for k in CAMPOS_COMPLETABLES if k in vals]
            motivo = 'Existe en Odoo como "{}" (id {}) con el mismo CUIT y sin Código DEPOFIS. '.format(
                actual.get('name', '?'), d.partner_id)
            motivo += ('Se completan los datos vacíos: {}.'.format(', '.join(completados))
                       if completados else 'Sólo se le carga el código: el resto de los datos ya estaba.')
            fila = dict(base, accion='vincular', requiere_atencion=False,
                        payload={'odoo': vals, 'depofis': info})
            ejecutar_vincular(escritor, fila, d.partner_id, vals, motivo, conteo, pub)

    log('Sin cambios (ya vinculados): {}'.format(conteo['sin_cambios']))
    log('Altas: {}  ·  vincular: {}  ·  omitidos: {}  ·  errores: {}'.format(
        conteo['alta'], conteo['vincular'], conteo['omitido'], conteo['error']))
    if conteo['sin_vendedor']:
        log('⚠ {} alta(s) sin Salesperson: su vendedor de DEPOFIS no tiene usuario en Odoo.'
            .format(conteo['sin_vendedor']))
    return conteo


def ejecutar_alta_cliente(escritor, fila, vals, avisos, conteo, pub):
    codigo = vals['depofis_code']
    conteo['alta'] += 1
    if not escritor.puede():
        no = escritor.motivo_no_ejecutada()
        pub.agregar(dict(fila, ejecutada=False, motivo=' · '.join(avisos + ([no] if no else []))))
        return
    try:
        # Por si alguien lo cargó a mano mientras la rutina corría.
        ya = odoo.search_count('res.partner', [
            ('active', 'in', [True, False]),
            '|', ('depofis_code', '=', codigo), ('vat', '=', vals['vat'])])
        if ya:
            conteo['alta'] -= 1
            conteo['omitido'] += 1
            pub.agregar(dict(fila, accion='omitido', requiere_atencion=True, ejecutada=False,
                             motivo='Apareció en Odoo mientras corría la rutina: no se crea.'))
            return
        escritor.hechas += 1
        nuevo = odoo.crear('res.partner', vals)
        leido = odoo.read('res.partner', [nuevo], fields=['depofis_code'])
        if not leido or str(leido[0]['depofis_code']).strip() != codigo:
            raise RuntimeError('Se creó el contacto {} pero al releerlo el Código DEPOFIS no es {}'
                               .format(nuevo, codigo))
        conteo['ejecutadas'] += 1
        pub.agregar(dict(fila, odoo_id=nuevo, ejecutada=True,
                         motivo=' · '.join(['Creado en Odoo (id {})'.format(nuevo)] + avisos)))
    except Exception as e:
        conteo['alta'] -= 1
        conteo['error'] += 1
        pub.agregar(dict(fila, accion='error', requiere_atencion=True, ejecutada=False,
                         motivo=str(e)[:500]))


def ejecutar_vincular(escritor, fila, partner_id, vals, motivo, conteo, pub):
    codigo = vals['depofis_code']
    conteo['vincular'] += 1
    if not escritor.puede():
        no = escritor.motivo_no_ejecutada()
        pub.agregar(dict(fila, ejecutada=False, motivo=motivo + (' · ' + no if no else '')))
        return
    try:
        antes = odoo.read('res.partner', [partner_id], fields=['depofis_code'])
        if not antes or antes[0]['depofis_code']:
            conteo['vincular'] -= 1
            conteo['omitido'] += 1
            pub.agregar(dict(fila, accion='omitido', requiere_atencion=True, ejecutada=False,
                             motivo='El contacto ya tiene Código DEPOFIS ({}): alguien lo cargó '
                                    'mientras corría la rutina. No se pisa.'
                                    .format(antes[0]['depofis_code'] if antes else 'no existe')))
            return
        escritor.hechas += 1
        odoo.escribir('res.partner', [partner_id], vals)
        leido = odoo.read('res.partner', [partner_id], fields=['depofis_code'])
        if str(leido[0]['depofis_code']).strip() != codigo:
            raise RuntimeError('Se escribió el contacto {} pero al releerlo el Código DEPOFIS no es {}'
                               .format(partner_id, codigo))
        conteo['ejecutadas'] += 1
        pub.agregar(dict(fila, ejecutada=True, motivo='Vinculado. ' + motivo))
    except Exception as e:
        conteo['vincular'] -= 1
        conteo['error'] += 1
        pub.agregar(dict(fila, accion='error', requiere_atencion=True, ejecutada=False,
                         motivo=str(e)[:500]))


# ═══════════════════════════════════════════════════════════════════════════
#  CONCEPTOS
# ═══════════════════════════════════════════════════════════════════════════

def verificar_impuestos():
    filas = odoo.read('account.tax', IMPUESTOS_IVA_21, fields=['amount', 'type_tax_use'])
    ok = len(filas) == len(IMPUESTOS_IVA_21) and all(
        f['amount'] == 21.0 and f['type_tax_use'] == 'sale' for f in filas)
    if not ok:
        raise RuntimeError('Los impuestos {} ya no son "IVA 21% de venta" en Odoo. Revisar '
                           'IMPUESTOS_IVA_21 en sincronizar.py antes de dar de alta conceptos.'
                           .format(IMPUESTOS_IVA_21))


def procesar_conceptos(acceso, escritor, pub):
    titulo('CONCEPTOS · DASSA.Concepfc → product.template')

    conceptos = acceso.conceptos()
    log('Conceptos en DEPOFIS: {}'.format(len(conceptos)))

    productos = odoo.search_read(
        'product.template',
        ['&', ('default_code', '!=', False), '|', ('active', '=', True), ('active', '=', False)],
        fields=['default_code'])
    en_odoo = {str(p['default_code']).strip() for p in productos}
    log('Productos en Odoo con Referencia Interna: {}'.format(len(en_odoo)))

    categorias = {c['name'].strip().upper(): c['id']
                  for c in odoo.search_read('product.category', [], fields=['id', 'name'])}
    verificar_impuestos()

    conteo = {'alta': 0, 'omitido': 0, 'error': 0, 'sin_cambios': 0,
              'fuera_alcance': 0, 'ejecutadas': 0}

    for k in conceptos:
        codigo = str(k.codigo) if k.codigo is not None else ''
        if codigo and codigo in en_odoo:
            conteo['sin_cambios'] += 1
            continue

        base = {'tipo': 'concepto', 'odoo_id': None, 'odoo_nombre': k.detalle or '(sin detalle)',
                'clave': codigo, 'depofis_id': codigo}
        info = {'grupo': k.grupo, 'gravado': k.gravado, 'importe': k.importe, 'calcula': k.calcula}

        excluido = reglas.excluir_concepto(k.codigo, k.detalle, k.us_del)
        if excluido:
            conteo['fuera_alcance'] += 1
            pub.agregar(dict(base, accion='fuera_alcance', requiere_atencion=False,
                             payload={'depofis': info}, motivo=excluido))
            continue

        if k.gravado != 'S':
            conteo['omitido'] += 1
            pub.agregar(dict(base, accion='omitido', requiere_atencion=True, payload={'depofis': info},
                             motivo='No está gravado en DEPOFIS (gravado = "{}"): todos los conceptos '
                                    'que ya están en Odoo llevan IVA 21%, y éste necesita que alguien '
                                    'defina el impuesto. Darlo de alta a mano.'.format(k.gravado)))
            continue

        categ = categorias.get(k.grupo.upper()) if k.grupo else None
        vals = {
            'name': k.detalle, 'default_code': codigo, 'type': 'service',
            'sale_ok': True, 'purchase_ok': False, 'invoice_policy': 'order',
            'taxes_id': [(6, 0, IMPUESTOS_IVA_21)], 'list_price': k.importe,
        }
        if categ:
            vals['categ_id'] = categ
        avisos = ['Servicio de venta, IVA 21%' + (', categoría {}'.format(k.grupo) if categ else
                                                   ', sin categoría (el grupo "{}" no existe en Odoo)'
                                                   .format(k.grupo) if k.grupo else ', sin grupo en DEPOFIS')]
        fila = dict(base, accion='alta', requiere_atencion=False, payload={'odoo': vals, 'depofis': info})
        conteo['alta'] += 1

        if not escritor.puede():
            no = escritor.motivo_no_ejecutada()
            pub.agregar(dict(fila, ejecutada=False, motivo=' · '.join(avisos + ([no] if no else []))))
            continue
        try:
            if odoo.search_count('product.template', [('default_code', '=', codigo),
                                                      ('active', 'in', [True, False])]):
                conteo['alta'] -= 1
                conteo['omitido'] += 1
                pub.agregar(dict(fila, accion='omitido', requiere_atencion=True, ejecutada=False,
                                 motivo='Apareció en Odoo mientras corría la rutina: no se crea.'))
                continue
            escritor.hechas += 1
            nuevo = odoo.crear('product.template', vals)
            leido = odoo.read('product.template', [nuevo], fields=['default_code'])
            if not leido or str(leido[0]['default_code']).strip() != codigo:
                raise RuntimeError('Se creó el producto {} pero al releerlo la Referencia Interna no es {}'
                                   .format(nuevo, codigo))
            conteo['ejecutadas'] += 1
            pub.agregar(dict(fila, odoo_id=nuevo, ejecutada=True,
                             motivo=' · '.join(['Creado en Odoo (id {})'.format(nuevo)] + avisos)))
        except Exception as e:
            conteo['alta'] -= 1
            conteo['error'] += 1
            pub.agregar(dict(fila, accion='error', requiere_atencion=True, ejecutada=False,
                             motivo=str(e)[:500]))

    log('Sin cambios (ya están en Odoo): {}  ·  fuera de alcance: {}'.format(
        conteo['sin_cambios'], conteo['fuera_alcance']))
    log('Altas: {}  ·  omitidos: {}  ·  errores: {}'.format(
        conteo['alta'], conteo['omitido'], conteo['error']))
    return conteo


# ═══════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    ap = argparse.ArgumentParser(description='Sincroniza maestros de DEPOFIS hacia Odoo.')
    ap.add_argument('--aplicar', action='store_true',
                    help='escribe en Odoo (además necesita SINCRO_PERMITIR_APLICAR=si)')
    ap.add_argument('--limite', type=int, default=None,
                    help='con --aplicar: máximo de escrituras en Odoo en esta corrida')
    ap.add_argument('--solo', choices=['clientes', 'conceptos'],
                    help='corre sólo una de las dos mitades')
    ap.add_argument('--origen', choices=['cron', 'cli', 'manual'], default='cli',
                    help='quién dispara la corrida')
    ap.add_argument('--disparada-por', default=None,
                    help='email de quien la dispara; vacío si la corre el cron')
    ap.add_argument('--sin-publicar', action='store_true',
                    help='no manda el resultado a la app (queda sólo el .json local)')
    args = ap.parse_args()
    if args.limite is not None and args.limite < 1:
        ap.error('--limite tiene que ser 1 o más')

    modo, aviso = config.resolver_modo(args.aplicar)
    avisos = [a for a in (aviso,) if a]

    titulo('SINCRONIZACIÓN DE MAESTROS DEPOFIS → ODOO  ·  v{}'.format(VERSION))
    log('Modo:   {}'.format(
        'APLICACIÓN — se van a ESCRIBIR altas y vínculos en ODOO' if modo == 'aplicacion'
        else 'SIMULACIÓN — no se escribe nada en Odoo'))
    if modo == 'aplicacion' and args.limite:
        log('Tope:   {} escritura(s) como máximo'.format(args.limite))
    log('DEPOFIS: espejo depofis_mirror, sólo lectura')
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

    log('Conectando al espejo (depofis_mirror)…')
    acceso = espejo.AccesoEspejo()
    sincronizado_en = acceso.sincronizado_en()
    log('  conectado · espejo actualizado al {}'.format(sincronizado_en))

    if modo == 'aplicacion':
        odoo.habilitar_escritura()
    escritor = Escritor(modo, args.limite)

    pub.abrir({
        'modo': modo,
        'origen': args.origen,
        'disparada_por': args.disparada_por,
        'odoo_db': info['db'],
        'odoo_uid': info['uid'],
        'fuente': 'espejo',
        'fuente_sincronizada_en': sincronizado_en,
        'depofis_server': 'depofis_mirror @ smart-dassa-central',
        'vendedor_map': reglas.vendedor_map_serializable(),
        'version_rutina': VERSION,
    })

    totales = {}
    estado = 'ok'
    error = None
    try:
        if args.solo != 'conceptos':
            totales['clientes'] = procesar_clientes(acceso, escritor, pub)
        if args.solo != 'clientes':
            totales['conceptos'] = procesar_conceptos(acceso, escritor, pub)
        if any(t.get('error') for t in totales.values()):
            estado = 'con_errores'
    except Exception:
        estado = 'fallida'
        error = traceback.format_exc()
        log('\n✗ La corrida falló:\n' + error)
    finally:
        acceso.cerrar()

    totales['modo'] = modo
    totales['limite'] = args.limite
    totales['avisos'] = avisos
    pub.cerrar(estado, totales, error)

    titulo('FIN · estado: {}'.format(estado))
    log('Duración: {:.1f} s'.format((datetime.now() - ahora).total_seconds()))
    if modo == 'simulacion':
        log('\nNo se escribió NADA en Odoo. Para ver el detalle, entrá a la app:')
    else:
        log('\nEscrituras en Odoo: {}. Detalle en la app:'.format(escritor.hechas))
    log('  https://apps.dassa.com.ar/sincro-odoo-depofis/')

    return 0 if estado in ('ok', 'con_errores') else 1


if __name__ == '__main__':
    sys.exit(main())
