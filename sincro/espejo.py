# -*- coding: utf-8 -*-
"""Lectura de DEPOFIS por el espejo Postgres (`depofis_mirror.*`).

Es la fuente por default de las corridas de SIMULACIÓN, y no es una comodidad:
la regla de datos de DASSA dice que **las apps nuevas leen el espejo, no el
origen** (`02-instructivo-acceso-operacion.md` §4). El SQL Server de DEPOFIS
queda para el sync y casos puntuales — acá, para el momento en que la rutina
tenga que ESCRIBIR de verdad.

⚠️ El schema correcto es `depofis_mirror`, **no** `depofis`. Los dos existen en
el mismo cluster y se parecen:

  · `depofis_mirror.clientes` — copia 1:1 de DASSA.Clientes, las 60+ columnas
    (incluye `tipo_cl`, `documento`, `vendedor`, `iva`). Se sincroniza a diario.
  · `depofis.clientes` — el schema viejo del Hub, con 12 columnas y sin
    `tipo_cl`. Está CONGELADO desde 2026-05-10 y acumula filas fantasma. Leer
    de ahí da números inventados (ya le pasó a `control-stock`).

La diferencia importa tanto que esta clase nombra el schema en una constante y
ninguna consulta lo escribe a mano.

Lo que el espejo NO puede hacer es escribir. `AccesoEspejo` no tiene métodos de
alta — igual que `AccesoLectura` — y `sincronizar.py` exige la fuente `origen`
para cualquier corrida de aplicación.
"""

import psycopg2

from . import config
from .reglas import solo_digitos

SCHEMA = 'depofis_mirror'


class AccesoEspejo:
    """Misma interfaz de lectura que `depofis.AccesoLectura`. Ni un INSERT."""

    def __init__(self, dsn=None):
        self.dsn = dsn or config.requerido(
            'SINCRO_ESPEJO_PG_DSN', 'el DSN del espejo Postgres de DEPOFIS')
        self.conn = psycopg2.connect(self.dsn, connect_timeout=20)
        self.cursor = self.conn.cursor()

    # ─── Catálogos ─────────────────────────────────────────────────────────

    def categorias(self):
        """Las categorías comerciales realmente en uso (Clientes.tipo_cl).

        Salen de los datos y no de una tabla de catálogo porque en DEPOFIS
        `tipo_cl` es texto libre: la lista viva es la que está usada.
        """
        self.cursor.execute(
            "SELECT DISTINCT btrim(tipo_cl) FROM {}.clientes "
            "WHERE tipo_cl IS NOT NULL AND btrim(tipo_cl) <> ''".format(SCHEMA))
        return {r[0] for r in self.cursor.fetchall()}

    def cuits_existentes(self):
        """Set de CUITs (sólo dígitos) ya cargados en Clientes.documento."""
        self.cursor.execute(
            'SELECT documento FROM {}.clientes'.format(SCHEMA))
        return {solo_digitos(r[0]) for r in self.cursor.fetchall() if solo_digitos(r[0])}

    def cuits_proveedores(self):
        """Set de CUITs (sólo dígitos) cargados en Proveed.cuit.

        Sirve para EXCLUIR: reconocer que un contacto de Odoo es proveedor y
        sacarlo del análisis. Esta rutina no escribe nunca en Proveed. Ver
        `reglas.clasificar_alcance`.

        En Clientes la columna se llama `documento` y acá `cuit`; el formato es
        el mismo y los dos sets se normalizan con `solo_digitos`.
        """
        self.cursor.execute('SELECT cuit FROM {}.proveed'.format(SCHEMA))
        return {solo_digitos(r[0]) for r in self.cursor.fetchall() if solo_digitos(r[0])}

    def codigos_concepto(self):
        self.cursor.execute('SELECT codigo FROM {}.concepfc'.format(SCHEMA))
        return {str(r[0]).strip() for r in self.cursor.fetchall() if r[0] is not None}

    def proximo_clie_nro(self):
        self.cursor.execute('SELECT MAX(clie_nro) FROM {}.clientes'.format(SCHEMA))
        return int(self.cursor.fetchone()[0] or 0) + 1

    # ─── Frescura ──────────────────────────────────────────────────────────

    def sincronizado_en(self):
        """Cuándo se actualizó el espejo por última vez.

        Se publica con la corrida y la pantalla lo muestra. Es la contracara de
        leer una copia: un informe basado en la foto de ayer puede decir "falta
        dar de alta" de un cliente que se cargó esta mañana. Ocultarlo sería
        presentar la copia como si fuera el original.
        """
        self.cursor.execute(
            'SELECT max(_synced_at) FROM {}.clientes'.format(SCHEMA))
        fila = self.cursor.fetchone()
        return fila[0] if fila else None

    def cerrar(self):
        try:
            self.conn.close()
        except Exception:
            pass
