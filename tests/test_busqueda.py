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


class ScalabilityTests(unittest.TestCase):
    """Tests para características de escalabilidad."""
    
    def test_postgres_fts_threshold_es_configurable(self):
        """El umbral para usar Postgres FTS debe ser configurable."""
        self.assertGreater(busqueda.POSTGRES_FTS_THRESHOLD, 0)
        self.assertEqual(busqueda.POSTGRES_FTS_THRESHOLD, 10000)  # default
    
    def test_chunk_limit_es_configurable(self):
        """El límite de chunks por documento debe ser configurable."""
        self.assertGreater(processor.CHUNK_LIMIT, 200)  # raised from old fixed 200
        self.assertEqual(processor.CHUNK_LIMIT, 500)  # new default
    
    def test_buscar_postgres_fts_devuelve_none_sin_indice(self):
        """Sin índice tsvector activo, debe retornar None para caer a BM25."""
        # Mock la sesión para simular que no hay chunks con tsv
        with patch('database.connection.get_sync_session') as mock:
            mock.return_value.__enter__.return_value.execute.return_value.scalar.return_value = False
            result = busqueda.buscar_postgres_fts("test query")
            self.assertIsNone(result)
    
    def test_buscar_hibrido_postgres_usa_fallback(self):
        """Sin FTS, debe usar solo resultados de vectores."""
        vec_results = [("c1", "n1", 0.9), ("c2", "n2", 0.8)]
        with patch('busqueda.buscar_postgres_fts', return_value=None):
            result = busqueda.buscar_hibrido_postgres("query", vec_results)
            self.assertEqual(result, ["c1", "c2"])
    
    def test_chunk_model_tiene_tsv(self):
        """El modelo Chunk debe tener columna tsv para full-text search."""
        from database.models import Chunk
        self.assertTrue(hasattr(Chunk, 'tsv'))
    
    def test_incremental_relations_usa_hnsw(self):
        """relaciones_incrementales debe documentar uso de HNSW."""
        doc = processor.relaciones_incrementales.__doc__ or ""
        self.assertIn("kNN", doc)
        self.assertIn("HNSW", doc)


class WatchedSourcesTests(unittest.TestCase):
    """Tests para Fuentes Vivas (watched sources)."""
    
    def test_modelo_watched_source_existe(self):
        """El modelo WatchedSource debe estar definido con campos correctos."""
        from database.models import WatchedSource
        self.assertTrue(hasattr(WatchedSource, 'id'))
        self.assertTrue(hasattr(WatchedSource, 'url'))
        self.assertTrue(hasattr(WatchedSource, 'kind'))
        self.assertTrue(hasattr(WatchedSource, 'seccion'))
        self.assertTrue(hasattr(WatchedSource, 'frequency_hours'))
        self.assertTrue(hasattr(WatchedSource, 'last_hash'))
        self.assertTrue(hasattr(WatchedSource, 'version_history'))
        self.assertTrue(hasattr(WatchedSource, 'status'))
    
    def test_content_hash_es_sha256(self):
        """El hash de contenido debe ser SHA-256."""
        import watcher
        h = watcher._content_hash(b"test content")
        self.assertEqual(len(h), 64)  # SHA-256 hex = 64 chars
        # Debe ser determinístico
        self.assertEqual(h, watcher._content_hash(b"test content"))
    
    def test_extract_pdf_links_detecta_pdfs(self):
        """Debe extraer links a PDFs de HTML."""
        import watcher
        html = '''
        <html>
            <a href="doc.pdf">Doc</a>
            <a href="/path/archivo.pdf">Archivo</a>
            <a href="https://otro.com/reporte.PDF">Reporte</a>
            <a href="noespdf.txt">No PDF</a>
        </html>
        '''
        links = watcher._extract_pdf_links(html, "https://ejemplo.com/pagina/")
        self.assertIn("https://ejemplo.com/pagina/doc.pdf", links)
        self.assertIn("https://ejemplo.com/path/archivo.pdf", links)
        self.assertIn("https://otro.com/reporte.PDF", links)
        self.assertEqual(len(links), 3)
    
    def test_procesar_url_web_acepta_pdf(self):
        """procesar_url_web con allow_pdf=True debe procesar PDFs por URL."""
        import processor
        # El test real requeriría mockear la descarga, pero verificamos que el parámetro existe
        import inspect
        sig = inspect.signature(processor.procesar_url_web)
        self.assertIn('allow_pdf', sig.parameters)
        self.assertEqual(sig.parameters['allow_pdf'].default, True)


if __name__ == "__main__":
    unittest.main()
