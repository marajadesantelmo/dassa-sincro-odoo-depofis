# -*- coding: utf-8 -*-
"""Publica la corrida en la app (`/api/servicio/*`).

`urllib` de la stdlib, no `requests`: son tres POST y la red de la oficina
rompe `pip install` igual que rompe `npm install` (FortiGate + inspección SSL,
ver CLAUDE.md del workspace).

Si la app no responde, la corrida NO se aborta: se sigue y se guarda el
resultado en un .json local. La rutina existe para saber qué pasa entre Odoo y
DEPOFIS; que la ventana esté caída no es motivo para no mirar. Lo que sí se
hace es gritarlo en el log y dejar el archivo con el nombre de la corrida, para
poder republicarla después.
"""

import json
import os
import urllib.error
import urllib.request

from . import config


class ErrorPublicacion(Exception):
    pass


def _post(ruta, cuerpo, token, timeout=30):
    url = config.SINCRO_API_URL.rstrip('/') + ruta
    datos = json.dumps(cuerpo, ensure_ascii=False, default=str).encode('utf-8')
    req = urllib.request.Request(url, data=datos, method='POST', headers={
        'Content-Type': 'application/json',
        'x-sincro-odoo-depofis-token': token,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as e:
        detalle = ''
        try:
            detalle = json.loads(e.read()).get('message', '')
        except Exception:
            pass
        raise ErrorPublicacion('{} {} → HTTP {} {}'.format('POST', ruta, e.code, detalle))
    except Exception as e:
        raise ErrorPublicacion('{} {} → {}'.format('POST', ruta, e))


class Publicador:
    """Abre la corrida, le manda las novedades por lotes y la cierra.

    `LOTE = 400` para que el body quede holgadamente abajo del límite de 4 MB
    del server aun con payloads grandes.
    """

    LOTE = 400

    def __init__(self, salida_local=None):
        self.token = config.valor('SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN')
        self.corrida_id = None
        self.activo = bool(self.token)
        self.salida_local = salida_local
        self.novedades = []
        if not self.activo:
            print('[publicar] ⚠ SINCRO_ODOO_DEPOFIS_SERVICE_TOKEN no configurado: '
                  'la corrida NO se va a publicar en la app.')

    def abrir(self, cabecera):
        self.cabecera = cabecera
        if not self.activo:
            return None
        try:
            r = _post('/api/servicio/corridas', cabecera, self.token)
            self.corrida_id = r['corrida']['id']
            print('[publicar] corrida {} abierta en la app'.format(self.corrida_id))
        except ErrorPublicacion as e:
            self.activo = False
            print('[publicar] ⚠ no se pudo abrir la corrida: {}'.format(e))
            print('[publicar]   la rutina sigue; el resultado queda en el .json local.')
        return self.corrida_id

    def agregar(self, novedad):
        """Acumula una novedad. Se guardan todas para el .json local aunque la
        publicación esté caída — ese archivo es el respaldo."""
        self.novedades.append(novedad)

    def enviar_pendientes(self):
        if not self.activo or not self.corrida_id:
            return
        for i in range(0, len(self.novedades), self.LOTE):
            lote = self.novedades[i:i + self.LOTE]
            try:
                _post('/api/servicio/corridas/{}/novedades'.format(self.corrida_id),
                      {'novedades': lote}, self.token, timeout=60)
                print('[publicar]   lote de {} novedades enviado'.format(len(lote)))
            except ErrorPublicacion as e:
                self.activo = False
                print('[publicar] ⚠ falló el envío de un lote: {}'.format(e))
                return

    def cerrar(self, estado, totales, error=None):
        self.enviar_pendientes()
        if self.activo and self.corrida_id:
            try:
                _post('/api/servicio/corridas/{}/cerrar'.format(self.corrida_id),
                      {'estado': estado, 'totales': totales, 'error': error}, self.token)
                print('[publicar] corrida {} cerrada como "{}"'.format(self.corrida_id, estado))
            except ErrorPublicacion as e:
                print('[publicar] ⚠ no se pudo cerrar la corrida: {}'.format(e))
        self._guardar_local(estado, totales, error)

    def _guardar_local(self, estado, totales, error):
        """El respaldo en disco. Se escribe SIEMPRE, publicada o no: es lo que
        permite republicar una corrida cuya app estaba caída, y lo que queda
        cuando alguien corre la rutina a mano desde su máquina."""
        if not self.salida_local:
            return
        os.makedirs(os.path.dirname(self.salida_local), exist_ok=True)
        with open(self.salida_local, 'w', encoding='utf-8') as f:
            json.dump({
                'corrida': dict(self.cabecera, id=self.corrida_id, estado=estado,
                                totales=totales, error=error),
                'novedades': self.novedades,
            }, f, ensure_ascii=False, indent=2, default=str)
        print('[publicar] respaldo local: {}'.format(self.salida_local))
