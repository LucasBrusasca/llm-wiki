"""Papelera: lo que se manda a la papelera vuelve idéntico, y sólo se pierde al
eliminarlo definitivamente.

Los tests de base corren contra una base DESCARTABLE que crean y borran en el servidor
de prueba (servicio demo-db), nunca contra la de Algedi. Si no está, se saltean.
"""
import os
import unittest
from datetime import datetime

import numpy as np

import papelera
from database.models import (Base, Chunk, Document, Edge, IngestJob, Node, Papelera,
                             ScriptRun, Source, UserNote)

ADMIN = os.getenv("ALGEDI_TEST_PG_ADMIN",
                  "postgresql+psycopg2://demo_admin:demo_admin@demo-db:5432/postgres")
BASE_TEST = "algedi_papelera_test"


def _vector(semilla: int) -> list[float]:
    return np.random.default_rng(semilla).random(384).astype(np.float32).tolist()


class CopiaExactaTest(unittest.TestCase):
    """Sin base: la copia de una fila vuelve igual, vectores y fechas incluidos."""

    def test_nodo_ida_y_vuelta(self):
        n = Node(id="a", label="Apunte", embedding=_vector(1), conceptos=["sql", "joins"],
                 x3d=0.25, cluster=2, created_at=datetime(2026, 9, 22, 2, 52, 0, 745361))
        copia = papelera.a_json(n)
        self.assertIsInstance(copia["embedding"], str)          # float32 en base64
        self.assertEqual(copia["created_at"], "2026-09-22T02:52:00.745361")
        vuelta = papelera.de_json(Node, copia)
        self.assertEqual(vuelta["embedding"], _vector(1))
        self.assertEqual(vuelta["created_at"], datetime(2026, 9, 22, 2, 52, 0, 745361))
        self.assertEqual(vuelta["conceptos"], ["sql", "joins"])
        self.assertIsNone(vuelta["desc"])

    def test_sin_columnas_que_se_regeneran(self):
        copia = papelera.a_json(UserNote(id=7, node_id="a", content="ojo con el ej. 3"))
        self.assertNotIn("id", papelera.de_json(UserNote, copia, sin=("id",)))


