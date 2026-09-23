"""Tests para parsear_json robusto.

Cubre los casos problemáticos que causan errores en producción cuando el LLM
devuelve JSON casi-válido (trailing commas, fences, thinking tags, etc.).

    python3 tests/test_parsear_json.py
"""
import unittest
import json
import re
import sys
from pathlib import Path


class JSONParseError(Exception):
    """Excepción amigable para errores de parsing de JSON del LLM."""
    pass


def _limpiar_texto_llm(texto: str) -> str:
    """Limpia el texto del LLM: elimina thinking tags, markdown fences, y prosa extra."""
    if not texto:
        return ""
    
    texto = re.sub(r'<think>.*?</think>', '', texto, flags=re.DOTALL | re.IGNORECASE)
    texto = re.sub(r'<thinking>.*?</thinking>', '', texto, flags=re.DOTALL | re.IGNORECASE)
    
    texto = re.sub(r'^```(?:json)?\s*\n?', '', texto, flags=re.MULTILINE)
    texto = re.sub(r'\n?```\s*$', '', texto, flags=re.MULTILINE)
    
    return texto.strip()


def _extraer_json_objeto(texto: str) -> str | None:
    """Extrae el objeto JSON más externo del texto, manejando anidamiento."""
    inicio = texto.find('{')
    if inicio == -1:
        return None
    
    nivel = 0
    en_string = False
    escape = False
    
    for i, char in enumerate(texto[inicio:], inicio):
        if escape:
            escape = False
            continue
        if char == '\\':
            escape = True
            continue
        if char == '"' and not escape:
            en_string = not en_string
            continue
        if en_string:
            continue
        if char == '{':
            nivel += 1
        elif char == '}':
            nivel -= 1
            if nivel == 0:
                return texto[inicio:i + 1]
    
    return None


def _reparar_json(texto: str) -> str:
    """Intenta reparar problemas comunes en JSON del LLM."""
    texto = re.sub(r',(\s*[}\]])', r'\1', texto)
    
    texto = re.sub(r'([}\]"\d])\s*\n\s*(")', r'\1,\n\2', texto)
    
    texto = re.sub(r'("(?:[^"\\]|\\.)*")', lambda m: m.group(0).replace('\n', '\\n'), texto)
    
    return texto


def parsear_json(texto: str, *, permitir_retry: bool = False, 
                 retry_fn: callable = None) -> dict:
    """Parsea JSON del LLM de forma robusta."""
    if not texto or not texto.strip():
        raise JSONParseError("El modelo no devolvió contenido. Reintentá el ingest.")
    
    texto_limpio = _limpiar_texto_llm(texto)
    
    try:
        return json.loads(texto_limpio)
    except json.JSONDecodeError:
        pass
    
    json_extraido = _extraer_json_objeto(texto_limpio)
    if json_extraido:
        try:
            return json.loads(json_extraido)
        except json.JSONDecodeError:
            pass
        
        json_reparado = _reparar_json(json_extraido)
        try:
            return json.loads(json_reparado)
        except json.JSONDecodeError:
            pass
    
    if permitir_retry and retry_fn:
        try:
            nuevo_texto = retry_fn(texto)
            if nuevo_texto and nuevo_texto != texto:
                return parsear_json(nuevo_texto, permitir_retry=False)
        except Exception:
            pass
    
    raise JSONParseError(
        "El modelo devolvió metadata inválida; reintentá el ingest. "
        "Si el error persiste, probá con otro video o verificá tu conexión."
    )


class TestLimpiarTextoLLM(unittest.TestCase):
    """Tests para _limpiar_texto_llm."""
    
    def test_thinking_tags(self):
        texto = '<think>Voy a analizar esto...</think>{"key": "value"}'
        self.assertEqual(_limpiar_texto_llm(texto), '{"key": "value"}')
    
    def test_thinking_tags_multilinea(self):
        texto = '''<think>
        Pensando mucho
        sobre el problema
        </think>
        {"key": "value"}'''
        resultado = _limpiar_texto_llm(texto)
        self.assertIn('{"key": "value"}', resultado)
        self.assertNotIn('think', resultado.lower())
    
    def test_markdown_fences_json(self):
        texto = '```json\n{"key": "value"}\n```'
        self.assertEqual(_limpiar_texto_llm(texto), '{"key": "value"}')
    
    def test_markdown_fences_sin_lang(self):
        texto = '```\n{"key": "value"}\n```'
        self.assertEqual(_limpiar_texto_llm(texto), '{"key": "value"}')


class TestExtraerJsonObjeto(unittest.TestCase):
    """Tests para _extraer_json_objeto."""
    
    def test_json_simple(self):
        texto = '{"key": "value"}'
        self.assertEqual(_extraer_json_objeto(texto), '{"key": "value"}')
    
    def test_json_con_prosa_antes(self):
        texto = 'Aquí está el JSON: {"key": "value"}'
        self.assertEqual(_extraer_json_objeto(texto), '{"key": "value"}')
    
    def test_json_con_prosa_despues(self):
        texto = '{"key": "value"} Espero que te sirva!'
        self.assertEqual(_extraer_json_objeto(texto), '{"key": "value"}')
    
    def test_json_anidado(self):
        texto = '{"nodo": {"id": "test", "conceptos": ["a", "b"]}}'
        self.assertEqual(_extraer_json_objeto(texto), texto)
    
    def test_json_con_llaves_en_strings(self):
        texto = '{"desc": "Usa {esto} para {eso}"}'
        self.assertEqual(_extraer_json_objeto(texto), texto)
    
    def test_sin_json(self):
        texto = 'No hay JSON aquí'
        self.assertIsNone(_extraer_json_objeto(texto))


