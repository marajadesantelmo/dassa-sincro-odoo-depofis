# -*- coding: utf-8 -*-
"""Lectura de DEPOFIS por el espejo Postgres (`depofis_mirror.*`).

DEPOFIS es el maestro de esta sincronización y se lee SÓLO de acá. La regla de
datos de DASSA dice que las apps nuevas leen el espejo, no el SQL Server
(`02-instructivo-acceso-operacion.md` §4), y esta rutina no tiene código ni
credenciales para escribirle a DEPOFIS. Esta clase no tiene un solo método que
escriba: son todos SELECT.

⚠️ El schema correcto es `depofis_mirror`, **no** `depofis`. Los dos existen en
el mismo cluster y se parecen:

  · `depofis_mirror.clientes` — copia 1:1 de DASSA.Clientes, las 60+ columnas.
    Se sincroniza cada hora (medido 2026-10-09).
  · `depofis.clientes` — el schema viejo del Hub, con 12 columnas. Está
    CONGELADO desde 2026-05-10 y acumula filas fantasma. Leer de ahí da números
    inventados (ya le pasó a `control-stock`).

La diferencia importa tanto que el schema va en una constante y ninguna consulta
lo escribe a mano.

`depofis_mirror.clientes` trae también `usuario` y `password` (el acceso web del
cliente). Las consultas de acá nombran sus columnas una por una y nunca hacen
`SELECT *`: esos dos campos no tienen por qué pasar por esta rutina.
"""

from collections import namedtuple

import psycopg2

from . import config
from .reglas import solo_digitos

SCHEMA = 'depofis_mirror'

# `estado = 0` es el cliente activo. Medido 2026-10-09: los 192 clientes dados
# de alta en 2026 tienen 0; los 1 y 2 son de 2024 para atrás.
ESTADO_ACTIVO = 0

ClienteDepofis = namedtuple('ClienteDepofis', [
    'clie_nro', 'nombre', 'cuit', 'tipo_doc', 'iva', 'vendedor', 'tipo_cl',
    'direccion', 'localidad', 'cpostal', 'pais', 'telefono', 'email', 'fecha_alta',
])

ConceptoDepofis = namedtuple('ConceptoDepofis', [
    'codigo', 'detalle', 'grupo', 'gravado', 'importe', 'calcula', 'us_del',
])


def _txt(v):
    return (v or '').strip() if isinstance(v, str) else ('' if v is None else str(v).strip())


class AccesoEspejo:
    """Lectura de Clientes y Concepfc. Ni un INSERT."""

    def __init__(self, dsn=None):
        self.dsn = dsn or config.requerido(
            'SINCRO_ESPEJO_PG_DSN', 'el DSN del espejo Postgres de DEPOFIS')
        self.conn = psycopg2.connect(self.dsn, connect_timeout=20)
        self.conn.set_session(readonly=True)
        self.cursor = self.conn.cursor()

    def clientes(self):
        """Los clientes ACTIVOS. Devuelve (activos, cantidad_inactivos)."""
        self.cursor.execute(
            'SELECT clie_nro, apellido, nombre, documento, tipo_doc, iva, vendedor, tipo_cl, '
            '       direccion, localidad, cpostal, pais, telefono, email, fecha_add, estado '
            '  FROM {}.clientes ORDER BY clie_nro'.format(SCHEMA))
        activos, inactivos = [], 0
        for (nro, apellido, nombre, doc, tipo_doc, iva, vend, tipo_cl,
             direc, loc, cp, pais, tel, email, fecha, estado) in self.cursor.fetchall():
            if estado is not None and int(estado) != ESTADO_ACTIVO:
                inactivos += 1
                continue
            activos.append(ClienteDepofis(
                clie_nro=int(nro),
                # La razón social está en `apellido`; `nombre` casi siempre va vacío.
                nombre=_txt(apellido) or _txt(nombre),
                cuit=solo_digitos(doc),
                tipo_doc=_txt(tipo_doc),
                iva=None if iva is None else int(iva),
                vendedor=None if vend is None else int(vend),
                tipo_cl=_txt(tipo_cl),
                direccion=_txt(direc), localidad=_txt(loc), cpostal=_txt(cp),
                pais=_txt(pais), telefono=_txt(tel), email=_txt(email),
                fecha_alta=fecha,
            ))
        return activos, inactivos

    def conceptos(self):
        self.cursor.execute(
            'SELECT codigo, detalle, grupo, gravado, importe, calcula, us_del '
            '  FROM {}.concepfc ORDER BY codigo'.format(SCHEMA))
        return [
            ConceptoDepofis(
                codigo=None if c is None else int(c), detalle=_txt(d), grupo=_txt(g),
                gravado=_txt(gr).upper(), importe=float(imp or 0), calcula=_txt(cal),
                us_del=_txt(ud))
            for c, d, g, gr, imp, cal, ud in self.cursor.fetchall()
        ]

    # ─── Frescura ──────────────────────────────────────────────────────────

    def sincronizado_en(self):
        """Cuándo se actualizó el espejo por última vez.

        Se publica con la corrida y la pantalla lo muestra: un cliente cargado
        en DEPOFIS después de esa hora todavía no se ve.
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
