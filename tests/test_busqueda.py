import unittest
from unittest.mock import patch

import busqueda
import processor
from main import _mejor_sim


class PalabrasTests(unittest.TestCase):
    def test_saca_acentos_pero_no_la_enie(self):
        self.assertEqual(busqueda.terminos("Análisis del año"), ["analisis", "año"])

    def test_descarta_palabras_vacias(self):
        self.assertEqual(busqueda.terminos("la regresión de los datos"), ["regresion", "datos"])


class BM25Tests(unittest.TestCase):
    def test_un_termino_raro_pesa_mas_que_uno_comun(self):
        textos = ["modelos de datos y más datos", "modelos de datos", "modelo ARIMA para series",
                  "datos de ventas"]
        idx = busqueda.IndiceLexico([(f"c{i}", f"n{i}", "", t) for i, t in enumerate(textos)])
        self.assertEqual(idx.buscar("arima datos", 1)[0][0], "c2")

    def test_sin_coincidencias_no_devuelve_nada(self):
        idx = busqueda.IndiceLexico([("c0", "n0", "Título", "texto cualquiera")])
        self.assertEqual(idx.buscar("inexistente"), [])

    def test_el_titulo_del_documento_cuenta(self):
        idx = busqueda.IndiceLexico([("c0", "n0", "Cost of Carry", "el precio futuro"),
                                     ("c1", "n1", "Otro", "el precio futuro")])
        self.assertEqual(idx.buscar("carry", 1)[0][0], "c0")


class FusionTests(unittest.TestCase):
    def test_rrf_premia_estar_arriba_en_las_dos_listas(self):
        # El ejemplo de siempre: A está 1.º y 2.º, C está 3.º y 1.º → gana A.
        self.assertEqual(busqueda.rrf(["A", "B", "C"], ["C", "A", "D"])[0], "A")

    def test_rrf_con_peso(self):
        self.assertEqual(busqueda.rrf(["A", "B"], ["B", "A"], pesos=[2, 1])[0], "A")

    def test_el_indice_se_rehace_cuando_cambian_los_fragmentos(self):
        busqueda.construir_indice((1, 10), [("c0", "n0", "", "uno")])
        self.assertIsNotNone(busqueda.indice_vigente((1, 10)))
        self.assertIsNone(busqueda.indice_vigente((2, 15)))

    def test_el_umbral_mira_el_mejor_coseno_y_no_el_primero(self):
        """Con el orden híbrido el primero puede haber subido por palabras."""
        self.assertEqual(_mejor_sim([{"sim": 0.70}, {"sim": 0.91}]), 0.91)
        self.assertEqual(_mejor_sim([]), 0.0)


class DocScopedRetrievalTests(unittest.TestCase):
    """Regresión: la búsqueda acotada a un documento debe ser más rápida que la global."""
    
    def test_doc_scoped_cap_es_razonable(self):
        """El cap de chunks para doc-scoped debe ser bajo para mantener latencia baja."""
        from main import DOC_SCOPED_MAX_CHUNKS
        self.assertLessEqual(DOC_SCOPED_MAX_CHUNKS, 50)
        self.assertGreaterEqual(DOC_SCOPED_MAX_CHUNKS, 10)
    
    def test_timeout_agente_es_razonable(self):
        """El timeout del agente debe ser corto para buena UX."""
        from main import AGENT_TIMEOUT_S
        self.assertLessEqual(AGENT_TIMEOUT_S, 20.0)
        self.assertGreaterEqual(AGENT_TIMEOUT_S, 5.0)


class UmbralesPorModeloTests(unittest.TestCase):
    def test_cada_modelo_tiene_umbrales_coherentes(self):
        for modelo, u in processor.UMBRALES_POR_MODELO.items():
            with self.subTest(modelo=modelo):
                self.assertGreater(u["piso_relacion"], u["piso_conceptos"])
                self.assertGreater(u["complementa"], u["piso_relacion"])
                self.assertGreater(u["cita"], u["veto"])

    def test_e5_lleva_prefijos_y_minilm_no(self):
        with patch.object(processor, "EMBED_MODEL_NAME", "intfloat/multilingual-e5-small"):
            self.assertEqual(processor._prefijos(), ("query: ", "passage: "))
        with patch.object(processor, "EMBED_MODEL_NAME", "paraphrase-multilingual-MiniLM-L12-v2"):
            self.assertEqual(processor._prefijos(), ("", ""))

    def test_el_fragmento_viaja_con_el_titulo_de_su_documento(self):
        self.assertEqual(processor.texto_de_fragmento("Libro", "capítulo 3"), "Libro\ncapítulo 3")
        self.assertEqual(processor.texto_de_fragmento(None, "capítulo 3"), "capítulo 3")


class ConversationHistoryTests(unittest.TestCase):
    """Tests para el historial de conversaciones del agente."""
    
    def test_modelos_de_conversacion_existen(self):
        """Los modelos AgentConversation y AgentMessage deben estar definidos."""
        from database.models import AgentConversation, AgentMessage
        self.assertTrue(hasattr(AgentConversation, 'id'))
        self.assertTrue(hasattr(AgentConversation, 'seccion'))
        self.assertTrue(hasattr(AgentConversation, 'titulo'))
        self.assertTrue(hasattr(AgentMessage, 'conversation_id'))
        self.assertTrue(hasattr(AgentMessage, 'role'))
        self.assertTrue(hasattr(AgentMessage, 'text'))
        self.assertTrue(hasattr(AgentMessage, 'citations'))
    
    def test_edge_co_citado_tiene_campos_de_procedencia(self):
        """Las aristas CO_CITADO deben tener campos para procedencia."""
        from database.models import Edge
        self.assertTrue(hasattr(Edge, 'metodo'))
        self.assertTrue(hasattr(Edge, 'evidencia'))
        self.assertTrue(hasattr(Edge, 'base_relacion'))


class IntentRoutingTests(unittest.TestCase):
    """Tests para el routing de intención explain vs compute."""
    
    def test_detecta_intencion_explicar(self):
        """Debe detectar pedidos de explicación conceptual."""
        import jev
        # Pedidos de explicación
        self.assertTrue(jev.es_intencion_explicar("qué es la correlación"))
        self.assertTrue(jev.es_intencion_explicar("explicame sobre correlación"))
        self.assertTrue(jev.es_intencion_explicar("necesito que me expliques sobre regresión"))
        self.assertTrue(jev.es_intencion_explicar("cómo funciona el clustering"))
        # NO son pedidos de explicación
        self.assertFalse(jev.es_intencion_explicar("calculá las correlaciones del CSV"))
        self.assertFalse(jev.es_intencion_explicar("analizá los datos"))
        self.assertFalse(jev.es_intencion_explicar("hacé una regresión con esta tabla"))
    
    def test_pregunta_concepto_pattern(self):
        """El regex de pregunta conceptual debe capturar variantes."""
        import jev
        t = jev.plano("necesito que me expliques sobre correlación")
        self.assertTrue(jev._PREGUNTA_CONCEPTO.search(t))


if __name__ == "__main__":
    unittest.main()
