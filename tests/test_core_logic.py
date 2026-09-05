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
    RelationReview,
    SolveReview,
    _architect_score,
    _normalize_architect_route,
    _rescatar_decisiones_humanas,
    _restaurar_aristas_manuales,
    _sanitize_solve_citations,
    _solve_list,
    analyze_with_architect,
    edge_to_dict,
    review_relation,
    review_solve,
    solve_issue,
)
from processor import (
    METODO_GLOBAL,
    METODO_INCREMENTAL,
    _auto_relaciones,
    _clasificar_base,
    _describir_relacion,
    _resolver_tema,
    crear_chunks,
    crear_chunks_paginas,
    relaciones_incrementales,
)
from security_utils import UnsafeUrlError, validate_public_http_url
from vigencia import (
    MOTIVO_ARCHIVO_AUSENTE,
    MOTIVO_ARCHIVO_MODIFICADO,
    MOTIVO_LINEA_BASE_NUEVA,
    MOTIVO_NO_VERIFICABLE,
    MOTIVO_REINGESTA,
    MOTIVO_SIN_CAMBIOS,
    POSIBLEMENTE_DESACTUALIZADO,
    REEMPLAZADO,
    VIGENTE,
    aplicar_decision_humana,
    estado_inicial,
    fecha_contenido_conocida,
    registrar_ingesta,
    resolver_estado,
    verificar_contra_disco,
)
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


class ProcedenciaDeRelacionTests(unittest.TestCase):
    """Una arista tiene que poder decir POR QUE existe: con que metodo se calculo, que
    la sostiene y con que numeros. Sin esto el grafo muestra que dos cosas estan unidas
    y el usuario no puede distinguir "comparten conceptos escritos" de "sus vectores
    quedaron cerca"."""

    def test_conceptos_compartidos_hacen_la_relacion_explicita(self):
        rel = _describir_relacion("a", "b", 0.62, ["chunking", "trazabilidad"],
                                  metodo=METODO_GLOBAL, piso=0.40, piso_medido=True)
        self.assertEqual(rel["base_relacion"], "explicita")
        self.assertEqual(rel["evidencia"]["n_conceptos_compartidos"], 2)
        self.assertTrue(rel["evidencia"]["comparte_conceptos_suficientes"])

    def test_sin_conceptos_pero_con_piso_medido_la_relacion_es_semantica(self):
        rel = _describir_relacion("a", "b", 0.62, [],
                                  metodo=METODO_GLOBAL, piso=0.40, piso_medido=True)
        self.assertEqual(rel["base_relacion"], "semantica")
        self.assertTrue(rel["evidencia"]["supera_piso"])

    def test_un_solo_concepto_no_alcanza_para_explicita(self):
        rel = _describir_relacion("a", "b", 0.62, ["trazabilidad"],
                                  metodo=METODO_GLOBAL, piso=0.40, piso_medido=True)
        self.assertEqual(rel["base_relacion"], "semantica")

    def test_piso_no_medido_degrada_la_relacion_a_inferida(self):
        """Superar un umbral que nadie midio sobre este corpus es cumplir un supuesto,
        no un umbral observado. Tiene que verse distinto."""
        rel = _describir_relacion("a", "b", 0.62, [],
                                  metodo=METODO_INCREMENTAL, piso=0.35, piso_medido=False)
        self.assertEqual(rel["base_relacion"], "inferida")
        self.assertFalse(rel["evidencia"]["piso_medido"])
        self.assertEqual(rel["evidencia"]["piso_usado"], 0.35)

    def test_la_evidencia_guarda_los_numeros_que_sostienen_la_arista(self):
        rel = _describir_relacion("a", "b", 0.71, ["rag", "grafo"],
                                  metodo=METODO_GLOBAL, piso=0.44, piso_medido=True)
        ev = rel["evidencia"]
        self.assertEqual(ev["similitud_coseno"], 0.71)
        self.assertEqual(ev["piso_usado"], 0.44)
        self.assertEqual(ev["conceptos_compartidos"], ["rag", "grafo"])
        self.assertTrue(ev["modelo_embeddings"])
        self.assertTrue(ev["k_vecinos"])

    def test_clasificar_base_sin_piso_no_inventa_una_clase_fuerte(self):
        self.assertEqual(_clasificar_base(0.9, [], None, False), "inferida")

    def test_cada_camino_de_calculo_declara_su_propio_metodo(self):
        """El incremental y el global NO son el mismo criterio (uno mira el top-K del
        nodo nuevo, el otro el de ambos extremos). La arista tiene que decir cual la
        creo, o su score se vuelve incomparable."""
        rng = np.random.default_rng(11)
        base = rng.standard_normal(16)
        base /= np.linalg.norm(base)
        otro = base + rng.standard_normal(16) * 0.2
        otro /= np.linalg.norm(otro)
        nodos = [
            {"id": "n0", "label": "A", "conceptos": ["rag", "grafo"],
             "embedding": base.tolist(), "dominio": "personal", "is_centroid": False},
            {"id": "n1", "label": "B", "conceptos": ["rag", "grafo"],
             "embedding": otro.tolist(), "dominio": "personal", "is_centroid": False},
        ]
        stats = {}
        globales = _auto_relaciones(nodos, stats)
        self.assertTrue(globales)
        for rel in globales:
            self.assertEqual(rel["metodo"], METODO_GLOBAL)
            self.assertTrue(rel["evidencia"]["piso_medido"])

        vecinos = [{**nodos[1], "sim": None}]
        incrementales = relaciones_incrementales(nodos[0], vecinos, piso=stats["floor"])
        self.assertTrue(incrementales)
        for rel in incrementales:
            self.assertEqual(rel["metodo"], METODO_INCREMENTAL)

    def test_ingesta_sin_piso_medido_marca_sus_aristas_como_inferidas(self):
        """Camino real de una instalacion nueva: se ingiere antes de que exista un
        recalculo global, asi que el piso es el default. No debe presentarse como
        una relacion semantica medida."""
        rng = np.random.default_rng(3)
        base = rng.standard_normal(16)
        base /= np.linalg.norm(base)
        nodo = {"id": "n0", "label": "A", "conceptos": ["alfa"],
                "embedding": base.tolist(), "dominio": "personal"}
        vecino = {"id": "n1", "label": "B", "conceptos": ["beta"],
                  "embedding": base.tolist(), "dominio": "personal", "sim": 0.90}
        rels = relaciones_incrementales(nodo, vecino and [vecino], piso=None)
        self.assertTrue(rels)
        self.assertEqual(rels[0]["base_relacion"], "inferida")
        self.assertFalse(rels[0]["evidencia"]["piso_medido"])


