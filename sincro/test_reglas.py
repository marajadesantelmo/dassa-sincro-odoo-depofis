# -*- coding: utf-8 -*-
"""Tests de las reglas de negocio.

    python -m unittest sincro.test_reglas -v

Corren sin credenciales y sin red: `reglas.py` es un módulo puro. Es lo que
permite verificar el criterio de vendedor en cualquier máquina, incluso sin VPN.
"""

import unittest

from sincro import reglas


class TestVendedor(unittest.TestCase):
    """El criterio que pidió el proyecto: propio vs institucional según is_dassa."""

    def test_enzo_propio_es_5(self):
        r = reglas.resolver_vendedor((13, 'Enzo Nieto'), False)
        self.assertEqual(r.codigo, 5)
        self.assertEqual(r.uid, 13)

    def test_enzo_dassa_es_15(self):
        r = reglas.resolver_vendedor((13, 'Enzo Nieto'), True)
        self.assertEqual(r.codigo, 15)

    def test_los_seis_comerciales(self):
        """El mapa completo, tal como se verificó contra los 1951 clientes ya
        vinculados el 2026-09-07."""
        esperado = {
            6:  (3, 13),   # Manuel de la Arena
            7:  (4, 14),   # Santiago Aguirre Oliva
            8:  (6, 16),   # Francisco Urtubey
            11: (7, 17),   # Guillermo Jorge
            12: (8, 18),   # Alexis Dalpra
            13: (5, 15),   # Enzo Nieto
        }
        for uid, (propio, institucional) in esperado.items():
            self.assertEqual(reglas.resolver_vendedor((uid, 'x'), False).codigo, propio,
                             'código propio de uid {}'.format(uid))
            self.assertEqual(reglas.resolver_vendedor((uid, 'x'), True).codigo, institucional,
                             'código institucional de uid {}'.format(uid))

    def test_institucional_es_propio_mas_diez(self):
        """La regla observada en los datos. Si un día entra un comercial que no
        la cumpla, este test se cae y obliga a mirarlo — que es la intención."""
        for uid, v in reglas.VENDEDOR_MAP.items():
            self.assertEqual(v.institucional, v.propio + 10,
                             'uid {} ({}) rompe la regla propio+10'.format(uid, v.nombre))

    def test_sin_salesperson_no_inventa(self):
        """El 0 de DEPOFIS es un código real (523 clientes), no 'sin vendedor'.
        Sin Salesperson tiene que quedar None."""
        r = reglas.resolver_vendedor(False, False)
        self.assertIsNone(r.codigo)
        self.assertIn('no tiene Salesperson', r.motivo)

    def test_usuario_fuera_del_mapa_no_inventa(self):
        """María Delgado (uid 9) es usuaria de Odoo pero no es comercial: no
        tiene par de códigos y no se le puede asignar uno."""
        r = reglas.resolver_vendedor((9, 'Maria Delgado'), False)
        self.assertIsNone(r.codigo)
        self.assertEqual(r.uid, 9)
        self.assertIn('no está en el mapeo', r.motivo)

    def test_el_mapa_serializado_no_pierde_nada(self):
        d = reglas.vendedor_map_serializable()
        self.assertEqual(len(d), len(reglas.VENDEDOR_MAP))
        self.assertEqual(d['13'], {'nombre': 'Enzo Nieto', 'propio': 5, 'institucional': 15})


class TestCuit(unittest.TestCase):

    def test_formatea_con_guiones(self):
        self.assertEqual(reglas.formatear_cuit('30714088811'), ('30-71408881-1', True))

    def test_acepta_el_que_ya_viene_con_guiones(self):
        self.assertEqual(reglas.formatear_cuit('30-71408881-1'), ('30-71408881-1', True))

    def test_marca_invalido_el_que_no_tiene_11_digitos(self):
        _, ok = reglas.formatear_cuit('123')
        self.assertFalse(ok)

    def test_vacio_no_explota(self):
        self.assertEqual(reglas.formatear_cuit(None), ('', False))
        self.assertEqual(reglas.formatear_cuit(False), ('', False))


class TestIva(unittest.TestCase):

    def test_responsable_inscripto(self):
        self.assertEqual(reglas.resolver_iva((1, 'IVA Responsable Inscripto')), (1, False))

    def test_vacio_asume_responsable_inscripto(self):
        self.assertEqual(reglas.resolver_iva(False), (reglas.IVA_DEFAULT, False))

    def test_los_aproximados_se_marcan(self):
        """Cliente del Exterior no tiene equivalente directo: se mapea por
        criterio y la fila tiene que quedar marcada para revisar."""
        codigo, aprox = reglas.resolver_iva((9, 'Cliente del Exterior'))
        self.assertEqual(codigo, 5)
        self.assertTrue(aprox)

    def test_id_desconocido_cae_al_default_pero_marcado(self):
        codigo, aprox = reglas.resolver_iva((999, 'Categoría nueva de ARCA'))
        self.assertEqual(codigo, reglas.IVA_DEFAULT)
        self.assertTrue(aprox)


