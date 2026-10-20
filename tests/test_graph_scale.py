"""Payload del grafo: aristas de la sección, tope por nodo, clustering."""
import unittest

from graph_payload import (
    GRAPH_CLUSTER_THRESHOLD, GRAPH_EDGES_PER_NODE, GRAPH_NODE_CAP,
    agrupar_por_tema, aristas_entre, cap_edges_per_node, clave_cluster,
    hnsw_ef_search, hnsw_settings_sql, sql_knn_chunks, sql_knn_nodos,
)


class AristasEntreTests(unittest.TestCase):
    def test_descarta_aristas_con_un_extremo_afuera(self):
        ids = {"a", "b"}
        edges = [
            {"source": "a", "target": "b", "score": 0.9},
            {"source": "a", "target": "z", "score": 0.8},
            {"source": "x", "target": "y", "score": 0.99},
        ]
        got = aristas_entre(edges, ids)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["target"], "b")

    def test_no_devuelve_todas_las_aristas_de_la_base(self):
        """Regresión: /api/graph no debe serializar edges de otras secciones."""
        ids = {f"s1-{i}" for i in range(10)}
        edges = (
            [{"source": f"s1-{i}", "target": f"s1-{(i+1)%10}", "score": 0.7} for i in range(10)]
            + [{"source": f"s2-{i}", "target": f"s2-{(i+1)%50}", "score": 0.7} for i in range(50)]
        )
        got = aristas_entre(edges, ids)
        self.assertEqual(len(got), 10)
        self.assertTrue(all(e["source"].startswith("s1-") for e in got))


class CapEdgesTests(unittest.TestCase):
    def test_hub_no_manda_mas_de_k_rayos(self):
        hub = "h"
        edges = [{"source": hub, "target": f"n{i}", "score": 1 - i * 0.01} for i in range(40)]
        got = cap_edges_per_node(edges, k=8)
        self.assertLessEqual(len(got), 8)
        scores = [e["score"] for e in got]
        self.assertEqual(scores, sorted(scores, reverse=True)[:len(scores)])

    def test_default_k_es_configurable(self):
        self.assertGreaterEqual(GRAPH_EDGES_PER_NODE, 4)
        self.assertLessEqual(GRAPH_EDGES_PER_NODE, 16)


class ClusteringTests(unittest.TestCase):
    def test_por_debajo_del_umbral_no_agrupa(self):
        nodos = [{"id": f"n{i}", "tema": "a", "x3d": 0, "y3d": 0, "z3d": 0} for i in range(10)]
        out, clustered = agrupar_por_tema(nodos, threshold=1500)
        self.assertFalse(clustered)
        self.assertEqual(len(out), 10)

    def test_por_encima_resume_por_tema(self):
        nodos = []
        for t in ("alpha", "beta"):
            for i in range(20):
                nodos.append({"id": f"{t}-{i}", "tema": t, "x3d": 1.0, "y3d": 2.0, "z3d": 3.0,
                              "dominio": "personal"})
        out, clustered = agrupar_por_tema(nodos, threshold=10)
        self.assertTrue(clustered)
        self.assertEqual(len(out), 2)
        self.assertTrue(all(n["is_cluster"] for n in out))
        self.assertEqual({n["node_count"] for n in out}, {20})

    def test_clave_sin_tema_usa_cluster(self):
        self.assertEqual(clave_cluster({"cluster": 3}), "cluster_3")
        self.assertEqual(clave_cluster({"tema": "leyes"}), "leyes")


class CapsConfigTests(unittest.TestCase):
    def test_caps_razonables(self):
        self.assertGreaterEqual(GRAPH_NODE_CAP, 500)
        self.assertGreaterEqual(GRAPH_CLUSTER_THRESHOLD, 500)
        self.assertLessEqual(GRAPH_CLUSTER_THRESHOLD, GRAPH_NODE_CAP + 500)


class HnswSqlTests(unittest.TestCase):
    def test_ef_search_es_al_menos_k(self):
        self.assertGreaterEqual(hnsw_ef_search(50), 50)
        self.assertGreaterEqual(hnsw_ef_search(10), 40)

    def test_settings_incluyen_iterative_scan(self):
        stmts = hnsw_settings_sql(40)
        self.assertTrue(any("hnsw.ef_search" in s for s in stmts))
        self.assertTrue(any("iterative_scan" in s for s in stmts))

    def test_knn_seccion_filtra_dominio(self):
        sql = sql_knn_nodos(seccion="leyes", exclude_id=True)
        self.assertIn("dominio = :seccion", sql)
        self.assertIn("id != :nid", sql)
        self.assertIn("embedding <=>", sql)

    def test_knn_doc_filtra_node_id(self):
        sql = sql_knn_chunks(node_id=True)
        self.assertIn("d.node_id = :node_id", sql)
        self.assertNotIn("dominio", sql)

    def test_knn_chunks_seccion(self):
        sql = sql_knn_chunks(seccion="economia")
        self.assertIn("n.dominio = :seccion", sql)


class InitDbTimelineTests(unittest.TestCase):
    def test_alter_known_since_y_valid_from(self):
        from pathlib import Path
        text = Path("database/init_db.py").read_text(encoding="utf-8")
        self.assertIn("known_since TIMESTAMPTZ", text)
        self.assertIn("valid_from TIMESTAMPTZ", text)
        self.assertIn("SET known_since = created_at", text)


if __name__ == "__main__":
    unittest.main()
