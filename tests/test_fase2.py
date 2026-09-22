"""Fase 2: notas como nodos, tablas legibles, ejecución de archivos y conducta del agente."""
import tempfile
import unittest
from pathlib import Path

from main import (
    AGENT_CITA_UMBRAL,
    AGENT_VETO_UMBRAL,
    RUN_TIMEOUT,
    _conducta_agente,
    _ejecutar_archivo,
    _leer_tabla,
    _nota_valida,
    _stats_columnas,
)


class NotaTest(unittest.TestCase):
    def test_titulo_obligatorio(self):
        with self.assertRaises(ValueError):
            _nota_valida({"desc": "cuerpo sin título"})

    def test_cuerpo_conserva_saltos_de_linea(self):
        nota = _nota_valida({"label": "  Ideas  sueltas ", "desc": "# Título\n\n- uno\n- dos\n"})
        self.assertEqual(nota["label"], "Ideas sueltas")
        self.assertIn("\n- uno", nota["desc"])

    def test_tags_deben_ser_texto(self):
        with self.assertRaises(ValueError):
            _nota_valida({"label": "x", "tags": [1, 2]})


class TablaTest(unittest.TestCase):
    def test_csv_con_punto_y_coma(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "datos.csv"
            ruta.write_text("nombre;monto\nana;10\nluis;20\nzoe;30\n", encoding="utf-8")
            t = _leer_tabla(ruta, None, limite=2)
            self.assertEqual(t["columnas"], ["nombre", "monto"])
            self.assertEqual(len(t["filas"]), 2)          # respeta el límite
            self.assertEqual(t["total_filas"], 3)         # pero informa el total

    def test_stats_numericas_y_categoricas(self):
        stats = _stats_columnas(["monto", "color"], [["10", "rojo"], ["20", "rojo"], ["", "azul"]])
        monto, color = stats
        self.assertTrue(monto["numerica"])
        self.assertEqual((monto["min"], monto["max"], monto["promedio"]), (10.0, 20.0, 15.0))
        self.assertEqual(monto["vacios"], 1)
        self.assertFalse(color["numerica"])
        self.assertEqual(color["mas_frecuentes"][0], {"valor": "rojo", "veces": 2})


class EjecutarTest(unittest.TestCase):
    def test_corre_y_captura_stdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "hola.py"
            ruta.write_text("print('hola algedi')\n", encoding="utf-8")
            r = _ejecutar_archivo(ruta)
            self.assertEqual(r["returncode"], 0)
            self.assertIn("hola algedi", r["stdout"])
            self.assertFalse(r["timeout"])

    def test_error_queda_en_stderr_sin_romper(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "roto.py"
            ruta.write_text("raise ValueError('boom')\n", encoding="utf-8")
            r = _ejecutar_archivo(ruta)
            self.assertNotEqual(r["returncode"], 0)
            self.assertIn("boom", r["stderr"])

    def test_no_recibe_las_variables_del_servidor(self):
        # Una clave del backend no puede filtrarse al script ejecutado.
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "env.py"
            ruta.write_text("import os; print('DB=', os.getenv('DATABASE_URL'));"
                            " print('KEY=', os.getenv('ANTHROPIC_API_KEY'))\n", encoding="utf-8")
            r = _ejecutar_archivo(ruta)
            self.assertIn("DB= None", r["stdout"])
            self.assertIn("KEY= None", r["stdout"])

    def test_se_corta_por_tiempo(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "lento.py"
            ruta.write_text(f"import time; time.sleep({RUN_TIMEOUT + 5})\n", encoding="utf-8")
            r = _ejecutar_archivo(ruta)
            self.assertTrue(r["timeout"])
            self.assertIn("tiempo", r["stderr"])


class ConductaTest(unittest.TestCase):
    def test_con_citas_responde(self):
        r = _conducta_agente(0.8, "que es un estimador insesgado", True, 0.35)
        self.assertEqual(r["conducta"], "responder")

    def test_sin_evidencia_y_consulta_corta_pide_aclaracion(self):
        r = _conducta_agente(0.1, "y eso?", False, 0.35)
        self.assertEqual(r["conducta"], "pedir_aclaracion")
        self.assertIn("2 palabras", r["motivo"])

    def test_sin_evidencia_se_abstiene_con_numeros(self):
        r = _conducta_agente(0.12, "como afecta la inflacion de brasil a mi tesis", False, 0.35)
        self.assertEqual(r["conducta"], "abstenerse")
        self.assertIn("12%", r["motivo"])
        self.assertIn("35%", r["motivo"])

    def test_el_piso_para_citar_es_mas_exigente_que_el_veto_general(self):
        # Con embeddings multilingües, textos sin relación dan ~0.5: citar pide más.
        self.assertGreater(AGENT_CITA_UMBRAL, AGENT_VETO_UMBRAL)

    def test_pasaje_por_debajo_del_piso_de_citas_se_abstiene(self):
        r = _conducta_agente(0.56, "cuanto sale el alquiler promedio en osaka este mes",
                             False, AGENT_CITA_UMBRAL)
        self.assertEqual(r["conducta"], "abstenerse")
        self.assertIn("56%", r["motivo"])

    def test_afinidad_sobre_el_piso_sin_pasaje_igual_responde(self):
        r = _conducta_agente(0.5, "resumime la unidad de muestreo", False, 0.35)
        self.assertEqual(r["conducta"], "responder")


if __name__ == "__main__":
    unittest.main()