class AristaSinProcedenciaTests(unittest.TestCase):
    """Aristas anteriores a esta trazabilidad. No se les puede inventar un metodo:
    tienen que viajar como `None` y el panel las muestra como 'origen no registrado'."""

    def test_una_arista_vieja_no_recibe_procedencia_inventada(self):
        vieja = SimpleNamespace(
            source="a", target="b", score=0.5, shared_concepts=["x"],
            label="RELACIONADO_CON", description="…",
            metodo=None, base_relacion=None, evidencia=None, revision=None,
            is_manual=None,
        )
        d = edge_to_dict(vieja)
        self.assertIsNone(d["metodo"])
        self.assertIsNone(d["base_relacion"])
        self.assertIsNone(d["evidencia"])
        self.assertIsNone(d["revision"])
        self.assertFalse(d["is_manual"])
        # Lo que si tenia se conserva intacto: no hay perdida de datos.
        self.assertEqual(d["score"], 0.5)
        self.assertEqual(d["shared_concepts"], ["x"])
        self.assertEqual(d["label"], "RELACIONADO_CON")


class _FakeQuery:
    def __init__(self, filas):
        self._filas = filas

    def filter(self, *_a, **_k):
        return self

    def all(self):
        return self._filas


class _FakeSession:
    """Doble minimo de sesion sincronica: solo lo que usan los helpers de rescate."""

    def __init__(self, filas):
        self._filas = filas
        self.insertados = []

    def query(self, _modelo):
        return _FakeQuery(self._filas)

    def execute(self, stmt):
        self.insertados.append(stmt)


