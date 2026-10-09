# -*- coding: utf-8 -*-
"""Tests de las reglas de negocio.

    python -m unittest sincro.test_reglas -v

Corren sin credenciales y sin red: `reglas.py` es un módulo puro. Es lo que
permite verificar el criterio en cualquier máquina, incluso sin VPN.
"""

import unittest

from sincro import reglas


class TestVendedor(unittest.TestCase):
    """Código de DEPOFIS → Salesperson + Cliente DASSA."""

    def test_los_seis_comerciales_en_los_dos_sentidos(self):
        esperado = {
            6:  (3, 13),   # Manuel de la Arena
            7:  (4, 14),   # Santiago Aguirre Oliva
            8:  (6, 16),   # Francisco Urtubey
            11: (7, 17),   # Guillermo Jorge
            12: (8, 18),   # Alexis Dalpra
            13: (5, 15),   # Enzo Nieto
        }
        for uid, (propio, institucional) in esperado.items():
            r = reglas.vendedor_desde_depofis(propio)
            self.assertEqual((r.uid, r.es_dassa), (uid, False), 'propio {}'.format(propio))
            r = reglas.vendedor_desde_depofis(institucional)
            self.assertEqual((r.uid, r.es_dassa), (uid, True), 'institucional {}'.format(institucional))

    def test_institucional_es_propio_mas_diez(self):
        for v in reglas.VENDEDOR_MAP.values():
            self.assertEqual(v.institucional, v.propio + 10, v.nombre)

    def test_cero_queda_sin_salesperson(self):
        r = reglas.vendedor_desde_depofis(0)
        self.assertIsNone(r.uid)
        self.assertIsNone(r.es_dassa)
        self.assertIn('código 0', r.motivo)

    def test_vendedores_sin_usuario_en_odoo_no_inventan(self):
        for codigo in (1, 2, 9, 19):
            r = reglas.vendedor_desde_depofis(codigo)
            self.assertIsNone(r.uid, codigo)
            self.assertIn('no tiene usuario en Odoo', r.motivo)

    def test_none_no_explota(self):
        self.assertIsNone(reglas.vendedor_desde_depofis(None).uid)

    def test_el_mapa_serializado_no_pierde_nada(self):
        m = reglas.vendedor_map_serializable()
        self.assertEqual(set(m), {str(u) for u in reglas.VENDEDOR_MAP})
        self.assertEqual(m['13'], {'nombre': 'Enzo Nieto', 'propio': 5, 'institucional': 15})


class TestIva(unittest.TestCase):

    def test_equivalencias_directas(self):
        self.assertEqual(reglas.iva_a_odoo(1), 1)
        self.assertEqual(reglas.iva_a_odoo(3), 5)
        self.assertEqual(reglas.iva_a_odoo(4), 6)
        self.assertEqual(reglas.iva_a_odoo(6), 4)

    def test_sin_equivalencia_queda_vacio(self):
        for codigo in (0, 5, 12, None):
            self.assertIsNone(reglas.iva_a_odoo(codigo), codigo)


class TestCuit(unittest.TestCase):

    def test_valido(self):
        # CUITs reales de clientes de la corrida del 2026-10-09
        self.assertTrue(reglas.cuit_valido('30-66314822-9'))   # NATI TEXTIL
        self.assertTrue(reglas.cuit_valido('30710023782'))     # TRAFORLOG SRL

    def test_digito_verificador_mal(self):
        self.assertFalse(reglas.cuit_valido('30-66314822-8'))

    def test_largo_mal_o_vacio(self):
        for v in ('', None, '20123456', '301234567890'):
            self.assertFalse(reglas.cuit_valido(v), v)

    def test_formatea(self):
        self.assertEqual(reglas.formatear_cuit('30663148229'), '30-66314822-9')
        self.assertEqual(reglas.formatear_cuit('123'), '123')


