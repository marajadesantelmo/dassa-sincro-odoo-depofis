#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Aplica las migraciones de `sql/` vía la Management API de Supabase.

    export SUPABASE_MGMT_TOKEN='<el PAT sbp_ del inventario, completo>'
    python3 scripts/aplicar_sql.py            # dry-run: qué archivos y en qué orden
    python3 scripts/aplicar_sql.py --apply    # las ejecuta

POR QUÉ ESTE SCRIPT Y NO EL `for` CON curl DE sql/README.md
───────────────────────────────────────────────────────────
Ese usa `jq` para armar el JSON, y **app01 no tiene jq**. Python3 sí está, y de
paso el script hace tres cosas que el bucle de shell no hacía:

  · **corta en el primer error** en vez de seguir aplicando migraciones sobre un
    schema a medio crear;
  · **no imprime el token** ni lo deja en el historial del shell;
  · avisa si una migración ya estaba aplicada, en vez de tratar el error como
    fatal (las migraciones son idempotentes: `IF NOT EXISTS`, `OR REPLACE`).

Sin dependencias: urllib de la stdlib.
"""

import argparse
import glob
import json
import os
import sys
import urllib.error
import urllib.request

PROYECTO = 'txlotccsiqaypkzobkxm'   # smart-dassa-central
API = 'https://api.supabase.com/v1/projects/{}/database/query'.format(PROYECTO)

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ⚠️ `api.supabase.com` está detrás de Cloudflare, que bloquea por firma del
# cliente. Con el User-Agent que manda urllib por default
# (`Python-urllib/3.10`) responde:
#
#     HTTP 403 · error code: 1010
#
# que NO es un problema del token ni de permisos — es Cloudflare rechazando el
# cliente antes de que la request llegue a Supabase. Por eso el bucle con `curl`
# de las otras apps sí funciona: curl manda su propio UA y no está en la lista.
# Verificado desde app01 el 2026-09-07.
USER_AGENT = 'curl/8.5.0'


def ejecutar(sql, token):
    """Manda una sentencia. Devuelve (ok, detalle)."""
    datos = json.dumps({'query': sql}).encode('utf-8')
    req = urllib.request.Request(API, data=datos, method='POST', headers={
        'Authorization': 'Bearer {}'.format(token),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return True, (r.read() or b'').decode('utf-8', 'replace')[:400]
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode('utf-8', 'replace')
        try:
            cuerpo = json.loads(cuerpo).get('message', cuerpo)
        except Exception:
            pass
        if e.code == 403 and '1010' in cuerpo:
            cuerpo = ('Cloudflare rechazó el cliente (error 1010). No es el token: '
                      'es el User-Agent. Revisá la constante USER_AGENT de este script.')
        return False, 'HTTP {} · {}'.format(e.code, cuerpo[:400])
    except Exception as e:
        return False, str(e)[:400]


def main():
    ap = argparse.ArgumentParser(description='Aplica sql/*.sql vía la Management API.')
    ap.add_argument('--apply', action='store_true', help='ejecuta; sin esto sólo lista')
    args = ap.parse_args()

    archivos = sorted(glob.glob(os.path.join(RAIZ, 'sql', '0*.sql')))
    if not archivos:
        print('No hay archivos sql/0*.sql'); return 1

    print('Proyecto: {} (smart-dassa-central)'.format(PROYECTO))
    print('Migraciones, en orden:')
    for f in archivos:
        print('   {:<24} {:>6} bytes'.format(os.path.basename(f), os.path.getsize(f)))

    if not args.apply:
        print('\n(DRY-RUN — no se aplicó nada. Agregá --apply.)')
        return 0

    token = os.environ.get('SUPABASE_MGMT_TOKEN', '').strip()
    if not token.startswith('sbp_'):
        print('\n✗ Falta SUPABASE_MGMT_TOKEN (el PAT sbp_ del inventario).')
        print("  export SUPABASE_MGMT_TOKEN='<el PAT completo>'")
        return 1
    # El placeholder pegado tal cual. Pasaba el startswith('sbp_') y moria 30
    # lineas mas abajo con "HTTP 401 - JWT could not be decoded", que en medio
    # de un deploy encadenado se lee como un problema de permisos y no como
    # "te olvidaste de reemplazar el token". Un PAT real son 40+ caracteres.
    if len(token) < 24 or '.' in token:
        print('\n✗ SUPABASE_MGMT_TOKEN parece un placeholder, no un PAT: {!r}'
              .format(token[:8] + '…'))
        print('  Un PAT de Supabase es "sbp_" seguido de ~40 caracteres.')
        print('  Esta en el inventario del ecosistema; no lo tipees de memoria.')
        return 1

    print()
    for f in archivos:
        nombre = os.path.basename(f)
        with open(f, 'r', encoding='utf-8') as fh:
            sql = fh.read()
        ok, detalle = ejecutar(sql, token)
        if ok:
            print('  ✓ {}'.format(nombre))
        else:
            # 'already exists' no es una falla: las migraciones son idempotentes
            # y re-correrlas tiene que ser inocuo.
            if 'already exists' in detalle.lower():
                print('  = {}  (ya estaba aplicada)'.format(nombre))
                continue
            print('  ✗ {}\n      {}'.format(nombre, detalle))
            print('\n  Se corta acá: no se aplican las siguientes para no dejar')
            print('  el schema a medio crear.')
            return 1

    print('\n✓ Todas las migraciones aplicadas.')
    print('  Siguiente: npm run db:diag')
    return 0


if __name__ == '__main__':
    sys.exit(main())
