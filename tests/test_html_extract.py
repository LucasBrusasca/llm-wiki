"""Extracción limpia de páginas web (feeds ruidosos, tablas, JS opcional)."""
import os
import unittest
from pathlib import Path
from unittest.mock import patch

FIXTURE = Path(__file__).parent / "fixtures" / "html" / "feed_ruidoso.html"


class LimpiezaTextoTests(unittest.TestCase):
    def test_quita_ver_mas_concatenado_y_puntos(self):
        from html_extract import limpiar_texto_web
        sucio = "La obra avanza.\n... Ver másVer menos\nVer más\nLeer más"
        limpio = limpiar_texto_web(sucio)
        self.assertIn("La obra avanza.", limpio)
        self.assertNotIn("Ver más", limpio)
        self.assertNotIn("Ver menos", limpio)
        self.assertNotIn("Leer más", limpio)

    def test_colapsa_emoji_vineta_y_hashtags_sueltos(self):
        from html_extract import limpiar_texto_web
        sucio = (
            "🛣️ La Autopista sigue avanzando.\n"
            "#HacerparaCrecer 🛣️ 😊\n"
            "Cierre de campaña #Ruta #Obras\n"
        )
        limpio = limpiar_texto_web(sucio)
        self.assertIn("La Autopista sigue avanzando.", limpio)
        self.assertNotIn("🛣️", limpio)
        self.assertNotIn("#HacerparaCrecer", limpio)
        self.assertNotIn("#Ruta", limpio)
        self.assertIn("Cierre de campaña", limpio)

    def test_dedupe_bloques_repetidos(self):
        from html_extract import limpiar_texto_web
        bloque = "La Autopista entre Ejemplo Norte y Ejemplo Sur sigue avanzando."
        limpio = limpiar_texto_web(f"{bloque}\n{bloque}\n{bloque}")
        self.assertEqual(limpio.count(bloque), 1)


class FixtureFeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = FIXTURE.read_text(encoding="utf-8")

    def test_fixture_es_publico_sintetico(self):
        bajo = self.html.casefold()
        self.assertNotIn("caminos de las sierras", bajo)
        self.assertNotIn("córdoba", bajo)
        self.assertIn("Red Vial del Centro", self.html)

    def test_extrae_contenido_y_tira_ruido(self):
        from html_extract import html_a_texto
        texto = html_a_texto(self.html)
        self.assertIn("Red Vial del Centro", texto)
        self.assertIn("¿Qué cambia cuando cambia una ruta?", texto)
        self.assertIn("12,4 km restantes", texto)
        self.assertIn("1.400 toneladas", texto)
        # Toggles y chrome
        self.assertNotIn("Ver más", texto)
        self.assertNotIn("Ver menos", texto)
        self.assertNotIn("Aceptar cookies", texto)
        self.assertNotIn("Política de cookies", texto)
        self.assertNotIn("Mapa del sitio", texto)
        self.assertNotIn("Seguinos en redes", texto)
        # Emojis-viñeta y hashtags de campaña
        self.assertNotIn("Ver másVer menos", texto)
        self.assertNotIn("#HacerparaCrecer", texto)
        self.assertNotIn("🛣️", texto)
        # El bloque del feed no se duplica
        self.assertEqual(texto.count("12,4 km restantes"), 1)

    def test_conserva_tabla_de_tarifas(self):
        from html_extract import html_a_texto
        texto = html_a_texto(self.html)
        self.assertIn("Tarifas vigentes", texto)
        self.assertIn("Peaje", texto)
        self.assertIn("Acceso Norte", texto)
        self.assertIn("$1500", texto)
        self.assertIn("Camiones", texto)
        self.assertIn("$4200", texto)
        self.assertIn("Acceso Sur", texto)
        self.assertIn("$1800", texto)

    def test_processor_usa_el_extracto_limpio(self):
        from processor import _extraer_texto_html
        texto = _extraer_texto_html(self.html)
        self.assertIn("Red Vial del Centro", texto)
        self.assertNotIn("Ver más", texto)
        self.assertIn("Acceso Norte", texto)

    def test_js_apagado_por_default(self):
        from html_extract import js_habilitado
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ALGEDI_HTML_JS", None)
            self.assertFalse(js_habilitado())


class JsOpcionalTests(unittest.TestCase):
    def test_apagado_por_default_no_llama_playwright(self):
        from html_extract import extraer_texto_pagina
        html = "<html><body><p>Hola</p></body></html>"
        with patch.dict(os.environ, {"ALGEDI_HTML_JS": "0"}, clear=False), \
                patch("html_extract.renderizar_js", side_effect=AssertionError("no debía renderizar")):
            texto = extraer_texto_pagina(html, url="https://ejemplo.test/")
        self.assertIn("Hola", texto)

    def test_prendido_renderiza_si_el_estatico_es_corto(self):
        from html_extract import extraer_texto_pagina
        shell = "<html><body><div id='app'></div></body></html>"
        rico = "<html><body><h1>Artículo largo</h1><p>" + ("palabra " * 80) + "</p></body></html>"
        env = {
            "ALGEDI_HTML_JS": "1",
            "ALGEDI_HTML_JS_MIN_CHARS": "400",
        }
        with patch.dict(os.environ, env, clear=False), \
                patch("html_extract.renderizar_js", return_value=rico) as render:
            texto = extraer_texto_pagina(shell, url="https://ejemplo.test/spa")
        render.assert_called_once_with("https://ejemplo.test/spa")
        self.assertIn("Artículo largo", texto)
        self.assertGreater(len(texto), 400)

    def test_prendido_no_renderiza_si_ya_hay_texto(self):
        from html_extract import extraer_texto_pagina
        html = "<html><body><p>" + ("contenido suficiente " * 40) + "</p></body></html>"
        env = {"ALGEDI_HTML_JS": "1", "ALGEDI_HTML_JS_MIN_CHARS": "400"}
        with patch.dict(os.environ, env, clear=False), \
                patch("html_extract.renderizar_js", side_effect=AssertionError("no debía renderizar")):
            texto = extraer_texto_pagina(html, url="https://ejemplo.test/")
        self.assertIn("contenido suficiente", texto)

    def test_chromium_ausente_degrada_al_estatico(self):
        from html_extract import extraer_texto_pagina
        html = "<html><body><p>Fallback estático</p></body></html>"
        env = {"ALGEDI_HTML_JS": "1", "ALGEDI_HTML_JS_MIN_CHARS": "400"}
        with patch.dict(os.environ, env, clear=False), \
                patch("html_extract.renderizar_js", return_value=None):
            texto = extraer_texto_pagina(html, url="https://ejemplo.test/")
        self.assertIn("Fallback estático", texto)


class HtmlProcessorCompatTests(unittest.TestCase):
    def test_pagina_corta_sin_tirar_el_menu(self):
        from processor import _extraer_texto_html
        html = "<html><body><nav>Menú</nav><p>Hola <b>mundo</b></p><script>x()</script></body></html>"
        texto = _extraer_texto_html(html)
        self.assertIn("Hola mundo", texto)
        self.assertNotIn("x()", texto)
        self.assertNotIn("Menú", texto)


if __name__ == "__main__":
    unittest.main()
