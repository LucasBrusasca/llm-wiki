"""Workbench: scripts y datos como nodos, corridas en el sandbox, consultas de sólo
lectura y pedidos de ejecución dirigidos al agente."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

import workbench as wb

SCRIPT = '''"""Limpia las ventas del mes y resume por región."""
import pandas as pd
import os
from utilidades import normalizar

def cargar():
    return pd.read_csv("data/ventas.csv")

def resumir(df):
    return df.groupby("region").sum()
'''


class AnalisisTest(unittest.TestCase):
    def test_lee_docstring_funciones_imports_y_datos_con_su_linea(self):
        a = wb.analizar_script(SCRIPT)
        self.assertEqual(a["docstring"], "Limpia las ventas del mes y resume por región.")
        self.assertEqual(a["funciones"], ["cargar", "resumir"])
        self.assertEqual([i["modulo"] for i in a["imports"]], ["pandas", "os", "utilidades"])
        self.assertEqual(a["archivos"], [{"archivo": "ventas.csv", "literal": "data/ventas.csv", "linea": 7}])
        self.assertIsNone(a["error"])

    def test_con_error_de_sintaxis_igual_encuentra_sus_vinculos(self):
        # Un script a medio escribir tiene que seguir unido a lo que usa.
        a = wb.analizar_script("import numpy\nx = open('tabla.xlsx'\ndef roto(:\n")
        self.assertIn("línea", a["error"])
        self.assertEqual([i["modulo"] for i in a["imports"]], ["numpy"])
        self.assertEqual(a["archivos"][0]["archivo"], "tabla.xlsx")

    def test_la_descripcion_sale_del_codigo_sin_llm(self):
        r = wb.resumir_script("limpieza", wb.analizar_script(SCRIPT), SCRIPT)
        self.assertIn("Limpia las ventas", r["desc"])
        self.assertIn("lee ventas.csv", r["desc"])
        self.assertIn("2 funciones", r["desc"])
        self.assertEqual(r["conceptos"], ["pandas", "utilidades"])   # `os` no dice nada del tema

    def test_codigo_normalizado_y_nombre_de_archivo(self):
        self.assertEqual(wb.normalizar_codigo("a\r\nb\x00\rc"), "a\nb\nc")
        with self.assertRaises(ValueError):
            wb.normalizar_codigo("x" * (wb.CODIGO_MAX + 1))
        self.assertEqual(wb.slug_archivo("Limpieza de Ventas 2024"), "limpieza_de_ventas_2024.py")
        self.assertEqual(wb.slug_archivo("2024 cierre"), "s_2024_cierre.py")   # importable como módulo
        self.assertEqual(wb.hash_codigo("a"), wb.hash_codigo("a"))
        self.assertNotEqual(wb.hash_codigo("a"), wb.hash_codigo("b"))


class VinculosTest(unittest.TestCase):
    CANDIDATOS = [
        {"id": "d1", "type": "DATOS", "archivo": "Ventas.CSV"},
        {"id": "s2", "type": "SCRIPT", "archivo": "utilidades.py"},
        {"id": "x", "type": "DOCUMENTO", "archivo": "otro.pdf"},
        {"id": "s1", "type": "SCRIPT", "archivo": "limpieza.py"},   # el propio script
    ]

    def test_une_el_script_con_los_datos_que_lee_y_los_modulos_que_importa(self):
        aristas = wb.vinculos_de_codigo("s1", wb.analizar_script(SCRIPT), self.CANDIDATOS)
        self.assertEqual({(a["target"], a["label"]) for a in aristas},
                         {("d1", wb.REL_LEE_DATOS), ("s2", wb.REL_IMPORTA)})
        lee = next(a for a in aristas if a["target"] == "d1")
        self.assertEqual(lee["source"], "s1")
        self.assertEqual(lee["evidencia"]["linea"], 7)
        self.assertEqual((lee["metodo"], lee["base_relacion"], lee["score"]),
                         (wb.METODO_CODIGO, wb.BASE_CODIGO, 1.0))
        self.assertIn("línea 7", lee["description"])

    def test_reingerir_un_nodo_repone_solo_lo_que_trazaron_otros_scripts(self):
        aristas = [
            {"source": "s1", "target": "d1", "metodo": wb.METODO_CODIGO},    # otro script → d1: se repone
            {"source": "d1", "target": "doc", "metodo": "knn_incremental"},  # similitud: se recalcula
            {"source": "d1", "target": "s9", "metodo": wb.METODO_CODIGO},    # sale del guardado: se recalcula
        ]
        self.assertEqual(wb.aristas_codigo_ajenas(aristas, "d1"), [aristas[0]])


class SandboxTest(unittest.TestCase):
    def test_el_script_lee_una_copia_de_sus_datos_y_lo_que_escribe_se_descarta(self):
        with tempfile.TemporaryDirectory() as tmp:
            datos = Path(tmp) / "ventas.csv"
            datos.write_text("region,monto\nnorte,10\nsur,5\n", encoding="utf-8")
            script = Path(tmp) / "suma.py"
            script.write_text(
                "import csv\n"
                "with open('ventas.csv') as f:\n"
                "    print(sum(int(r['monto']) for r in csv.DictReader(f)))\n"
                "open('ventas.csv', 'w').write('pisado')\n"
                "open('resultado.txt', 'w').write('ok')\n",
                encoding="utf-8",
            )
            r = wb.ejecutar_en_sandbox(script, datos=[datos], timeout_s=20)
            self.assertEqual(r["returncode"], 0, r["stderr"])
            self.assertIn("15", r["stdout"])
            self.assertEqual(datos.read_text(encoding="utf-8").splitlines()[0], "region,monto")  # original intacto
            self.assertEqual(r["datos"], ["ventas.csv"])
            self.assertEqual([g["archivo"] for g in r["generados"]], ["resultado.txt"])
            self.assertLessEqual(r["inicio"], r["fin"])

    def test_se_corta_por_tiempo(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "lento.py"
            script.write_text("import time\ntime.sleep(10)\n", encoding="utf-8")
            r = wb.ejecutar_en_sandbox(script, timeout_s=1)
            self.assertTrue(r["timeout"])
            self.assertIsNone(r["returncode"])

    def test_el_plan_dice_que_corre_con_que_datos_y_con_que_limites(self):
        plan = wb.plan_ejecucion("limpieza.py", "abc123def456",
                                 [{"node_id": "d1", "label": "Ventas", "archivo": "ventas.csv"}], 25)
        texto = " ".join(plan["pasos"])
        for esperado in ("limpieza.py", "abc123def456", "ventas.csv", "25 s", "Corridas"):
            self.assertIn(esperado, texto)
        self.assertTrue(plan["advertencia"])

    def test_resumen_de_salida_larga(self):
        texto = "\n".join(f"línea {i}" for i in range(500))
        corto = wb.resumen_salida(texto, 100)
        self.assertLessEqual(len(corto), 110)
        self.assertTrue(corto.startswith("línea 0"))
        self.assertTrue(corto.endswith("línea 499"))


class ConsultaTest(unittest.TestCase):
    COLS = ["region", "monto"]
    FILAS = [["norte", "10"], ["sur", "5,5"], ["norte", "4"], ["", ""]]

    def test_select_con_agregados_sobre_columnas_numericas(self):
        r = wb.consultar_tabla(self.COLS, self.FILAS,
                               "SELECT region, SUM(monto) AS total FROM datos WHERE region <> '' "
                               "GROUP BY region ORDER BY total DESC")
        self.assertEqual(r["columnas"], ["region", "total"])
        self.assertEqual(r["filas"], [["norte", 14.0], ["sur", 5.5]])
        self.assertEqual(r["tabla"]["filas"], 4)

    def test_solo_lectura(self):
        for sql in ("DELETE FROM datos", "DROP TABLE datos", "INSERT INTO datos VALUES ('x', 1)",
                    "ATTACH DATABASE '/tmp/x.db' AS x", "PRAGMA writable_schema = 1", "CREATE TABLE t (a)"):
            with self.subTest(sql=sql), self.assertRaises(wb.ConsultaInvalida):
                wb.consultar_tabla(self.COLS, self.FILAS, sql)

    def test_una_sola_sentencia_por_vez(self):
        with self.assertRaises(wb.ConsultaInvalida):
            wb.consultar_tabla(self.COLS, self.FILAS, "SELECT 1; SELECT 2")

    def test_corta_las_consultas_que_no_terminan(self):
        eterna = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c"
        with self.assertRaises(wb.ConsultaInvalida) as ctx:
            wb.consultar_tabla(self.COLS, self.FILAS, eterna, timeout_s=0.3)
        self.assertIn("se cortó", str(ctx.exception))

    def test_tope_de_filas(self):
        r = wb.consultar_tabla(self.COLS, self.FILAS, "SELECT * FROM datos", limite=2)
        self.assertEqual(len(r["filas"]), 2)
        self.assertTrue(r["truncado"])

    def test_base_sqlite_real_en_solo_lectura(self):
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "base.db"
            conn = sqlite3.connect(ruta)
            conn.execute("CREATE TABLE clientes (id INTEGER, nombre TEXT)")
            conn.execute("INSERT INTO clientes VALUES (1, 'Ana')")
            conn.commit()
            conn.close()
            self.assertEqual(wb.esquema_sqlite(ruta), [{"tabla": "clientes", "columnas": ["id", "nombre"]}])
            self.assertEqual(wb.consultar_sqlite(ruta, "SELECT nombre FROM clientes")["filas"], [["Ana"]])
            with self.assertRaises(wb.ConsultaInvalida):
                wb.consultar_sqlite(ruta, "UPDATE clientes SET nombre = 'x'")
            conn = sqlite3.connect(ruta)
            self.assertEqual(conn.execute("SELECT nombre FROM clientes").fetchone()[0], "Ana")
            conn.close()


class PedidoAlAgenteTest(unittest.TestCase):
    SCRIPTS = [
        {"id": "s1", "label": "Limpieza de ventas", "archivo": "limpieza_ventas.py"},
        {"id": "s2", "label": "Reporte mensual", "archivo": "reporte.py"},
    ]

    def test_por_nombre_de_archivo(self):
        self.assertEqual(wb.detectar_pedido_ejecucion("corré limpieza_ventas.py", self.SCRIPTS)["node_id"], "s1")

    def test_por_nombre_de_modulo(self):
        self.assertEqual(wb.detectar_pedido_ejecucion("ejecutá reporte", self.SCRIPTS)["node_id"], "s2")

    def test_por_titulo(self):
        self.assertEqual(wb.detectar_pedido_ejecucion("¿podés correr la limpieza de ventas?", self.SCRIPTS)["node_id"], "s1")

    def test_pronombre_sobre_el_script_que_se_esta_mirando(self):
        self.assertEqual(wb.detectar_pedido_ejecucion("correlo", self.SCRIPTS, contexto_id="s2")["node_id"], "s2")

    def test_una_pregunta_no_es_una_orden(self):
        self.assertIsNone(wb.detectar_pedido_ejecucion("¿cómo se corre una regresión lineal?", self.SCRIPTS))
        self.assertIsNone(wb.detectar_pedido_ejecucion("qué hace limpieza_ventas.py", self.SCRIPTS))

    def test_si_hay_varios_pregunta(self):
        scripts = [{"id": "a", "label": "Ventas norte", "archivo": "a.py"},
                   {"id": "b", "label": "Ventas sur", "archivo": "b.py"}]
        self.assertEqual(wb.detectar_pedido_ejecucion("ejecutá ventas", scripts), {"ambiguo": ["b", "a"]})


if __name__ == "__main__":
    unittest.main()
