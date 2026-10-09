# -*- coding: utf-8 -*-
"""Tests de la guarda de escritura de Odoo.

    python -m unittest sincro.test_odoo_client -v

No tocan la red: cada caso tiene que levantar PermissionError ANTES de
conectar. Si alguno llegara a conectarse, es que la guarda se rompió.
"""

import unittest

from sincro import odoo_client as odoo


class TestGuardaEscritura(unittest.TestCase):

    def setUp(self):
        odoo._escritura_habilitada = False

    def tearDown(self):
        odoo._escritura_habilitada = False

    def test_sin_habilitar_no_crea(self):
        with self.assertRaises(PermissionError):
            odoo.crear('res.partner', {'name': 'X'})

    def test_sin_habilitar_no_escribe(self):
        with self.assertRaises(PermissionError):
            odoo.escribir('res.partner', [1], {'depofis_code': '1'})

    def test_modelo_no_permitido(self):
        odoo.habilitar_escritura()
        with self.assertRaises(PermissionError):
            odoo.crear('account.move', {'name': 'X'})
        with self.assertRaises(PermissionError):
            odoo.escribir('product.template', [1], {'name': 'X'})

    def test_campo_no_permitido(self):
        odoo.habilitar_escritura()
        # A un contacto existente no se le cambia la identidad.
        for campo in ('name', 'vat', 'active'):
            with self.assertRaises(PermissionError, msg=campo):
                odoo.escribir('res.partner', [1], {campo: 'X'})
        with self.assertRaises(PermissionError):
            odoo.crear('res.partner', {'name': 'X', 'property_account_receivable_id': 5})

    def test_lectura_rechaza_metodos_de_escritura(self):
        for metodo in ('write', 'create', 'unlink'):
            with self.assertRaises(PermissionError, msg=metodo):
                odoo._execute_kw('res.partner', metodo, [])


if __name__ == '__main__':
    unittest.main()
