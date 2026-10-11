"""JEV: fichas de herramientas, decisiones tipadas y parámetros. Sin modelo de
embeddings: los casos están armados para que decidan las reglas (columnas nombradas,
dato seleccionado) o se le pasan puntajes ya calculados al decisor."""
import csv
import unittest
from pathlib import Path

import decisor
import jev
import workbench as wb
from main import _temas_con_nombre

BASE = Path(__file__).resolve().parent.parent
FICHA = '''"""Comparar grupos.

Sirve para: comparar una variable numérica entre grupos.
Necesita: una tabla.
Entrega: medias por grupo y la prueba que corresponde.
Toca: nada.
Pedidos típicos:
- Compará el gasto entre regiones
- ¿Hay diferencia entre planes?
"""
PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "grupo": {"tipo": "columna", "clase": "categorica"},
    "valor": {"tipo": "columna", "clase": "numérica"},
    "raro": {"tipo": "inventado"},
}
'''


def tabla_demo():
    with (BASE / "herramientas" / "ejemplos" / "clientes_demo.csv").open(encoding="utf-8") as fh:
        filas = list(csv.reader(fh))
    return {"node_id": "t", "label": "clientes_demo.csv", "desc": "",
            "columnas": jev.describir_tabla(filas[0], filas[1:501])}


class FichaTests(unittest.TestCase):
    def test_lee_los_campos_y_los_pedidos_tipicos(self):
        f = wb.leer_ficha(FICHA)
        self.assertEqual(f["titulo"], "Comparar grupos")
        self.assertEqual(f["sirve_para"], "comparar una variable numérica entre grupos.")
        self.assertEqual(f["ejemplos"], ["Compará el gasto entre regiones", "¿Hay diferencia entre planes?"])

    def test_los_parametros_se_normalizan_y_lo_desconocido_se_descarta(self):
        p = wb.leer_ficha(FICHA)["parametros"]
        self.assertEqual(set(p), {"datos", "grupo", "valor"})
        self.assertEqual(p["valor"]["clase"], "numerica")          # sin tilde
        self.assertEqual(p["grupo"]["de"], "datos")

    def test_sin_ficha_no_es_herramienta(self):
        self.assertIsNone(wb.leer_ficha('"""Un script cualquiera."""\nprint(1)\n'))

    def test_avisa_si_el_codigo_escribe_o_usa_la_red(self):
        codigo = FICHA + "import requests\nopen('x.csv', 'w').write('a')\ndf.to_csv('y.csv')\n"
        self.assertEqual(wb.leer_ficha(codigo)["efectos"], ["escribe archivos", "usa la red"])
        self.assertEqual(wb.leer_ficha(FICHA)["efectos"], [])

    def test_la_descripcion_del_nodo_es_la_ficha(self):
        r = wb.resumir_script("comparar", wb.analizar_script(FICHA), FICHA)
        self.assertIn("Sirve para: comparar una variable numérica", r["desc"])
        self.assertIn("herramienta", r["conceptos"])

    def test_toda_la_navaja_trae_ficha_completa(self):
        for ruta in sorted((BASE / "herramientas" / "data_science").glob("*.py")):
            with self.subTest(script=ruta.name):
                f = wb.leer_ficha(ruta.read_text(encoding="utf-8"))
                self.assertIsNotNone(f)
                self.assertTrue(f["sirve_para"] and f["entrega"])
                self.assertGreaterEqual(len(f["ejemplos"]), 4)
                self.assertEqual(f["efectos"], [])                  # la navaja sólo lee
                self.assertEqual(f["parametros"]["datos"]["tipo"], "tabla")


