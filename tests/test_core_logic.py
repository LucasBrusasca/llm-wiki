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
from processor import (
    _auto_relaciones,
    _describir_relacion,
    _resolver_tema,
    crear_chunks,
    crear_chunks_paginas,
    relaciones_incrementales,
)
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

            async def execute(self, _statement):
                # Architect persiste la corrida como expediente y primero pregunta si el
                # caso ya existe. Devolver "no existe" ejercita el alta, que es el camino
                # que este test verifica.
                class SinResultado:
                    def scalar_one_or_none(self):
                        return None
                return SinResultado()

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


class RelacionesIncrementalesTests(unittest.TestCase):
    """El camino de la ingesta no debe inventar aristas distintas de las del recálculo
    global: sólo mirar menos candidatos. Si divergieran, una misma arista significaría
    cosas distintas según cómo entró al grafo."""

    CONCEPTOS = [
        ["recuperacion densa", "grafo semantico", "trazabilidad", "evidencia citable"],
        ["recuperacion densa", "grafo semantico", "veto epistemico", "chunking"],
        ["balance contable", "amortizacion", "ejercicio fiscal", "auditoria"],
        ["balance contable", "amortizacion", "estados financieros", "auditoria"],
        ["turbina eolica", "generacion distribuida", "red electrica", "despacho"],
        ["turbina eolica", "generacion distribuida", "tarifa", "concesion"],
    ]

    def _corpus(self):
        rng = np.random.default_rng(7)
        nodos = []
        for indice, conceptos in enumerate(self.CONCEPTOS):
            # Tres pares tematicos: los vectores dentro de un par se parecen entre si.
            base = rng.standard_normal(16) if indice % 2 == 0 else None
            if base is None:
                base = np.array(nodos[-1]["embedding"]) + rng.standard_normal(16) * 0.25
            vector = base / np.linalg.norm(base)
            nodos.append({
                "id": f"n{indice}", "label": f"Documento {indice}",
                "conceptos": conceptos, "embedding": vector.tolist(),
                "dominio": "personal", "is_centroid": False,
            })
        return nodos

    def test_incremental_no_inventa_aristas_fuera_del_calculo_global(self):
        nodos = self._corpus()
        stats = {}
        globales = _auto_relaciones(nodos, stats)
        pares_globales = {frozenset((r["source"], r["target"])) for r in globales}

        for nodo in nodos:
            vecinos = [
                {**otro, "sim": None} for otro in nodos if otro["id"] != nodo["id"]
            ]
            for rel in relaciones_incrementales(nodo, vecinos, piso=stats["floor"]):
                self.assertIn(
                    frozenset((rel["source"], rel["target"])), pares_globales,
                    f"la ingesta creo una arista que el recalculo global descarta: {rel}",
                )

    def test_incremental_conserva_score_y_conceptos_compartidos(self):
        nodos = self._corpus()
        stats = {}
        globales = _auto_relaciones(nodos, stats)
        por_par = {frozenset((r["source"], r["target"])): r for r in globales}

        vecinos = [{**otro, "sim": None} for otro in nodos if otro["id"] != "n0"]
        incrementales = relaciones_incrementales(nodos[0], vecinos, piso=stats["floor"])
        self.assertTrue(incrementales, "n0 deberia conectarse con su par tematico n1")
        for rel in incrementales:
            equivalente = por_par[frozenset((rel["source"], rel["target"]))]
            self.assertEqual(rel["score"], equivalente["score"])
            self.assertEqual(rel["label"], equivalente["label"])
            self.assertEqual(
                sorted(rel["shared_concepts"]), sorted(equivalente["shared_concepts"])
            )

    def test_secciones_distintas_no_se_conectan_en_la_ingesta(self):
        nodos = self._corpus()
        nodo = nodos[0]
        vecinos = [{**otro, "dominio": "investigacion", "sim": 0.99}
                   for otro in nodos if otro["id"] != nodo["id"]]
        self.assertEqual(relaciones_incrementales(nodo, vecinos, piso=0.0), [])

    def test_sin_embedding_no_hay_aristas(self):
        nodos = self._corpus()
        huerfano = {**nodos[0], "embedding": None}
        vecinos = [{**otro, "sim": 0.9} for otro in nodos[1:]]
        self.assertEqual(relaciones_incrementales(huerfano, vecinos), [])

    def test_el_piso_medido_filtra_vecinos_debiles(self):
        nodos = self._corpus()
        vecinos = [{**otro, "sim": 0.10} for otro in nodos[1:]
                   if otro["conceptos"][0] != nodos[0]["conceptos"][0]]
        sin_piso = relaciones_incrementales(nodos[0], vecinos, piso=0.0)
        con_piso = relaciones_incrementales(nodos[0], vecinos, piso=0.5)
        self.assertTrue(sin_piso)
        self.assertEqual(con_piso, [])


