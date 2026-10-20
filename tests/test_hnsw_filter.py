"""HNSW filtrado por sección/doc debe devolver k completo.

pgvector recorre el índice, toma `ef_search` candidatos y DESPUÉS aplica el WHERE.
Sin iterative_scan / ef_search alto, un filtro de sección devolvía 3 vecinos de 40.
Este test replica el recorte (HNSW-naive) vs prefilter+kNN (lo que queremos)
con vectores en memoria: no requiere Postgres.
"""
import unittest

import numpy as np

from graph_payload import hnsw_ef_search, hnsw_settings_sql, sql_knn_chunks, sql_knn_nodos


def _norm(m):
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1
    return m / n


def knn_naive_then_filter(emb, labels, query, k, seccion):
    """Lo que hace HNSW sin iterative_scan: top-k global, después filtra."""
    sims = emb @ query
    order = np.argsort(-sims)[:k]
    return [i for i in order if labels[i] == seccion]


def knn_prefilter(emb, labels, query, k, seccion):
    """Prefilter: kNN sólo dentro de la sección → siempre k si hay ≥k en la sección."""
    mask = labels == seccion
    idx = np.where(mask)[0]
    sims = emb[idx] @ query
    order = np.argsort(-sims)[:k]
    return idx[order].tolist()


class HnswFilterKTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        # 80 docs en "a" (lejos), 320 en "b" (cerca del query). El top-k global
        # queda lleno de "b"; filtrar a "a" después deja k incompleto.
        self.emb_a = _norm(rng.normal(loc=3.0, scale=0.2, size=(80, 32)).astype(np.float32))
        self.emb_b = _norm(rng.normal(loc=0.0, scale=0.4, size=(320, 32)).astype(np.float32))
        self.emb = np.vstack([self.emb_a, self.emb_b])
        self.labels = np.array(["a"] * 80 + ["b"] * 320)
        self.query = _norm(rng.normal(loc=0.0, scale=0.1, size=(1, 32)).astype(np.float32))[0]
        self.k = 40

    def test_naive_hnsw_recorta_k_con_filtro_selectivo(self):
        got = knn_naive_then_filter(self.emb, self.labels, self.query, self.k, "a")
        self.assertLess(len(got), self.k, "el recorte naive debería perder vecinos")

    def test_prefilter_devuelve_k_completo_de_la_seccion(self):
        got = knn_prefilter(self.emb, self.labels, self.query, self.k, "a")
        self.assertEqual(len(got), self.k)
        self.assertTrue(all(self.labels[i] == "a" for i in got))

    def test_doc_scoped_sql_no_usa_indice_global(self):
        """Un documento ~dezenas de chunks: el WHERE al documento es el prefilter."""
        sql = sql_knn_chunks(node_id=True)
        self.assertIn("d.node_id = :node_id", sql)
        self.assertIn("LIMIT :lim", sql)

    def test_seccion_sql_declara_filtro_y_settings_de_scan(self):
        sql = sql_knn_nodos(seccion="a")
        self.assertIn("dominio = :seccion", sql)
        stmts = hnsw_settings_sql(self.k)
        self.assertGreaterEqual(hnsw_ef_search(self.k), self.k)
        self.assertTrue(any("iterative_scan" in s for s in stmts))


class IngestConcurrencyConfigTests(unittest.TestCase):
    def test_parallel_y_workers_son_configurables(self):
        import main as m
        self.assertGreaterEqual(m.INGEST_PARALLEL, 1)
        self.assertGreaterEqual(m.INGEST_WORKERS, 1)
        self.assertTrue(hasattr(m, "_DB_WRITE_GATE"))
        self.assertTrue(hasattr(m, "_reservar_slot_ingest"))


if __name__ == "__main__":
    unittest.main()