class TestDecidirCliente(unittest.TestCase):
    CUIT = '30663148229'

    def decidir(self, codigos=(), partners=None, clie_nro=2039, cuit=CUIT):
        return reglas.decidir_cliente(clie_nro, cuit, set(codigos), partners or {})

    def test_ya_vinculado_no_se_toca(self):
        d = self.decidir(codigos={'2039'}, partners={self.CUIT: [{'id': 1, 'depofis_code': '2039'}]})
        self.assertEqual(d.accion, 'sin_cambios')

    def test_no_existe_en_odoo_es_alta(self):
        self.assertEqual(self.decidir().accion, 'alta')

    def test_un_contacto_sin_codigo_se_vincula(self):
        d = self.decidir(partners={self.CUIT: [{'id': 77, 'depofis_code': False, 'active': True}]})
        self.assertEqual((d.accion, d.partner_id), ('vincular', 77))

    def test_cuit_invalido_se_omite(self):
        d = self.decidir(cuit='30663148228')
        self.assertEqual(d.accion, 'omitido')
        self.assertIn('CUIT inválido', d.motivo)

    def test_cuit_vinculado_a_otro_codigo_no_se_vincula(self):
        d = self.decidir(partners={self.CUIT: [{'id': 5, 'depofis_code': '318', 'active': True},
                                               {'id': 6, 'depofis_code': False, 'active': True}]})
        self.assertEqual(d.accion, 'omitido')
        self.assertIn('318', d.motivo)

    def test_dos_contactos_sin_codigo_es_ambiguo(self):
        d = self.decidir(partners={self.CUIT: [{'id': 5, 'depofis_code': False, 'active': True},
                                               {'id': 6, 'depofis_code': False, 'active': True}]})
        self.assertEqual(d.accion, 'omitido')
        self.assertIn('duplicados en Odoo', d.motivo)

    def test_archivado_no_se_vincula(self):
        d = self.decidir(partners={self.CUIT: [{'id': 5, 'depofis_code': False, 'active': False}]})
        self.assertEqual(d.accion, 'omitido')
        self.assertIn('archivado', d.motivo)

    def test_un_activo_y_uno_archivado_vincula_el_activo(self):
        d = self.decidir(partners={self.CUIT: [{'id': 5, 'depofis_code': False, 'active': False},
                                               {'id': 6, 'depofis_code': False, 'active': True}]})
        self.assertEqual((d.accion, d.partner_id), ('vincular', 6))


class TestCompletarVacios(unittest.TestCase):

    def test_solo_escribe_lo_vacio(self):
        actual = {'street': 'Calle 1', 'city': False, 'user_id': [11, 'Guillermo'], 'email': ''}
        deseado = {'depofis_code': '2039', 'street': 'Otra 2', 'city': 'CABA',
                   'user_id': 13, 'is_dassa': True, 'email': 'a@b.com'}
        vals = reglas.completar_vacios(actual, deseado)
        self.assertEqual(vals, {'depofis_code': '2039', 'city': 'CABA', 'email': 'a@b.com'})

    def test_is_dassa_sigue_al_salesperson(self):
        vals = reglas.completar_vacios({'user_id': False}, {'user_id': 13, 'is_dassa': True})
        self.assertEqual(vals, {'user_id': 13, 'is_dassa': True})

    def test_no_manda_valores_vacios(self):
        vals = reglas.completar_vacios({'city': False}, {'depofis_code': '1', 'city': ''})
        self.assertEqual(vals, {'depofis_code': '1'})

    def test_many2many_vacio_se_completa(self):
        vals = reglas.completar_vacios({'category_id': []}, {'category_id': [(6, 0, [35])]})
        self.assertEqual(vals, {'category_id': [(6, 0, [35])]})


class TestExcluirConcepto(unittest.TestCase):

    def test_conceptos_reales_entran(self):
        for codigo, detalle in ((30339, 'TOMA DE CONTENIDO'),
                                (30065, 'ALMACENAJE DE VEHÍCULO X DIA (MOTO)'),
                                (20604, 'VERIFICACION SENASA')):
            self.assertIsNone(reglas.excluir_concepto(codigo, detalle), codigo)

    def test_separador(self):
        self.assertIn('Separador', reglas.excluir_concepto(40000, '------E.P IMPORTACION MARITIMA------'))

    def test_sin_detalle_y_codigo_cero(self):
        self.assertIsNotNone(reglas.excluir_concepto(20007, ''))
        self.assertIsNotNone(reglas.excluir_concepto(0, 'N/D'))

    def test_no_usar(self):
        self.assertIsNotNone(reglas.excluir_concepto(1000, 'NO USAR!!!'))
        self.assertIsNotNone(reglas.excluir_concepto(2356656, 'RE-ACONDICION DE PALLET O BULTO NO USAR'))

    def test_testing_y_borrados(self):
        self.assertIn('TESTING', reglas.excluir_concepto(999999, 'TESTING FACUNDO'))
        self.assertIn('borrado', reglas.excluir_concepto(30001, 'ALGO', us_del='12'))


if __name__ == '__main__':
    unittest.main()