class DecisionesHumanasSobrevivenAlRecalculoTests(unittest.TestCase):
    """El recalculo global borra TODAS las aristas y las rehace. El calculo se puede
    rehacer; el juicio de una persona no. Si la revision se perdiera, el grafo
    olvidaria a sus revisores en cada reagrupado."""

    def _arista(self, source, target, revision=None, is_manual=False):
        return SimpleNamespace(
            source=source, target=target, score=0.6, shared_concepts=["x"],
            label="RELACIONADO_CON", description="…", metodo=METODO_GLOBAL,
            base_relacion="explicita", evidencia={"similitud_coseno": 0.6},
            revision=revision, is_manual=is_manual,
        )

    def test_la_revision_humana_se_rescata_antes_de_borrar(self):
        revision = {"estado": "rechazada", "comentario": "no corresponde"}
        session = _FakeSession([
            self._arista("a", "b", revision=revision),
            self._arista("c", "d"),
        ])
        revisiones, manuales = _rescatar_decisiones_humanas(session, object())
        self.assertEqual(revisiones, {("a", "b"): revision})
        self.assertEqual(manuales, [])

    def test_las_aristas_manuales_se_rescatan_y_se_reponen(self):
        session = _FakeSession([self._arista("a", "b", is_manual=True)])
        _, manuales = _rescatar_decisiones_humanas(session, object())
        self.assertEqual(len(manuales), 1)
        self.assertTrue(manuales[0]["is_manual"])
        self.assertEqual(manuales[0]["source"], "a")

        from database.models import Edge as EdgeModel
        destino = _FakeSession([])
        _restaurar_aristas_manuales(destino, EdgeModel, manuales)
        self.assertEqual(len(destino.insertados), 1)

    def test_una_arista_sin_revision_ni_manual_no_deja_rastro(self):
        session = _FakeSession([self._arista("a", "b")])
        revisiones, manuales = _rescatar_decisiones_humanas(session, object())
        self.assertEqual(revisiones, {})
        self.assertEqual(manuales, [])


class RevisionDeRelacionTests(unittest.TestCase):
    """Registrar que una persona miro una relacion es lo que separa "el sistema
    propuso" de "alguien lo valido"."""

    def _db(self, arista):
        db = SimpleNamespace()
        resultado = SimpleNamespace(scalars=lambda: SimpleNamespace(first=lambda: arista))
        db.execute = AsyncMock(return_value=resultado)
        db.commit = AsyncMock()
        return db

    def test_confirmar_deja_estado_comentario_y_fecha(self):
        arista = SimpleNamespace(source="a", target="b", revision=None)
        db = self._db(arista)
        salida = asyncio.run(review_relation(
            RelationReview(source="a", target="b", estado="confirmada",
                           comentario="revisado a mano"), db))
        self.assertEqual(arista.revision["estado"], "confirmada")
        self.assertEqual(arista.revision["comentario"], "revisado a mano")
        self.assertTrue(arista.revision["fecha"])
        self.assertTrue(salida["ok"])

    def test_rechazar_no_borra_la_arista_solo_la_marca(self):
        arista = SimpleNamespace(source="a", target="b", revision=None)
        db = self._db(arista)
        asyncio.run(review_relation(
            RelationReview(source="a", target="b", estado="rechazada"), db))
        self.assertEqual(arista.revision["estado"], "rechazada")
        # La arista sigue existiendo: se conserva la evidencia de que el calculo fallo.
        self.assertEqual(arista.source, "a")
        self.assertEqual(arista.target, "b")

    def test_quitar_la_revision_vuelve_a_sin_revisar(self):
        arista = SimpleNamespace(source="a", target="b",
                                 revision={"estado": "confirmada"})
        db = self._db(arista)
        asyncio.run(review_relation(
            RelationReview(source="a", target="b", estado="sin_revisar"), db))
        self.assertIsNone(arista.revision)

    def test_un_estado_inventado_se_rechaza(self):
        from fastapi import HTTPException
        db = self._db(SimpleNamespace(source="a", target="b", revision=None))
        with self.assertRaises(HTTPException) as caso:
            asyncio.run(review_relation(
                RelationReview(source="a", target="b", estado="verdadera"), db))
        self.assertEqual(caso.exception.status_code, 400)

    def test_revisar_una_relacion_inexistente_no_crea_nada(self):
        from fastapi import HTTPException
        db = self._db(None)
        with self.assertRaises(HTTPException) as caso:
            asyncio.run(review_relation(
                RelationReview(source="a", target="zzz", estado="confirmada"), db))
        self.assertEqual(caso.exception.status_code, 404)



