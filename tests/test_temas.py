"""Temas por sección: agrupado completo, ubicación de lo nuevo y secciones chicas."""
import unittest

import numpy as np

from embeddings_engine import MIN_DOCS_TEMAS, calcular_temas


def _manchas(seccion, centros, por_mancha, rng, prefijo):
    """Documentos alrededor de unos centros bien separados (temas evidentes)."""
    nodos = []
    for k, c in enumerate(centros):
        for j in range(por_mancha):
            v = c + rng.standard_normal(len(c)) * 0.05
            nodos.append({"id": f"{prefijo}{k}_{j}", "dominio": seccion, "embedding": v.tolist(), "cluster": -1})
    return nodos


class TemasPorSeccionTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(3)
        self.rng = rng
        self.centros = [np.eye(32)[i] * 3 + rng.standard_normal(32) * 0.1 for i in (0, 8, 16)]

    def test_seccion_chica_no_arma_temas(self):
        nodos = _manchas("chica", self.centros[:1], MIN_DOCS_TEMAS - 1, self.rng, "c")
        resumen = calcular_temas(nodos, reagrupar=True, ids_nuevos=set())
        self.assertEqual(resumen["chica"], 0)
        self.assertTrue(all(n["cluster"] == -1 for n in nodos))

    def test_reagrupar_separa_temas_y_los_ids_no_se_pisan_entre_secciones(self):
        a = _manchas("a", self.centros, 15, self.rng, "a")
        b = _manchas("b", self.centros, 15, self.rng, "b")
        resumen = calcular_temas(a + b, reagrupar=True, ids_nuevos=set())
        self.assertGreaterEqual(resumen["a"], 2)
        ids_a = {n["cluster"] for n in a if n["cluster"] >= 0}
        ids_b = {n["cluster"] for n in b if n["cluster"] >= 0}
        self.assertFalse(ids_a & ids_b)

    def test_lo_nuevo_se_suma_al_tema_cercano_sin_mover_lo_demas(self):
        nodos = _manchas("a", self.centros, 15, self.rng, "a")
        calcular_temas(nodos, reagrupar=True, ids_nuevos=set())
        antes = {n["id"]: n["cluster"] for n in nodos}
        referencia = next(n for n in nodos if n["cluster"] >= 0)
        # El documento nuevo es el «típico» de ese tema: el promedio de sus miembros.
        tipico = np.mean([n["embedding"] for n in nodos if n["cluster"] == referencia["cluster"]], axis=0)
        nuevo = {"id": "nuevo", "dominio": "a", "cluster": -1, "embedding": tipico.tolist()}
        calcular_temas(nodos + [nuevo], reagrupar=False, ids_nuevos={"nuevo"})
        self.assertEqual({n["id"]: n["cluster"] for n in nodos}, antes)
        self.assertEqual(nuevo["cluster"], referencia["cluster"])

    def test_el_tema_cero_cuenta_como_tema(self):
        nodos = _manchas("a", self.centros, 15, self.rng, "a")
        calcular_temas(nodos, reagrupar=True, ids_nuevos=set())
        self.assertIn(0, {n["cluster"] for n in nodos})
        antes = [n["cluster"] for n in nodos]
        # Sin nada nuevo y sin reagrupar, nadie cambia (antes el tema 0 se tomaba como «sin tema»).
        calcular_temas(nodos, reagrupar=False, ids_nuevos=set())
        self.assertEqual([n["cluster"] for n in nodos], antes)


if __name__ == "__main__":
    unittest.main()
