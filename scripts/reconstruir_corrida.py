#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reconstruye las filas de una corrida que escribió en Odoo y no llegó a publicar.

    python3 scripts/reconstruir_corrida.py --corrida 15 --plantilla 14            # muestra qué haría
    python3 scripts/reconstruir_corrida.py --corrida 15 --plantilla 14 --aplicar  # las inserta

POR QUÉ EXISTE
──────────────
La corrida 15 (2026-10-09 12:35) se cortó con Ctrl-C a mitad de camino. Las
escrituras en Odoo que alcanzó a hacer (~54) pasaron, pero ninguna quedó
registrada: la rutina publicaba las filas recién al cerrar. Sin esas filas el
historial ("Sincronizado") no las muestra. Desde la 0.2.1 una corrida cortada
publica igual lo que escribió, así que esto no debería hacer falta otra vez.

CÓMO DECIDE
───────────
La `--plantilla` es una corrida previa con la lista de lo que había para hacer
(la 14 tiene las 87 altas y vinculaciones pendientes, calculadas sobre los
mismos datos). De esa lista se descarta lo que alguna OTRA corrida registró
como ejecutado (la 16 hizo el resto) y lo que quede se busca en Odoo:

  · alta     → tiene que existir un contacto con ese Código DEPOFIS, CREADO por
               el usuario de la rutina dentro del intervalo de la corrida (desde
               que arrancó hasta que arrancó la siguiente).
  · vincular → el contacto de la plantilla tiene que tener hoy ese Código DEPOFIS.

Lo que no cumple se lista y NO se inserta. No escribe en Odoo ni en DEPOFIS:
sólo inserta filas en `sincro_odoo_depofis.novedad` de esa corrida, con
`ejecutada = true` y un motivo que dice que son reconstruidas.