class VigenciaNoSeInventaTests(unittest.TestCase):
    """La regla que sostiene todo P2: la antiguedad NO es senal de desactualizacion.
    Si esto se rompe, el producto empieza a afirmar cosas que no observo."""

    AHORA = "2026-09-02T00:00:00+00:00"

    def test_la_fecha_de_carga_no_cambia_el_estado(self):
        """Dos fuentes identicas salvo por cuando se cargaron deben terminar igual.
        Es el test que impide 'esto es de 2019, marcalo como viejo'."""
        vieja = verificar_contra_disco(
            {"version": 1, "historial": []}, "hash_a", "hash_a", True, True,
            "2019-01-01T00:00:00+00:00")
        nueva = verificar_contra_disco(
            {"version": 1, "historial": []}, "hash_a", "hash_a", True, True,
            "2026-09-02T00:00:00+00:00")
        self.assertEqual(vieja[0], nueva[0])
        self.assertEqual(vieja[0], VIGENTE)
        self.assertEqual(vieja[1]["motivo"], nueva[1]["motivo"])

    def test_el_modulo_no_mira_ninguna_fecha_de_incorporacion(self):
        """Ni siquiera recibe la fecha de carga como parametro: no puede usarla."""
        import inspect
        import vigencia as modulo
        firma = inspect.signature(modulo.verificar_contra_disco)
        self.assertNotIn("created_at", firma.parameters)
        self.assertNotIn("incorporada_en", firma.parameters)
        fuente = inspect.getsource(modulo)
        self.assertNotIn("created_at", fuente)

    def test_archivo_sin_cambios_queda_vigente(self):
        estado, vig = verificar_contra_disco(None, "h1", "h1", True, True, self.AHORA)
        self.assertEqual(estado, VIGENTE)
        self.assertEqual(vig["motivo"], MOTIVO_SIN_CAMBIOS)

    def test_archivo_modificado_marca_posiblemente_desactualizado(self):
        estado, vig = verificar_contra_disco(None, "h1", "h2", True, True, self.AHORA)
        self.assertEqual(estado, POSIBLEMENTE_DESACTUALIZADO)
        self.assertEqual(vig["motivo"], MOTIVO_ARCHIVO_MODIFICADO)
        self.assertEqual(vig["hash_en_disco"], "h2")

    def test_archivo_ausente_marca_posiblemente_desactualizado(self):
        estado, vig = verificar_contra_disco(None, "h1", None, False, True, self.AHORA)
        self.assertEqual(estado, POSIBLEMENTE_DESACTUALIZADO)
        self.assertEqual(vig["motivo"], MOTIVO_ARCHIVO_AUSENTE)

    def test_una_url_no_verificable_no_se_degrada(self):
        """No verificable NO es lo mismo que desactualizado. Degradar una URL por no
        poder comprobarla offline seria inventar el estado."""
        estado, vig = verificar_contra_disco(None, None, None, False, False, self.AHORA)
        self.assertEqual(estado, VIGENTE)
        self.assertEqual(vig["motivo"], MOTIVO_NO_VERIFICABLE)

    def test_sin_hash_previo_se_fija_la_linea_base_y_se_declara(self):
        """Fijar la referencia hoy habilita detectar cambios futuros. El motivo tiene
        que decir que no afirma nada sobre el pasado."""
        estado, vig = verificar_contra_disco(None, None, "h_hoy", True, True, self.AHORA)
        self.assertEqual(estado, VIGENTE)
        self.assertEqual(vig["motivo"], MOTIVO_LINEA_BASE_NUEVA)
        self.assertEqual(vig["hash_contenido"], "h_hoy")
        self.assertEqual(vig["linea_base_en"], self.AHORA)


class VigenciaVersionadoTests(unittest.TestCase):
    AHORA = "2026-09-02T00:00:00+00:00"

    def test_primera_ingesta_arranca_en_version_1(self):
        estado, vig = registrar_ingesta(None, None, "h1", self.AHORA)
        self.assertEqual(estado, VIGENTE)
        self.assertEqual(vig["version"], 1)
        self.assertEqual(vig["hash_contenido"], "h1")
        self.assertEqual(vig["historial"], [])

    def test_reingerir_igual_no_sube_la_version(self):
        _, v1 = registrar_ingesta(None, None, "h1", self.AHORA)
        _, v2 = registrar_ingesta(v1, "h1", "h1", self.AHORA)
        self.assertEqual(v2["version"], 1)
        self.assertEqual(v2["historial"], [])

    def test_reingerir_con_contenido_nuevo_sube_version_y_guarda_el_hash_viejo(self):
        """El hash anterior es la unica prueba de que la fuente cambio. Perderlo
        equivale a que el sistema olvide que hubo otra version."""
        _, v1 = registrar_ingesta(None, None, "h1", self.AHORA)
        _, v2 = registrar_ingesta(v1, "h1", "h2", self.AHORA)
        self.assertEqual(v2["version"], 2)
        self.assertEqual(v2["motivo"], MOTIVO_REINGESTA)
        self.assertEqual(v2["hash_contenido"], "h2")
        self.assertEqual(v2["historial"], [{"hash": "h1", "reemplazado_en": self.AHORA}])

    def test_el_historial_se_acumula_entre_versiones(self):
        _, v1 = registrar_ingesta(None, None, "h1", self.AHORA)
        _, v2 = registrar_ingesta(v1, "h1", "h2", self.AHORA)
        _, v3 = registrar_ingesta(v2, "h2", "h3", self.AHORA)
        self.assertEqual(v3["version"], 3)
        self.assertEqual([h["hash"] for h in v3["historial"]], ["h1", "h2"])

    def test_un_duplicado_se_registra_pero_no_degrada_el_estado(self):
        """Dos copias del mismo archivo no vuelven vieja a ninguna. Es dato para
        deduplicar, no una senal de obsolescencia."""
        estado, vig = registrar_ingesta(None, None, "h1", self.AHORA,
                                        duplicado_de="src_original")
        self.assertEqual(estado, VIGENTE)
        self.assertEqual(vig["duplicado_de"], "src_original")


