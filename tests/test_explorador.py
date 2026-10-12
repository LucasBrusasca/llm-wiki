"""Explorador de datos: el modelo de una fuente y la tabla dinámica (SQL armado y
corrido de verdad sobre un SQLite temporal con claves foráneas)."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

import explorador as ex
import workbench as wb


def base_demo(ruta: Path):
    conn = sqlite3.connect(ruta)
    conn.executescript("""
        CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, provincia TEXT);
        CREATE TABLE productos (id INTEGER PRIMARY KEY, nombre TEXT, categoria TEXT, precio REAL);
        CREATE TABLE ventas (id INTEGER PRIMARY KEY, fecha DATE,
            cliente_id INTEGER REFERENCES clientes(id), producto_id INTEGER REFERENCES productos(id),
            cantidad INTEGER);
        INSERT INTO clientes VALUES (1, 'Ana', 'Salta'), (2, 'Beto', 'Jujuy');
        INSERT INTO productos VALUES (1, 'Yerba', 'Almacén', 10), (2, 'Termo', 'Bazar', 50);
        INSERT INTO ventas VALUES
            (1, '2025-01-10', 1, 1, 3), (2, '2025-01-20', 1, 2, 1),
            (3, '2025-02-05', 2, 1, 5), (4, '2025-03-15', 2, 2, 2);
    """)
    conn.commit()
    conn.close()


class ModeloTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ruta = Path(self.tmp.name) / "demo.sqlite"
        base_demo(self.ruta)
        self.modelo = wb.modelo_sqlite(self.ruta)

    def tearDown(self):
        self.tmp.cleanup()

    def test_lee_tablas_campos_claves_y_relaciones(self):
        tablas = {t["clave"]: t for t in self.modelo["tablas"]}
        self.assertEqual(set(tablas), {"clientes", "productos", "ventas"})
        campos = {c["nombre"]: c for c in tablas["ventas"]["campos"]}
        self.assertTrue(campos["id"]["pk"])
        self.assertEqual(campos["fecha"]["clase"], "fecha")
        self.assertEqual(campos["cantidad"]["clase"], "numerica")
        self.assertEqual(campos["cliente_id"]["ref"], {"tabla": "clientes", "columna": "id"})
        self.assertEqual(tablas["ventas"]["filas_aprox"], 4)
        self.assertEqual(len(self.modelo["relaciones"]), 2)

    def test_pivot_une_las_tablas_por_sus_relaciones(self):
        spec = {"filas": [{"tabla": "clientes", "columna": "provincia"}],
                "columnas": [{"tabla": "productos", "columna": "categoria"}],
                "valores": [{"tabla": "ventas", "columna": "cantidad", "agregacion": "suma"}]}
        armado = ex.armar_pivot(self.modelo, spec, "sqlite")
        self.assertIn('LEFT JOIN "clientes" AS t1 ON t0."cliente_id" = t1."id"', armado["sql"])
        res = wb.consultar_sqlite(self.ruta, armado["sql"])
        self.assertEqual(sorted(map(tuple, res["filas"])),
                         [("Jujuy", "Almacén", 5), ("Jujuy", "Bazar", 2), ("Salta", "Almacén", 3), ("Salta", "Bazar", 1)])

    def test_fechas_por_mes_en_orden_y_filtros(self):
        spec = {"filas": [{"tabla": "ventas", "columna": "fecha", "fecha": "mes"}],
                "valores": [{"tabla": "ventas", "columna": "cantidad", "agregacion": "suma"}],
                "filtros": [{"tabla": "productos", "columna": "categoria", "op": "=", "valor": "Almacén"}]}
        res = wb.consultar_sqlite(self.ruta, ex.armar_pivot(self.modelo, spec, "sqlite")["sql"])
        self.assertEqual(res["filas"], [["2025-01", 3], ["2025-02", 5]])

    def test_un_filtro_con_comillas_no_rompe_el_sql(self):
        spec = {"valores": [{"tabla": "clientes", "columna": "*", "agregacion": "conteo"}],
                "filtros": [{"tabla": "clientes", "columna": "nombre", "op": "=", "valor": "O'Higgins"}]}
        res = wb.consultar_sqlite(self.ruta, ex.armar_pivot(self.modelo, spec, "sqlite")["sql"])
        self.assertEqual(res["filas"], [[0]])

    def test_relacion_marcada_a_mano(self):
        sin = {**self.modelo, "relaciones": []}
        spec = {"filas": [{"tabla": "clientes", "columna": "provincia"}],
                "valores": [{"tabla": "ventas", "columna": "cantidad", "agregacion": "suma"}]}
        with self.assertRaises(ex.PivotInvalido):
            ex.armar_pivot(sin, spec, "sqlite")
        con = ex.con_relaciones(sin, [{"desde": {"tabla": "ventas", "columna": "cliente_id"},
                                       "hacia": {"tabla": "clientes", "columna": "id"}},
                                      {"desde": {"tabla": "ventas", "columna": "no_existe"},
                                       "hacia": {"tabla": "clientes", "columna": "id"}}])
        self.assertEqual(len(con["relaciones"]), 1)                    # la inválida no entra
        self.assertEqual(con["relaciones"][0]["origen"], "manual")
        self.assertIn("LEFT JOIN", ex.armar_pivot(con, spec, "sqlite")["sql"])


class PivotReglasTests(unittest.TestCase):
    MODELO = ex.modelo_de_tabla([{"nombre": "plan", "clases": ["categorica"]},
                                 {"nombre": "gasto", "clases": ["numerica"]},
                                 {"nombre": "alta", "clases": ["fecha"]}], 10)

    def test_no_se_suma_texto(self):
        with self.assertRaises(ex.PivotInvalido):
            ex.armar_pivot(self.MODELO, {"valores": [{"tabla": "datos", "columna": "plan", "agregacion": "suma"}]}, "sqlite")

    def test_campo_inexistente(self):
        with self.assertRaises(ex.PivotInvalido):
            ex.armar_pivot(self.MODELO, {"filas": [{"tabla": "datos", "columna": "nada"}]}, "sqlite")

    def test_sin_valores_cuenta_filas(self):
        a = ex.armar_pivot(self.MODELO, {"filas": [{"tabla": "datos", "columna": "plan"}]}, "sqlite")
        self.assertIn("COUNT(*)", a["sql"])
        self.assertEqual(a["medidas"][0]["etiqueta"], "Cantidad de filas")

    def test_tabla_csv_con_consultar_tabla(self):
        spec = {"filas": [{"tabla": "datos", "columna": "plan"}],
                "valores": [{"tabla": "datos", "columna": "gasto", "agregacion": "suma"}]}
        sql = ex.armar_pivot(self.MODELO, spec, "sqlite")["sql"]
        res = wb.consultar_tabla(["plan", "gasto", "alta"],
                                 [["A", "10", "2025-01-01"], ["B", "5", "2025-01-02"], ["A", "1", "2025-02-01"]], sql)
        self.assertEqual(res["filas"], [["A", 11.0], ["B", 5.0]])

    def test_postgres_agrupa_fechas_con_to_char(self):
        a = ex.armar_pivot(self.MODELO, {"filas": [{"tabla": "datos", "columna": "alta", "fecha": "trimestre"}]}, "postgres")
        self.assertIn("to_char", a["sql"])

    def test_clases_sql(self):
        self.assertEqual(ex.clase_sql("numeric(10,2)"), "numerica")
        self.assertEqual(ex.clase_sql("timestamp without time zone"), "fecha")
        self.assertEqual(ex.clase_sql("character varying"), "texto")
        self.assertEqual(ex.clase_sql("boolean"), "booleano")

    def test_descripcion_del_reporte(self):
        spec = {"filas": [{"tabla": "clientes", "columna": "provincia"}],
                "valores": [{"tabla": "ventas", "columna": "cantidad", "agregacion": "suma"}]}
        self.assertEqual(ex.describir_pivot(spec), "Suma de cantidad por clientes.provincia")


if __name__ == "__main__":
    unittest.main()


class RelacionesSugeridasTests(unittest.TestCase):
    """Sin claves foráneas, los nombres delatan las relaciones (como Power BI)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ruta = Path(self.tmp.name) / "sin_fk.sqlite"
        conn = sqlite3.connect(self.ruta)
        conn.executescript("""
            CREATE TABLE clientes (id INTEGER PRIMARY KEY, provincia TEXT);
            CREATE TABLE proveedores (codigo INTEGER PRIMARY KEY, nombre TEXT);
            CREATE TABLE categorias (id INTEGER, nombre TEXT);
            CREATE TABLE ventas (id INTEGER PRIMARY KEY, cliente_id INTEGER, proveedor_id INTEGER,
                id_categoria INTEGER, vendedor_id INTEGER, cantidad INTEGER);
            CREATE TABLE notas (id INTEGER PRIMARY KEY, nota_id INTEGER);
            INSERT INTO clientes VALUES (1, 'Salta'), (2, 'Jujuy');
            INSERT INTO ventas VALUES (1, 1, NULL, NULL, NULL, 3), (2, 2, NULL, NULL, NULL, 5), (3, 2, NULL, NULL, NULL, 1);
        """)
        conn.commit()
        conn.close()
        self.modelo = wb.modelo_sqlite(self.ruta)

    def tearDown(self):
        self.tmp.cleanup()

    def test_sugiere_por_nombre_singular_plural_y_clave(self):
        sugeridas = {(r["desde"]["tabla"], r["desde"]["columna"], r["hacia"]["tabla"], r["hacia"]["columna"])
                     for r in ex.sugerir_relaciones(self.modelo)}
        self.assertEqual(sugeridas, {
            ("ventas", "cliente_id", "clientes", "id"),
            ("ventas", "proveedor_id", "proveedores", "codigo"),      # su pk, aunque no se llame id
            ("ventas", "id_categoria", "categorias", "id"),           # sin pk: la columna «id»
        })                                                            # vendedor_id: no hay tabla; nota_id: misma tabla
        self.assertTrue(all(r["origen"] == "sugerida" for r in ex.sugerir_relaciones(self.modelo)))

    def test_no_sugiere_lo_que_la_base_ya_declara(self):
        with tempfile.TemporaryDirectory() as d:
            base_demo(Path(d) / "demo.sqlite")
            self.assertEqual(ex.sugerir_relaciones(wb.modelo_sqlite(Path(d) / "demo.sqlite")), [])

    def test_aceptar_la_sugerencia_habilita_la_union(self):
        spec = {"filas": [{"tabla": "clientes", "columna": "provincia"}],
                "valores": [{"tabla": "ventas", "columna": "cantidad", "agregacion": "suma"}]}
        with self.assertRaises(ex.PivotInvalido):
            ex.armar_pivot(self.modelo, spec, "sqlite")
        cliente = next(r for r in ex.sugerir_relaciones(self.modelo) if r["desde"]["columna"] == "cliente_id")
        con = ex.con_relaciones(self.modelo, [cliente])
        self.assertEqual([r["origen"] for r in con["relaciones"]], ["manual"])
        self.assertNotIn(("ventas", "cliente_id"), {(r["desde"]["tabla"], r["desde"]["columna"])
                                                   for r in ex.sugerir_relaciones(con)})
        res = wb.consultar_sqlite(self.ruta, ex.armar_pivot(con, spec, "sqlite")["sql"])
        self.assertEqual(sorted(map(tuple, res["filas"])), [("Jujuy", 6), ("Salta", 3)])


