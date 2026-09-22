"""Edición manual desde la UI: campos editables de un nodo, mover nodos de sección
y secciones que persisten vacías."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from fastapi import HTTPException

from main import NodesMove, _campos_editables, _nombre_seccion, move_nodes


class NombreSeccionTest(unittest.TestCase):
    def test_normaliza_espacios_y_minusculas(self):
        self.assertEqual(_nombre_seccion("  Tesis   Maestría "), "tesis maestría")

    def test_vacio_se_rechaza(self):
        with self.assertRaises(ValueError):
            _nombre_seccion("   ")

    def test_demasiado_largo_se_rechaza(self):
        with self.assertRaises(ValueError):
            _nombre_seccion("x" * 61)


class CamposEditablesTest(unittest.TestCase):
    def test_solo_pasan_los_campos_permitidos(self):
        cambios = _campos_editables({"label": " Nuevo  título ", "autor": "Ana", "dominio": "otra", "embedding": [1]})
        self.assertEqual(cambios, {"label": "Nuevo título", "autor": "Ana"})

    def test_autor_o_tema_vacios_quedan_en_null(self):
        self.assertEqual(_campos_editables({"autor": "", "tema": "  "}), {"autor": None, "tema": None})

    def test_el_titulo_no_puede_quedar_vacio(self):
        with self.assertRaises(ValueError):
            _campos_editables({"label": "   "})

    def test_sin_campos_editables_es_error(self):
        with self.assertRaises(ValueError):
            _campos_editables({"dominio": "otra"})

    def test_tipo_invalido_se_rechaza(self):
        with self.assertRaises(ValueError):
            _campos_editables({"autor": 42})

    def test_largo_maximo(self):
        with self.assertRaises(ValueError):
            _campos_editables({"tema": "t" * 121})


class MoverNodosTest(unittest.TestCase):
    def _db(self, movidos):
        db = SimpleNamespace()
        # 1ª llamada: UPDATE (rowcount); 2ª: SELECT de la sección destino (no existe → se crea)
        db.execute = AsyncMock(side_effect=[
            SimpleNamespace(rowcount=movidos),
            SimpleNamespace(scalar_one_or_none=lambda: None),
        ])
        db.add = Mock()
        db.commit = AsyncMock()
        return db

    def test_mueve_y_registra_la_seccion_destino(self):
        db = self._db(2)
        salida = asyncio.run(move_nodes(NodesMove(ids=["a", "b", "a"], seccion=" Finanzas "), db))
        self.assertEqual(salida["seccion"], "finanzas")
        self.assertEqual(salida["movidos"], 2)
        self.assertEqual(salida["pedidos"], 2)          # ids duplicados no cuentan dos veces
        self.assertEqual(db.add.call_args[0][0].nombre, "finanzas")
        db.commit.assert_awaited()

    def test_sin_ids_es_400(self):
        with self.assertRaises(HTTPException) as caso:
            asyncio.run(move_nodes(NodesMove(ids=[], seccion="x"), self._db(0)))
        self.assertEqual(caso.exception.status_code, 400)

    def test_seccion_vacia_es_400(self):
        with self.assertRaises(HTTPException) as caso:
            asyncio.run(move_nodes(NodesMove(ids=["a"], seccion="  "), self._db(0)))
        self.assertEqual(caso.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
