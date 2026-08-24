import asyncio
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np

from embeddings_engine import _apply_normalization, _normalization_for
from database.models import Chunk, Document, Source
from database.backfill_chunks import build_chunks_for_node
from main import (
    ArchitectAnalyzeRequest,
    SolveReview,
    _architect_score,
    _normalize_architect_route,
    _sanitize_solve_citations,
    _solve_list,
    analyze_with_architect,
    review_solve,
    solve_issue,
)
from processor import _auto_relaciones, crear_chunks, crear_chunks_paginas
from security_utils import UnsafeUrlError, validate_public_http_url
from vault_watcher import VaultWatcher


class RelationIsolationTests(unittest.TestCase):
    def _node(self, node_id, dominio):
        return {
            "id": node_id,
            "label": node_id,
            "dominio": dominio,
            "conceptos": ["modelo predictivo", "validación cruzada"],
            "embedding": [1.0, 0.0, 0.0],
            "is_centroid": False,
        }

    def test_different_sections_are_not_connected(self):
        rels = _auto_relaciones([
            self._node("a", "personal"),
            self._node("b", "investigacion"),
        ])
        self.assertEqual(rels, [])

    def test_same_section_can_be_connected(self):
        rels = _auto_relaciones([
            self._node("a", "personal"),
            self._node("b", "personal"),
        ])
        self.assertEqual(len(rels), 1)


class UmapNormalizationTests(unittest.TestCase):
    def test_training_and_incremental_points_share_the_same_scale(self):
        training = np.array([[0.0, 10.0, -2.0], [10.0, 30.0, 2.0]], dtype=np.float32)
        mins, ranges = _normalization_for(training)
        scaled = _apply_normalization(training, mins, ranges)
        incremental = _apply_normalization(
            np.array([[5.0, 20.0, 0.0]], dtype=np.float32), mins, ranges
        )

        np.testing.assert_allclose(scaled[0], [-1.0, -1.0, -1.0])
        np.testing.assert_allclose(scaled[1], [1.0, 1.0, 1.0])
        np.testing.assert_allclose(incremental[0], [0.0, 0.0, 0.0])


class ChunkingTests(unittest.TestCase):
    def test_long_text_is_split_with_overlap_and_positions(self):
        text = " ".join(f"palabra{i}" for i in range(700))
        chunks = crear_chunks(text)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk["content"]) <= 1400 for chunk in chunks))
        self.assertLess(chunks[1]["char_start"], chunks[0]["char_end"])
        self.assertEqual([chunk["ordinal"] for chunk in chunks], list(range(len(chunks))))

    def test_pdf_pages_remain_identifiable(self):
        chunks = crear_chunks_paginas([(1, "primera página"), (2, "segunda página")])
        self.assertEqual([chunk["page"] for chunk in chunks], [1, 2])

    def test_existing_youtube_transcript_can_be_backfilled(self):
        node = SimpleNamespace(transcript="contenido real del video " * 200, fuente_path=None)
        self.assertGreater(len(build_chunks_for_node(node)), 1)

    def test_database_incompatible_nul_is_removed(self):
        chunks = crear_chunks("antes\x00después")
        self.assertEqual(chunks[0]["content"], "antes después")


class VaultConfirmationTests(unittest.TestCase):
    def _run_one(self, ingest_result):
        with tempfile.TemporaryDirectory() as tmp:
            umap_calls = []
            watcher = VaultWatcher(tmp, lambda *_: ingest_result, lambda: umap_calls.append(1))
            digest = "digest-1"
            self.assertTrue(watcher._reserve(digest))
            self.assertFalse(watcher._reserve(digest))
            worker = threading.Thread(target=watcher._worker, daemon=True)
            worker.start()
            watcher.q.put((str(Path(tmp) / "doc.txt"), "personal", digest, "doc.txt"))
            watcher.q.join()
            watcher.stop()
            worker.join(timeout=2)
            return watcher.seen, umap_calls

    def test_failed_ingestion_is_not_marked_seen(self):
        seen, umap_calls = self._run_one(False)
        self.assertNotIn("digest-1", seen)
        self.assertEqual(umap_calls, [])

    def test_successful_ingestion_is_confirmed_and_reprojects(self):
        seen, umap_calls = self._run_one(True)
        self.assertIn("digest-1", seen)
        self.assertEqual(umap_calls, [1])