def _abrir_base():
    from sqlalchemy import create_engine, text
    admin = create_engine(ADMIN, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {BASE_TEST} WITH (FORCE)"))
        c.execute(text(f"CREATE DATABASE {BASE_TEST}"))
    admin.dispose()
    engine = create_engine(ADMIN.rsplit("/", 1)[0] + f"/{BASE_TEST}")
    with engine.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    return engine


def _cerrar_base(engine):
    from sqlalchemy import create_engine, text
    engine.dispose()
    admin = create_engine(ADMIN, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {BASE_TEST} WITH (FORCE)"))
    admin.dispose()


class PapeleraBaseTest(unittest.TestCase):
    """Contra una base descartable con el esquema de Algedi."""

    @classmethod
    def setUpClass(cls):
        try:
            cls.engine = _abrir_base()
        except Exception as e:   # sin servidor de prueba: no hay contra qué probar
            raise unittest.SkipTest(f"sin base de prueba ({type(e).__name__}): {e}")
        from sqlalchemy.orm import sessionmaker
        cls.Sesion = sessionmaker(cls.engine)

    @classmethod
    def tearDownClass(cls):
        _cerrar_base(cls.engine)

    def setUp(self):
        from sqlalchemy import text
        with self.engine.begin() as c:
            c.execute(text("TRUNCATE papelera, chunks, documents, sources, user_notes, edges, "
                           "script_runs, ingest_jobs, sections, nodes RESTART IDENTITY CASCADE"))
        with self.Sesion() as s:
            for i, nid in enumerate(("a", "b", "c")):
                s.add(Node(id=nid, label=f"Doc {nid.upper()}", dominio="maestria", embedding=_vector(i),
                           conceptos=[nid], fuente_path=f"/app/uploads/{nid}.pdf"))
            s.flush()
            for origen, destino in (("a", "b"), ("a", "c"), ("b", "c")):
                s.add(Edge(source=origen, target=destino, score=0.8, label="RELACIONADO",
                           metodo="knn_incremental", evidencia={"sim": 0.8}))
            s.add(UserNote(node_id="a", content="Repasar el ejercicio 3"))
            s.add(Source(id="src_a", kind="pdf", locator="/app/uploads/a.pdf", content_hash="h1"))
            s.flush()
            s.add(Document(id="doc_a", source_id="src_a", node_id="a", parser="pdf"))
            s.flush()
            for k in range(3):
                s.add(Chunk(id=f"ch_a_{k}", document_id="doc_a", ordinal=k, content=f"pasaje {k}",
                            page=k + 1, embedding=_vector(100 + k)))
            s.add(ScriptRun(script_id="consulta:a", node_id="a", status="completed"))
            s.add(IngestJob(id="job_a", kind="file", node_id="a", status="done"))
            s.commit()

    # ── helpers ──
    def _mover(self, *ids):
        with self.Sesion() as s:
            creados = papelera.mover(s, list(ids))
            s.commit()
            return creados

    def _restaurar(self, pid):
        with self.Sesion() as s:
            r = papelera.restaurar(s, pid)
            s.commit()
            return r

    def _aristas(self):
        from sqlalchemy import select
        with self.Sesion() as s:
            return sorted((e.source, e.target) for e in s.scalars(select(Edge)))

    # ── tests ──
    def test_cuenta_lo_que_se_va_sin_tocar_nada(self):
        with self.Sesion() as s:
            self.assertEqual(papelera.contar(s, ["a", "no-existe"]),
                             {"documentos": 1, "aristas": 2, "notas": 1, "pasajes": 3, "corridas": 1})
            self.assertIsNotNone(s.get(Node, "a"))

    def test_sale_de_todo_y_vuelve_identico(self):
        with self.Sesion() as s:
            antes = papelera.a_json(s.get(Node, "a"))
        [pid] = self._mover("a")
        with self.Sesion() as s:
            self.assertIsNone(s.get(Node, "a"))
            self.assertIsNone(s.get(Document, "doc_a"))
            self.assertIsNone(s.get(Chunk, "ch_a_0"))
            self.assertIsNone(s.get(Source, "src_a"))           # nadie más la usaba
            self.assertIsNone(s.get(ScriptRun, 1).node_id)      # el log queda, sin el vínculo
            item = s.get(Papelera, pid)
            self.assertEqual(item.resumen, {"aristas": 2, "notas": 1, "pasajes": 3, "corridas": 1})
        self.assertEqual(self._aristas(), [("b", "c")])

        r = self._restaurar(pid)
        self.assertEqual(r["aristas"], {"restauradas": 2, "esperan": 0, "perdidas": 0})
        with self.Sesion() as s:
            self.assertEqual(papelera.a_json(s.get(Node, "a")), antes)
            self.assertEqual([np.asarray(s.get(Chunk, f"ch_a_{k}").embedding, dtype=np.float32).tolist()
                              for k in range(3)],
                             [_vector(100 + k) for k in range(3)])
            self.assertEqual(s.get(Document, "doc_a").node_id, "a")
            self.assertEqual(s.get(Source, "src_a").content_hash, "h1")
            self.assertEqual(s.get(ScriptRun, 1).node_id, "a")
            self.assertEqual(s.get(IngestJob, "job_a").node_id, "a")
            from sqlalchemy import select
            self.assertEqual([n.content for n in s.scalars(select(UserNote))], ["Repasar el ejercicio 3"])
            self.assertIsNone(s.get(Papelera, pid))
        self.assertEqual(self._aristas(), [("a", "b"), ("a", "c"), ("b", "c")])

    def test_una_arista_entre_dos_borrados_vuelve_cuando_vuelven_los_dos(self):
        pa, pb = self._mover("a", "b")
        self.assertEqual(self._aristas(), [])
        r = self._restaurar(pa)              # b sigue en la papelera: a-b lo espera
        self.assertEqual(r["aristas"], {"restauradas": 1, "esperan": 1, "perdidas": 0})
        self.assertEqual(self._aristas(), [("a", "c")])
        self._restaurar(pb)
        self.assertEqual(self._aristas(), [("a", "b"), ("a", "c"), ("b", "c")])

    def test_no_pisa_un_nodo_que_volvio_a_entrar(self):
        [pid] = self._mover("c")
        with self.Sesion() as s:
            s.add(Node(id="c", label="Doc C (reingerido)", dominio="maestria"))
            s.commit()
        with self.assertRaises(papelera.Conflicto):
            self._restaurar(pid)
        with self.Sesion() as s:
            self.assertEqual(s.get(Node, "c").label, "Doc C (reingerido)")
            self.assertIsNotNone(s.get(Papelera, pid))

    def test_una_fuente_compartida_se_queda_hasta_que_se_va_el_ultimo(self):
        with self.Sesion() as s:
            s.add(Node(id="d", label="Copia de A", dominio="maestria"))
            s.flush()
            s.add(Document(id="doc_d", source_id="src_a", node_id="d", parser="pdf"))
            s.commit()
        [pa] = self._mover("a")
        with self.Sesion() as s:
            self.assertIsNotNone(s.get(Source, "src_a"))        # d todavía la usa
        [pd] = self._mover("d")
        with self.Sesion() as s:
            self.assertIsNone(s.get(Source, "src_a"))
        self._restaurar(pa)                                      # vuelve con su propia copia
        self._restaurar(pd)
        with self.Sesion() as s:
            self.assertEqual(s.get(Document, "doc_d").source_id, "src_a")
            self.assertIsNotNone(s.get(Source, "src_a"))

    def test_eliminar_definitivo_dice_que_archivo_quedo_sin_duenio(self):
        with self.Sesion() as s:
            s.add(Node(id="e", label="Otro nodo del mismo PDF", dominio="maestria",
                       fuente_path="/app/uploads/b.pdf"))
            s.commit()
        pa, pb = self._mover("a", "b")
        with self.Sesion() as s:
            resto_a = papelera.eliminar(s, pa)
            resto_b = papelera.eliminar(s, pb)
            s.commit()
            self.assertEqual(s.query(Papelera).count(), 0)
        self.assertEqual(resto_a, {"node_id": "a", "archivo": "/app/uploads/a.pdf", "miniatura": True})
        self.assertIsNone(resto_b["archivo"])                    # «e» todavía usa b.pdf
        self.assertEqual(self._aristas(), [])                    # a-c y b-c se fueron con ellos


if __name__ == "__main__":
    unittest.main()
