"""Calidad de la ingesta: lo que el LLM ve de cada documento, el contexto que se le pide
a Ollama y la detección de duplicados."""
import unittest

import duplicados as dup


class MuestraTests(unittest.TestCase):
    def test_documento_corto_va_entero(self):
        from processor import _muestra_representativa
        self.assertEqual(_muestra_representativa("hola mundo", 100), "hola mundo")

    def test_documento_largo_ve_principio_medio_y_final(self):
        from processor import _muestra_representativa
        texto = "".join(f"[{i:04d}]" + "x" * 94 for i in range(1000))   # 100 mil caracteres
        m = _muestra_representativa(texto, 14000)
        self.assertLessEqual(len(m), 14000 + 200)                        # más los separadores
        self.assertIn("[0000]", m)                                       # el comienzo
        self.assertIn("[0999]", m)                                       # el final
        medios = [i for i in range(200, 800) if f"[{i:04d}]" in m]
        self.assertGreaterEqual(len(medios), 5)                          # tramos del medio, no sólo 3
        self.assertGreater(max(medios) - min(medios), 300)               # repartidos a lo largo


class OllamaTests(unittest.TestCase):
    def test_url_nativa(self):
        from processor import _url_ollama_nativa
        self.assertEqual(_url_ollama_nativa("http://host.docker.internal:11434/v1/chat/completions"),
                         "http://host.docker.internal:11434/api/chat")
        self.assertEqual(_url_ollama_nativa("http://localhost:11434/api/chat"), "http://localhost:11434/api/chat")
        self.assertIsNone(_url_ollama_nativa("https://otro.proveedor/chat"))

    def test_pide_contexto_y_usa_api_nativa(self):
        from unittest.mock import patch
        import processor
        enviado = {}

        def falso(url, payload, headers, timeout, retries=6):
            enviado.update(url=url, payload=payload)
            return {"message": {"content": "ok"}}
        with patch.dict("os.environ", {"LLM_PROVIDER": "ollama", "LLM_MODEL": "qwen2.5:7b",
                                       "OLLAMA_URL": "http://h:11434/v1/chat/completions"}), \
                patch.object(processor, "_post_llm_chat", side_effect=falso):
            self.assertEqual(processor.query_llm([{"role": "user", "content": "hola"}]), "ok")
        self.assertEqual(enviado["url"], "http://h:11434/api/chat")
        self.assertEqual(enviado["payload"]["options"]["num_ctx"], processor.OLLAMA_NUM_CTX)
        self.assertGreaterEqual(processor.OLLAMA_NUM_CTX, 8192)
        self.assertFalse(enviado["payload"]["stream"])


class HtmlTests(unittest.TestCase):
    def test_contenido_principal_sin_menu_ni_script(self):
        from processor import _extraer_texto_html
        html = "<html><body><nav>Menú</nav><p>Hola <b>mundo</b></p><script>x()</script></body></html>"
        texto = _extraer_texto_html(html)
        self.assertIn("Hola mundo", texto)
        self.assertNotIn("x()", texto)
        self.assertNotIn("Menú", texto)

    def test_acepta_url_para_render_js(self):
        import inspect
        from processor import procesar_html, _extraer_texto_html
        self.assertIn("url", inspect.signature(procesar_html).parameters)
        self.assertIn("url", inspect.signature(_extraer_texto_html).parameters)


class DuplicadosTests(unittest.TestCase):
    NODOS = [
        {"id": "yt_viejo", "label": "Backprop", "fuente": "youtube", "video": "Ilg3gGewQ5U", "created_at": "2026-06-26"},
        {"id": "yt_nuevo", "label": "Backpropagation, intuitively", "fuente": "youtube", "video": "Ilg3gGewQ5U", "created_at": "2026-10-11"},
        {"id": "ppt_a", "label": "Intro Python", "fuente": "ppt", "hash": "h1", "created_at": "2026-09-06"},
        {"id": "ppt_b", "label": "Introducción a Python", "fuente": "ppt", "hash": "h1", "created_at": "2026-09-08"},
        {"id": "pdf_a", "label": "Maestría en Ciencia de Datos", "fuente": "pdf", "hash": "h2"},
        {"id": "pdf_b", "label": "Maestria en ciencia de datos", "fuente": "pdf", "hash": "h3"},
        {"id": "solo", "label": "Otro documento", "fuente": "pdf", "hash": "h4"},
    ]

    def test_grupos_seguros_y_probables(self):
        grupos = dup.agrupar(self.NODOS)
        por_ids = {tuple(g["ids"]): g for g in grupos}
        self.assertEqual(por_ids[("yt_nuevo", "yt_viejo")]["fuerza"], "seguro")
        self.assertIn("el mismo video", por_ids[("yt_nuevo", "yt_viejo")]["motivo"])
        self.assertEqual(por_ids[("ppt_a", "ppt_b")]["motivo"], "el mismo archivo")
        self.assertEqual(por_ids[("pdf_a", "pdf_b")]["fuerza"], "probable")             # mismo título, distinto archivo
        self.assertNotIn(("solo",), por_ids)
        self.assertEqual([g["fuerza"] for g in grupos], ["seguro", "seguro", "probable"])

    def test_contenido_casi_igual_y_descartados(self):
        grupos = dup.agrupar(self.NODOS[-1:] + [{"id": "otro", "label": "x", "fuente": "word"}],
                             pares_contenido=[("solo", "otro", 0.99)])
        self.assertEqual(grupos[0]["motivo"], "contenido casi igual")
        self.assertEqual(dup.agrupar(self.NODOS[-1:] + [{"id": "otro", "label": "x", "fuente": "word"}],
                                     pares_contenido=[("solo", "otro", 0.99)], descartados={grupos[0]["clave"]}), [])
        self.assertEqual(dup.agrupar(self.NODOS[-1:] + [{"id": "otro", "label": "x", "fuente": "word"}],
                                     pares_contenido=[("solo", "otro", 0.97)]), [])

    def test_sugerido_el_mas_conectado_y_a_igualdad_el_primero(self):
        self.assertEqual(dup.sugerido(self.NODOS[:2]), "yt_viejo")                    # sin relaciones: el que entró primero
        viejo_conectado = [{"id": "junio", "created_at": "2026-06-07", "relaciones": 15},
                           {"id": "agosto", "created_at": "2026-08-23", "relaciones": 0}]
        self.assertEqual(dup.sugerido(viejo_conectado), "junio")


if __name__ == "__main__":
    unittest.main()