class UrlSecurityTests(unittest.TestCase):
    def test_local_and_private_urls_are_blocked(self):
        for url in ("http://localhost/admin", "http://127.0.0.1/",
                    "http://169.254.169.254/latest/meta-data/"):
            with self.subTest(url=url), self.assertRaises(UnsafeUrlError):
                validate_public_http_url(url)

    @patch("security_utils.socket.getaddrinfo")
    def test_public_dns_target_is_allowed(self, getaddrinfo):
        getaddrinfo.return_value = [
            (2, 1, 6, "", ("8.8.8.8", 443)),
        ]
        self.assertEqual(
            validate_public_http_url("https://papers.example.org/article"),
            "https://papers.example.org/article",
        )

    @patch("security_utils.socket.getaddrinfo")
    def test_dns_resolving_to_private_network_is_blocked(self, getaddrinfo):
        getaddrinfo.return_value = [
            (2, 1, 6, "", ("10.10.0.5", 443)),
        ]
        with self.assertRaises(UnsafeUrlError):
            validate_public_http_url("https://internal.example.org/")


class TraceabilitySchemaTests(unittest.TestCase):
    def test_source_document_chunk_schema_is_available(self):
        self.assertEqual(Source.__tablename__, "sources")
        self.assertIn("source_id", Document.__table__.columns)
        self.assertIn("document_id", Chunk.__table__.columns)
        self.assertIn("embedding", Chunk.__table__.columns)


class SolveContractTests(unittest.TestCase):
    def test_solve_is_persisted_on_issue_nodes(self):
        from database.models import Node
        self.assertIn("solve", Node.__table__.columns)

    def test_only_lists_cross_the_list_contract(self):
        self.assertEqual(_solve_list(["a"]), ["a"])
        self.assertEqual(_solve_list("a"), [])

    def test_nonexistent_citation_markers_are_removed(self):
        value, invalid = _sanitize_solve_citations(
            {"foundation": "Respaldado por [C1] y [C99]"}, {"C1"}
        )
        self.assertEqual(value["foundation"], "Respaldado por [C1] y [cita no válida]")
        self.assertEqual(invalid, ["C99"])

    def test_controlled_solve_flow_and_human_review(self):
        from database.models import Node

        issue = Node(id="issue-test", label="Demora", desc="El proceso tarda demasiado", is_issue=True)

        class ScalarResult:
            def scalar_one_or_none(self):
                return issue

        class FakeSession:
            def __init__(self):
                self.added = []
                self.commits = 0

            async def execute(self, _statement):
                return ScalarResult()

            def add(self, value):
                self.added.append(value)

            async def commit(self):
                self.commits += 1

        class FakeRequest:
            async def json(self):
                return {"objective": "Reducir demoras", "constraints": "Sin ampliar el equipo"}

        planner = {
            "problem_understanding": "Hay un cuello de botella.",
            "assumptions": ["La demanda es estable"],
            "alternatives": [
                {"id": "A1", "title": "Simplificar", "description": "Eliminar pasos", "pros": [], "cons": [], "foundation": "conocimiento general"},
                {"id": "A2", "title": "Automatizar", "description": "Automatizar control", "pros": [], "cons": [], "foundation": "conocimiento general"},
            ],
            "recommendation": {"alternative_id": "A1", "why": "Menor riesgo", "conditions": []},
            "future_process": {"steps": [], "connections": []},
            "roadmap": [], "risks": [], "kpis": [], "missing_information": [],
        }
        verifier = {
            "verdict": "viable_with_changes", "recommended_alternative_id": "A1",
            "findings": [], "evidence_gaps": ["Falta línea base"], "required_changes": [],
        }
        session = FakeSession()
        with patch("main._chunks_relevantes_scored", new=AsyncMock(return_value=[])), \
             patch("processor.query_llm", side_effect=[json.dumps(planner), json.dumps(verifier)]):
            result = asyncio.run(solve_issue("issue-test", FakeRequest(), session))

        self.assertEqual(result["human_review"]["status"], "pending")
        self.assertEqual(len(result["alternatives"]), 2)
        self.assertEqual(issue.solve["critical_review"]["verdict"], "viable_with_changes")

        reviewed = asyncio.run(review_solve(
            "issue-test", SolveReview(decision="approved", note="Validado en piloto"), session
        ))
        self.assertEqual(reviewed["human_review"]["status"], "approved")
        self.assertEqual(reviewed["human_review"]["history"][0]["note"], "Validado en piloto")