Necesita SINCRO_ODOO_DEPOFIS_PG_DSN (el .env de la app) y la API key de Odoo.
"""

import argparse
import os
import sys
from datetime import datetime, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

import psycopg2                                   # noqa: E402
from psycopg2.extras import Json                  # noqa: E402

from sincro import config                         # noqa: E402
from sincro import odoo_client as odoo            # noqa: E402

COLUMNAS = ['tipo', 'odoo_id', 'odoo_nombre', 'clave', 'accion', 'motivo', 'requiere_atencion',
            'vendedor_uid', 'vendedor_nombre', 'es_dassa', 'vendedor_depofis', 'payload',
            'depofis_id', 'ejecutada']


def fecha_odoo(s):
    """Odoo devuelve 'YYYY-MM-DD HH:MM:SS' en UTC, sin zona."""
    return datetime.strptime(s, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)


def motivo_limpio(motivo):
    """El motivo de la plantilla sin el "No se ejecutó: tope --limite" de esa corrida."""
    partes = [p for p in (motivo or '').split(' · ') if not p.startswith('No se ejecutó')]
    return ' · '.join(partes)


def main():
    ap = argparse.ArgumentParser(description='Reconstruye desde Odoo las filas de una corrida cortada.')
    ap.add_argument('--corrida', type=int, required=True, help='la corrida que se cortó sin publicar')
    ap.add_argument('--plantilla', type=int, required=True, help='corrida previa con la lista de pendientes')
    ap.add_argument('--aplicar', action='store_true', help='inserta las filas; sin esto sólo muestra')
    args = ap.parse_args()

    conn = psycopg2.connect(config.requerido('SINCRO_ODOO_DEPOFIS_PG_DSN', 'el DSN de la base de la app'),
                            connect_timeout=20)
    cur = conn.cursor()

    cur.execute('SELECT id, estado, iniciada_en, terminada_en FROM sincro_odoo_depofis.corrida WHERE id = %s',
                (args.corrida,))
    fila = cur.fetchone()
    if not fila:
        sys.exit('No existe la corrida {}.'.format(args.corrida))
    _, estado, desde, terminada = fila
    if estado == 'en_curso':
        sys.exit('La corrida {} sigue en_curso: cerrarla primero.'.format(args.corrida))
    cur.execute('SELECT min(iniciada_en) FROM sincro_odoo_depofis.corrida WHERE id > %s', (args.corrida,))
    hasta = cur.fetchone()[0] or terminada

    cur.execute('SELECT depofis_id FROM sincro_odoo_depofis.novedad WHERE corrida_id = %s', (args.corrida,))
    ya_en_la_corrida = {r[0] for r in cur.fetchall()}

    cur.execute(
        """SELECT DISTINCT tipo, depofis_id FROM sincro_odoo_depofis.novedad
            WHERE ejecutada AND corrida_id <> %s""", (args.corrida,))
    hechas_por_otras = set(cur.fetchall())

    cur.execute(
        """SELECT {} FROM sincro_odoo_depofis.novedad
            WHERE corrida_id = %s AND accion IN ('alta', 'vincular') AND NOT ejecutada
            ORDER BY id""".format(', '.join(COLUMNAS)), (args.plantilla,))
    plantilla = [dict(zip(COLUMNAS, r)) for r in cur.fetchall()]

    info = odoo.info_conexion()
    uid = info['uid']
    print('Corrida {} · {} → {} (UTC: {} → {})'.format(args.corrida, desde, hasta,
          desde.astimezone(timezone.utc), hasta.astimezone(timezone.utc)))
    print('Plantilla {}: {} pendientes · usuario de la rutina en Odoo: uid {}'.format(
        args.plantilla, len(plantilla), uid))

    hoy = datetime.now().strftime('%Y-%m-%d')
    a_insertar, descartadas = [], []
    for n in plantilla:
        if (n['tipo'], n['depofis_id']) in hechas_por_otras:
            continue
        if n['depofis_id'] in ya_en_la_corrida:
            descartadas.append((n, 'ya está en la corrida {}'.format(args.corrida)))
            continue
        if n['tipo'] != 'cliente':
            descartadas.append((n, 'sólo se reconstruyen clientes'))
            continue

        encontrados = odoo.search_read(
            'res.partner',
            [('depofis_code', '=', n['depofis_id']), ('parent_id', '=', False),
             '|', ('active', '=', True), ('active', '=', False)],
            fields=['id', 'name', 'create_uid', 'create_date'])
        if len(encontrados) != 1:
            descartadas.append((n, '{} contactos con ese Código DEPOFIS en Odoo'.format(len(encontrados))))
            continue
        p = encontrados[0]

        if n['accion'] == 'alta':
            creado = fecha_odoo(p['create_date'])
            if (p['create_uid'] or [None])[0] != uid or not (desde <= creado < hasta):
                descartadas.append((n, 'el contacto {} no lo creó la rutina dentro de la corrida '
                                       '(creado {} por {})'.format(p['id'], p['create_date'], p['create_uid'])))
                continue
        elif p['id'] != n['odoo_id']:
            descartadas.append((n, 'el código está en el contacto {}, no en el {} de la plantilla'
                                   .format(p['id'], n['odoo_id'])))
            continue

        nueva = dict(n, odoo_id=p['id'], ejecutada=True,
                     motivo='Reconstruida desde Odoo el {}: la corrida se cortó antes de publicar. {}'
                            .format(hoy, motivo_limpio(n['motivo'])).strip())
        a_insertar.append(nueva)

    altas = sum(1 for n in a_insertar if n['accion'] == 'alta')
    print('\nA insertar: {} ({} altas, {} vinculaciones)'.format(len(a_insertar), altas, len(a_insertar) - altas))
    for n in a_insertar:
        print('  + {:<8} {:>5}  {}  (Odoo {})'.format(n['accion'], n['depofis_id'], n['odoo_nombre'], n['odoo_id']))
    if descartadas:
        print('\nNo se insertan: {}'.format(len(descartadas)))
        for n, por in descartadas:
            print('  - {:<8} {:>5}  {} — {}'.format(n['accion'], n['depofis_id'], n['odoo_nombre'], por))

    if not args.aplicar:
        print('\n(Sin --aplicar: no se insertó nada.)')
        return 0
    if not a_insertar:
        print('\nNada para insertar.')
        return 0

    with conn:
        for n in a_insertar:
            cur.execute(
                'INSERT INTO sincro_odoo_depofis.novedad (corrida_id, {}) VALUES (%s, {})'.format(
                    ', '.join(COLUMNAS), ', '.join(['%s'] * len(COLUMNAS))),
                [args.corrida] + [Json(n[c]) if c == 'payload' else n[c] for c in COLUMNAS])
        cur.execute(
            """UPDATE sincro_odoo_depofis.corrida
                  SET error = coalesce(error, '') || %s
                WHERE id = %s""",
            (' · {} fila(s) reconstruidas desde Odoo el {} con scripts/reconstruir_corrida.py.'
             .format(len(a_insertar), hoy), args.corrida))
    print('\n✓ {} fila(s) insertadas en la corrida {}.'.format(len(a_insertar), args.corrida))
    return 0


if __name__ == '__main__':
    sys.exit(main())
