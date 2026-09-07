"""
Sincroniza maestros de Odoo (res.partner / product.template) hacia DEPOFIS SQL
(DASSA.Clientes / DASSA.Concepfc). Ver 'Descripcion Proyecto.md' en esta carpeta
para el detalle completo del circuito y las reglas de negocio.

Dirección del flujo: LEE de Odoo (conexion_odoo, solo lectura) y ESCRIBE (INSERT)
en el SQL de DEPOFIS. Es la dirección opuesta a los update_*_odoo.py del repo,
que leen de DEPOFIS y escriben en Odoo.

Como conexion_odoo es de solo lectura, el script nunca puede marcar en Odoo que
un cliente ya fue sincronizado (no puede escribir depofis_code). La idempotencia
se logra en cambio matcheando por CUIT contra DASSA.Clientes.documento antes de
cada alta: si el CUIT ya existe en DEPOFIS, se asume que ese cliente ya fue
cargado (por este script o a mano) y se omite, reportándolo como "vincular en
Odoo" en vez de duplicarlo.

1) CLIENTES (res.partner -> DASSA.Clientes)
   Candidatos: is_company=True, vat cargado, depofis_code vacío en Odoo.
   Se excluyen (van al reporte, no se crean):
     - sin vat: sin CUIT no se puede verificar si el cliente ya existe (regla
       explícita de la Descripción de Proyecto).
     - CUIT ya presente en DASSA.Clientes.documento: falta vincular en Odoo.
     - sin ninguna etiqueta (category_id) que matchee una categoría DEPOFIS
       conocida (tipo_cl): la categoría comercial es obligatoria para el alta.
   Vendedor (columna 'vendedor'): NO existe el campo depofis_vendedor_code en
   Odoo, pero se puede derivar sin él a partir de dos campos que sí existen:
   user_id (Salesperson) + is_dassa ('Cliente DASSA'). Cada comercial tiene un
   código propio y uno institucional (VENDEDOR_MAP); is_dassa=True usa el
   institucional. Si no hay Salesperson asignado o no está en el mapeo (ej.
   código 9/19 "A.M.", sin usuario activo en Odoo), 'vendedor' queda NULL en
   vez de asignar un valor por defecto (decisión explícita: no adivinar).
   Condición de IVA ('iva'): se mapea desde l10n_ar_afip_responsibility_type_id
   contra DASSA.Tipo_iva; si el campo viene vacío en Odoo se asume Responsable
   Inscripto (código 1), tal como pide la Descripción de Proyecto.
   depofis_consolida_id no existe todavía en Odoo -> 'consolida' se inserta en 0.
   Provincia se inserta siempre como 'N/D' (así se carga hoy en DEPOFIS).

2) CONCEPTOS (product.template -> DASSA.Concepfc)
   El código DEPOFIS NO requiere un campo custom nuevo: ya está disponible en
   Odoo como default_code ('Referencia Interna'), cargado en la migración
   original (verificado: 331 de 339 productos con Referencia Interna matchean
   un código real de Concepfc, misma convención de sufijo de período para
   almacenaje que usa migacion_skus_clientes_ctascontables.py / -07,-30,-60,
   -90,-99). Se sincronizan los productos con Referencia Interna numérica cuyo
   código todavía no existe en Concepfc.
   depofis_calcula (unidad de cálculo) sigue sin existir en Odoo, pero solo
   hace falta dato para conceptos de Almacenaje: se deriva del nombre del
   producto replicando la regla real de update_prefacturacion_odoo.py
   (almacenaje_mask / contenedor_mask) — ahí Cantidad ya se calcula así en
   producción, no es una regla nueva:
     - nombre contiene "Almacenaje" y "Contenedor"  -> calcula = 'Dias'
     - nombre contiene "Almacenaje" sin "Contenedor" -> calcula = 'Dias * M3'
       (almacenaje de mercadería: Cantidad = Días * Volumen)
     - cualquier otro producto                      -> calcula = 'Nada'
   Si el nombre sugiere período (contiene "Dias"/"Días") pero no dice
   "Almacenaje" (no cae en almacenaje_mask de update_prefacturacion_odoo.py,
   ej. "Bajada de Mercadería a Piso... de 0 a 30 días"), se deja 'Nada' y se
   marca REVISAR en el reporte en vez de adivinar.
   Si depofis_calcula llega a existir en Odoo y viene cargado, tiene prioridad
   sobre esta derivación.

Salida: sincronizacion_clientes_conceptos/resultado_sincronizacion.xlsx con el
detalle de creados / omitidos (y por qué), para auditar cada corrida.
"""

