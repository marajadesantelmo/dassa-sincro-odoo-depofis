# -*- coding: utf-8 -*-
"""Acceso al SQL Server de DEPOFIS.

Dos modos, y la diferencia importa:

  · `AccesoLectura`  — sólo SELECT. Es lo que usa la corrida en SIMULACIÓN, que
    es el default. No tiene un solo método que escriba: no es una convención, no
    hay INSERT en este objeto.
  · `AccesoEscritura` — hereda del anterior y agrega los INSERT. Sólo se
    instancia cuando `config.resolver_modo()` devolvió 'aplicacion', o sea con
    las dos llaves puestas.

Es la misma idea que el allowlist de `odoo_client.py`: la garantía la da que el
método no exista, no que alguien se acuerde de no llamarlo.

Esta es la fuente del modo APLICACIÓN. Para leer —que es todo lo que hace una
corrida de simulación— la fuente correcta es el espejo Postgres: la regla de
datos de DASSA dice que las apps nuevas leen el espejo, no el origen. Ver
`sincro/espejo.py`.

⚠️ Tres cosas que se aprendieron conectando desde el box (2026-09-07), y que
hacen la diferencia entre conectar y no:

  1. **Se conecta por puerto, SIN el nombre de instancia.** El server es un
     SQLEXPRESS_X86 de 32 bits; la forma `host\\INSTANCIA,puerto` necesita al
     SQL Browser en UDP 1434, que desde Linux no responde. Va `101.44.8.58,1436`
     a secas. (En Windows la otra forma anda, y por eso los scripts viejos la
     usan.)
  2. **Sin cifrado.** `Encrypt=no` + `TrustServerCertificate=yes`. Es lo mismo
     que hace `depofis-mirror` (`encrypt: false, trustServerCertificate: true`),
     que es el ETL que ya lee esta base desde el box todos los días. Sin esto,
     el Driver 18 —que cifra por default— falla en el handshake.
  3. **El driver del box es el 18**, no el 17 ni el viejo `SQL Server` de
     Windows. Por eso la lista de abajo lo prueba primero.

Como no se cifra, NO hace falta ningún `openssl-legacy.cnf`: la vuelta del
TLS 1.0 con OpenSSL 3 no aplica acá.
"""

import pyodbc

from . import config, vfp

BASE = 'DEPOFIS.DASSA'

# Orden de preferencia. El 18 primero: es el que está instalado en app01.
DRIVERS = (
    'ODBC Driver 18 for SQL Server',
    'ODBC Driver 17 for SQL Server',
    'SQL Server',
    'FreeTDS',
)


def _cadena_conexion(driver):
    return (
        'DRIVER={{{}}};SERVER={};UID={};PWD={};Encrypt=no;TrustServerCertificate=yes'
        .format(driver, config.DEPOFIS_SERVER,
                config.requerido('DEPOFIS_USER', 'el usuario del SQL de DEPOFIS'),
                config.requerido('DEPOFIS_PASSWORD', 'la contraseña del SQL de DEPOFIS'))
    )


def conectar():
    """Abre la conexión, probando los drivers instalados en orden.

    ⚠️ `autocommit=True` NO es una preferencia de estilo: es obligatorio.

    `DEPOFIS.DASSA.*` no son tablas de SQL Server — son un **linked server sobre
    FoxPro** (`DEPO50_DASSA`, provider `VFPOLEDB`). pyodbc abre una transacción
    implícita en cuanto ejecuta algo, y eso convierte el INSERT en una
    transacción distribuida que VFPOLEDB no sabe manejar:

        [42000] ... OLE DB provider "VFPOLEDB" for linked server "DEPO50_DASSA"
        does not support the required transaction interface. (7390)

    Verificado contra producción el 2026-09-07: con transacción implícita el
    INSERT falla siempre; con autocommit entra.

    **Consecuencia de fondo: acá no hay rollback.** Cada INSERT es definitivo en
    el momento en que corre. Un lote a medio escribir no se puede deshacer, así
    que la rutina inserta de a una fila y trata cada alta como un hecho
    consumado — no hay "todo o nada" posible contra esta base.
    """
    intentos = []
    for driver in DRIVERS:
        if driver not in pyodbc.drivers():
            continue
        try:
            return pyodbc.connect(_cadena_conexion(driver), timeout=15, autocommit=True)
        except pyodbc.Error as e:
            intentos.append('{}: {}'.format(driver, e))
    raise RuntimeError(
        'No se pudo conectar al SQL de DEPOFIS ({}).\n  Drivers presentes: {}\n  {}\n'
        '  Recordá: SERVER va como "host,puerto", sin el nombre de instancia.'
        .format(config.DEPOFIS_SERVER, pyodbc.drivers(),
                '\n  '.join(intentos) or 'ninguno de los conocidos está instalado'))