class ArchitectContractTests(unittest.TestCase):
    def test_route_aliases_are_bounded_to_product_taxonomy(self):
        self.assertEqual(_normalize_architect_route("IA asistiva"), "assistive")
        self.assertEqual(_normalize_architect_route("agente"), "agent")
        self.assertEqual(_normalize_architect_route("una categoría inventada"), "none")
        self.assertEqual(_architect_score(9), 5)
        self.assertEqual(_architect_score("3"), 3)
        self.assertEqual(_architect_score("sin puntaje"), 1)

    def test_architect_uses_planner_and_independent_verifier(self):
        class FakeSession:
            def __init__(self):
                self.added = []
                self.commits = 0

            def add(self, value):
                self.added.append(value)

            async def commit(self):
                self.commits += 1

        planner = {
            "classification": "data",
            "problem_understanding": "La necesidad principal es consolidar información.",
            "trace": ["recuperar", "clasificar", "comparar", "verificar", "decidir"],
            "assumptions": ["Los archivos tienen estructura estable"],
            "alternatives": [
                {"route": "redesign", "title": "Ordenar", "proposal": "Definir entradas", "foundation": "conocimiento general"},
                {"route": "rules", "title": "Automatizar", "proposal": "Validaciones fijas", "foundation": "conocimiento general"},
                {"route": "data", "title": "Consolidar", "proposal": "Capa de datos", "foundation": "conocimiento general"},
            ],
            "matrix": [
                {"route": route, "impact": 4, "data_readiness": 3, "complexity": 4, "risk": 4, "cost": 4, "rationale": "prueba"}
                for route in ("redesign", "rules", "data")
            ],
            "recommendation": {"route": "data", "why": "Intervención mínima", "conditions": []},
            "missing_information": ["Línea base"],
            "pilot": {"scope": "Un reporte", "success_signal": "Menos reproceso", "stop_condition": "Sin mejora"},
        }
        verifier = {
            "verdict": "viable_with_changes", "agrees_with_route": True,
            "suggested_route": "data", "objection": "Validar calidad antes de automatizar.",
            "findings": [], "evidence_gaps": ["Línea base"], "required_changes": [],
        }
        payload = ArchitectAnalyzeRequest(
            case_name="Reporte", problem="Las planillas se consolidan manualmente cada mes"
        )
        session = FakeSession()
        with patch("main._chunks_relevantes_scored", new=AsyncMock(return_value=[])), \
             patch("processor.query_llm", side_effect=[json.dumps(planner), json.dumps(verifier)]):
            result = asyncio.run(analyze_with_architect(payload, session))

        self.assertEqual(result["classification"], "data")
        self.assertEqual(result["critical_review"]["verdict"], "viable_with_changes")
        self.assertEqual(result["human_review"]["status"], "pending")
        self.assertEqual(session.commits, 1)


if __name__ == "__main__":
    unittest.main()
