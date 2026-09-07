#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prueba de humo del camino de ESCRITURA contra DEPOFIS.

    python scripts/probar_escritura.py                 # sólo muestra el comando
    python scripts/probar_escritura.py --confirmar     # lo ejecuta
    python scripts/probar_escritura.py --borrar        # muestra el DELETE
    python scripts/probar_escritura.py --borrar --confirmar

POR QUÉ EXISTE
──────────────
El camino de escritura nunca se había ejecutado: el primer `--aplicar` sería
también la primera vez que corre contra producción. Esto separa las dos
preguntas — "¿el mecanismo de escritura funciona?" de "¿damos de alta los
conceptos de verdad?" — y contesta la primera con una fila descartable.

Fue esta prueba la que descubrió que `INSERT INTO` no sirve contra DEPOFIS y
que hay que usar pass-through. Ver `sincro/vfp.py`.

QUÉ NO PUEDE HACER
──────────────────
Sólo puede tocar UNA fila: el código y el nombre están hardcodeados abajo y no
se pueden pasar por parámetro. No es una convención — no hay argumento que los
cambie. Un script de prueba capaz de escribir cualquier concepto sería una
puerta trasera al freno de dos llaves de `sincronizar.py`.

Por lo mismo NO mira `SINCRO_PERMITIR_APLICAR`: no es una sincronización, es un
ping con una fila que se borra después. El freno de la rutina sigue intacto.
"""

import argparse
import io
import os
import sys
from datetime import datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

for _flujo in ('stdout', 'stderr'):
    _s = getattr(sys, _flujo)
    if hasattr(_s, 'buffer') and (getattr(_s, 'encoding', '') or '').lower() not in ('utf-8', 'utf8'):
        setattr(sys, _flujo, io.TextIOWrapper(_s.buffer, encoding='utf-8', errors='replace'))

from sincro import config, depofis, vfp  # noqa: E402

# ─── La fila de prueba. No se puede cambiar por parámetro, a propósito. ─────
TABLA = 'Concepfc'
CODIGO = 999999
DETALLE = 'TESTING FACUNDO'
CALCULA = 'Nada'          # uno de los 9 valores que DEPOFIS ya usa
GRUPO = 'TESTING'

# `us_add` es char(10) y lleva el marcador de la app, igual que 'ORDEN_APP' en
# dassa-orden (1057 filas en cordicar). Es lo que acota el DELETE: esta prueba
# no puede borrar una fila que haya cargado una persona.
US_ADD = 'ODOO'


def comando_insert(ahora):
    """⚠️ NO es `INSERT INTO`. Las vistas DASSA.* no son escribibles (VFPOLEDB no
    expone IID_IRowsetChange, error 7301). La vía que funciona es pass-through:
    el comando viaja como string y lo ejecuta FoxPro del otro lado."""
    campos = vfp.campos_concepfc({
        'codigo': CODIGO,
        'detalle': DETALLE,
        'calcula': CALCULA,
        'grupo': GRUPO,
        'us_add': US_ADD,
        'fecha_add': ahora.strftime('%Y-%m-%d'),
        'hora_add': ahora.strftime('%H:%M:%S'),
    })
    return vfp.construir_insert(TABLA, campos, vfp.TIPOS_CONCEPFC)


def comando_delete():
    return vfp.construir_delete_por_codigo(TABLA, 'codigo', CODIGO, US_ADD)


def mostrar(titulo, comando):
    print()
    print('-' * 72)
    print('  ' + titulo)
    print('-' * 72)
    print(comando)


def main():
    ap = argparse.ArgumentParser(description='Prueba de escritura contra DEPOFIS (una fila).')
    ap.add_argument('--confirmar', action='store_true',
                    help='ejecuta de verdad; sin esto sólo muestra el comando')
    ap.add_argument('--borrar', action='store_true',
                    help='borra la fila de prueba en vez de crearla')
    args = ap.parse_args()

    ahora = datetime.now()
    if args.borrar:
        comando, que = comando_delete(), 'BORRAR la fila de prueba'
    else:
        comando, que = comando_insert(ahora), 'CREAR la fila de prueba'

    print('=' * 72)
    print('  PRUEBA DE ESCRITURA · DEPOFIS.DASSA.' + TABLA)
    print('=' * 72)
    print('  Servidor : {}'.format(config.DEPOFIS_SERVER))
    print('  Mecanismo: EXEC (...) AT [{}] · pass-through a FoxPro'.format(vfp.LINKED_SERVER))
    print('  Accion   : {}'.format(que))
    mostrar('EL COMANDO', comando)

    if not args.confirmar:
        print()
        print('=' * 72)
        print('  MODO MUESTRA - no se ejecuto nada.')
        print('  Para ejecutarlo:  python scripts/probar_escritura.py{} --confirmar'
              .format(' --borrar' if args.borrar else ''))
        print('=' * 72)
        return 0

    acceso = depofis.AccesoEscritura()
    try:
        # Antes de tocar nada: en qué estado está el código.
        existente = acceso.verificar(TABLA, 'codigo', CODIGO)

        if args.borrar:
            if not existente:
                print()
                print('  El codigo {} no existe: no hay nada que borrar.'.format(CODIGO))
                return 0
            acceso.cursor.execute(comando)
            if acceso.verificar(TABLA, 'codigo', CODIGO):
                print()
                print('  X El comando corrio pero la fila SIGUE ahi.')
                print('    Probable: el us_add no coincide con {!r}, que es el guard'
                      ' del DELETE.'.format(US_ADD))
                return 1
            print()
            print('  OK Fila de prueba borrada y verificada.')
            return 0

        if existente:
            print()
            print('  X ABORTADO: el codigo {} ya existe.'.format(CODIGO))
            print('    Si es la fila de esta prueba, borrala con --borrar --confirmar.')
            return 1

        acceso.cursor.execute(comando)
        print()
        print('  Comando ejecutado sin error. Verificando...')

        # Sin transacciones, "no dio error" no es "entro". Se relee siempre.
        fila = acceso.verificar(TABLA, 'codigo', CODIGO)
        if not fila:
            print('  X El comando no fallo pero la fila NO esta. No se escribio nada.')
            return 1

        print('  OK FILA CREADA Y VERIFICADA en DEPOFIS.')
        print()
        # Se recorre por índice y no con zip(): una Row de pyodbc se indexa como
        # una tupla en runtime, pero su stub de tipos no declara __iter__ y el
        # type checker marca el zip como error.
        cols = [d[0] for d in acceso.cursor.description]
        for i, nombre in enumerate(cols):
            valor = fila[i]
            texto = '' if valor is None else str(valor).strip()
            if texto and texto != '0':
                print('    {:12s} = {!r}'.format(nombre, valor))
        print()
        print('  Para dejar la tabla como estaba:')
        print('    python scripts/probar_escritura.py --borrar --confirmar')
        return 0
    except Exception as e:
        # Sin rollback: el linked server no soporta transacciones. Si fallo, no
        # entro nada; si entro, ya es definitivo.
        print()
        print('  X Fallo: {}'.format(e))
        return 1
    finally:
        acceso.cerrar()


if __name__ == '__main__':
    sys.exit(main())