class AccesoLectura:
    """Todo lo que la corrida necesita saber de DEPOFIS. Ni un INSERT."""

    def __init__(self, conexion=None):
        self.conn = conexion or conectar()
        self.cursor = self.conn.cursor()

    # ─── Catálogos ─────────────────────────────────────────────────────────

    def categorias(self):
        """Las categorías comerciales realmente en uso (Clientes.tipo_cl).

        Salen de los datos y no de una tabla de catálogo porque en DEPOFIS
        `tipo_cl` es texto libre: la lista viva es la que está usada.
        """
        self.cursor.execute('SELECT DISTINCT tipo_cl FROM {}.Clientes'.format(BASE))
        return {r[0].strip() for r in self.cursor.fetchall() if r[0] and r[0].strip()}

    def cuits_existentes(self):
        """Set de CUITs (sólo dígitos) ya cargados en Clientes.documento.

        Es la única defensa contra duplicar un cliente, porque el cliente de
        Odoo es de solo lectura y no puede marcar allá que ya sincronizó.
        """
        from .reglas import solo_digitos
        self.cursor.execute('SELECT documento FROM {}.Clientes'.format(BASE))
        return {solo_digitos(r[0]) for r in self.cursor.fetchall() if solo_digitos(r[0])}

    def codigos_concepto(self):
        self.cursor.execute('SELECT codigo FROM {}.Concepfc'.format(BASE))
        return {str(r[0]).strip() for r in self.cursor.fetchall()}

    def proximo_clie_nro(self):
        """`clie_nro` no es identity: se calcula a mano.

        En simulación se usa sólo para mostrar qué número le tocaría a cada
        alta. En aplicación se relee dentro de la misma conexión antes del
        primer INSERT — no protege de dos rutinas corriendo a la vez, pero esas
        dos rutinas no deberían existir (ver docs/OPERACION.md).
        """
        self.cursor.execute('SELECT MAX(clie_nro) FROM {}.Clientes'.format(BASE))
        return int(self.cursor.fetchone()[0] or 0) + 1

    def cerrar(self):
        try:
            self.conn.close()
        except Exception:
            pass


class AccesoEscritura(AccesoLectura):
    """Agrega los INSERT. Se instancia SÓLO en modo 'aplicacion'.

    ⚠️ **No usa `INSERT INTO`.** Las vistas `DASSA.*` no son escribibles
    (VFPOLEDB no expone `IID_IRowsetChange`, error 7301). La única vía que
    funciona es pass-through: mandarle a FoxPro el comando como string con
    `EXEC ('...') AT [DEPO50_DASSA]`. Ver `sincro/vfp.py`, que es un port del
    builder de `dassa-orden` — la app del ecosistema que ya escribe en DEPOFIS
    en producción por este mismo camino.

    No hay `commit()` ni `rollback()` acá, y no es un olvido: la conexión va en
    autocommit porque el linked server no soporta transacciones. Cada alta es
    definitiva al ejecutarse, así que después de escribir se **verifica**.
    """

    def alta_cliente(self, payload):
        """Crea una fila en DASSA.Clientes. Devuelve el clie_nro asignado.

        Definitivo: no hay forma de deshacerlo desde acá.
        """
        campos = {k: payload[k] for k in (
            'clie_nro', 'apellido', 'direccion', 'localidad', 'provincia', 'cpostal',
            'telefono', 'tipo_cl', 'tipo_doc', 'documento', 'iva', 'vendedor',
            'consolida', 'email', 'estado', 'us_add', 'fecha_add', 'hora_add')}
        self.cursor.execute(vfp.construir_insert('Clientes', campos, vfp.TIPOS_CLIENTES))
        return payload['clie_nro']

    def alta_concepto(self, payload):
        """Crea una fila en DASSA.Concepfc. Devuelve el código.

        Manda las 38 columnas: FoxPro no acepta null en ninguna. Las 7 que la
        rutina deriva de Odoo vienen en `payload`; el resto sale de
        `vfp.DEFAULTS_CONCEPFC`.
        """
        propios = {k: payload[k] for k in (
            'codigo', 'detalle', 'calcula', 'grupo', 'us_add', 'fecha_add', 'hora_add')}
        campos = vfp.campos_concepfc(propios)
        self.cursor.execute(vfp.construir_insert('Concepfc', campos, vfp.TIPOS_CONCEPFC))
        return payload['codigo']

    def verificar(self, tabla, columna, valor):
        """Relee por el mismo camino pass-through. Devuelve la fila o None.

        Sin transacciones, verificar después de escribir es lo único que
        distingue "entró" de "el comando no dio error".
        """
        self.cursor.execute(vfp.construir_select_por_codigo(tabla, columna, valor))
        return self.cursor.fetchone()

    def borrar(self, tabla, columna, valor, us_add):
        """Borra, acotado por `us_add`: nunca puede tocar una fila de una persona."""
        self.cursor.execute(vfp.construir_delete_por_codigo(tabla, columna, valor, us_add))


def abrir(modo):
    """El acceso al ORIGEN que corresponde al modo.

    Es el único lugar donde se decide lectura vs escritura contra el SQL Server.
    La elección origen-vs-espejo la hace `sincronizar.py` con `abrir_fuente()`.
    """
    return AccesoEscritura() if modo == 'aplicacion' else AccesoLectura()