import os
import re
import sys
from datetime import datetime

import pyodbc
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, PROJECT_DIR)

from tokens import username, password
from conexion_odoo.odoo_client import search_read, fields_get

# Configuración de directorio de trabajo para ejecución en task scheduler
if os.path.exists(PROJECT_DIR):
    os.chdir(PROJECT_DIR)


# Sistema de log: duplica stdout hacia archivo en carpeta log/
class _Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)

    def flush(self):
        for s in self.streams:
            s.flush()


_LOG_DIR = os.path.join(PROJECT_DIR, 'log')
os.makedirs(_LOG_DIR, exist_ok=True)
_log_path = os.path.join(_LOG_DIR, f"sync_clientes_conceptos_{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.log")
_log_file = open(_log_path, 'w', encoding='utf-8')
sys.stdout = _Tee(sys.__stdout__, _log_file)
print(f"Log: {_log_path}")

SERVER = '101.44.8.58\\SQLEXPRESS_X86,1436'
OUTPUT_XLSX = os.path.join(SCRIPT_DIR, 'resultado_sincronizacion.xlsx')

# Código propio / código institucional por usuario de Odoo (ver docstring).
# id de res.users -> (codigo_propio, codigo_institucional). Códigos 1 (MT), 2
# (DASSA genérico) y 9/19 (A.M.) no tienen usuario activo asociado en Odoo hoy.
VENDEDOR_MAP = {
    6: (3, 13),   # Manuel de la Arena
    7: (4, 14),   # Santiago Aguirre Oliva
    13: (5, 15),  # Enzo Nieto
    8: (6, 16),   # Francisco Urtubey
    11: (7, 17),  # Guillermo Jorge
    12: (8, 18),  # Alexis Dalpra
}

# l10n_ar.afip.responsibility.type (id) -> DASSA.Tipo_iva.codigo.
# Mapeo aproximado para las categorías sin equivalente directo (Proveedor/
# Cliente del Exterior, IVA Liberado, Sujeto no Categorizado): juicio de
# negocio, revisar si aparecen casos reales.
IVA_MAP = {
    1: 1,    # IVA Responsable Inscripto -> RESPONSABLE INSCRIPTO
    4: 6,    # IVA Sujeto Exento -> EXENTO
    5: 3,    # Consumidor Final -> CONSUMIDOR FINAL
    6: 4,    # Responsable Monotributo -> MONOTRIBUTO
    7: 0,    # Sujeto no Categorizado -> S/D
    8: 5,    # Proveedor del Exterior -> NO GRAVADO
    9: 5,    # Cliente del Exterior -> NO GRAVADO
    10: 6,   # IVA Liberado Ley 19.640 -> EXENTO (aproximado)
    13: 4,   # Monotributista Social -> MONOTRIBUTO
    15: 5,   # IVA No Alcanzado -> NO GRAVADO
    16: 4,   # Monotributo Trabajador Independiente Promovido -> MONOTRIBUTO
}
IVA_DEFAULT = 1  # Responsable Inscripto: default si el campo viene vacío en Odoo

US_ADD = 'ODOO'  # marca de origen automático en us_add (char(10))