class ReporteSpecTests(unittest.TestCase):
    SPEC = {"filas": [{"tabla": "ventas", "columna": "fecha", "fecha": "mes"}],
            "valores": [{"tabla": "ventas", "columna": "cantidad", "agregacion": "suma"}]}

    def test_spec_completo_trae_los_cuatro_pozos(self):
        completo = ex.spec_completo({**self.SPEC, "limite": 200, "otra": "cosa"})
        self.assertEqual(set(completo), {"filas", "columnas", "valores", "filtros", "limite"})
        self.assertEqual(completo["columnas"], [])
        self.assertEqual(ex.spec_completo(None), {"filas": [], "columnas": [], "valores": [], "filtros": []})

    def test_la_huella_ignora_pozos_vacios(self):
        self.assertEqual(ex.huella_reporte("d1", self.SPEC), ex.huella_reporte("d1", ex.spec_completo(self.SPEC)))
        self.assertEqual(len(ex.huella_reporte("d1", self.SPEC)), 6)
        self.assertNotEqual(ex.huella_reporte("d1", self.SPEC), ex.huella_reporte("d2", self.SPEC))
        otro = {**self.SPEC, "columnas": [{"tabla": "productos", "columna": "categoria"}]}
        self.assertNotEqual(ex.huella_reporte("d1", self.SPEC), ex.huella_reporte("d1", otro))