class TestRepararJson(unittest.TestCase):
    """Tests para _reparar_json."""
    
    def test_trailing_comma_objeto(self):
        texto = '{"a": 1, "b": 2,}'
        self.assertEqual(_reparar_json(texto), '{"a": 1, "b": 2}')
    
    def test_trailing_comma_array(self):
        texto = '{"items": ["a", "b",]}'
        reparado = _reparar_json(texto)
        self.assertNotIn(',]', reparado)
    
    def test_coma_faltante_entre_propiedades(self):
        texto = '''{
  "a": 1
  "b": 2
}'''
        reparado = _reparar_json(texto)
        self.assertTrue('"a": 1,' in reparado or '"a": 1,\n' in reparado)


class TestParsearJson(unittest.TestCase):
    """Tests para parsear_json (función principal)."""
    
    def test_json_valido(self):
        """JSON válido se parsea sin cambios."""
        texto = '{"nodo": {"id": "test", "label": "Test"}}'
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "test")
        self.assertEqual(resultado["nodo"]["label"], "Test")
    
    def test_json_con_markdown_fence(self):
        """JSON con markdown fences (```json...```)."""
        texto = '```json\n{"nodo": {"id": "test"}}\n```'
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "test")
    
    def test_json_con_thinking_tags(self):
        """JSON con thinking tags de modelos que piensan."""
        texto = '''<think>
Voy a generar el JSON para este video...
El video trata sobre machine learning.
</think>
{"nodo": {"id": "ml_video", "label": "ML Tutorial"}}'''
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "ml_video")
    
    def test_json_con_trailing_comma(self):
        """JSON con trailing comma (error común del LLM)."""
        texto = '{"nodo": {"id": "test", "conceptos": ["a", "b",],}}'
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "test")
        self.assertEqual(resultado["nodo"]["conceptos"], ["a", "b"])
    
    def test_json_con_prosa_antes_y_despues(self):
        """JSON con texto explicativo alrededor."""
        texto = '''Aquí está el análisis del video:
        
{"nodo": {"id": "video1", "label": "Tutorial"}}

Espero que te sea útil!'''
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "video1")
    
    def test_json_completo_tipo_youtube(self):
        """JSON completo como el que genera procesar_youtube."""
        texto = '''```json
{
  "nodo": {
    "id": "yt_hy8UstR2NEg",
    "label": "Video Tutorial",
    "type": "DOCUMENTO",
    "level": 1,
    "desc": "Este video explica conceptos de programación.",
    "fragmento": "La programación es el arte de resolver problemas.",
    "conceptos": ["programación", "algoritmos", "estructuras de datos"]
  },
  "relaciones": []
}
```'''
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "yt_hy8UstR2NEg")
        self.assertEqual(len(resultado["nodo"]["conceptos"]), 3)
    
    def test_json_con_coma_faltante(self):
        """JSON con coma faltante entre propiedades (error reportado)."""
        texto = '''{
  "nodo": {
    "id": "test"
    "label": "Test Label"
  }
}'''
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "test")
    
    def test_error_amigable_sin_json(self):
        """Error amigable cuando no hay JSON recuperable."""
        with self.assertRaises(JSONParseError) as ctx:
            parsear_json("Esto no es JSON para nada")
        self.assertIn("metadata inválida", str(ctx.exception))
        self.assertIn("reintentá", str(ctx.exception).lower())
    
    def test_error_amigable_texto_vacio(self):
        """Error amigable con texto vacío."""
        with self.assertRaises(JSONParseError) as ctx:
            parsear_json("")
        self.assertIn("no devolvió contenido", str(ctx.exception))
    
    def test_error_amigable_solo_espacios(self):
        """Error amigable con solo espacios."""
        with self.assertRaises(JSONParseError) as ctx:
            parsear_json("   \n\t  ")
        self.assertIn("no devolvió contenido", str(ctx.exception))


class TestCasosRealesProduccion(unittest.TestCase):
    """Tests basados en casos reales de producción."""
    
    def test_caso_youtube_error_original(self):
        """El caso del issue: 'Expecting ',' delimiter: line 10 column 2'."""
        texto = '''{
  "nodo": {
    "id": "youtube_video_test",
    "label": "Video sobre IA",
    "type": "DOCUMENTO",
    "level": 1,
    "desc": "Este video explora los fundamentos de la inteligencia artificial"
    "fragmento": "La IA está transformando todas las industrias",
    "conceptos": ["inteligencia artificial", "machine learning", "deep learning"]
  },
  "relaciones": []
}'''
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "youtube_video_test")
        self.assertIn("inteligencia artificial", resultado["nodo"]["conceptos"])
    
    def test_thinking_tags_con_fence(self):
        """Modelo que piensa Y usa markdown fences."""
        texto = '''<think>
Analizando el contenido del video...
Es un tutorial técnico.
</think>

```json
{
  "nodo": {
    "id": "tutorial_tech",
    "label": "Tech Tutorial",
    "conceptos": ["python", "desarrollo"]
  }
}
```'''
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "tutorial_tech")
    
    def test_multiples_trailing_commas(self):
        """Múltiples trailing commas en diferentes niveles."""
        texto = '''{
  "nodo": {
    "id": "multi_comma",
    "conceptos": ["a", "b", "c",],
    "label": "Test",
  },
  "relaciones": [],
}'''
        resultado = parsear_json(texto)
        self.assertEqual(resultado["nodo"]["id"], "multi_comma")
        self.assertEqual(len(resultado["nodo"]["conceptos"]), 3)


if __name__ == "__main__":
    unittest.main()