def solo_digitos(s):
    return re.sub(r'\D', '', str(s or ''))


def formatear_cuit(vat):
    """CUIT de Odoo (con o sin guiones) -> formato DEPOFIS 'XX-XXXXXXXX-X' (13 chars).
    Si no tiene 11 dígitos, se devuelven los dígitos tal cual (se marca para revisar)."""
    d = solo_digitos(vat)
    if len(d) == 11:
        return f"{d[0:2]}-{d[2:10]}-{d[10:11]}"
    return d[:13]


def resolver_vendedor(user_id, is_dassa):
    """user_id: tupla (id, nombre) o False. Devuelve código DEPOFIS o None si no se puede resolver."""
    if not user_id:
        return None
    codigos = VENDEDOR_MAP.get(user_id[0])
    if not codigos:
        return None
    return codigos[1] if is_dassa else codigos[0]


def resolver_iva(afip_responsibility_type_id):
    """afip_responsibility_type_id: tupla (id, nombre) o False."""
    if not afip_responsibility_type_id:
        return IVA_DEFAULT
    return IVA_MAP.get(afip_responsibility_type_id[0], IVA_DEFAULT)


def resolver_calcula(nombre_producto):
    """Deriva 'calcula' para conceptos de almacenaje replicando la regla real
    de update_prefacturacion_odoo.py (almacenaje_mask / contenedor_mask):
    Cantidad = Dias Almacenaje, y se multiplica además por volumen cuando el
    nombre NO dice 'Contenedor' (almacenaje de mercadería, no de contenedor).
    Devuelve (calcula, revisar) — revisar=True cuando el nombre sugiere un
    concepto por período pero no matchea 'Almacenaje' (caso no cubierto por
    esa regla, no se adivina)."""
    n = nombre_producto.upper()
    if 'ALMACENAJE' in n:
        return ('Dias', False) if 'CONTENEDOR' in n else ('Dias * M3', False)
    if 'DIAS' in n or 'DÍAS' in n:
        return 'Nada', True
    return 'Nada', False


def resolver_categoria(category_ids, categoria_por_id):
    """category_ids: lista de ids de res.partner.category. Devuelve el primer
    nombre que matchee una categoría DEPOFIS conocida (tipo_cl), o None."""
    for cid in category_ids or []:
        nombre = categoria_por_id.get(cid)
        if nombre:
            return nombre
    return None


print(f"\n{'=' * 70}")
print("  SINCRONIZACIÓN DE MAESTROS ODOO -> DEPOFIS (clientes y conceptos)")
print(f"{'=' * 70}\n")

conn = pyodbc.connect('DRIVER={SQL Server};SERVER=' + SERVER + ';UID=' + username + ';PWD=' + password)
cursor = conn.cursor()

# ── Categorías comerciales válidas (tipo_cl actualmente en uso en DEPOFIS) ────
cursor.execute("SELECT DISTINCT tipo_cl FROM DEPOFIS.DASSA.Clientes")
categorias_depofis = {row[0].strip() for row in cursor.fetchall() if row[0] and row[0].strip()}
print(f"Categorías DEPOFIS conocidas (tipo_cl): {len(categorias_depofis)}")

odoo_categorias = search_read('res.partner.category', [], fields=['id', 'name'])
categoria_por_id = {
    c['id']: c['name'].strip()
    for c in odoo_categorias
    if c['name'].strip() in categorias_depofis
}
print(f"Etiquetas de Odoo que matchean una categoría DEPOFIS: {len(categoria_por_id)}")

# ── CUITs ya existentes en DEPOFIS (para no duplicar altas) ──────────────────
cursor.execute("SELECT documento FROM DEPOFIS.DASSA.Clientes")
cuits_existentes = {solo_digitos(row[0]) for row in cursor.fetchall() if solo_digitos(row[0])}
print(f"CUITs ya cargados en DASSA.Clientes: {len(cuits_existentes)}")