class TestCalcula(unittest.TestCase):

    def test_almacenaje_de_contenedor_es_por_dias(self):
        self.assertEqual(reglas.resolver_calcula('Almacenaje Contenedor 40HC'), ('Dias', False))

    def test_almacenaje_de_mercaderia_multiplica_volumen(self):
        self.assertEqual(reglas.resolver_calcula('Almacenaje de Mercadería'), ('Dias * M3', False))

    def test_producto_comun_no_calcula_nada(self):
        self.assertEqual(reglas.resolver_calcula('Movimiento de Contenedor'), ('Nada', False))

    def test_habla_de_dias_pero_no_es_almacenaje_se_marca(self):
        """El caso real que motivó la marca: cae fuera de almacenaje_mask, así
        que no se adivina la unidad — se deja en Nada y se avisa."""
        calcula, revisar = reglas.resolver_calcula('Bajada de Mercadería a Piso de 0 a 30 días')
        self.assertEqual(calcula, 'Nada')
        self.assertTrue(revisar)

    def test_nombre_vacio_no_explota(self):
        self.assertEqual(reglas.resolver_calcula(None), ('Nada', False))


class TestCategoria(unittest.TestCase):

    MAPA = {10: 'TELAS / HILADOS / RO', 20: 'AUTOMOTRIZ'}

    def test_toma_la_que_matchea(self):
        self.assertEqual(reglas.resolver_categoria([99, 10], self.MAPA), ('TELAS / HILADOS / RO', False))

    def test_sin_ninguna_valida_devuelve_none(self):
        self.assertEqual(reglas.resolver_categoria([99], self.MAPA), (None, False))

    def test_con_dos_validas_avisa_que_eligio(self):
        """DEPOFIS acepta una sola categoría y Odoo permite varias etiquetas:
        elegir la primera es razonable, pero hay que decirlo."""
        nombre, ambiguo = reglas.resolver_categoria([10, 20], self.MAPA)
        self.assertEqual(nombre, 'TELAS / HILADOS / RO')
        self.assertTrue(ambiguo)

    def test_lista_vacia_no_explota(self):
        self.assertEqual(reglas.resolver_categoria(None, self.MAPA), (None, False))
        self.assertEqual(reglas.resolver_categoria([], self.MAPA), (None, False))


class TestAlcance(unittest.TestCase):
    """Clientes si, proveedores no. Ver reglas.clasificar_alcance."""

    PROV = {'30655116512'}      # EDESUR, en DASSA.Proveed
    CLI = {'30711129142'}       # un cliente, en DASSA.Clientes

    def clasificar(self, **kw):
        args = dict(cuit_digitos='30999999997', customer_rank=0, supplier_rank=0,
                    tiene_salesperson=False, es_dassa=False, tiene_categoria_depofis=False)
        args.update(kw)
        return reglas.clasificar_alcance(
            args['cuit_digitos'], args['customer_rank'], args['supplier_rank'],
            args['tiene_salesperson'], args['es_dassa'], args['tiene_categoria_depofis'],
            self.PROV, self.CLI)

    # -- se excluye --------------------------------------------------------
    def test_proveedor_por_rank_queda_fuera(self):
        r = self.clasificar(supplier_rank=3)
        self.assertFalse(r.en_alcance)
        self.assertIn('supplier_rank', r.motivo)

    def test_proveedor_por_estar_en_proveed_queda_fuera(self):
        r = self.clasificar(cuit_digitos='30655116512')
        self.assertFalse(r.en_alcance)
        self.assertIn('DASSA.Proveed', r.motivo)

    # -- NO se excluye: la evidencia de cliente gana ------------------------
    def test_customer_rank_lo_rescata(self):
        """El caso de los 4 que un filtro crudo por supplier_rank habria perdido."""
        self.assertTrue(self.clasificar(supplier_rank=3, customer_rank=1).en_alcance)

    def test_salesperson_lo_rescata(self):
        self.assertTrue(self.clasificar(supplier_rank=3, tiene_salesperson=True).en_alcance)

    def test_is_dassa_lo_rescata(self):
        self.assertTrue(self.clasificar(supplier_rank=3, es_dassa=True).en_alcance)

    def test_categoria_depofis_lo_rescata(self):
        self.assertTrue(self.clasificar(supplier_rank=3, tiene_categoria_depofis=True).en_alcance)

    def test_estar_en_clientes_le_gana_a_todo(self):
        """Si ya esta en DASSA.Clientes es un cliente, aunque Odoo lo trate de
        proveedor. Lo que corresponde es la omision "falta vincular el
        depofis_code", que si es trabajo pendiente."""
        r = self.clasificar(cuit_digitos='30711129142', supplier_rank=9)
        self.assertTrue(r.en_alcance)
        self.assertIn('DASSA.Clientes', r.motivo)

    def test_ambos_deja_constancia(self):
        """Comprado y vendido a la vez: entra, pero la fila lo dice."""
        r = self.clasificar(supplier_rank=3, tiene_salesperson=True)
        self.assertTrue(r.en_alcance)
        self.assertIsNotNone(r.motivo)

    # -- el caso normal ----------------------------------------------------
    def test_cliente_comun_entra_sin_motivo(self):
        r = self.clasificar(tiene_salesperson=True)
        self.assertTrue(r.en_alcance)
        self.assertIsNone(r.motivo)

    def test_sin_ninguna_senal_entra(self):
        """Un contacto del que no se sabe nada NO es un proveedor. La asimetria
        es deliberada: dejar entrar un proveedor cuesta una fila de ruido,
        dejar afuera un cliente cuesta un alta que nunca se hace."""
        r = self.clasificar()
        self.assertTrue(r.en_alcance)
        self.assertIsNone(r.motivo)

    def test_cuit_vacio_no_explota(self):
        self.assertTrue(self.clasificar(cuit_digitos='').en_alcance)
        self.assertTrue(self.clasificar(cuit_digitos=None).en_alcance)

    def test_ranks_none_no_explotan(self):
        self.assertTrue(self.clasificar(customer_rank=None, supplier_rank=None).en_alcance)


if __name__ == '__main__':
    unittest.main()
