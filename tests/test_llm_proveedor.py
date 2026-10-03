"""Proveedor «openai»: cualquier API compatible con OpenAI que pida clave (Z.ai, Groq…)."""
import os
import unittest
from unittest import mock

import processor


class ProveedorCompatibleOpenAI(unittest.TestCase):
    def _llamar(self, **env):
        capturado = {}

        def falso(url, payload, headers, timeout, retries=6):
            capturado.update(url=url, payload=payload, headers=headers)
            return {"choices": [{"message": {"content": "hola"}}]}

        with mock.patch.dict(os.environ, {"LLM_PROVIDER": "openai", **env}), \
                mock.patch.object(processor, "_post_llm_chat", falso):
            respuesta = processor.query_llm([{"role": "user", "content": "decí hola"}], system="sos breve")
        return respuesta, capturado

    def test_zai_manda_la_clave_y_apaga_el_razonamiento(self):
        r, c = self._llamar(LLM_BASE_URL="https://api.z.ai/api/paas/v4/", LLM_API_KEY="clave-de-prueba",
                            LLM_MODEL="glm-4.7-flash")
        self.assertEqual(r, "hola")
        self.assertEqual(c["url"], "https://api.z.ai/api/paas/v4/chat/completions")
        self.assertEqual(c["headers"]["Authorization"], "Bearer clave-de-prueba")
        self.assertEqual(c["payload"]["model"], "glm-4.7-flash")
        self.assertEqual(c["payload"]["thinking"], {"type": "disabled"})
        self.assertEqual(c["payload"]["messages"][0], {"role": "system", "content": "sos breve"})

    def test_url_completa_y_sin_parametros_de_glm_en_otros_proveedores(self):
        _, c = self._llamar(LLM_BASE_URL="https://api.groq.com/openai/v1/chat/completions", LLM_API_KEY="k",
                            LLM_MODEL="qwen/qwen3-32b")
        self.assertEqual(c["url"], "https://api.groq.com/openai/v1/chat/completions")
        self.assertNotIn("thinking", c["payload"])
        self.assertTrue(c["payload"]["messages"][-1]["content"].endswith("/no_think"))


if __name__ == "__main__":
    unittest.main()
