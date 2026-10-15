"""Nodo «Pregunta»: semáforo de suficiencia, id estable, prompt y citas (lógica pura)."""
import unittest

import preguntas as pr

CITA, VETO = 0.86, 0.784


def pasaje(sim, node="d1", cid=None, page=None):
    return {"chunk_id": cid or f"c{sim}{node}", "node_id": node, "label": f"Doc {node}", "page": page,
            "texto": f"texto de {node}", "sim": sim}


class SemaforoTests(unittest.TestCase):
    def test_verde_con_dos_citables(self):
        s = pr.semaforo([pasaje(0.9, "a"), pasaje(0.88, "b"), pasaje(0.7)], CITA, VETO)
        self.assertEqual((s["color"], s["citables"]), ("verde", 2))
        self.assertIn("2 fragmentos de 2 documentos", s["motivo"])

    def test_amarillo_con_uno_o_cerca(self):
        self.assertEqual(pr.semaforo([pasaje(0.9), pasaje(0.8)], CITA, VETO)["color"], "amarillo")
        cerca = pr.semaforo([pasaje(0.83)], CITA, VETO)
        self.assertEqual((cerca["color"], cerca["citables"]), ("amarillo", 0))

    def test_rojo_sin_evidencia(self):
        self.assertEqual(pr.semaforo([pasaje(0.79)], CITA, VETO)["color"], "rojo")
        self.assertEqual(pr.semaforo([], CITA, VETO)["color"], "rojo")

    def test_el_motivo_no_compara_porcentajes(self):
        # el agente decía «86 %, debajo del 86 %» por el redondeo
        for ps in ([pasaje(0.857)], [pasaje(0.9), pasaje(0.91)], []):
            self.assertNotIn("%", pr.semaforo(ps, CITA, VETO)["motivo"])


class IdYPromptTests(unittest.TestCase):
    def test_id_estable_y_por_alcance(self):
        a = pr.id_pregunta("¿Qué es el Cost of Carry?", "finanzas")
        self.assertEqual(a, pr.id_pregunta("¿Qué es el   cost of carry?", "finanzas"))
        self.assertNotEqual(a, pr.id_pregunta("¿Qué es el Cost of Carry?", "*"))
        self.assertTrue(a.startswith("pregunta_que_es_el_cost_of_carry_"))

    def test_prompt_usa_primero_los_citables_y_numera(self):
        ps = [pasaje(0.7, "x"), pasaje(0.9, "a", page=12), pasaje(0.88, "b")]
        prompt, usados = pr.armar_prompt("¿Qué?", ps, CITA)
        self.assertEqual([p["node_id"] for p in usados], ["a", "b"])
        self.assertIn("[1] «Doc a», pág. 12", prompt)
        self.assertIn("Falta:", prompt)
        _, sin_citables = pr.armar_prompt("¿Qué?", [pasaje(0.7, "x"), pasaje(0.6, "y")], CITA)
        self.assertEqual(len(sin_citables), 2)                         # sin citables, los mejores igual

    def test_citas_usadas(self):
        self.assertEqual(pr.citas_usadas("Uno [2] dos [1][2] tres [9].", 3), [2, 1])

    def test_cambio_de_evidencia(self):
        a = [pasaje(0.9, cid="c1"), pasaje(0.9, cid="c2")]
        b = [pasaje(0.9, cid="c2"), pasaje(0.9, cid="c3")]
        self.assertEqual(pr.cambio_de_evidencia(a, b), {"entraron": 1, "salieron": 1, "cambio": True})
        self.assertFalse(pr.cambio_de_evidencia(a, list(reversed(a)))["cambio"])


if __name__ == "__main__":
    unittest.main()