class ConfinamientoDeArchivosTests(unittest.TestCase):
    """`/doc`, `/thumbnail` y `/excel-preview` reciben una ruta del cliente. Confinarla
    a la raíz del repo no alcanzaba: ahí viven .env y el código."""

    def test_no_se_puede_pedir_el_env_ni_el_codigo(self):
        from fastapi import HTTPException
        from main import _resolve
        for ruta in (".env", "main.py", "processor.py", ".env.example",
                     "database/connection.py"):
            with self.assertRaises(HTTPException, msg=f"quedo servible: {ruta}") as caso:
                _resolve(ruta)
            self.assertEqual(caso.exception.status_code, 404)

    def test_no_se_puede_escapar_con_rutas_relativas(self):
        from fastapi import HTTPException
        from main import _resolve
        for ruta in ("../../../etc/passwd", "uploads/../.env", "uploads/../../secreto"):
            with self.assertRaises(HTTPException):
                _resolve(ruta)

    def test_un_documento_ingerido_si_se_sirve(self):
        from main import UPLOADS, _resolve
        UPLOADS.mkdir(exist_ok=True)
        archivo = UPLOADS / "_prueba_confinamiento.txt"
        archivo.write_text("contenido", encoding="utf-8")
        try:
            self.assertEqual(_resolve("uploads/_prueba_confinamiento.txt"), archivo.resolve())
            # También por nombre suelto: las rutas guardadas dentro de Docker vienen
            # con el prefijo /app y tienen que seguir resolviendo fuera del contenedor.
            self.assertEqual(_resolve("/app/uploads/_prueba_confinamiento.txt"),
                             archivo.resolve())
        finally:
            archivo.unlink()


class DescripcionDeRelacionTests(unittest.TestCase):
    def test_la_etiqueta_describe_la_fuerza_del_vinculo(self):
        fuerte = _describir_relacion("a", "b", 0.80, ["uno", "dos"])
        self.assertEqual(fuerte["label"], "COMPLEMENTA_A")
        media = _describir_relacion("a", "b", 0.60, ["uno", "dos"])
        self.assertEqual(media["label"], "PROFUNDIZA_EN")
        floja = _describir_relacion("a", "b", 0.10, [])
        self.assertEqual(floja["label"], "SEMANTICAMENTE_SIMILAR_A")

    def test_la_descripcion_menciona_los_conceptos_compartidos(self):
        rel = _describir_relacion("a", "b", 0.50, ["chunking", "trazabilidad"])
        self.assertIn("chunking", rel["description"])
        self.assertIn("2 conceptos", rel["description"])


class ResolucionDeTemaTests(unittest.TestCase):
    """La clasificacion en lote nunca debe estrenar un tema: la taxonomia solo la crea
    el reagrupado global."""

    TEMAS = ["Agentes y Razonamiento IA", "Recuperacion y RAG"]

    def test_respuesta_exacta_se_acepta(self):
        self.assertEqual(_resolver_tema("Recuperacion y RAG", self.TEMAS),
                         "Recuperacion y RAG")

    def test_respuesta_con_comillas_o_mayusculas_se_normaliza(self):
        self.assertEqual(_resolver_tema('"recuperacion y rag"', self.TEMAS),
                         "Recuperacion y RAG")

    def test_tema_inventado_cae_en_sin_clasificar(self):
        self.assertEqual(_resolver_tema("Vision por Computadora", self.TEMAS),
                         "Sin clasificar")

    def test_abstencion_explicita_se_respeta(self):
        self.assertEqual(_resolver_tema("Sin clasificar", self.TEMAS), "Sin clasificar")


if __name__ == "__main__":
    unittest.main()