class SandboxConParametrosTests(unittest.TestCase):
    def test_los_parametros_llegan_al_script(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "eco.py"
            ruta.write_text("import os\nprint(os.environ.get('ALGEDI_PARAMS'))\n", encoding="utf-8")
            r = wb.ejecutar_en_sandbox(ruta, timeout_s=20, parametros={"objetivo": "abandono"})
        self.assertEqual(r["returncode"], 0)
        self.assertIn('"objetivo": "abandono"', r["stdout"])

    def test_el_plan_muestra_los_parametros(self):
        plan = wb.plan_ejecucion("x.py", "abc", [], 60, {"objetivo": "abandono", "k": None})
        self.assertIn("Con estos parámetros: objetivo = abandono.", plan["pasos"])

    def test_una_herramienta_corre_sobre_la_tabla_de_prueba(self):
        csv_demo = BASE / "herramientas" / "ejemplos" / "clientes_demo.csv"
        r = wb.ejecutar_en_sandbox(BASE / "herramientas" / "data_science" / "comparar_grupos.py",
                                   datos=[csv_demo], timeout_s=60,
                                   parametros={"datos": csv_demo.name, "grupo": "plan", "valor": "gasto_mensual"})
        self.assertEqual(r["returncode"], 0, r["stderr"])
        self.assertIn("Kruskal-Wallis", r["stdout"])
        self.assertEqual(r["stderr"].strip(), "")


class DecisorTests(unittest.TestCase):
    def test_elige_cuando_una_opcion_se_despega(self):
        d = decisor.decidir({"a": 0.90, "b": 0.82, "c": 0.80})
        self.assertEqual(d.eleccion, "a")
        self.assertAlmostEqual(sum(d.probabilidades.values()), 1.0)

    def test_si_dos_quedan_parejas_pregunta(self):
        d = decisor.decidir({"a": 0.900, "b": 0.898})
        self.assertIsNone(d.eleccion)
        self.assertEqual([k for k, _ in d.ranking(2)], ["a", "b"])

    def test_con_piso_no_elige_lo_que_no_se_parece(self):
        self.assertIsNone(decisor.decidir({"a": 0.70}, piso=0.8).eleccion)


class ColumnasTests(unittest.TestCase):
    def test_clases_de_columna(self):
        self.assertEqual(jev.clases_de_columna(["1", "2.5", "3"]), {"numerica", "categorica"})
        self.assertIn("binaria", jev.clases_de_columna(["0", "1", "1", "0"]))
        fechas = [f"2025-{m:02d}-{d:02d}" for m in range(1, 5) for d in range(1, 11)]
        self.assertEqual(jev.clases_de_columna(fechas), {"fecha"})
        self.assertNotIn("numerica", jev.clases_de_columna(["Norte", "Sur"] * 10))

    def test_nombrar_una_columna(self):
        p = jev.plano("¿Hay outliers en la antigüedad? y en el uso, comparado entre planes")
        self.assertTrue(jev._mencionada("antiguedad_meses", p))       # palabra principal
        self.assertTrue(jev._mencionada("plan", p))                   # plural
        self.assertTrue(jev._mencionada("uso_mensual_gb", p))         # 3 letras alcanzan
        self.assertFalse(jev._mencionada("uso_mensual_gb", jev.plano("el gasto mensual")))

    def test_la_clase_principal_reparte_las_columnas_nombradas(self):
        ficha = wb.leer_ficha((BASE / "herramientas" / "data_science" / "comparar_grupos.py").read_text(encoding="utf-8"))
        t = tabla_demo()
        r = jev.resolver_parametros("Compará la satisfacción entre planes", ficha, None, [t])
        self.assertEqual((r.valores["grupo"], r.valores["valor"]), ("plan", "satisfaccion"))
        self.assertEqual(r.valores["datos"], "t")                      # la única tabla
        self.assertEqual(r.faltan, [])

    def test_lo_que_se_quiere_explicar_va_primero(self):
        ficha = wb.leer_ficha((BASE / "herramientas" / "data_science" / "regresion_lineal.py").read_text(encoding="utf-8"))
        r = jev.resolver_parametros("¿Cuánto aumenta el gasto por cada GB de uso?", ficha,
                                    {"id": "t", "type": "DATOS"}, [tabla_demo()])
        self.assertEqual(r.valores["objetivo"], "gasto_mensual")

    def test_lo_que_eligio_la_persona_no_se_vuelve_a_decidir(self):
        ficha = wb.leer_ficha((BASE / "herramientas" / "data_science" / "comparar_grupos.py").read_text(encoding="utf-8"))
        r = jev.resolver_parametros("Compará la satisfacción entre planes", ficha, None, [tabla_demo()],
                                    fijados={"grupo": "region"})
        self.assertEqual(r.valores["grupo"], "region")
        self.assertEqual(r.valores["valor"], "satisfaccion")

    def test_un_numero_del_pedido_llena_el_parametro_numerico(self):
        ficha = wb.leer_ficha((BASE / "herramientas" / "data_science" / "segmentacion_kmeans.py").read_text(encoding="utf-8"))
        r = jev.resolver_parametros("Segmentá en 4 grupos", ficha, {"id": "t", "type": "DATOS"}, [tabla_demo()])
        self.assertEqual(r.valores["k"], 4)

    def test_sin_tablas_pregunta_por_los_datos(self):
        ficha = wb.leer_ficha(FICHA)
        r = jev.resolver_parametros("Compará el gasto entre regiones", ficha, None, [])
        self.assertEqual(r.faltan[0]["nombre"], "datos")


class PedidoPorNombreTests(unittest.TestCase):
    def test_gana_el_script_con_mas_palabras_nombradas(self):
        scripts = [{"id": "kmeans", "label": "Segmentación con k-means", "archivo": "segmentacion_kmeans.py"},
                   {"id": "grupos", "label": "Comparar grupos", "archivo": "comparar_grupos.py"}]
        r = wb.detectar_pedido_ejecucion("Corré la segmentación con k-means en 3 grupos", scripts)
        self.assertEqual(r, {"node_id": "kmeans", "por": "nombre"})


class TemasTests(unittest.TestCase):
    def test_un_tema_sin_nombre_se_nombra_por_sus_conceptos_distintivos(self):
        docs = ([(0, None, ["regresión", "datos"])] * 4 + [(1, None, ["redes neuronales", "datos"])] * 3
                + [(-1, "Sin clasificar", ["datos"])])
        temas = _temas_con_nombre(docs)
        self.assertTrue(temas[0][0].startswith("regresión"))          # el más grande, nombrado
        self.assertEqual(temas[0][1], 4)
        self.assertEqual(sum(n for _, n in temas), 7)                  # el ruido no es un tema


if __name__ == "__main__":
    unittest.main()