class VigenciaDecisionHumanaTests(unittest.TestCase):
    AHORA = "2026-09-02T00:00:00+00:00"

    def test_la_decision_humana_no_pisa_la_observacion_del_sistema(self):
        """El bug que este diseno evita: si la decision humana escribiera
        `estado_vigencia`, quitarla despues dejaria el estado humano pegado y
        'lo que observo el sistema' pasaria a ser mentira."""
        revision = aplicar_decision_humana("reemplazado", "superado", self.AHORA)
        self.assertEqual(revision["estado"], REEMPLAZADO)
        # Devuelve SOLO la revision: no hay forma de que toque la observacion.
        self.assertIsInstance(revision, dict)
        self.assertNotIn("hash_contenido", revision)

    def test_el_estado_efectivo_prioriza_a_la_persona(self):
        self.assertEqual(resolver_estado(VIGENTE, {"estado": REEMPLAZADO}), REEMPLAZADO)

    def test_sin_revision_manda_la_observacion(self):
        self.assertEqual(resolver_estado(POSIBLEMENTE_DESACTUALIZADO, None),
                         POSIBLEMENTE_DESACTUALIZADO)

    def test_quitar_la_revision_devuelve_el_estado_observado(self):
        observado = POSIBLEMENTE_DESACTUALIZADO
        con_revision = resolver_estado(observado, {"estado": VIGENTE})
        sin_revision = resolver_estado(observado, None)
        self.assertEqual(con_revision, VIGENTE)
        self.assertEqual(sin_revision, observado)

    def test_una_revision_con_estado_basura_se_ignora(self):
        self.assertEqual(resolver_estado(VIGENTE, {"estado": "obsoleto"}), VIGENTE)

    def test_un_estado_invalido_no_se_puede_registrar(self):
        with self.assertRaises(ValueError):
            aplicar_decision_humana("obsoleto", None, self.AHORA)


class VigenciaFechaDelContenidoTests(unittest.TestCase):
    """En el corpus real solo 27 de 105 nodos traen fecha propia. Decir 'no la sabemos'
    es parte del producto: la fecha de carga no puede ocupar su lugar."""

    def test_sin_fecha_del_contenido_se_declara_desconocida(self):
        self.assertFalse(fecha_contenido_conocida(None))
        self.assertFalse(fecha_contenido_conocida(""))
        self.assertFalse(fecha_contenido_conocida("   "))

    def test_con_fecha_del_contenido_se_declara_conocida(self):
        self.assertTrue(fecha_contenido_conocida("2024-03-01"))

    def test_el_estado_inicial_no_afirma_haber_verificado(self):
        inicial = estado_inicial()
        self.assertIsNone(inicial["verificado_en"])
        self.assertEqual(inicial["motivo"], "nunca_verificado")


class VigenciaCompatibilidadTests(unittest.TestCase):
    """Fuentes anteriores a esta capa: vigencia en None. No se les puede inventar
    estado ni historial."""

    AHORA = "2026-09-02T00:00:00+00:00"

    def test_una_fuente_sin_vigencia_previa_no_rompe_ni_inventa_historial(self):
        estado, vig = verificar_contra_disco(None, None, None, False, False, self.AHORA)
        self.assertEqual(estado, VIGENTE)
        self.assertEqual(vig["historial"], [])
        self.assertEqual(vig["version"], 1)
        self.assertIsNone(vig["duplicado_de"])

    def test_reingesta_sobre_una_fuente_sin_vigencia_previa_no_inventa_cambio(self):
        _, vig = registrar_ingesta(None, None, "h1", self.AHORA)
        self.assertEqual(vig["historial"], [],
                         "sin hash previo no se puede afirmar que el contenido cambio")


if __name__ == "__main__":
    unittest.main()