# ── Próximo clie_nro (no es columna identity, se calcula a mano) ─────────────
cursor.execute("SELECT MAX(clie_nro) FROM DEPOFIS.DASSA.Clientes")
siguiente_clie_nro = int(cursor.fetchone()[0] or 0) + 1
print(f"Próximo clie_nro a asignar: {siguiente_clie_nro}")

# ── Candidatos en Odoo: empresas con CUIT y sin depofis_code (no vinculadas) ──
print("\nConsultando candidatos en Odoo (res.partner)...")
candidatos = search_read(
    'res.partner',
    [('is_company', '=', True), ('vat', '!=', False), ('depofis_code', '=', False)],
    fields=[
        'id', 'name', 'vat', 'category_id', 'user_id', 'is_dassa',
        'l10n_ar_afip_responsibility_type_id', 'street', 'city', 'zip', 'phone', 'email',
    ],
)
print(f"  {len(candidatos)} empresa(s) en Odoo sin depofis_code, con CUIT cargado.")

reporte_clientes = []
creados = 0
now = datetime.now()

for p in candidatos:
    cuit_digitos = solo_digitos(p['vat'])
    nombre = p['name'].strip()

    if cuit_digitos in cuits_existentes:
        reporte_clientes.append({
            'Odoo ID': p['id'], 'Nombre': nombre, 'CUIT': p['vat'],
            'Resultado': 'OMITIDO', 'Motivo': 'CUIT ya existe en DEPOFIS: falta vincular depofis_code en Odoo',
        })
        continue

    categoria = resolver_categoria(p['category_id'], categoria_por_id)
    if not categoria:
        reporte_clientes.append({
            'Odoo ID': p['id'], 'Nombre': nombre, 'CUIT': p['vat'],
            'Resultado': 'OMITIDO', 'Motivo': 'Sin categoría comercial DEPOFIS asignada (category_id)',
        })
        continue

    vendedor = resolver_vendedor(p['user_id'], p['is_dassa'])
    iva = resolver_iva(p['l10n_ar_afip_responsibility_type_id'])
    cuit_fmt = formatear_cuit(p['vat'])

    nro = siguiente_clie_nro
    try:
        cursor.execute(
            """
            INSERT INTO DEPOFIS.DASSA.Clientes
            (clie_nro, apellido, direccion, localidad, provincia, cpostal, telefono,
             tipo_cl, tipo_doc, documento, iva, vendedor, consolida, email, estado,
             us_add, fecha_add, hora_add)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            nro,
            nombre[:80],
            (p['street'] or '')[:50],
            (p['city'] or '')[:30],
            'N/D',
            (p['zip'] or '')[:8],
            (p['phone'] or '')[:30],
            categoria[:20],
            'C.U.I.T.',
            cuit_fmt,
            iva,
            vendedor,
            0,
            (p['email'] or '')[:200],
            0,
            US_ADD,
            now.strftime('%Y-%m-%d'),
            now.strftime('%H:%M:%S'),
        )
        conn.commit()
        cuits_existentes.add(cuit_digitos)
        siguiente_clie_nro += 1
        creados += 1
        reporte_clientes.append({
            'Odoo ID': p['id'], 'Nombre': nombre, 'CUIT': cuit_fmt,
            'Resultado': 'CREADO', 'Motivo': f"clie_nro={nro}"
                                              + ('' if vendedor is not None else ' | vendedor sin resolver'),
        })
    except Exception as e:
        conn.rollback()
        reporte_clientes.append({
            'Odoo ID': p['id'], 'Nombre': nombre, 'CUIT': p['vat'],
            'Resultado': 'ERROR', 'Motivo': str(e),
        })

print(f"\nClientes creados en DEPOFIS: {creados}")
print(f"Clientes omitidos/con error: {len(reporte_clientes) - creados}")

# ── Conceptos de facturación (product.template -> Concepfc) ──────────────────
# Código DEPOFIS = default_code ('Referencia Interna'), ya cargado desde la
# migración original (ver docstring). depofis_calcula sigue sin existir en
# Odoo -> fallback 'Nada' si no está.
print("\nConsultando campos de product.template en Odoo...")
product_fields = fields_get('product.template')
tiene_calcula_custom = 'depofis_calcula' in product_fields
reporte_conceptos = []

cursor.execute("SELECT codigo FROM DEPOFIS.DASSA.Concepfc")
codigos_existentes = {str(row[0]).strip() for row in cursor.fetchall()}

campos_producto = ['id', 'name', 'default_code', 'categ_id']
if tiene_calcula_custom:
    campos_producto.append('depofis_calcula')

productos = search_read(
    'product.template',
    [('default_code', '!=', False)],
    fields=campos_producto,
)
print(f"  {len(productos)} producto(s) en Odoo con Referencia Interna cargada.")

for prod in productos:
    codigo = str(prod['default_code']).strip()
    if not codigo.isdigit():
        reporte_conceptos.append({
            'Odoo ID': prod['id'], 'Nombre': prod['name'], 'Referencia Interna': codigo,
            'Resultado': 'OMITIDO', 'Motivo': 'Referencia Interna no es numérica',
        })
        continue
    if codigo in codigos_existentes:
        reporte_conceptos.append({
            'Odoo ID': prod['id'], 'Nombre': prod['name'], 'Referencia Interna': codigo,
            'Resultado': 'OMITIDO', 'Motivo': 'Código ya existe en Concepfc',
        })
        continue

    calcula_custom = (prod.get('depofis_calcula') or '').strip() if tiene_calcula_custom else ''
    if calcula_custom:
        calcula, revisar_calcula = calcula_custom, False
    else:
        calcula, revisar_calcula = resolver_calcula(prod['name'])
    grupo = prod['categ_id'][1] if prod.get('categ_id') else ''

    try:
        cursor.execute(
            """
            INSERT INTO DEPOFIS.DASSA.Concepfc (codigo, detalle, calcula, grupo, us_add, fecha_add, hora_add)
            VALUES (?,?,?,?,?,?,?)
            """,
            int(codigo),
            prod['name'][:120],
            calcula[:15],
            grupo[:30],
            US_ADD,
            now.strftime('%Y-%m-%d'),
            now.strftime('%H:%M:%S'),
        )
        conn.commit()
        codigos_existentes.add(codigo)
        motivo = f"calcula={calcula}"
        if revisar_calcula:
            motivo += " | REVISAR: nombre sugiere período por días pero no dice 'Almacenaje' (fuera de la regla)"
        reporte_conceptos.append({
            'Odoo ID': prod['id'], 'Nombre': prod['name'], 'Referencia Interna': codigo,
            'Resultado': 'CREADO', 'Motivo': motivo,
        })
    except Exception as e:
        conn.rollback()
        reporte_conceptos.append({
            'Odoo ID': prod['id'], 'Nombre': prod['name'], 'Referencia Interna': codigo,
            'Resultado': 'ERROR', 'Motivo': str(e),
        })

conn.close()

# ── Reporte ────────────────────────────────────────────────────────────────
with pd.ExcelWriter(OUTPUT_XLSX, engine='openpyxl') as writer:
    pd.DataFrame(reporte_clientes).to_excel(writer, sheet_name='Clientes', index=False)
    pd.DataFrame(reporte_conceptos if reporte_conceptos else [{'Info': 'Sin productos con Referencia Interna en Odoo'}]) \
        .to_excel(writer, sheet_name='Conceptos', index=False)

print(f"\nReporte guardado en: {OUTPUT_XLSX}")
print(f"\n{'=' * 70}")
print("=== Proceso completado ===")
print(f"Fecha y hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"{'=' * 70}")

sys.stdout = sys.__stdout__
_log_file.close()
