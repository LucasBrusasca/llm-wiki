import math
import os
import random
import re
import threading
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select, text, func
from sqlalchemy import delete as sql_delete
from sqlalchemy import update as sql_update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from database.connection import get_async_session, get_sync_session
from database.models import AuditLog, Chunk, Document, Edge, GraphStat, Node, Source

load_dotenv()

BASE = Path(__file__).parent.resolve()
UPLOADS = BASE / "uploads"
UPLOADS.mkdir(exist_ok=True)
THUMBS = UPLOADS / "thumbs"
THUMBS.mkdir(exist_ok=True)
# Carpeta "mágica" de Ingesta Continua: lo que se suelte acá se ingiere solo.
VAULT = BASE / "vault"
VAULT.mkdir(exist_ok=True)

MAX_UPLOAD_MB = max(1, int(os.getenv("ALGEDI_MAX_UPLOAD_MB", "150")))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
INGEST_EXTENSIONS = {".pdf", ".xlsx", ".xls", ".html", ".htm", ".txt", ".md",
                     ".docx", ".pptx", ".pptm"}
ISSUE_EXTENSIONS = {".pdf", ".html", ".htm", ".txt", ".md"}


async def _save_upload(file: UploadFile, allowed_extensions: set[str]) -> Path:
    """Guarda un upload por streaming, con límite y sin sobrescribir otro archivo."""
    safe_name = Path(file.filename or "").name
    suffix = Path(safe_name).suffix.lower()
    if not safe_name or safe_name.startswith(".") or suffix not in allowed_extensions:
        permitidas = ", ".join(sorted(allowed_extensions))
        raise HTTPException(400, f"Tipo de archivo no permitido. Formatos: {permitidas}")

    save_path = UPLOADS / safe_name
    if save_path.exists():
        save_path = UPLOADS / f"{Path(safe_name).stem}-{uuid4().hex[:8]}{suffix}"
    temp_path = save_path.with_name(f".{save_path.name}.{uuid4().hex}.part")
    total = 0
    try:
        with open(temp_path, "wb") as output:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, f"El archivo supera el límite de {MAX_UPLOAD_MB} MB")
                output.write(chunk)
        temp_path.replace(save_path)
        return save_path
    finally:
        if temp_path.exists():
            temp_path.unlink()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from database.init_db import init_db
    await init_db()
    _start_vault_watcher()
    yield


def _start_vault_watcher():
    """Arranca la Ingesta Continua (carpeta mágica). Opt-out con ALGEDI_VAULT=0."""
    if os.getenv("ALGEDI_VAULT", "1") not in ("1", "true", "True"):
        print("[vault] Ingesta Continua deshabilitada (ALGEDI_VAULT=0)")
        return

    def _vault_ingest(path: str, skip_umap: bool, seccion: str):
        global _ingest_source, _ingest
        _ingest_source = "vault"
        with _ingest_lock:
            _ingest = {"state": "processing", "message": "Ingesta continua…",
                       "label": Path(path).name if not path.startswith("http") else path[:60],
                       "progress": 5}
        return _run_ingest(path, skip_umap, seccion)

    def _vault_umap():
        import embeddings_engine
        embeddings_engine.main()

    try:
        import vault_watcher
        vault_watcher.start(VAULT, _vault_ingest, _vault_umap)
    except Exception as e:
        print(f"[vault] no se pudo iniciar la Ingesta Continua: {e}")


app = FastAPI(title="Algedi", lifespan=lifespan)

CORS_ORIGINS = [origin.strip() for origin in os.getenv(
    "ALGEDI_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# El LLM se invoca vía processor.query_llm, que respeta LLM_PROVIDER
# (ollama / gemini / anthropic). No se instancia ningún cliente acá.

# ── Ingestion state ───────────────────────────────────────────────────
_ingest = {"state": "idle", "message": "", "label": "", "progress": 0}
_ingest_lock = threading.Lock()
# Serializa la EJECUCIÓN de ingestas (subida manual + Ingesta Continua del vault)
# para que nunca corran dos a la vez y no se pisen el estado/UMAP.
_INGEST_GATE = threading.Lock()
# Quién disparó la ingesta en curso: 'user' (subida manual) | 'vault' (carpeta mágica).
_ingest_source = "user"

# ── Issue state ────────────────────────────────────────────────────────
_issue_state = {"state": "idle", "message": "", "progress": 0, "result": None}
_issue_lock = threading.Lock()


# Únicas carpetas de las que se sirve contenido. Confinar a BASE no alcanzaba: BASE es
# la raíz del repo, así que /doc?p=.env devolvía las claves de API, y lo mismo con
# cualquier archivo del código. Los documentos ingeridos sólo viven en estas dos.
CARPETAS_SERVIBLES = (UPLOADS, VAULT)


def _dentro_de_carpetas_servibles(target: Path) -> bool:
    for carpeta in CARPETAS_SERVIBLES:
        try:
            target.relative_to(carpeta.resolve())
            return True
        except ValueError:
            continue
    return False


def _resolve(rel: str) -> Path:
    """Resuelve una ruta pedida por el cliente, confinada a las carpetas de contenido."""
    raw = unquote(rel or "").replace("\\", "/")
    candidato = Path(raw)
    intentos = [candidato] if candidato.is_absolute() else [BASE / raw]
    # Fallback por nombre: rutas guardadas con el prefijo del contenedor (/app/uploads/…)
    # tienen que seguir resolviendo cuando el backend corre fuera de Docker.
    intentos += [carpeta / Path(raw).name for carpeta in CARPETAS_SERVIBLES]
    for intento in intentos:
        try:
            target = intento.resolve()
        except Exception:
            continue
        if _dentro_de_carpetas_servibles(target) and target.is_file():
            return target
    raise HTTPException(status_code=404, detail="Not found")


# ── Conversion helpers ────────────────────────────────────────────────

def node_to_dict(n) -> dict:
    emb = n.embedding
    if hasattr(emb, "tolist"):
        emb = emb.tolist()
    if emb:
        # 4 decimales bastan para el coseno del frontend (descubrimientos/centroide)
        # y achican ~60% el peso del payload de /api/graph.
        emb = [round(float(x), 4) for x in emb]
    return {
        "id": n.id,
        "label": n.label,
        "type": n.type,
        "desc": n.desc,
        "fragmento": n.fragmento,
        "conceptos": n.conceptos or [],
        "embedding": emb,
        "x3d": n.x3d,
        "y3d": n.y3d,
        "z3d": n.z3d,
        "x_pca": n.x_pca,
        "y_pca": n.y_pca,
        "z_pca": n.z_pca,
        "cluster": n.cluster if n.cluster is not None else -1,
        "dominio": n.dominio or "personal",
        "fuente": n.fuente,
        "fuente_url": n.fuente_url,
        "fuente_path": n.fuente_path,
        "fuente_label": n.fuente_label,
        "autor": n.autor,
        "fecha_doc": n.fecha_doc,
        "tema": n.tema,
        "flujograma": n.flujograma,
        "synthesis": n.synthesis,
        "solve": n.solve,
        "is_centroid": n.is_centroid or False,
        "is_issue": n.is_issue or False,
        "tags": n.tags or [],
        # rich_html NO viaja acá: puede pesar cientos de KB por nodo y el frontend
        # lo pide on-demand vía /api/node/{id}/rich-preview. Sacarlo aliviana /api/graph.
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


def edge_to_dict(e) -> dict:
    return {
        "source": e.source,
        "target": e.target,
        "score": e.score,
        "shared_concepts": e.shared_concepts or [],
        "label": e.label,
        "description": e.description,
        # Procedencia: sin esto el frontend sólo puede adivinar por qué existe la
        # arista, y adivinaba (recalculaba coseno y solapamiento por su cuenta, con
        # otro criterio que el backend). `None` significa "no registrado", no "manual".
        "metodo": e.metodo,
        "base_relacion": e.base_relacion,
        "evidencia": e.evidencia,
        "revision": e.revision,
        "is_manual": bool(e.is_manual),
    }


# ── Helpers ───────────────────────────────────────────────────────────

async def _nodos_relevantes(pregunta: str, max_n: int = 5,
                             db: AsyncSession = None) -> list[str]:
    try:
        from processor import get_embed_model
        model = get_embed_model()
        vec = model.encode([pregunta], show_progress_bar=False)[0].tolist()
        result = await db.execute(
            text("""
                SELECT id
                FROM nodes
                WHERE NOT COALESCE(is_centroid, false)
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> CAST(:vec AS vector)
                LIMIT :lim
            """),
            {"vec": str(vec), "lim": max_n}
        )
        return [row.id for row in result]
    except Exception as e:
        print(f"Vector search fallback (keyword): {e}")
        stops = {"el","la","los","las","un","una","de","en","que","es",
                 "y","a","con","por","para","del","al","se","no","lo","su","sus"}
        words = [w for w in pregunta.lower().split()
                 if len(w) > 2 and w not in stops]
        if not words:
            return []
        rows = (await db.execute(
            select(Node.id, Node.label, Node.desc)
            .where(Node.is_centroid == False)
        )).all()
        scored = []
        for row in rows:
            txt = f"{row.label or ''} {row.desc or ''}".lower()
            s = sum(1 for w in words if w in txt)
            if s > 0:
                scored.append((s, row.id))
        scored.sort(reverse=True)
        return [nid for _, nid in scored[:max_n]]


async def _nodos_relevantes_scored(pregunta: str, max_n: int = 6,
                                   db: AsyncSession = None) -> list[dict]:
    """Como _nodos_relevantes pero devuelve también el contenido y la SIMILITUD coseno
    (sim = 1 - distancia). Lo usa el agente para fundamentar la respuesta y para el VETO."""
    try:
        from processor import get_embed_model
        model = get_embed_model()
        vec = model.encode([pregunta], show_progress_bar=False)[0].tolist()
        result = await db.execute(
            text("""
                SELECT id, label, "desc", fragmento,
                       (embedding <=> CAST(:vec AS vector)) AS dist
                FROM nodes
                WHERE NOT COALESCE(is_centroid, false)
                  AND NOT COALESCE(is_issue, false)
                  AND embedding IS NOT NULL
                ORDER BY dist
                LIMIT :lim
            """),
            {"vec": str(vec), "lim": max_n}
        )
        out = []
        for r in result:
            out.append({
                "id": r.id, "label": r.label, "desc": r.desc, "fragmento": r.fragmento,
                "sim": max(0.0, 1.0 - float(r.dist)),
            })
        return out
    except Exception as e:
        print(f"scored retrieval failed: {e}")
        return []


async def _chunks_relevantes_scored(pregunta: str, max_n: int = 8,
                                    db: AsyncSession = None) -> list[dict]:
    """Recupera pasajes citables, vinculados al documento y nodo de origen."""
    try:
        from processor import get_embed_model
        model = get_embed_model()
        vec = model.encode([pregunta], show_progress_bar=False)[0].tolist()
        result = await db.execute(
            text("""
                SELECT c.id, c.content, c.page, c.ordinal,
                       n.id AS node_id, n.label, n.fuente_url, n.fuente_path,
                       (c.embedding <=> CAST(:vec AS vector)) AS dist
                FROM chunks c
                JOIN documents d ON d.id = c.document_id
                JOIN nodes n ON n.id = d.node_id
                WHERE c.embedding IS NOT NULL
                  AND NOT COALESCE(n.is_issue, false)
                ORDER BY dist
                LIMIT :lim
            """),
            {"vec": str(vec), "lim": max_n},
        )
        return [{
            "id": row.id,
            "content": row.content,
            "page": row.page,
            "ordinal": row.ordinal,
            "node_id": row.node_id,
            "label": row.label,
            "fuente_url": row.fuente_url,
            "fuente_path": row.fuente_path,
            "sim": max(0.0, 1.0 - float(row.dist)),
        } for row in result]
    except Exception as exc:
        print(f"chunk retrieval failed: {exc}")
        return []


# Vecinos que trae la consulta kNN antes de filtrar. Más que RELACIONES_K a propósito:
# el criterio de conceptos compartidos puede rescatar un vecino que no está entre los
# primeros por coseno. Sigue siendo O(log n) por el índice HNSW.
VECINOS_CANDIDATOS = 40


def _rescatar_decisiones_humanas(session, EdgeModel, filtro=None):
    """Lo que un recálculo NO puede regenerar: revisiones y aristas creadas a mano.

    El cálculo de relaciones es determinístico y reproducible; el juicio de una persona
    no. Borrar aristas para recalcularlas es correcto, pero perder en el camino un
    "esta relación no corresponde" o un vínculo que alguien trazó a mano convierte al
    grafo en algo que olvida a sus revisores. Devuelve
    `({(source, target): revision}, [arista_manual, ...])`.
    """
    consulta = session.query(EdgeModel)
    if filtro is not None:
        consulta = consulta.filter(filtro)
    revisiones, manuales = {}, []
    for arista in consulta.all():
        par = (arista.source, arista.target)
        if arista.revision:
            revisiones[par] = arista.revision
        if arista.is_manual:
            manuales.append({
                "source": arista.source, "target": arista.target,
                "score": arista.score,
                "shared_concepts": arista.shared_concepts or [],
                "label": arista.label, "description": arista.description,
                "metodo": arista.metodo, "base_relacion": arista.base_relacion,
                "evidencia": arista.evidencia, "revision": arista.revision,
                "is_manual": True,
            })
    return revisiones, manuales


def _restaurar_aristas_manuales(session, EdgeModel, manuales):
    """Reinserta las aristas trazadas por una persona después de un borrado de recálculo."""
    for arista in manuales:
        session.execute(
            pg_insert(EdgeModel).values(**arista)
            .on_conflict_do_nothing(index_elements=["source", "target"])
        )


def _leer_piso_similitud(session) -> float | None:
    """Último piso de similitud medido por el recálculo global (None si nunca corrió)."""
    from database.models import GraphStat as GraphStatModel
    try:
        fila = session.query(GraphStatModel).filter(
            GraphStatModel.key == "relaciones"
        ).one_or_none()
        if fila and isinstance(fila.value, dict):
            piso = fila.value.get("floor")
            return float(piso) if piso is not None else None
    except Exception as exc:
        print(f"Warning: no se pudo leer el piso de similitud: {exc}")
    return None


def _guardar_piso_similitud(session, stats: dict):
    """Persiste lo que midió el recálculo global para que la ingesta lo reutilice."""
    from database.models import GraphStat as GraphStatModel
    if not stats:
        return
    valores = {
        "floor": stats.get("floor"),
        "n_docs": stats.get("n_docs"),
        "n_pares": stats.get("n_pares"),
        "medido_en": datetime.now(timezone.utc).isoformat(),
    }
    session.execute(
        pg_insert(GraphStatModel).values(key="relaciones", value=valores)
        .on_conflict_do_update(index_elements=["key"], set_={"value": valores})
    )


def _vecinos_candidatos(session, node_id: str, embedding, dominio: str,
                        conceptos: list | None = None) -> list:
    """Vecinos plausibles de un nodo, sin recorrer el corpus.

    Dos fuentes complementarias, ambas indexadas:
      1. kNN por coseno vía pgvector (índice HNSW sobre `nodes.embedding`);
      2. documentos que comparten al menos un concepto textual exacto.

    La segunda existe porque el criterio de conceptos compartidos puede vincular
    documentos que el coseno no pone cerca. Si esa consulta falla (JSON con forma
    inesperada), se sigue con los vecinos por coseno: perder un candidato degrada la
    arista, romper la ingesta pierde el documento.
    """
    if not embedding:
        return []
    vec = str(list(embedding))
    filtro = """
          AND id != :nid
          AND NOT COALESCE(is_centroid, false)
          AND NOT COALESCE(is_issue, false)
          AND COALESCE(dominio, 'personal') = :dominio
          AND embedding IS NOT NULL
    """
    encontrados = {}

    filas = session.execute(text(f"""
        SELECT id, label, conceptos, dominio,
               1 - (embedding <=> CAST(:vec AS vector)) AS sim
        FROM nodes
        WHERE true {filtro}
        ORDER BY embedding <=> CAST(:vec AS vector)
        LIMIT :lim
    """), {"vec": vec, "nid": node_id, "dominio": dominio,
           "lim": VECINOS_CANDIDATOS}).all()
    for fila in filas:
        encontrados[fila.id] = {"id": fila.id, "label": fila.label,
                                "conceptos": fila.conceptos or [],
                                "dominio": fila.dominio, "sim": float(fila.sim)}

    if conceptos:
        try:
            filas = session.execute(text(f"""
                SELECT id, label, conceptos, dominio,
                       1 - (embedding <=> CAST(:vec AS vector)) AS sim
                FROM nodes
                WHERE jsonb_exists_any(conceptos::jsonb, CAST(:conceptos AS text[]))
                      {filtro}
                LIMIT :lim
            """), {"vec": vec, "nid": node_id, "dominio": dominio,
                   "conceptos": list(conceptos)[:20],
                   "lim": VECINOS_CANDIDATOS}).all()
            for fila in filas:
                encontrados.setdefault(fila.id, {
                    "id": fila.id, "label": fila.label,
                    "conceptos": fila.conceptos or [],
                    "dominio": fila.dominio, "sim": float(fila.sim)})
        except Exception as exc:
            print(f"Warning: candidatos por concepto no disponibles ({exc}); "
                  f"se usan sólo los vecinos por similitud")

    return list(encontrados.values())


def _save_node_sync(nodo_data: dict, chunks: list[dict] | None = None):
    """Guarda o actualiza un nodo en PostgreSQL y recalcula SUS relaciones.

    Síncrona — segura para threads. Antes recalculaba el grafo entero en cada guardado
    (O(n²) en Python): medido en esta máquina, 92 s por documento con 800 nodos, y
    creciendo al cuadrado. Ahora sólo se tocan las aristas del nodo guardado.
    """
    import hashlib
    from database.models import (Chunk as ChunkModel, Document as DocumentModel,
                                 Edge as EdgeModel, Node as NodeModel, Source as SourceModel)
    from sqlalchemy import delete as sync_delete
    from processor import relaciones_incrementales
    from vigencia import registrar_ingesta

    campos_validos = {c.key for c in NodeModel.__table__.columns}
    datos = {k: v for k, v in nodo_data.items() if k in campos_validos}

    with get_sync_session() as session:
        session.execute(
            pg_insert(NodeModel).values(**datos)
            .on_conflict_do_update(index_elements=["id"], set_=datos)
        )
        session.flush()

        # Base de trazabilidad compatible con el modelo actual. Los chunks se poblarán
        # cuando los conectores entreguen pasajes/páginas, sin perder este vínculo.
        locator = (nodo_data.get("fuente_url") or nodo_data.get("fuente_path")
                   or f"node:{nodo_data['id']}")
        content_hash = None
        if nodo_data.get("fuente_path"):
            try:
                path = _resolve_file(nodo_data["fuente_path"])
                digest = hashlib.sha256()
                with open(path, "rb") as source_file:
                    for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
                        digest.update(chunk)
                content_hash = digest.hexdigest()
            except Exception:
                pass
        # La identidad sigue al locator estable; el hash de contenido versiona el archivo
        # sin cambiar silenciosamente el ID de la fuente.
        source_fingerprint = hashlib.sha256(locator.encode("utf-8")).hexdigest()
        source_id = f"src_{source_fingerprint[:24]}"
        # ── Vigencia ──────────────────────────────────────────────────────────
        # Antes de sobrescribir la fuente hay que mirar la que estaba: si el contenido
        # cambió, esa versión anterior es información, no basura. Sin esto reingerir un
        # archivo modificado pisaba el hash viejo y el sistema perdía la única prueba
        # de que la fuente había cambiado.
        previa = session.get(SourceModel, source_id)
        hash_previo = previa.content_hash if previa else None
        vigencia_previa = previa.vigencia if previa else None

        # ¿Ya hay otra fuente con este mismo contenido byte a byte? En el corpus real
        # abundan: el mismo paper subido como "X - copia.pdf" y como "X.pdf".
        duplicado_de = None
        if content_hash:
            gemela = session.query(SourceModel).filter(
                SourceModel.content_hash == content_hash,
                SourceModel.id != source_id,
            ).order_by(SourceModel.created_at.asc()).first()
            if gemela is not None:
                duplicado_de = gemela.id

        estado_vigencia, vigencia_nueva = registrar_ingesta(
            vigencia_previa, hash_previo, content_hash,
            datetime.now(timezone.utc).isoformat(), duplicado_de,
        )

        source_values = {
            "id": source_id,
            "kind": nodo_data.get("fuente") or "unknown",
            "locator": locator,
            "original_name": nodo_data.get("fuente_label"),
            "content_hash": content_hash,
            "source_metadata": {
                "autor": nodo_data.get("autor"),
                "fecha_doc": nodo_data.get("fecha_doc"),
                "dominio": nodo_data.get("dominio") or "personal",
            },
            "estado_vigencia": estado_vigencia,
            "vigencia": vigencia_nueva,
        }
        session.execute(
            pg_insert(SourceModel).values(**source_values)
            .on_conflict_do_update(index_elements=["id"], set_=source_values)
        )

        processed_text = "\n".join([
            nodo_data.get("label") or "",
            nodo_data.get("desc") or "",
            nodo_data.get("fragmento") or "",
            " | ".join(nodo_data.get("conceptos") or []),
        ])
        processed_hash = hashlib.sha256(processed_text.encode("utf-8")).hexdigest()
        document_id = f"doc_{hashlib.sha256(nodo_data['id'].encode('utf-8')).hexdigest()[:24]}"
        document_values = {
            "id": document_id,
            "source_id": source_id,
            "node_id": nodo_data["id"],
            "parser": nodo_data.get("fuente") or "unknown",
            "parser_version": "legacy-node-v1",
            "content_hash": processed_hash,
        }
        session.execute(
            pg_insert(DocumentModel).values(**document_values)
            .on_conflict_do_update(index_elements=["id"], set_=document_values)
        )
        session.flush()

        if chunks is not None:
            # Reingerir reemplaza únicamente los pasajes derivados de esta versión.
            session.execute(sync_delete(ChunkModel).where(ChunkModel.document_id == document_id))
            valid_chunks = [c for c in chunks if (c.get("content") or "").strip()]
            if valid_chunks:
                from processor import get_embed_model
                model = get_embed_model()
                vectors = model.encode(
                    [c["content"] for c in valid_chunks],
                    batch_size=32,
                    show_progress_bar=False,
                )
                for index, (chunk_data, vector) in enumerate(zip(valid_chunks, vectors)):
                    ordinal = int(chunk_data.get("ordinal", index))
                    chunk_fingerprint = hashlib.sha256(
                        f"{document_id}:{ordinal}:{chunk_data['content']}".encode("utf-8")
                    ).hexdigest()
                    session.add(ChunkModel(
                        id=f"chk_{chunk_fingerprint[:24]}",
                        document_id=document_id,
                        ordinal=ordinal,
                        content=chunk_data["content"],
                        page=chunk_data.get("page"),
                        char_start=chunk_data.get("char_start"),
                        char_end=chunk_data.get("char_end"),
                        embedding=vector.tolist(),
                        chunk_metadata={"node_id": nodo_data["id"]},
                    ))
                session.flush()

        # Los issues/procesos NO participan de las relaciones del grafo de conocimiento:
        # son entidades de otro plano (módulo Issue/Procesos) cuyo fundamento se calcula
        # on-the-fly contra el grafo. Mezclarlos ensuciaba el espacio de documentos.
        # Antes igual se disparaba el recálculo completo al guardarlos: puro costo, cero
        # efecto sobre las aristas.
        if nodo_data.get("is_issue") or nodo_data.get("is_centroid"):
            session.commit()
            return

        embedding = nodo_data.get("embedding")
        dominio = nodo_data.get("dominio") or "personal"
        vecinos = _vecinos_candidatos(
            session, nodo_data["id"], embedding, dominio,
            nodo_data.get("conceptos"),
        )
        nuevas = relaciones_incrementales(
            {**nodo_data, "dominio": dominio},
            vecinos,
            piso=_leer_piso_similitud(session),
        )

        # Sólo se reemplazan las aristas de ESTE nodo. Las del resto del grafo quedan
        # intactas: son válidas y volver a calcularlas era el costo cuadrático.
        #
        # Antes de borrar hay que rescatar lo que el cálculo NO puede regenerar: las
        # aristas creadas a mano y las revisiones humanas. Una decisión de una persona
        # no puede evaporarse porque se reingirió un documento.
        revisiones_previas, manuales_previas = _rescatar_decisiones_humanas(
            session, EdgeModel,
            (EdgeModel.source == nodo_data["id"]) | (EdgeModel.target == nodo_data["id"]),
        )
        session.execute(sync_delete(EdgeModel).where(
            (EdgeModel.source == nodo_data["id"]) | (EdgeModel.target == nodo_data["id"])
        ))
        _restaurar_aristas_manuales(session, EdgeModel, manuales_previas)
        for r in nuevas:
            session.execute(
                pg_insert(EdgeModel).values(
                    source=r["source"],
                    target=r["target"],
                    score=r.get("score"),
                    shared_concepts=r.get("shared_concepts", []),
                    label=r.get("label"),
                    description=r.get("description"),
                    metodo=r.get("metodo"),
                    base_relacion=r.get("base_relacion"),
                    evidencia=r.get("evidencia"),
                    revision=revisiones_previas.get((r["source"], r["target"])),
                ).on_conflict_do_nothing(index_elements=["source", "target"])
            )
        session.commit()


def _recompute_edges_background():
    from processor import _auto_relaciones
    from database.models import Node as NodeModel, Edge as EdgeModel
    from sqlalchemy import delete as sync_delete
    with get_sync_session() as session:
        nodes = session.query(NodeModel).filter(
            NodeModel.is_centroid == False,
            NodeModel.is_issue == False,   # issues fuera del grafo de conocimiento
        ).all()
        nodes_dicts = []
        for n in nodes:
            emb = n.embedding
            if hasattr(emb, "tolist"):
                emb = emb.tolist()
            nodes_dicts.append({
                "id": n.id, "label": n.label,
                "conceptos": n.conceptos or [],
                "embedding": emb, "dominio": n.dominio or "personal",
                "is_centroid": False,
            })
        stats = {}
        new_rels = _auto_relaciones(nodes_dicts, stats)
        # El recálculo global borra TODO el grafo de aristas y lo rehace. Las decisiones
        # humanas no se pueden rehacer, así que se rescatan antes y se reponen después.
        revisiones, manuales = _rescatar_decisiones_humanas(session, EdgeModel)
        session.execute(sync_delete(EdgeModel))
        for r in new_rels:
            session.add(EdgeModel(
                **r, revision=revisiones.get((r["source"], r["target"]))
            ))
        _restaurar_aristas_manuales(session, EdgeModel, manuales)
        # El piso medido acá es el que después usa la ingesta incremental.
        _guardar_piso_similitud(session, stats)
        session.commit()


# ── Graph data ────────────────────────────────────────────────────────

@app.get("/api/sections")
async def get_sections(db: AsyncSession = Depends(get_async_session)):
    """Lista las secciones (dominios) existentes con su cantidad de documentos.
    Cada sección es un grafo de conocimiento independiente."""
    rows = (await db.execute(
        select(Node.dominio, func.count()).where(
            Node.is_centroid == False, Node.is_issue == False
        ).group_by(Node.dominio)
    )).all()
    secciones = [{"nombre": (d or "personal"), "count": c} for d, c in rows]
    if not any(s["nombre"] == "personal" for s in secciones):
        secciones.insert(0, {"nombre": "personal", "count": 0})
    secciones.sort(key=lambda s: (s["nombre"] != "personal", s["nombre"].lower()))
    return {"secciones": secciones}


@app.get("/api/sections/bridges")
async def get_section_bridges(db: AsyncSession = Depends(get_async_session)):
    """Puentes entre secciones: conexiones cross-dominio basadas en conceptos compartidos.
    
    MVP: usa heurística simple basada en overlap de taxonomías (temas) entre secciones.
    Si dos secciones comparten temas similares, hay un puente entre ellas.
    """
    # Obtener todas las secciones con sus nodos
    rows = (await db.execute(
        select(Node.dominio, Node.group_label).where(
            Node.is_centroid == False,
            Node.is_issue == False,
            Node.group_label.isnot(None)
        )
    )).all()
    
    # Agrupar temas por sección
    section_themes = {}
    for dominio, theme in rows:
        d = dominio or "personal"
        if d not in section_themes:
            section_themes[d] = set()
        if theme:
            section_themes[d].add(theme.lower().strip())
    
    # Calcular puentes basados en temas compartidos
    bridges = []
    sections_list = list(section_themes.keys())
    for i, s1 in enumerate(sections_list):
        for s2 in sections_list[i+1:]:
            themes1 = section_themes[s1]
            themes2 = section_themes[s2]
            # Overlap: temas en común
            common = themes1 & themes2
            if common:
                # Peso basado en cantidad de temas compartidos
                weight = len(common) / max(1, min(len(themes1), len(themes2)))
                if weight > 0.1:  # umbral mínimo
                    bridges.append({
                        "source": s1,
                        "target": s2,
                        "weight": round(weight * 3, 2),  # escalar para visualización
                        "shared_themes": list(common)[:5],  # máximo 5 para no saturar
                    })
    
    # Ordenar por peso descendente
    bridges.sort(key=lambda b: b["weight"], reverse=True)
    
    return {"bridges": bridges[:20]}  # máximo 20 puentes


@app.get("/api/traceability/status")
async def traceability_status(db: AsyncSession = Depends(get_async_session)):
    """Cobertura de la migración Source → Document → Chunk."""
    async def count(model):
        return (await db.execute(select(func.count()).select_from(model))).scalar_one()

    linked_nodes = (await db.execute(
        select(func.count()).select_from(Document).where(Document.node_id.isnot(None))
    )).scalar_one()
    return {
        "sources": await count(Source),
        "documents": await count(Document),
        "chunks": await count(Chunk),
        "linked_nodes": linked_nodes,
        "nodes": await count(Node),
    }


@app.get("/api/graph/chunks")
async def get_graph_chunks(seccion: str = None, db: AsyncSession = Depends(get_async_session)):
    """Vista de FRAGMENTOS: cada documento es una estrella de sus propios pasajes.

    El grafo de documentos muestra 65 nodos; la biblioteca tiene 4.397 chunks. Esta
    vista los expone sin recalcular nada caro: los pasajes se distribuyen en una
    esfera alrededor de la posición 3D que su documento ya tiene por UMAP.

    Por qué así y no un UMAP nuevo sobre los chunks: la pertenencia de un pasaje a su
    documento es un hecho, no una estimación. Colocarlo alrededor lo respeta, sale
    gratis y produce la topología radial (hub + radios) que el ojo lee como red.
    """
    stmt = select(Node).where(Node.is_centroid == False, Node.is_issue == False)
    if seccion:
        stmt = stmt.where(Node.dominio == seccion)
    docs = (await db.execute(stmt)).scalars().all()
    por_id = {d.id: d for d in docs}

    filas = (await db.execute(text("""
        SELECT c.id, c.ordinal, c.page, LEFT(c.content, 70) AS preview, d.node_id
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE d.node_id = ANY(:ids)
        ORDER BY d.node_id, c.ordinal
    """), {"ids": list(por_id.keys())})).all() if por_id else []

    nodos, relaciones = [], []
    for d in docs:
        nodos.append({
            "id": d.id, "label": d.label, "type": "DOCUMENTO",
            "tema": d.tema, "dominio": d.dominio or "personal",
            "fuente": d.fuente, "fuente_url": d.fuente_url, "fuente_path": d.fuente_path,
            "cluster": d.cluster if d.cluster is not None else -1,
            "x3d": d.x3d, "y3d": d.y3d, "z3d": d.z3d,
            "is_hub": True, "pin": True,
        })

    # Esfera de Fibonacci: reparte los pasajes de forma pareja alrededor del hub,
    # sin los polos apelmazados que produce un muestreo aleatorio.
    agrupados = {}
    for f in filas:
        agrupados.setdefault(f.node_id, []).append(f)

    for node_id, chunks in agrupados.items():
        doc = por_id.get(node_id)
        if doc is None or doc.x3d is None:
            continue
        n = len(chunks)
        radio = 0.018 + math.sqrt(n) * 0.006      # las estrellas grandes ocupan más
        phi = math.pi * (3.0 - math.sqrt(5.0))    # ángulo áureo
        for i, c in enumerate(chunks):
            y = 1 - (i / max(1, n - 1)) * 2 if n > 1 else 0.0
            r = math.sqrt(max(0.0, 1 - y * y))
            th = phi * i
            nodos.append({
                "id": c.id,
                "label": (c.preview or "").strip()[:64] or f"fragmento {c.ordinal}",
                "type": "FRAGMENTO",
                "tema": doc.tema, "dominio": doc.dominio or "personal",
                "cluster": doc.cluster if doc.cluster is not None else -1,
                "x3d": doc.x3d + math.cos(th) * r * radio,
                "y3d": doc.y3d + y * radio,
                "z3d": doc.z3d + math.sin(th) * r * radio,
                "parent_id": node_id, "page": c.page, "ordinal": c.ordinal,
                "is_hub": False, "pin": True,
            })
            relaciones.append({"source": node_id, "target": c.id, "score": 1.0, "spoke": True})

    edges = (await db.execute(select(Edge))).scalars().all()
    ids = {d.id for d in docs}
    for e in edges:
        if e.source in ids and e.target in ids:
            relaciones.append({"source": e.source, "target": e.target,
                               "score": e.score, "label": e.label})

    return {"nodos": nodos, "relaciones": relaciones}


async def _vigencia_por_nodo(db: AsyncSession, node_ids: set[str]) -> dict:
    """Estado de vigencia de la fuente de cada nodo, en una sola consulta.

    Un nodo no "tiene" vigencia: la tiene la fuente de la que salió. Se resuelve por
    `Document.node_id → Source`. El estado efectivo aplica la decisión humana por
    encima de la observación automática.
    """
    from vigencia import resolver_estado, fecha_contenido_conocida
    if not node_ids:
        return {}
    filas = (await db.execute(
        select(Document.node_id, Source.id, Source.estado_vigencia, Source.vigencia,
               Source.revision_vigencia, Source.content_hash, Source.source_metadata,
               Source.created_at)
        .join(Source, Source.id == Document.source_id)
        .where(Document.node_id.in_(node_ids))
    )).all()
    salida = {}
    for node_id, src_id, estado, vig, revision, chash, meta, creada in filas:
        vig = vig or {}
        fecha_doc = (meta or {}).get("fecha_doc")
        salida[node_id] = {
            "source_id": src_id,
            "estado": resolver_estado(estado, revision),
            "estado_observado": estado or "vigente",
            "motivo": vig.get("motivo"),
            "version": vig.get("version"),
            "duplicado_de": vig.get("duplicado_de"),
            "reemplazada_por": (revision or {}).get("reemplazada_por"),
            "verificado_en": vig.get("verificado_en"),
            "historial": vig.get("historial") or [],
            "revision": revision,
            "content_hash": chash,
            "fecha_contenido": fecha_doc,
            "fecha_contenido_conocida": fecha_contenido_conocida(fecha_doc),
            "incorporada_en": creada.isoformat() if creada else None,
        }
    return salida


@app.get("/api/graph")
async def get_graph(seccion: str = None, db: AsyncSession = Depends(get_async_session)):
    # Filtro por sección: cada sección es un grafo independiente. Los issues NO se filtran
    # (viven en su módulo, fuera del grafo). Sin 'seccion' → todo (compat / vista global).
    stmt = select(Node)
    if seccion:
        stmt = stmt.where((Node.dominio == seccion) | (Node.is_issue == True))
    nodes_rows = (await db.execute(stmt)).scalars().all()
    edges_rows = (await db.execute(select(Edge))).scalars().all()

    rng = random.Random(42)
    nodes_list = []
    node_ids = set()
    for n in nodes_rows:
        nd = node_to_dict(n)
        if nd["x3d"] is None:
            nd["x3d"] = rng.uniform(-1, 1)
            nd["y3d"] = rng.uniform(-1, 1)
            nd["z3d"] = rng.uniform(-1, 1)
        nodes_list.append(nd)
        node_ids.add(n.id)

    # Vigencia por nodo: una sola consulta con join, no una por nodo.
    vigencias = await _vigencia_por_nodo(db, node_ids)
    for nd in nodes_list:
        nd["vigencia"] = vigencias.get(nd["id"])

    # Solo aristas cuyos DOS extremos están en la sección visible.
    relaciones = [edge_to_dict(e) for e in edges_rows
                  if e.source in node_ids and e.target in node_ids]
    return {"nodos": nodes_list, "relaciones": relaciones}


# ── File serving ──────────────────────────────────────────────────────

@app.get("/thumbnail")
def get_thumbnail(p: str):
    target = _resolve(p)
    try:
        import fitz
        doc = fitz.open(str(target))
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(1.2, 1.2), alpha=False)
        data = pix.tobytes("png")
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/doc")
def get_doc(p: str):
    target = _resolve(p)
    ext = target.suffix.lower().lstrip(".")
    media = {
        "pdf":  "application/pdf",
        "mp3":  "audio/mpeg",
        "wav":  "audio/wav",
        "ogg":  "audio/ogg",
        "html": "text/html",
        "htm":  "text/html",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls":  "application/vnd.ms-excel",
    }.get(ext, "application/octet-stream")
    disposition = "inline" if ext in ("pdf", "html", "htm") else "attachment"
    return Response(
        content=target.read_bytes(),
        media_type=media,
        headers={"Content-Disposition": f'{disposition}; filename="{target.name}"'},
    )


@app.get("/excel-preview")
def excel_preview(p: str):
    target = _resolve(p)
    try:
        import openpyxl
        wb = openpyxl.load_workbook(str(target), read_only=True, data_only=True)
        ws = wb.active
        rows = []
        for i, row in enumerate(ws.iter_rows(max_row=5, max_col=5, values_only=True)):
            rows.append([str(c) if c is not None else "" for c in row])
            if i >= 4:
                break
        wb.close()
        return {"rows": rows}
    except ImportError:
        raise HTTPException(status_code=501, detail="openpyxl not installed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_file(p: str) -> Path:
    """Resuelve la ruta de un archivo ingerido, tolerando rutas absolutas del
    contenedor, relativas o sólo el nombre. Confinado a las carpetas de contenido:
    un `fuente_path` corrupto no puede convertirse en lectura del código o del .env."""
    try:
        return _resolve(p)
    except HTTPException:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")


@app.get("/files/{node_id}")
async def get_file(node_id: str, db: AsyncSession = Depends(get_async_session)):
    """Sirve el archivo original asociado a un nodo (por id). Inline para que
    PDF/imagen/audio/video se previsualicen embebidos. Soporta Range (seek)."""
    node = (await db.execute(select(Node).where(Node.id == node_id))).scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")
    if not node.fuente_path:
        raise HTTPException(status_code=404, detail="El nodo no tiene archivo")
    target = _resolve_file(node.fuente_path)
    import mimetypes
    media, _ = mimetypes.guess_type(target.name)
    return FileResponse(
        str(target),
        media_type=media or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{target.name}"'},
    )


def _yt_id(url: str):
    import re as _re
    m = _re.search(r"(?:youtu\.be/|v=|embed/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else None


def _render_thumb(doc) -> bytes:
    """Renderiza la primera página/imagen de un documento fitz a PNG ~128px."""
    import fitz
    page = doc[0]
    rect = page.rect
    big = max(rect.width, rect.height) or 1
    zoom = min(128.0 / big, 2.0)  # no agrandar de más
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return pix.tobytes("png")


def _text_thumb(texto: str) -> bytes | None:
    """Miniatura a partir de TEXTO (para formatos que fitz no abre: Word/PPT/Excel).
    Renderiza el contenido como página de texto → muestra el inicio del documento."""
    import fitz
    snippet = (texto or "").strip()[:1500]
    if not snippet:
        return None
    try:
        doc = fitz.open(stream=snippet.encode("utf-8"), filetype="txt")
        data = _render_thumb(doc); doc.close()
        return data
    except Exception:
        return None


def _generate_thumb(node) -> bytes | None:
    """Miniatura (PNG ~128px) según el tipo de nodo. None si no aplica."""
    import fitz
    fuente = (node.fuente or "").lower()

    # YouTube: usar el thumbnail de la URL (descargado server-side → mismo origen, CORS-clean)
    if fuente == "youtube" and node.fuente_url:
        vid = _yt_id(node.fuente_url)
        if not vid:
            return None
        import httpx
        for q in ("mqdefault", "hqdefault", "default"):
            try:
                r = httpx.get(f"https://img.youtube.com/vi/{vid}/{q}.jpg", timeout=10.0)
                if r.status_code == 200 and len(r.content) > 1000:
                    doc = fitz.open(stream=r.content, filetype="jpg")
                    data = _render_thumb(doc); doc.close()
                    return data
            except Exception:
                continue
        return None

    # Archivos locales (PDF / imagen). fitz abre tanto PDF como imágenes.
    if node.fuente_path:
        try:
            target = _resolve_file(node.fuente_path)
        except HTTPException:
            return None
        ext = target.suffix.lower().lstrip(".")
        if ext == "pdf" or fuente in ("pdf", "tesis") or ext in (
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"
        ):
            try:
                doc = fitz.open(str(target))
                data = _render_thumb(doc); doc.close()
                return data
            except Exception:
                return None
        # HTML: fitz lo renderiza como documento → miniatura de la primera parte.
        if ext in ("html", "htm") or fuente == "html":
            try:
                doc = fitz.open(str(target), filetype="html")
                data = _render_thumb(doc); doc.close()
                return data
            except Exception:
                return None
        # Texto plano / Markdown: fitz lo pagina como texto.
        if ext in ("txt", "md", "markdown"):
            try:
                return _text_thumb(target.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                return None
        # Word / PowerPoint: fitz NO los abre → miniatura del texto extraído.
        if ext == "docx" or fuente == "word":
            from processor import _extraer_texto_office
            return _text_thumb(_extraer_texto_office(str(target), ["word/document.xml"]))
        if ext in ("pptx", "pptm") or fuente == "ppt":
            from processor import _extraer_texto_office
            return _text_thumb(_extraer_texto_office(str(target), ["ppt/slides/"]))
        # Excel: primeras filas como texto.
        if ext in ("xlsx", "xls") or fuente == "excel":
            try:
                import openpyxl
                wb = openpyxl.load_workbook(str(target), read_only=True, data_only=True)
                ws = wb.active
                rows = []
                for i, row in enumerate(ws.iter_rows(max_row=20, values_only=True)):
                    txt = " | ".join(str(c) for c in row if c is not None)
                    if txt.strip():
                        rows.append(txt)
                    if i >= 19:
                        break
                wb.close()
                return _text_thumb("\n".join(rows))
            except Exception:
                return None
    return None


def _render_html_playwright(path: str) -> bytes | None:
    """Miniatura de un HTML renderizado CON estilos (Chromium headless): captura del
    inicio del documento → reducida. Pixel-perfect. SÍNCRONA: llamar en un thread
    (la sync API de Playwright no corre dentro del event loop de asyncio)."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 900, "height": 650}, device_scale_factor=1)
            page.goto(f"file://{path}", wait_until="networkidle", timeout=15000)
            png = page.screenshot(clip={"x": 0, "y": 0, "width": 900, "height": 650})
            browser.close()
        import fitz
        doc = fitz.open(stream=png, filetype="png")
        data = _render_thumb(doc); doc.close()
        return data
    except Exception as e:
        print(f"playwright html thumb failed: {e}")
        return None


@app.get("/thumb/{node_id}")
async def get_thumb(node_id: str, db: AsyncSession = Depends(get_async_session)):
    """Miniatura del archivo del nodo (cara del nodo en el grafo). 404 → el front
    cae al punto cian. Cachea en disco para no re-renderizar (perf en GPU integrada)."""
    import hashlib
    h = hashlib.md5(node_id.encode("utf-8")).hexdigest()
    cache = THUMBS / f"{h}.png"
    if cache.exists():
        return FileResponse(str(cache), media_type="image/png",
                            headers={"Cache-Control": "public, max-age=86400"})
    node = (await db.execute(select(Node).where(Node.id == node_id))).scalar_one_or_none()
    if node is None:
        raise HTTPException(status_code=404, detail="Nodo no encontrado")
    data = None
    # HTML → render CON estilos (Chromium headless), en un thread. Fallback a fitz si falla.
    fuente = (node.fuente or "").lower()
    fp = (node.fuente_path or "").lower()
    if node.fuente_path and (fuente == "html" or fp.endswith((".html", ".htm"))):
        try:
            import asyncio
            target = _resolve_file(node.fuente_path)
            data = await asyncio.to_thread(_render_html_playwright, str(target))
        except Exception:
            data = None
    if not data:
        try:
            data = _generate_thumb(node)
        except Exception:
            data = None
    if not data:
        raise HTTPException(status_code=404, detail="Sin miniatura")
    try:
        cache.write_bytes(data)
    except Exception:
        pass
    return Response(content=data, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


# ── Backup: export / import ───────────────────────────────────────────

def _row_to_dict_full(row, model) -> dict:
    """Serializa TODAS las columnas de una fila (para un backup completo, no la vista liviana)."""
    d = {}
    for col in model.__table__.columns:
        v = getattr(row, col.key)
        if hasattr(v, "tolist"):
            v = v.tolist()          # vector de embedding
        elif hasattr(v, "isoformat"):
            v = v.isoformat()       # datetime
        d[col.key] = v
    return d


@app.get("/api/export")
async def export_graph(db: AsyncSession = Depends(get_async_session)):
    """Backup COMPLETO del grafo (todos los nodos + relaciones) como JSON descargable."""
    import json as _json
    nodes_rows = (await db.execute(select(Node))).scalars().all()
    edges_rows = (await db.execute(select(Edge))).scalars().all()
    payload = {
        "algedi_backup": 1,
        "nodos": [_row_to_dict_full(n, Node) for n in nodes_rows],
        "relaciones": [_row_to_dict_full(e, Edge) for e in edges_rows],
    }
    return Response(
        content=_json.dumps(payload, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="algedi-backup.json"'},
    )


@app.post("/api/import")
async def import_graph(request: Request, db: AsyncSession = Depends(get_async_session)):
    """Restaura un backup: upsert de nodos (conserva posiciones, temas, etc.) y recalcula
    relaciones. NO borra lo existente — mergea por id, así podés unir backups."""
    import asyncio
    body = await request.json()
    nodos = body.get("nodos") or []
    if not nodos:
        raise HTTPException(400, "El backup no contiene nodos.")
    # Un import hace upsert masivo: puede pisar el contenido de nodos existentes.
    if not _check_password(body.get("password")):
        raise HTTPException(403, "Clave de seguridad incorrecta.")
    node_cols = {c.key for c in Node.__table__.columns}
    skip = {"created_at", "updated_at"}
    n_ok = 0
    for nd in nodos:
        datos = {k: v for k, v in nd.items() if k in node_cols and k not in skip and v is not None}
        if not datos.get("id"):
            continue
        await db.execute(
            pg_insert(Node).values(**datos).on_conflict_do_update(index_elements=["id"], set_=datos)
        )
        n_ok += 1
    await db.commit()
    # Las relaciones son derivadas → recalcularlas con el algoritmo actual.
    await asyncio.to_thread(_recompute_edges_background)
    return {"ok": True, "nodos_importados": n_ok}


# ── Seguridad (clave para acciones destructivas) ──────────────────────

def _security_enabled() -> bool:
    return bool((os.getenv("ALGEDI_ADMIN_PASSWORD") or "").strip())


def _check_password(pwd) -> bool:
    """True si la clave es correcta, o si no hay clave configurada (no se exige)."""
    import hmac
    real = (os.getenv("ALGEDI_ADMIN_PASSWORD") or "").strip()
    if not real:
        return True
    return hmac.compare_digest((str(pwd or "")).strip(), real)


async def _read_body(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:
        return {}


@app.get("/api/security")
async def security_status():
    """Le dice al frontend si hay clave configurada (para pedirla en acciones destructivas)."""
    return {"enabled": _security_enabled()}


# ── Secciones: renombrar / eliminar ───────────────────────────────────

@app.post("/api/sections/rename")
async def rename_section(request: Request, db: AsyncSession = Depends(get_async_session)):
    body = await _read_body(request)
    origen = (body.get("from") or "").strip()
    destino = (body.get("to") or "").strip()
    if not origen or not destino:
        raise HTTPException(400, "Faltan nombres (from/to).")
    # Renombrar reasigna todos los documentos de la sección: no es destructivo, pero
    # sí reorganiza el grafo entero, así que va detrás de la misma clave.
    if not _check_password(body.get("password")):
        raise HTTPException(403, "Clave de seguridad incorrecta.")
    await db.execute(sql_update(Node).where(Node.dominio == origen).values(dominio=destino))
    await db.commit()
    return {"ok": True}


@app.post("/api/sections/delete")
async def delete_section(request: Request, db: AsyncSession = Depends(get_async_session)):
    body = await _read_body(request)
    nombre = (body.get("nombre") or "").strip()
    if not nombre:
        raise HTTPException(400, "Falta el nombre de la sección.")
    if not _check_password(body.get("password")):
        raise HTTPException(403, "Clave de seguridad incorrecta.")
    # Borra los documentos de la sección (las aristas caen por cascade). No toca issues.
    ids = (await db.execute(
        select(Node.id).where(Node.dominio == nombre, Node.is_issue == False)
    )).scalars().all()
    if ids:
        await db.execute(sql_delete(Edge).where(Edge.source.in_(ids) | Edge.target.in_(ids)))
        await db.execute(sql_delete(Node).where(Node.id.in_(ids)))
        await db.commit()
    return {"ok": True, "borrados": len(ids)}


# ── Reset / clear ─────────────────────────────────────────────────────

@app.post("/api/reset")
async def reset_graph(request: Request, db: AsyncSession = Depends(get_async_session)):
    body = await _read_body(request)
    if not _check_password(body.get("password")):
        raise HTTPException(403, "Clave de seguridad incorrecta.")
    await db.execute(sql_delete(Edge))
    await db.execute(sql_delete(Node))
    await db.commit()
    umap_pkl = BASE / "umap_model.pkl"
    if umap_pkl.exists():
        umap_pkl.unlink()
    return {"ok": True}


# ── Recompute relations ───────────────────────────────────────────────

@app.post("/api/recompute-relations")
async def recompute_relations(db: AsyncSession = Depends(get_async_session)):
    from processor import _auto_relaciones
    nodes_rows = (await db.execute(
        select(Node).where(Node.is_centroid == False, Node.is_issue == False)
    )).scalars().all()

    nodes_dicts = []
    for n in nodes_rows:
        emb = n.embedding
        if hasattr(emb, "tolist"):
            emb = emb.tolist()
        nodes_dicts.append({
            "id": n.id,
            "label": n.label,
            "conceptos": n.conceptos or [],
            "embedding": emb,
            "dominio": n.dominio or "personal",
            "is_centroid": False,
        })

    stats = {}
    new_rels = _auto_relaciones(nodes_dicts, stats)

    # Mismo criterio que el recálculo en background: lo que decidió una persona
    # sobrevive al recálculo; lo que calculó la máquina se rehace.
    previas = (await db.execute(select(Edge))).scalars().all()
    revisiones = {(e.source, e.target): e.revision for e in previas if e.revision}
    manuales = [{
        "source": e.source, "target": e.target, "score": e.score,
        "shared_concepts": e.shared_concepts or [], "label": e.label,
        "description": e.description, "metodo": e.metodo,
        "base_relacion": e.base_relacion, "evidencia": e.evidencia,
        "revision": e.revision, "is_manual": True,
    } for e in previas if e.is_manual]

    await db.execute(sql_delete(Edge))
    for r in new_rels:
        db.add(Edge(
            source=r["source"], target=r["target"],
            score=r.get("score"),
            shared_concepts=r.get("shared_concepts", []),
            label=r.get("label"),
            description=r.get("description"),
            metodo=r.get("metodo"),
            base_relacion=r.get("base_relacion"),
            evidencia=r.get("evidencia"),
            revision=revisiones.get((r["source"], r["target"])),
        ))
    for arista in manuales:
        await db.execute(
            pg_insert(Edge).values(**arista)
            .on_conflict_do_nothing(index_elements=["source", "target"])
        )
    # Este recálculo es el único que ve el corpus entero: deja medido el piso de
    # similitud para que las próximas ingestas incrementales usen el mismo criterio.
    if stats:
        valores = {
            "floor": stats.get("floor"),
            "n_docs": stats.get("n_docs"),
            "n_pares": stats.get("n_pares"),
            "medido_en": datetime.now(timezone.utc).isoformat(),
        }
        await db.execute(
            pg_insert(GraphStat).values(key="relaciones", value=valores)
            .on_conflict_do_update(index_elements=["key"], set_={"value": valores})
        )
    await db.commit()
    return {"ok": True, "relaciones": len(new_rels), "piso": stats.get("floor")}


# Estados posibles de la revisión humana de una relación. Deliberadamente no incluye
# "verdadera"/"falsa": una persona confirma que la relación le sirve o la descarta,
# no dictamina una verdad sobre el mundo.
ESTADOS_REVISION = {"confirmada", "rechazada", "sin_revisar"}


class RelationReview(BaseModel):
    source: str
    target: str
    estado: str
    comentario: str | None = None


@app.post("/api/relation/review")
async def review_relation(payload: RelationReview,
                          db: AsyncSession = Depends(get_async_session)):
    """Registra la decisión de una persona sobre una relación calculada.

    Es lo que separa "el sistema propuso" de "alguien lo miró". La arista NO se borra
    cuando se rechaza: se marca. Borrarla haría desaparecer la evidencia de que el
    cálculo se equivocó, que es justamente lo que conviene conservar.
    """
    if payload.estado not in ESTADOS_REVISION:
        raise HTTPException(400, f"Estado inválido. Válidos: {sorted(ESTADOS_REVISION)}")

    # La arista puede estar guardada en cualquiera de los dos sentidos.
    arista = (await db.execute(select(Edge).where(
        ((Edge.source == payload.source) & (Edge.target == payload.target)) |
        ((Edge.source == payload.target) & (Edge.target == payload.source))
    ))).scalars().first()
    if arista is None:
        raise HTTPException(404, "No existe esa relación en el grafo")

    if payload.estado == "sin_revisar":
        arista.revision = None
    else:
        arista.revision = {
            "estado": payload.estado,
            "comentario": (payload.comentario or "").strip() or None,
            "fecha": datetime.now(timezone.utc).isoformat(),
        }
    await db.commit()
    return {"ok": True, "source": arista.source, "target": arista.target,
            "revision": arista.revision}


# ── Vigencia de fuentes ───────────────────────────────────────────────────────
# La antigüedad NO degrada una fuente. Sólo la degrada una observación concreta.
# Las reglas viven en vigencia.py; acá está el I/O.

def _hash_archivo(path) -> str | None:
    import hashlib
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as archivo:
            for bloque in iter(lambda: archivo.read(1024 * 1024), b""):
                digest.update(bloque)
        return digest.hexdigest()
    except Exception:
        return None


class VigenciaReview(BaseModel):
    source_id: str
    estado: str
    comentario: str | None = None
    reemplazada_por: str | None = None


@app.post("/api/vigencia/verificar")
async def verificar_vigencia(db: AsyncSession = Depends(get_async_session)):
    """Recalcula el estado de vigencia comparando cada fuente contra el archivo en disco.

    Offline y determinístico: sólo SHA-256 sobre archivos locales. No consulta la red,
    no llama a ningún modelo y no mira la fecha de carga. Una fuente pasa a
    `posiblemente_desactualizado` únicamente si su archivo cambió o desapareció.
    """
    from vigencia import verificar_contra_disco, resolver_estado

    from collections import Counter

    ahora = datetime.now(timezone.utc).isoformat()
    fuentes = (await db.execute(select(Source))).scalars().all()
    # El resumen se reporta POR MOTIVO, no sólo por estado. Un agregado de
    # "105 vigentes" escondería que la mayoría nunca se comparó contra nada.
    motivos = Counter()
    resumen = {"revisadas": 0, "vigentes": 0, "posiblemente_desactualizadas": 0,
               "cambiadas": [], "ausentes": []}

    for fuente in fuentes:
        locator = fuente.locator or ""
        # Sólo son verificables las fuentes con archivo local. Una URL o un video no
        # se pueden comprobar sin red, y no verificable ≠ desactualizado.
        tiene_archivo_local = bool(locator) and not locator.startswith(
            ("http://", "https://", "node:")
        )
        archivo_existe, hash_en_disco = False, None
        if tiene_archivo_local:
            try:
                ruta = _resolve_file(locator)
                archivo_existe = True
                hash_en_disco = _hash_archivo(ruta)
            except Exception:
                archivo_existe = False

        estado, vigencia = verificar_contra_disco(
            fuente.vigencia, fuente.content_hash, hash_en_disco,
            archivo_existe, tiene_archivo_local, ahora,
        )
        fuente.estado_vigencia = estado
        fuente.vigencia = vigencia
        # Si esta corrida fijó la línea base, hay que persistir el hash: sin eso la
        # próxima verificación volvería a no tener contra qué comparar.
        if vigencia.get("motivo") == "linea_base_establecida_ahora":
            fuente.content_hash = vigencia.get("hash_contenido")
        resumen["revisadas"] += 1
        motivos[vigencia.get("motivo") or "sin_motivo"] += 1

        efectivo = resolver_estado(estado, fuente.revision_vigencia)
        if efectivo == "vigente":
            resumen["vigentes"] += 1
        else:
            resumen["posiblemente_desactualizadas"] += 1
            destino = (resumen["ausentes"] if vigencia.get("motivo") == "archivo_ausente"
                       else resumen["cambiadas"])
            destino.append({"source_id": fuente.id,
                            "nombre": fuente.original_name or fuente.locator})

    # ── Duplicados por contenido ──────────────────────────────────────────────
    # Se marcan acá y no sólo en la ingesta porque el corpus ya existente está lleno
    # de ellos: el mismo paper subido como "X - copia.pdf" y como "X.pdf". La fuente
    # más antigua queda como original; las demás apuntan a ella. NO cambia el estado:
    # dos copias del mismo archivo no vuelven vieja a ninguna.
    por_hash = {}
    for fuente in fuentes:
        if fuente.content_hash:
            por_hash.setdefault(fuente.content_hash, []).append(fuente)
    duplicados = 0
    for grupo in por_hash.values():
        if len(grupo) < 2:
            continue
        grupo.sort(key=lambda f: (f.created_at is None, f.created_at))
        original = grupo[0]
        for copia in grupo[1:]:
            vig = dict(copia.vigencia or {})
            vig["duplicado_de"] = original.id
            copia.vigencia = vig
            duplicados += 1
    resumen["duplicados_marcados"] = duplicados
    resumen["grupos_duplicados"] = sum(1 for g in por_hash.values() if len(g) > 1)

    await db.commit()
    resumen["por_motivo"] = dict(motivos)
    # Qué significa cada número, dicho en el propio payload: "vigente" acá quiere decir
    # "nada indica lo contrario", no "se comprobó que sigue vigente".
    resumen["lectura"] = {
        "contenido_sin_cambios": "el archivo es byte a byte el mismo que se ingirió",
        "linea_base_establecida_ahora": "no había hash de referencia; se fijó con el archivo actual. Habilita detectar cambios futuros, no dice nada del pasado",
        "sin_archivo_local_verificable": "URL o video: no se puede comprobar offline. No verificable no es lo mismo que desactualizado",
        "archivo_modificado_despues_de_la_ingesta": "el archivo cambió; el nodo del grafo describe una versión anterior",
        "archivo_ausente": "el original ya no está: la evidencia dejó de ser comprobable",
        "decision_humana": "el estado lo fijó una persona, no una observación del sistema",
        "duplicado_de": "otra fuente ya incorporada tiene contenido byte a byte idéntico. Es un dato para deduplicar, no una señal de obsolescencia",
    }
    resumen["advertencia"] = ("La antigüedad no se usa como señal. Ninguna fuente pasa a "
                              "desactualizada por la fecha en que se cargó.")
    resumen["verificado_en"] = ahora
    return resumen


@app.post("/api/vigencia/review")
async def review_vigencia(payload: VigenciaReview,
                          db: AsyncSession = Depends(get_async_session)):
    """Una persona fija el estado de vigencia de una fuente.

    Existe porque la verificación automática sólo ve el disco: no sabe que salió una
    norma nueva ni que un informe quedó sin efecto. Esa vigencia la sabe una persona y
    queda registrada como decisión humana, distinguible de lo que observó el sistema.
    """
    from vigencia import aplicar_decision_humana, ESTADOS

    if payload.estado not in ESTADOS:
        raise HTTPException(400, f"Estado inválido. Válidos: {sorted(ESTADOS)}")

    fuente = (await db.execute(
        select(Source).where(Source.id == payload.source_id)
    )).scalars().first()
    if fuente is None:
        raise HTTPException(404, "No existe esa fuente")

    if payload.reemplazada_por:
        existe = (await db.execute(
            select(Source.id).where(Source.id == payload.reemplazada_por)
        )).scalars().first()
        if existe is None:
            raise HTTPException(404, "La fuente que la reemplaza no existe")

    # Sólo se escribe la revisión. `estado_vigencia` y `vigencia` siguen guardando lo
    # que observó el sistema, para que se pueda ver en qué difiere la persona.
    revision = aplicar_decision_humana(
        payload.estado, payload.comentario,
        datetime.now(timezone.utc).isoformat(), payload.reemplazada_por,
    )
    fuente.revision_vigencia = revision
    await db.commit()
    return {"ok": True, "source_id": fuente.id,
            "estado": payload.estado,
            "estado_observado": fuente.estado_vigencia,
            "revision": revision}


@app.delete("/api/vigencia/review/{source_id}")
async def borrar_review_vigencia(source_id: str,
                                 db: AsyncSession = Depends(get_async_session)):
    """Quita la decisión humana y devuelve la fuente al estado que observa el sistema."""
    fuente = (await db.execute(
        select(Source).where(Source.id == source_id)
    )).scalars().first()
    if fuente is None:
        raise HTTPException(404, "No existe esa fuente")
    fuente.revision_vigencia = None
    await db.commit()
    return {"ok": True, "source_id": source_id, "estado": fuente.estado_vigencia}


@app.post("/api/recompute-layout")
async def recompute_layout():
    """Re-corre el clustering (UMAP intermedia + HDBSCAN) sobre todos los nodos y
    persiste posiciones/clusters. Sirve para aplicar ajustes de clustering al grafo
    existente, sin necesidad de re-subir documentos."""
    import asyncio
    import embeddings_engine
    await asyncio.to_thread(embeddings_engine.main)
    return {"ok": True}


@app.post("/api/taxonomy")
async def taxonomy(request: Request, apply: bool = False,
                   db: AsyncSession = Depends(get_async_session)):
    """Propone (dry-run) o aplica una taxonomía de TEMAS legible, asignada por LLM.
    Agrupa el grafo como lo haría una persona (por tema), no por densidad de embeddings.
    Sin apply → solo propone, no escribe. apply=true → persiste node.tema.
    Los embeddings/UMAP siguen rigiendo la POSICIÓN 3D; esto rige el GRUPO (color/etiqueta)."""
    # El dry-run es inofensivo; aplicar reescribe el tema de TODOS los documentos.
    if apply:
        body = await _read_body(request)
        if not _check_password(body.get("password")):
            raise HTTPException(403, "Clave de seguridad incorrecta.")
    rows = (await db.execute(
        select(Node).where(Node.is_centroid == False, Node.is_issue == False)
    )).scalars().all()
    docs = [{"id": n.id, "label": n.label or "", "conceptos": (n.conceptos or [])[:8]} for n in rows]
    if len(docs) < 3:
        return {"ok": False, "error": f"Solo {len(docs)} nodos; muy pocos para una taxonomía."}

    listado = "\n".join(
        f'- [{d["id"]}] {d["label"]} | conceptos: {", ".join(d["conceptos"]) or "(ninguno)"}'
        for d in docs
    )
    system = (
        "Sos un bibliotecario experto que organiza un grafo de conocimiento personal sobre IA, "
        "machine learning, estadística, RAG y temas afines. Agrupás documentos por TEMA, "
        "como lo haría una persona, no por palabras sueltas."
    )
    user = f"""Tengo {len(docs)} documentos. Para cada uno te doy id, título y conceptos clave.

1) Proponé una taxonomía con nombres cortos y legibles en español (las que hagan falta,
   típicamente 6 a 12), p.ej.: "Estadística", "LLMs", "RAG / Retrieval",
   "Diffusion y Visión", "Redes neuronales / Deep learning", "ML clásico", "Agentes",
   "Neurociencia / Cognición", "IA y sociedad". Los temas deben reflejar los REALES de
   ESTOS documentos, no una lista genérica.
   IMPORTANTE: cubrí TODOS los documentos. Si dos o más comparten un tema —aunque sea de
   nicho (ej. neurociencia, filosofía, historia)— CREÁ esa categoría; no los descartes por
   ser "de otro palo". Cada documento merece la etiqueta que le corresponde.
2) Asigná CADA documento a exactamente UN tema de tu taxonomía.
   Usá "Sin clasificar" SÓLO como último recurso: un documento único, sin ningún otro
   parecido, que realmente no forma tema con nadie. Si tiene al menos un "primo", creale
   la categoría.

Documentos:
{listado}

Respondé SOLO con JSON válido, sin backticks:
{{
  "temas": ["Tema 1", "Tema 2", "..."],
  "asignaciones": [{{"id": "<id exacto>", "tema": "<uno de temas, o 'Sin clasificar'>"}}]
}}
Cada id debe aparecer exactamente una vez. No inventes ids."""

    from processor import query_llm, parsear_json
    import asyncio
    from collections import Counter
    raw = await asyncio.to_thread(query_llm, [{"role": "user", "content": user}], system)
    try:
        data = parsear_json(raw)
    except Exception:
        return {"ok": False, "error": "El LLM no devolvió JSON válido.", "raw": raw[:600]}

    temas = data.get("temas") or []
    asign = {}
    for a in data.get("asignaciones", []):
        if isinstance(a, dict) and a.get("id"):
            asign[a["id"]] = (a.get("tema") or "Sin clasificar").strip()

    conteo = Counter(asign.get(d["id"], "Sin clasificar") for d in docs)

    if apply:
        for n in rows:
            n.tema = asign.get(n.id) or "Sin clasificar"
        await db.commit()

    return {
        "ok": True,
        "applied": apply,
        "temas": temas,
        "conteo": dict(conteo),
        "asignaciones": [
            {"id": d["id"], "label": d["label"], "tema": asign.get(d["id"], "Sin clasificar")}
            for d in docs
        ],
    }


# ── Search ────────────────────────────────────────────────────────────

@app.get("/api/search")
async def semantic_search(
    q: str,
    max_n: int = 10,
    db: AsyncSession = Depends(get_async_session),
):
    if not q or len(q.strip()) < 2:
        return {"ids": []}
    ids = await _nodos_relevantes(q.strip(), max_n=max_n, db=db)
    return {"ids": ids}


@app.get("/api/rag-debug")
async def rag_debug_search(
    q: str,
    top_k: int = 10,
    db: AsyncSession = Depends(get_async_session),
):
    """Debug visual de RAG: devuelve los top-k chunks recuperados con scores y node_ids.
    
    Usado por el modo "Explorar recuperación" en el grafo 3D.
    """
    if not q or len(q.strip()) < 3:
        return {"query": q, "results": [], "node_ids": []}
    
    chunks = await _chunks_relevantes_scored(q.strip(), max_n=top_k, db=db)
    
    # Agrupar por nodo, quedarse con el mejor chunk por nodo
    by_node = {}
    for chunk in chunks:
        nid = chunk["node_id"]
        if nid not in by_node or chunk["sim"] > by_node[nid]["sim"]:
            by_node[nid] = {
                "node_id": nid,
                "label": chunk["label"],
                "sim": round(chunk["sim"], 3),
                "excerpt": chunk["content"][:300],
                "page": chunk.get("page"),
                "chunk_id": chunk["id"],
            }
    
    results = sorted(by_node.values(), key=lambda x: x["sim"], reverse=True)
    node_ids = [r["node_id"] for r in results]
    
    return {
        "query": q,
        "results": results,
        "node_ids": node_ids,
        "count": len(results),
    }


# ── Node operations ───────────────────────────────────────────────────

@app.delete("/api/node/{node_id}")
async def delete_node(
    node_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_async_session),
):
    # Borrar un documento es irreversible: pide la misma clave que borrar una sección.
    body = await _read_body(request)
    if not _check_password(body.get("password")):
        raise HTTPException(403, "Clave de seguridad incorrecta.")
    result = await db.execute(
        sql_delete(Node).where(Node.id == node_id)
    )
    if result.rowcount == 0:
        raise HTTPException(404, f"Nodo {node_id} no encontrado")
    await db.commit()
    background_tasks.add_task(_recompute_edges_background)
    return {"ok": True}


@app.put("/api/node/{node_id}/rename")
async def rename_node(
    node_id: str,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    body = await request.json()
    new_label = (body.get("label") or "").strip()
    if not new_label:
        raise HTTPException(400, "Label vacío")
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, f"Nodo {node_id} no encontrado")
    node.label = new_label
    await db.commit()
    return {"ok": True}


class TagsUpdate(BaseModel):
    tags: list[str]


@app.post("/api/node/{node_id}/tags")
async def update_node_tags(
    node_id: str,
    payload: TagsUpdate,
    db: AsyncSession = Depends(get_async_session),
):
    result = await db.execute(select(Node).where(Node.id == node_id))
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Nodo no encontrado")
    node.tags = payload.tags
    await db.commit()
    return {"ok": True, "tags": payload.tags}


@app.get("/api/node/{node_id}/report")
async def get_node_report(
    node_id: str,
    db: AsyncSession = Depends(get_async_session),
):
    node = (await db.execute(select(Node).where(Node.id == node_id))).scalar_one_or_none()
    if not node:
        raise HTTPException(404, f"Nodo con ID {node_id} no encontrado")

    edges_rows = (await db.execute(select(Edge))).scalars().all()
    connected_ids = set()
    for e in edges_rows:
        if e.source == node_id:
            connected_ids.add(e.target)
        elif e.target == node_id:
            connected_ids.add(e.source)

    connected_nodes = []
    if connected_ids:
        rows = (await db.execute(
            select(Node).where(Node.id.in_(connected_ids))
        )).scalars().all()
        connected_nodes = [node_to_dict(n) for n in rows]

    nd = node_to_dict(node)

    md = "# Reporte de Conexiones Semánticas\n\n"
    md += f"## Nodo Principal: {nd.get('label', 'Sin título')}\n"
    md += f"- **ID**: `{nd['id']}`\n"
    md += f"- **Fuente**: {(nd.get('fuente') or 'concepto').upper()}\n"
    if nd.get("cluster") is not None:
        md += f"- **Cluster**: {nd['cluster']}\n"
    md += "\n"
    md += "### Descripción\n"
    md += f"> {nd.get('desc', 'Sin descripción.')}\n\n"
    if nd.get("fragmento"):
        md += "### Fragmento Extraído\n"
        md += f"```text\n{nd['fragmento']}\n```\n\n"
    if nd.get("conceptos"):
        md += "### Conceptos Clave\n"
        md += ", ".join([f"`{c}`" for c in nd["conceptos"]]) + "\n\n"
    md += "---\n\n"
    md += f"## Conexiones y Relaciones ({len(connected_nodes)})\n\n"

    if not connected_nodes:
        md += "*Este nodo no tiene conexiones directas con otros nodos.*\n"
    else:
        for idx, conn in enumerate(connected_nodes, 1):
            md += f"### {idx}. {conn.get('label', 'Sin título')} (`{conn['id']}`)\n"
            md += f"- **Fuente**: {(conn.get('fuente') or 'concepto').upper()}\n"
            if conn.get("cluster") is not None:
                md += f"- **Cluster**: {conn['cluster']}\n"
            md += f"- **Descripción**: {conn.get('desc', 'Sin descripción.')}\n"
            if conn.get("fragmento"):
                md += f"- **Fragmento**: *\"{conn['fragmento']}\"*\n"
            shared = set(nd.get("conceptos", [])) & set(conn.get("conceptos", []))
            if shared:
                md += "- **Conceptos Compartidos**: " + ", ".join([f"`{c}`" for c in shared]) + "\n"
            try:
                from processor import calcular_similitud_coseno
                sim = calcular_similitud_coseno(nd.get("embedding"), conn.get("embedding"))
                if sim and sim > 0:
                    md += f"- **Similitud Semántica**: `{sim:.2%}`\n"
            except Exception:
                pass
            md += "\n"

    filename = f"reporte-{node_id}.md"
    return Response(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/node/{node_id}/rich-preview")
async def get_rich_preview(
    node_id: str,
    db: AsyncSession = Depends(get_async_session),
):
    node = (await db.execute(select(Node).where(Node.id == node_id))).scalar_one_or_none()
    if not node:
        raise HTTPException(404, f"Nodo {node_id} no encontrado")

    if node.rich_html:
        return Response(content=node.rich_html, media_type="text/html")

    nodes_rows = (await db.execute(select(Node))).scalars().all()
    edges_rows = (await db.execute(select(Edge))).scalars().all()
    nodos = [node_to_dict(n) for n in nodes_rows]
    relaciones = [edge_to_dict(e) for e in edges_rows]
    nd = node_to_dict(node)

    from processor import generar_rich_html
    try:
        html_content = generar_rich_html(nd, nodos, relaciones)
        node.rich_html = html_content
        await db.commit()
    except Exception as e:
        raise HTTPException(500, f"Error al generar el apunte: {e}")

    return Response(content=html_content, media_type="text/html")


# ── Agent ─────────────────────────────────────────────────────────────

@app.post("/api/agent")
async def agent_endpoint(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    body = await request.json()
    system = body.get("system", "Sos el agente de Algedi.")
    messages = body.get("messages", [])
    ultima = messages[-1]["content"] if messages else ""

    chunks = await _chunks_relevantes_scored(ultima, max_n=8, db=db) if ultima else []
    scored = await _nodos_relevantes_scored(ultima, max_n=6, db=db) if ultima else []
    max_sim = chunks[0]["sim"] if chunks else (scored[0]["sim"] if scored else 0.0)
    evidence_sufficient = bool(ultima and max_sim >= AGENT_VETO_UMBRAL)

    # Documentos relacionados para navegación del grafo, deduplicados por nodo.
    best_by_node = {}
    for chunk in chunks:
        current = best_by_node.get(chunk["node_id"])
        if current is None or chunk["sim"] > current["sim"]:
            best_by_node[chunk["node_id"]] = {
                "id": chunk["node_id"], "label": chunk["label"], "sim": chunk["sim"],
            }
    for item in scored:
        best_by_node.setdefault(item["id"], {
            "id": item["id"], "label": item["label"], "sim": item["sim"],
        })
    fundamentos = [
        {**item, "sim": round(item["sim"], 2)}
        for item in sorted(best_by_node.values(), key=lambda value: value["sim"], reverse=True)
    ][:6]
    node_ids = [item["id"] for item in fundamentos]

    citations = []
    if chunks and evidence_sufficient:
        context_lines = []
        for index, chunk in enumerate(chunks, 1):
            marker = f"C{index}"
            location = f", página {chunk['page']}" if chunk.get("page") else ""
            context_lines.append(
                f"[{marker}] {chunk['label']}{location} "
                f"({int(chunk['sim'] * 100)}% afinidad): {chunk['content']}"
            )
            citations.append({
                "marker": marker,
                "chunk_id": chunk["id"],
                "node_id": chunk["node_id"],
                "label": chunk["label"],
                "page": chunk.get("page"),
                "excerpt": chunk["content"][:320],
                "sim": round(chunk["sim"], 2),
                "fuente_url": chunk.get("fuente_url"),
            })
        system = (
            f"{system}\n\n"
            "PASAJES RECUPERADOS DE LA BIBLIOTECA. Cuando una afirmación se apoye en un "
            "pasaje, citá su marcador exacto, por ejemplo [C1]. No atribuyas a la biblioteca "
            "nada que no figure en estos pasajes. Podés complementar con conocimiento general, "
            "pero separalo bajo el subtítulo 'Conocimiento general' y aclaralo.\n\n"
            + "\n\n".join(context_lines)
        )
    elif scored and evidence_sufficient:
        contexto = "\n".join(
            f"- [{int(s['sim'] * 100)}% afinidad] {s['label']}: "
            f"{(s.get('desc') or s.get('fragmento') or '').strip()[:240]}"
            for s in scored
        )
        system = (
            f"{system}\n\n"
            "RESÚMENES RELEVANTES DE LA BIBLIOTECA. Usalos como orientación, pero aclará "
            "que son resúmenes y todavía no citas por pasaje. Podés complementar con conocimiento "
            f"general, identificándolo como tal.\n\n{contexto}"
        )
    else:
        system = (
            f"{system}\n\n"
            "La biblioteca no ofrece respaldo suficiente para esta consulta. Igual podés brindar "
            "una explicación útil usando tu conocimiento general, bajo el subtítulo "
            "'Conocimiento general (sin respaldo en la biblioteca)'. No inventes fuentes ni digas "
            "que la respuesta proviene de documentos de Algedi. Si la consulta exige datos "
            "específicos o una decisión de alto impacto, explicá qué evidencia falta."
        )
    try:
        from processor import query_llm
        reply = query_llm(messages, system)
    except Exception as e:
        reply = f"Error: {e}"

    db.add(AuditLog(
        query=ultima,
        agent_mode=("RAG_CHUNKS" if citations else
                    "RAG_SUMMARIES" if evidence_sufficient else "GENERAL_KNOWLEDGE"),
        node_ids_consulted=node_ids,
        response=reply[:2000],
    ))
    await db.commit()

    return {
        "reply": reply,
        "nodos_relevantes": node_ids,
        "fundamentos": fundamentos,
        "citations": citations,
        "veto": False,
        "general_knowledge": not evidence_sufficient,
        "evidence_mode": ("chunks" if citations else
                          "summaries" if evidence_sufficient else "general"),
        "max_sim": round(max_sim, 2),
    }


@app.post("/api/synthesize")
async def synthesize_endpoint(request: Request, db: AsyncSession = Depends(get_async_session)):
    """Chat del módulo Issue: responde una consulta sobre un proceso/problema, fundándola
    en el grafo. Incluye SIEMPRE el contenido de los node_ids en foco (el issue y su etapa)
    + recupera conocimiento relevante por similitud. Honesto: si el grafo no cubre la
    pregunta, lo dice en vez de inventar. Devuelve markdown en 'result'."""
    import asyncio
    body = await request.json()
    query = (body.get("query") or "").strip()
    node_ids = body.get("node_ids") or []
    if not query:
        return {"result": "Escribí una consulta."}

    # Contenido explícito de los nodos en foco (el issue / la etapa seleccionada).
    contexto_focos = ""
    if node_ids:
        rows = (await db.execute(select(Node).where(Node.id.in_(node_ids)))).scalars().all()
        if rows:
            contexto_focos = "\n".join(
                f"- {n.label}: {(n.desc or n.fragmento or '').strip()[:400]}" for n in rows
            )

    # Recuperación semántica del resto del grafo para fundamentar (excluye los focos).
    scored = await _nodos_relevantes_scored(query, max_n=6, db=db)
    foco_set = set(node_ids)
    scored = [s for s in scored if s["id"] not in foco_set]
    max_sim = scored[0]["sim"] if scored else 0.0
    contexto_grafo = "\n".join(
        f"- [{int(s['sim'] * 100)}% afinidad] {s['label']}: "
        f"{(s.get('desc') or s.get('fragmento') or '').strip()[:240]}"
        for s in scored
    ) or "(sin coincidencias relevantes en el grafo)"

    system = (
        "Sos el agente de Algedi ayudando a diagnosticar y mejorar un proceso o problema. "
        "Respondé en español, con markdown, conciso y accionable. Andá DIRECTO a la ayuda "
        "útil sobre el proceso/etapa en foco — NO empieces con disclaimers sobre las "
        "afinidades del grafo. El grafo es apoyo opcional: si algún documento aporta, "
        "citalo; si no, respondé igual con criterio experto sobre el proceso. Solo aclarás "
        "una limitación si de verdad te falta info para algo puntual. No inventes datos "
        "específicos (números, fuentes) que no tengas.\n\n"
        f"CONTEXTO EN FOCO (el proceso/etapa):\n{contexto_focos or '(sin contexto específico)'}\n\n"
        f"CONOCIMIENTO DEL GRAFO que puede aportar (opcional):\n{contexto_grafo}"
    )

    try:
        from processor import query_llm
        reply = await asyncio.to_thread(query_llm, [{"role": "user", "content": query}], system)
    except Exception as e:
        reply = f"Error al consultar el agente: {e}"

    consultados = list(node_ids) + [s["id"] for s in scored]
    db.add(AuditLog(query=query[:2000], agent_mode="ISSUE_CHAT",
                    node_ids_consulted=consultados, response=reply[:2000]))
    await db.commit()

    return {"result": reply, "nodos_relevantes": [s["id"] for s in scored], "max_sim": round(max_sim, 2)}


# ── Algedi Solve MVP ──────────────────────────────────────────────────

class SolveReview(BaseModel):
    decision: str
    note: str = ""


class ArchitectAnalyzeRequest(BaseModel):
    case_name: str = ""
    problem: str
    objective: str = ""
    current_process: str = ""
    available_data: str = ""
    constraints: str = ""
    expected_value: str = ""


class ArchitectIntakeRequest(BaseModel):
    """Conversación de admisión: el usuario escribe libre y Architect repregunta.

    `messages` es el diálogo completo con el formato [{"role": "user"|"assistant",
    "content": "..."}]. El backend no guarda estado: la conversación viaja entera
    en cada llamada, igual que el chat del agente.
    """
    messages: list = []


ARCHITECT_ROUTES = {
    "redesign": "Rediseño",
    "rules": "Reglas",
    "data": "Datos / BI",
    "assistive": "IA asistiva",
    "agent": "Agente",
    "none": "No implementar",
}


def _solve_list(value) -> list:
    """Normaliza salidas del LLM para mantener estable el contrato del frontend."""
    return value if isinstance(value, list) else []


def _sanitize_solve_citations(value, valid_markers: set[str]):
    """Impide que el modelo convierta un marcador inexistente en una cita aparente."""
    invalid = set()

    def walk(item):
        if isinstance(item, dict):
            return {key: walk(child) for key, child in item.items()}
        if isinstance(item, list):
            return [walk(child) for child in item]
        if isinstance(item, str):
            def replace(match):
                marker = f"C{match.group(1)}"
                if marker in valid_markers:
                    return match.group(0)
                invalid.add(marker)
                return "[cita no válida]"
            return re.sub(r"\[C(\d+)\]", replace, item)
        return item

    return walk(value), sorted(invalid)


def _normalize_architect_route(value) -> str:
    """Mantiene la salida del LLM dentro de las seis rutas del producto."""
    route = str(value or "").strip().lower()
    aliases = {
        "rediseño": "redesign", "rediseno": "redesign", "redesign": "redesign",
        "reglas": "rules", "rules": "rules", "automatización": "rules",
        "automatizacion": "rules", "datos": "data", "datos / bi": "data",
        "bi": "data", "data": "data", "ia asistiva": "assistive",
        "asistiva": "assistive", "assistive": "assistive", "agente": "agent",
        "agent": "agent", "no implementar": "none", "none": "none",
    }
    return aliases.get(route, "none")


def _architect_score(value) -> int:
    """Convierte la matriz del LLM a una escala comparable y acotada de 1 a 5."""
    try:
        return max(1, min(5, int(round(float(value)))))
    except (TypeError, ValueError):
        return 1


@app.get("/architect-demo", include_in_schema=False)
async def architect_demo():
    """Sirve la demo desde el backend para que las llamadas sean same-origin."""
    return FileResponse(BASE / "entregables" / "algedi_architect_interactive.html")


ARCHITECT_CAMPOS = ("problem", "objective", "current_process",
                    "available_data", "constraints", "expected_value")


@app.post("/api/architect/intake")
async def architect_intake(payload: ArchitectIntakeRequest):
    """Admisión conversacional: el usuario escribe libre y Architect repregunta.

    Reemplaza al formulario de seis campos. El usuario describe su problema como
    lo diría en voz alta; Architect extrae lo que entendió, detecta qué falta y
    hace UNA pregunta por turno — sólo cuando ese dato cambiaría la ruta elegida.

    No decide la intervención: sólo prepara el brief. La clasificación sigue
    siendo trabajo de /api/architect/analyze, con su verificador y su HITL.
    """
    import asyncio
    from processor import parsear_json, query_llm

    mensajes = [m for m in (payload.messages or [])
                if isinstance(m, dict) and str(m.get("content") or "").strip()]
    if not mensajes:
        raise HTTPException(400, "No hay conversación para interpretar")

    dialogo = "\n".join(
        f"{'USUARIO' if m.get('role') != 'assistant' else 'ARCHITECT'}: "
        f"{str(m.get('content'))[:4000]}"
        for m in mensajes[-12:]
    )
    turnos_usuario = sum(1 for m in mensajes if m.get("role") != "assistant")

    prompt = f"""Sos la admisión de Algedi Architect. Tu único trabajo es entender el
caso que trae una persona y dejarlo listo para analizar. NO clasifiques la solución,
NO propongas tecnología, NO recomiendes nada.

CONVERSACIÓN HASTA ACÁ:
{dialogo}

Extraé lo que ya se puede afirmar. Lo que la persona no dijo va vacío: no lo inventes
ni lo completes con supuestos plausibles.

Después decidí si falta algo IMPRESCINDIBLE. Un dato es imprescindible sólo si su
ausencia cambiaría qué clase de intervención corresponde (rediseño de proceso, reglas
determinísticas, datos/BI, IA asistiva, agente, o no implementar). Por ejemplo: si no
se sabe si hay una decisión humana en el medio, o si las reglas son estables, o si el
proceso siquiera está definido, eso cambia la ruta.

REGLAS DE LA PREGUNTA:
- Una sola pregunta por turno, concreta y en lenguaje llano.
- Nunca preguntes algo que la persona ya respondió.
- Nunca pidas precisión numérica que la persona probablemente no tenga a mano.
- Van {turnos_usuario} turnos del usuario. A partir del tercero, sé mucho más
  permisivo: es preferible analizar con huecos declarados que interrogar.
- Si con lo que hay alcanza para distinguir entre las seis rutas, marcá suficiente.

Devolvé SOLO JSON:
{{"suficiente": true|false,
  "pregunta": "la única pregunta a hacer, o null si suficiente",
  "case_name": "nombre corto del caso, 3 a 6 palabras",
  "entendido": {{"problem":"...","objective":"...","current_process":"...",
                 "available_data":"...","constraints":"...","expected_value":"..."}},
  "faltantes": ["dato ausente que se declarará como hueco, no como supuesto"],
  "resumen": "una o dos frases devolviéndole a la persona lo que entendiste"}}"""

    try:
        crudo = await asyncio.to_thread(
            query_llm,
            [{"role": "user", "content": prompt}],
            "Sos la admisión de Algedi Architect. Escuchás y repreguntás lo mínimo. Respondés sólo JSON válido.",
        )
    except Exception as exc:
        raise HTTPException(502, f"No se pudo interpretar el caso: {exc}")

    crudo = (crudo or "").strip()
    if not crudo:
        raise HTTPException(502, "No se pudo interpretar el caso: respuesta vacía")
    try:
        data = parsear_json(crudo)
        if not isinstance(data, dict):
            raise ValueError("la admisión no devolvió un objeto")
    except Exception as exc:
        raise HTTPException(502, f"No se pudo interpretar el caso: {exc}")

    entendido = data.get("entendido")
    if not isinstance(entendido, dict):
        entendido = {}
    brief = {campo: str(entendido.get(campo) or "").strip() for campo in ARCHITECT_CAMPOS}

    # El brief manda sobre la autoevaluación del modelo: sin problema no hay caso,
    # y a partir del cuarto turno se corta para no convertir la admisión en interrogatorio.
    suficiente = bool(data.get("suficiente")) and bool(brief["problem"])
    if turnos_usuario >= 4 and brief["problem"]:
        suficiente = True

    pregunta = str(data.get("pregunta") or "").strip()
    if suficiente:
        pregunta = ""
    elif not pregunta:
        pregunta = "Contame un poco más: ¿cómo se resuelve hoy ese problema, paso a paso?"

    return {
        "suficiente": suficiente,
        "pregunta": pregunta or None,
        "case_name": str(data.get("case_name") or "").strip()[:120] or "Caso sin título",
        "brief": brief,
        "faltantes": _solve_list(data.get("faltantes")),
        "resumen": str(data.get("resumen") or "").strip(),
        "turnos_usuario": turnos_usuario,
    }


class GenerateFlowRequest(BaseModel):
    """Genera un flujograma inicial desde una descripción del problema."""
    problem: str
    case_name: str = ""


@app.post("/api/architect/generate-flow")
async def generate_flow_from_prompt(payload: GenerateFlowRequest):
    """Genera un flujograma de decisión a partir de un prompt.

    Usa el LLM para extraer pasos, decisiones y resultados del problema descripto.
    Devuelve nodos y aristas listos para React Flow.
    """
    from processor import parsear_json, query_llm

    problem = payload.problem.strip()[:2000]
    if len(problem) < 10:
        raise HTTPException(400, "Describí el problema con al menos 10 caracteres")

    prompt = f"""Analizá este problema y generá un flujograma de decisión simple.

PROBLEMA: {problem}

Devolvé SOLO JSON válido con este formato:
{{
  "nodes": [
    {{"id": "1", "type": "paso", "label": "Analizar situación", "position": {{"x": 250, "y": 50}}}},
    {{"id": "2", "type": "decision", "label": "¿Cumple criterios?", "position": {{"x": 250, "y": 170}}}},
    {{"id": "3", "type": "resultado", "label": "Implementar", "position": {{"x": 100, "y": 300}}}},
    {{"id": "4", "type": "resultado", "label": "No implementar", "position": {{"x": 400, "y": 300}}}}
  ],
  "edges": [
    {{"source": "1", "target": "2"}},
    {{"source": "2", "target": "3"}},
    {{"source": "2", "target": "4"}}
  ]
}}

Tipos válidos: paso (acción), decision (bifurcación con Sí/No), resultado (fin).
Posiciones: empieza en y=50, incrementa ~120 por nivel. x=250 centrado, x=100 izquierda, x=400 derecha.
Máximo 6 nodos. Decisiones tienen dos salidas. Sé conciso en los labels (máx 40 chars).
NO inventes etapas genéricas si el problema no las necesita.
SOLO JSON, sin explicación."""

    try:
        import asyncio
        raw = await asyncio.to_thread(
            query_llm,
            [{"role": "user", "content": prompt}],
            "Sos un experto en modelado de procesos. Generás flujogramas concisos. Respondés SOLO JSON.",
        )
        data = parsear_json(raw.strip())
        if not isinstance(data, dict) or not data.get("nodes"):
            raise ValueError("respuesta inválida")
        return {
            "nodes": data.get("nodes", [])[:6],
            "edges": data.get("edges", []),
        }
    except Exception as exc:
        # Fallback: devolver un flujo mínimo para que el frontend no falle
        return {
            "nodes": [
                {"id": "1", "type": "paso", "label": problem[:40] + ("…" if len(problem) > 40 else ""), "position": {"x": 250, "y": 50}},
                {"id": "2", "type": "decision", "label": "¿Proceder?", "position": {"x": 250, "y": 170}},
                {"id": "3", "type": "resultado", "label": "Implementar", "position": {"x": 100, "y": 300}},
                {"id": "4", "type": "resultado", "label": "No implementar", "position": {"x": 400, "y": 300}},
            ],
            "edges": [
                {"source": "1", "target": "2"},
                {"source": "2", "target": "3"},
                {"source": "2", "target": "4"},
            ],
            "fallback": True,
            "error": str(exc),
        }


class ArchitectChatRequest(BaseModel):
    """Chat interactivo del caso: el usuario dialoga y recibe sugerencias accionables."""
    messages: list = []
    canvas_state: dict = {}  # {nodes: [], edges: [], caseName: "", problem: ""}
    seccion: str = "personal"


@app.post("/api/architect/chat")
async def architect_chat(
    payload: ArchitectChatRequest,
    db: AsyncSession = Depends(get_async_session),
):
    """Chat interactivo para el taller de casos.
    
    A diferencia del intake one-shot, este endpoint:
    - Devuelve sugerencias CLICKEABLES que el frontend puede ejecutar
    - Incluye TRAZABILIDAD: fuentes/evidencia de donde salió cada respuesta
    - Responde rápido con feedback inmediato
    """
    import asyncio
    from processor import parsear_json, query_llm

    mensajes = [m for m in (payload.messages or [])
                if isinstance(m, dict) and str(m.get("content") or "").strip()]
    if not mensajes:
        raise HTTPException(400, "No hay mensaje para procesar")

    ultimo_msg = str(mensajes[-1].get("content", "")).strip()[:2000]
    canvas = payload.canvas_state or {}
    num_nodos = len(canvas.get("nodes", []))
    case_name = canvas.get("caseName", "")
    problem = canvas.get("problem", "")
    
    # TRAZABILIDAD: buscar evidencia relevante al mensaje + problema
    search_query = f"{problem[:500]} {ultimo_msg}"
    chunks = await _chunks_relevantes_scored(search_query, max_n=5, db=db)
    
    # Formatear fuentes para incluir en respuesta
    sources = []
    evidence_context = ""
    if chunks:
        evidence_lines = []
        for i, chunk in enumerate(chunks[:4]):
            sources.append({
                "node_id": chunk["node_id"],
                "label": chunk["label"],
                "excerpt": chunk["content"][:200],
                "page": chunk.get("page"),
                "sim": round(chunk["sim"], 2),
            })
            evidence_lines.append(f"[{i+1}] {chunk['label']}: {chunk['content'][:150]}...")
        evidence_context = "\n".join(evidence_lines)
    
    # Historial resumido (últimos 6 mensajes)
    historial = "\n".join(
        f"{'Usuario' if m.get('role') == 'user' else 'Asistente'}: {str(m.get('content'))[:500]}"
        for m in mensajes[-6:]
    )
    
    # Contexto del canvas
    canvas_context = ""
    if num_nodos > 0:
        nodos_desc = ", ".join(n.get("data", {}).get("label", "?")[:30] for n in canvas.get("nodes", [])[:5])
        canvas_context = f"\nCANVAS ACTUAL: {num_nodos} nodos ({nodos_desc}...)"
    
    # Contexto de evidencia para el LLM
    evidence_prompt = ""
    if evidence_context:
        evidence_prompt = f"\n\nEVIDENCIA RELACIONADA (del corpus):\n{evidence_context}"
    
    prompt = f"""Sos el asistente de Algedi Architect, un taller de casos.
Tu rol es ayudar al usuario a construir un flujo de decisión, NO dar respuestas largas.

CONTEXTO:
- Caso: {case_name or '(sin nombre)'}
- Problema: {problem[:300] or '(no definido)'}
{canvas_context}{evidence_prompt}

HISTORIAL:
{historial}

ULTIMO MENSAJE: {ultimo_msg}

REGLAS:
1. Respuestas CORTAS (2-3 oraciones máximo)
2. Siempre incluí al menos 1 SUGERENCIA accionable
3. Si hay evidencia relacionada, mencioná brevemente qué encontraste
4. Si piden generar flujo, sugerí la acción correspondiente
5. Si el canvas está vacío, sugerí empezar con una plantilla o generar desde el problema

TIPOS DE SUGERENCIAS (usa el "action" correspondiente):
- generate_flow: generar flujograma desde el problema actual
- add_node: agregar un nodo específico al canvas
- use_template: usar una plantilla predefinida (simple, verificacion, hitl)
- find_evidence: buscar evidencia relacionada
- refine_problem: el problema necesita más detalle
- analyze_routes: analizar rutas (solo si el usuario lo pide explícitamente)
- view_source: ver una fuente específica (params: node_id)

Devolvé SOLO JSON:
{{
  "message": "tu respuesta corta al usuario",
  "suggestions": [
    {{"label": "texto del botón", "action": "generate_flow", "params": {{}}}},
    {{"label": "Agregar paso: X", "action": "add_node", "params": {{"type": "paso", "label": "X"}}}},
    {{"label": "Ver fuente: Doc X", "action": "view_source", "params": {{"node_id": "..."}}}}
  ],
  "case_name": "nombre sugerido si detectás uno mejor, o null"
}}

Máximo 3 sugerencias. Las sugerencias deben ser relevantes al mensaje."""

    try:
        raw = await asyncio.to_thread(
            query_llm,
            [{"role": "user", "content": prompt}],
            "Sos un asistente conciso de taller de casos. Respondés SOLO JSON válido.",
        )
        data = parsear_json(raw.strip())
        if not isinstance(data, dict):
            raise ValueError("respuesta inválida")
        
        # Validar y limpiar sugerencias
        suggestions = []
        for s in data.get("suggestions", [])[:3]:
            if isinstance(s, dict) and s.get("label") and s.get("action"):
                suggestions.append({
                    "label": str(s["label"])[:60],
                    "action": str(s["action"]),
                    "params": s.get("params", {}),
                })
        
        # Si no hay sugerencias, agregar una por defecto
        if not suggestions:
            if num_nodos == 0:
                suggestions = [
                    {"label": "Generar flujo", "action": "generate_flow", "params": {}},
                    {"label": "Plantilla simple", "action": "use_template", "params": {"template": "simple"}},
                ]
            else:
                suggestions = [
                    {"label": "Agregar nodo", "action": "add_node", "params": {"type": "paso", "label": "Nuevo paso"}},
                ]
        
        return {
            "message": str(data.get("message", "")).strip()[:500] or "¿En qué te puedo ayudar?",
            "suggestions": suggestions,
            "case_name": data.get("case_name") if data.get("case_name") else None,
            "sources": sources,  # TRAZABILIDAD: fuentes de donde salió la respuesta
        }
    except Exception as exc:
        # Fallback rápido sin LLM
        default_suggestions = [
            {"label": "Generar flujo", "action": "generate_flow", "params": {}},
            {"label": "Usar plantilla", "action": "use_template", "params": {"template": "simple"}},
        ] if num_nodos == 0 else [
            {"label": "Agregar paso", "action": "add_node", "params": {"type": "paso", "label": "Nuevo paso"}},
        ]
        return {
            "message": "Contame más sobre tu caso. Puedo ayudarte a armar el flujo.",
            "suggestions": default_suggestions,
            "case_name": None,
            "sources": sources if 'sources' in dir() else [],  # Incluir sources si se recuperaron
            "_fallback": True,
        }


@app.post("/api/architect/analyze")
async def analyze_with_architect(
    payload: ArchitectAnalyzeRequest,
    db: AsyncSession = Depends(get_async_session),
):
    """Clasifica una necesidad con evidencia, comparación y verificación independiente.

    La ruta no surge de un árbol fijo: un planificador LLM evalúa seis alternativas
    sobre evidencia recuperada de Algedi y un segundo LLM objeta el resultado. La
    respuesta queda pendiente de decisión humana.
    """
    import asyncio
    from processor import parsear_json, query_llm

    problem = payload.problem.strip()[:4000]
    if len(problem) < 12:
        raise HTTPException(400, "Describí el problema con al menos 12 caracteres")
    inputs = {
        "case_name": payload.case_name.strip()[:200],
        "problem": problem,
        "objective": payload.objective.strip()[:2000],
        "current_process": payload.current_process.strip()[:3000],
        "available_data": payload.available_data.strip()[:2500],
        "constraints": payload.constraints.strip()[:2500],
        "expected_value": payload.expected_value.strip()[:2000],
    }
    search_query = "\n".join(value for value in inputs.values() if value)
    chunks = await _chunks_relevantes_scored(search_query, max_n=10, db=db)
    evidence_sufficient = bool(chunks and chunks[0]["sim"] >= AGENT_VETO_UMBRAL)
    citations = []
    evidence_lines = []
    if evidence_sufficient:
        for index, chunk in enumerate(chunks, 1):
            marker = f"C{index}"
            location = f", página {chunk['page']}" if chunk.get("page") else ""
            evidence_lines.append(f"[{marker}] {chunk['label']}{location}: {chunk['content']}")
            citations.append({
                "marker": marker,
                "chunk_id": chunk["id"],
                "node_id": chunk["node_id"],
                "label": chunk["label"],
                "page": chunk.get("page"),
                "excerpt": chunk["content"][:360],
                "sim": round(chunk["sim"], 2),
                "fuente_url": chunk.get("fuente_url"),
            })
    evidence_context = "\n\n".join(evidence_lines) or (
        "No hay pasajes con afinidad suficiente. Razoná con conocimiento general, "
        "declará esa limitación y no inventes fuentes ni hechos del caso."
    )

    planner_prompt = f"""CASO
Nombre: {inputs['case_name'] or '(sin nombre)'}
Problema: {problem}
Objetivo: {inputs['objective'] or '(no declarado)'}
Proceso actual: {inputs['current_process'] or '(no declarado)'}
Datos disponibles: {inputs['available_data'] or '(no declarados)'}
Restricciones: {inputs['constraints'] or '(no declaradas)'}
Valor esperado: {inputs['expected_value'] or '(no declarado)'}

EVIDENCIA RECUPERADA
{evidence_context}

Actuá como Architect: decidí qué intervención mínima resuelve mejor el problema entre
redesign, rules, data, assistive, agent y none. No asumas que IA es la respuesta.
Compará al menos tres rutas plausibles mediante cinco criterios: impacto, preparación
de datos, complejidad, riesgo y costo. Puntaje 1 es desfavorable y 5 favorable; en
complejidad, riesgo y costo, 5 significa menor complejidad/riesgo/costo.
Usá sólo marcadores [C1], [C2], etc. existentes. Si no hay evidencia, escribí
"conocimiento general" y explicitá qué dato falta.

Devolvé SOLO JSON válido:
{{
  "classification":"redesign|rules|data|assistive|agent|none",
  "problem_understanding":"...",
  "trace":["recuperación: ...","clasificación: ...","comparación: ...","verificación requerida: ...","decisión humana: pendiente"],
  "assumptions":["..."],
  "alternatives":[
    {{"route":"data","title":"...","proposal":"...","foundation":"... [C1]"}}
  ],
  "matrix":[
    {{"route":"data","impact":1,"data_readiness":1,"complexity":1,"risk":1,"cost":1,"rationale":"..."}}
  ],
  "recommendation":{{"route":"data","why":"...","conditions":["..."]}},
  "missing_information":["..."],
  "pilot":{{"scope":"...","success_signal":"...","stop_condition":"..."}}
}}
Reglas: 3 a 6 alternativas; una fila de matriz por alternativa; no inventes costos,
ahorros, métricas base ni resultados; español; sólo JSON."""
    try:
        raw_plan = await asyncio.to_thread(
            query_llm,
            [{"role": "user", "content": planner_prompt}],
            "Sos Algedi Architect. Comparás opciones y recomendás la intervención mínima suficiente. Respondés sólo JSON válido.",
        )
        plan = parsear_json(raw_plan.strip())
        if not isinstance(plan, dict):
            raise ValueError("el planificador no devolvió un objeto")
    except Exception as exc:
        raise HTTPException(502, f"No se pudo ejecutar Architect: {exc}")

    recommendation_route = (
        (plan.get("recommendation") or {}).get("route")
        if isinstance(plan.get("recommendation"), dict)
        else None
    )
    classification = _normalize_architect_route(
        recommendation_route or plan.get("classification")
    )
    plan["classification"] = classification
    for key in ("trace", "assumptions", "alternatives", "matrix", "missing_information"):
        plan[key] = _solve_list(plan.get(key))
    if len(plan["alternatives"]) < 3:
        raise HTTPException(502, "Architect no comparó al menos tres rutas")
    plan["alternatives"] = plan["alternatives"][:6]
    for alternative in plan["alternatives"]:
        if isinstance(alternative, dict):
            alternative["route"] = _normalize_architect_route(alternative.get("route"))
    if len(plan["matrix"]) < 3:
        raise HTTPException(502, "Architect no produjo una matriz comparable")
    plan["matrix"] = plan["matrix"][:6]
    for row in plan["matrix"]:
        if not isinstance(row, dict):
            continue
        row["route"] = _normalize_architect_route(row.get("route"))
        for criterion in ("impact", "data_readiness", "complexity", "risk", "cost"):
            row[criterion] = _architect_score(row.get(criterion))
    if not isinstance(plan.get("recommendation"), dict):
        plan["recommendation"] = {}
    plan["recommendation"]["route"] = classification
    if not isinstance(plan.get("pilot"), dict):
        plan["pilot"] = {}

    valid_markers = {citation["marker"] for citation in citations}
    referenced_markers = [f"C{number}" for number in sorted(set(re.findall(
        r"\[C(\d+)\]", json.dumps(plan, ensure_ascii=False)
    )))]
    plan, invalid_markers = _sanitize_solve_citations(plan, valid_markers)

    verifier_prompt = f"""Revisá como agente crítico independiente la recomendación de
Architect. Detectá si la tecnología propuesta es excesiva, si contradice restricciones,
si la matriz no justifica la ruta o si faltan datos. No agregues nuevas alternativas.

CASO: {json.dumps(inputs, ensure_ascii=False)}
MARCADORES VÁLIDOS: {', '.join(valid_markers) or '(ninguno)'}
MARCADORES INVÁLIDOS RETIRADOS: {', '.join(invalid_markers) or '(ninguno)'}
ANÁLISIS: {json.dumps(plan, ensure_ascii=False)}

Devolvé SOLO JSON:
{{"verdict":"viable|viable_with_changes|not_viable",
  "agrees_with_route":true,
  "suggested_route":"redesign|rules|data|assistive|agent|none",
  "objection":"objeción principal concreta",
  "findings":[{{"severity":"low|medium|high","finding":"...","action":"..."}}],
  "evidence_gaps":["..."],"required_changes":["..."]}}"""
    try:
        raw_review = await asyncio.to_thread(
            query_llm,
            [{"role": "user", "content": verifier_prompt}],
            "Sos el verificador crítico de Algedi Architect. Buscás falsos positivos de IA y evidencia insuficiente. Respondés sólo JSON válido.",
        )
        review = parsear_json(raw_review.strip())
        if not isinstance(review, dict):
            raise ValueError("el verificador no devolvió un objeto")
    except Exception as exc:
        raise HTTPException(502, f"No se pudo verificar Architect: {exc}")
    review["suggested_route"] = _normalize_architect_route(
        review.get("suggested_route") or classification
    )
    for key in ("findings", "evidence_gaps", "required_changes"):
        review[key] = _solve_list(review.get(key))
    if review.get("verdict") not in {"viable", "viable_with_changes", "not_viable"}:
        review["verdict"] = "not_viable"
    if invalid_markers:
        review["verdict"] = "viable_with_changes"
        review["findings"].append({
            "severity": "high",
            "finding": "El planificador intentó usar evidencia inexistente.",
            "action": "Las citas inválidas se retiraron; validar la afirmación antes de aprobar.",
        })

    result = {
        "version": "architect-pilot-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "inputs": inputs,
        "classification": classification,
        "classification_label": ARCHITECT_ROUTES[classification],
        "problem_understanding": plan.get("problem_understanding") or "",
        "trace": plan["trace"],
        "assumptions": plan["assumptions"],
        "alternatives": plan["alternatives"],
        "matrix": plan["matrix"],
        "recommendation": plan["recommendation"],
        "missing_information": plan["missing_information"],
        "pilot": plan["pilot"],
        "critical_review": review,
        "evidence_mode": "chunks" if evidence_sufficient else "general",
        "citations": citations,
        "citation_audit": {
            "valid_markers": sorted(valid_markers),
            "referenced_markers": referenced_markers,
            "invalid_markers": invalid_markers,
        },
        "human_review": {"status": "pending", "note": ""},
    }
    # ── Architect e Issue son la MISMA cosa ────────────────────────────────
    # Antes Architect devolvía el análisis y se perdía al cerrar el panel, mientras
    # Issue guardaba expedientes que Architect nunca había creado: dos módulos que
    # hacían lo mismo sobre objetos distintos. Ahora la corrida se persiste como
    # nodo de expediente, con el mismo contrato que consume el módulo Issue
    # (`Node.solve` + `is_issue`). Por eso la pestaña Expedientes las encuentra.
    import hashlib as _hashlib
    huella = _hashlib.sha256(
        f"{inputs.get('case_name','')}|{problem}".encode("utf-8")
    ).hexdigest()[:20]
    expediente_id = f"arq_{huella}"

    existente = (await db.execute(
        select(Node).where(Node.id == expediente_id)
    )).scalar_one_or_none()

    if existente is not None:
        # Reanálisis del mismo caso: se conserva la decisión humana ya registrada.
        # Pisarla obligaría a volver a aprobar algo que la persona ya aprobó.
        previa = (existente.solve or {}).get("human_review")
        if isinstance(previa, dict) and previa.get("status") not in (None, "pending"):
            result["human_review"] = previa
        existente.solve = result
        existente.label = inputs.get("case_name") or existente.label
        existente.desc = result.get("problem_understanding") or existente.desc
    else:
        db.add(Node(
            id=expediente_id,
            label=inputs.get("case_name") or "Caso sin título",
            type="EXPEDIENTE",
            desc=result.get("problem_understanding") or problem[:600],
            fragmento=problem[:1200],
            dominio=(citations[0].get("dominio") if citations else None) or "personal",
            fuente="architect",
            is_issue=True,
            solve=result,
        ))

    result["expediente_id"] = expediente_id

    db.add(AuditLog(
        query=search_query[:2000],
        agent_mode="ARCHITECT_PILOT",
        node_ids_consulted=[citation["node_id"] for citation in citations],
        response=json.dumps({
            "classification": classification,
            "verdict": review.get("verdict"),
            "expediente_id": expediente_id,
        }, ensure_ascii=False)[:2000],
    ))
    await db.commit()
    return result


@app.post("/api/issues/{issue_id}/solve")
async def solve_issue(
    issue_id: str,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """Convierte un Issue en una propuesta implementable, trazable y revisable.

    El planificador propone alternativas y un segundo agente actúa como verificador
    crítico. La investigación web autónoma queda fuera de este MVP: sólo se atribuye
    evidencia a pasajes realmente recuperados de la biblioteca.
    """
    issue = (await db.execute(
        select(Node).where(Node.id == issue_id, Node.is_issue == True)
    )).scalar_one_or_none()
    if issue is None:
        raise HTTPException(404, "No se encontró el problema")

    try:
        body = await request.json()
    except Exception:
        body = {}
    objective = str(body.get("objective") or "").strip()[:2000]
    constraints = str(body.get("constraints") or "").strip()[:3000]
    available_data = str(body.get("available_data") or "").strip()[:2000]
    problem = (issue.desc or issue.fragmento or issue.label or "").strip()
    search_query = "\n".join(filter(None, [issue.label, problem, objective, constraints]))

    chunks = await _chunks_relevantes_scored(search_query, max_n=10, db=db)
    evidence_sufficient = bool(chunks and chunks[0]["sim"] >= AGENT_VETO_UMBRAL)
    citations = []
    evidence_lines = []
    if evidence_sufficient:
        for index, chunk in enumerate(chunks, 1):
            marker = f"C{index}"
            location = f", página {chunk['page']}" if chunk.get("page") else ""
            evidence_lines.append(
                f"[{marker}] {chunk['label']}{location}: {chunk['content']}"
            )
            citations.append({
                "marker": marker,
                "chunk_id": chunk["id"],
                "node_id": chunk["node_id"],
                "label": chunk["label"],
                "page": chunk.get("page"),
                "excerpt": chunk["content"][:360],
                "sim": round(chunk["sim"], 2),
                "fuente_url": chunk.get("fuente_url"),
            })
    evidence_context = "\n\n".join(evidence_lines) or (
        "No hay pasajes con afinidad suficiente. Podés usar conocimiento general, "
        "pero no lo presentes como evidencia de la biblioteca."
    )

    current_flow = json.dumps(issue.flujograma or {}, ensure_ascii=False)
    planner_prompt = f"""PROBLEMA
Título: {issue.label}
Descripción: {problem}
Objetivo declarado: {objective or '(no declarado)'}
Datos disponibles: {available_data or '(no declarados)'}
Restricciones: {constraints or '(no declaradas)'}
Proceso actual: {current_flow}

EVIDENCIA RECUPERADA
{evidence_context}

Proponé una solución implementable. Cuando una afirmación se apoye en evidencia, usá
el marcador exacto [C1], [C2], etc. No inventes fuentes. Si completás con conocimiento
general, indicá "conocimiento general" en el campo fundamento.

Devolvé SOLO JSON válido con esta estructura:
{{
  "problem_understanding": "síntesis del problema y causa probable",
  "assumptions": ["supuesto a validar"],
  "alternatives": [
    {{"id":"A1","title":"...","description":"...","pros":["..."],"cons":["..."],"foundation":"texto con [C1] o conocimiento general"}}
  ],
  "recommendation": {{"alternative_id":"A1","why":"...","conditions":["..."]}},
  "future_process": {{
    "steps":[{{"id":"f1","label":"...","type":"start|step|decision|end"}}],
    "connections":[{{"source":"f1","target":"f2","condition":""}}]
  }},
  "roadmap": [{{"phase":"...","actions":["..."],"exit_criteria":["..."]}}],
  "risks": [{{"risk":"...","probability":"low|medium|high","impact":"low|medium|high","mitigation":"..."}}],
  "kpis": [{{"name":"...","definition":"...","measurement":"...","target":"a definir con línea base"}}],
  "missing_information": ["dato necesario"]
}}
Reglas: generá 2 o 3 alternativas; no inventes costos, métricas base ni resultados; el
roadmap debe empezar con una validación pequeña; español; sólo JSON."""

    try:
        import asyncio
        from processor import parsear_json, query_llm
        raw_plan = await asyncio.to_thread(
            query_llm,
            [{"role": "user", "content": planner_prompt}],
            "Sos el planificador de Algedi Solve. Proponés soluciones concretas, trazables y verificables. Respondés sólo JSON válido.",
        )
        plan = parsear_json(raw_plan.strip())
        if not isinstance(plan, dict):
            raise ValueError("el planificador no devolvió un objeto")
    except Exception as exc:
        raise HTTPException(502, f"No se pudo generar la solución: {exc}")

    # Contrato estable aunque el modelo omita campos opcionales.
    for key in ("assumptions", "alternatives", "roadmap", "risks", "kpis", "missing_information"):
        plan[key] = _solve_list(plan.get(key))
    if len(plan["alternatives"]) < 2:
        raise HTTPException(502, "El planificador no produjo al menos dos alternativas")
    plan["alternatives"] = plan["alternatives"][:3]
    if not isinstance(plan.get("recommendation"), dict):
        plan["recommendation"] = {}
    if not isinstance(plan.get("future_process"), dict):
        plan["future_process"] = {"steps": [], "connections": []}

    valid_markers = {citation["marker"] for citation in citations}
    referenced_markers = sorted(set(re.findall(
        r"\[C(\d+)\]", json.dumps(plan, ensure_ascii=False)
    )))
    referenced_markers = [f"C{number}" for number in referenced_markers]
    plan, invalid_markers = _sanitize_solve_citations(plan, valid_markers)

    verifier_prompt = f"""Actuá como verificador independiente. Revisá el plan contra el
problema, objetivo, restricciones y evidencia. Una cita sólo es válida si su marcador existe.
No propongas una cuarta solución; detectá fallas y elegí entre las alternativas existentes.

PROBLEMA: {problem}
OBJETIVO: {objective or '(no declarado)'}
RESTRICCIONES: {constraints or '(no declaradas)'}
MARCADORES VÁLIDOS: {', '.join(c['marker'] for c in citations) or '(ninguno)'}
MARCADORES INVÁLIDOS DETECTADOS Y RETIRADOS: {', '.join(invalid_markers) or '(ninguno)'}
PLAN: {json.dumps(plan, ensure_ascii=False)}

Devolvé SOLO JSON:
{{"verdict":"viable|viable_with_changes|not_viable",
  "recommended_alternative_id":"A1",
  "findings":[{{"severity":"low|medium|high","finding":"...","action":"..."}}],
  "evidence_gaps":["..."],
  "required_changes":["..."]}}"""
    try:
        raw_review = await asyncio.to_thread(
            query_llm,
            [{"role": "user", "content": verifier_prompt}],
            "Sos el agente crítico de Algedi Solve. Verificás viabilidad, restricciones y evidencia. Respondés sólo JSON válido.",
        )
        critical_review = parsear_json(raw_review.strip())
        if not isinstance(critical_review, dict):
            raise ValueError("el verificador no devolvió un objeto")
    except Exception as exc:
        raise HTTPException(502, f"No se pudo verificar la solución: {exc}")
    critical_review["findings"] = _solve_list(critical_review.get("findings"))
    critical_review["evidence_gaps"] = _solve_list(critical_review.get("evidence_gaps"))
    critical_review["required_changes"] = _solve_list(critical_review.get("required_changes"))
    if critical_review.get("verdict") not in {"viable", "viable_with_changes", "not_viable"}:
        critical_review["verdict"] = "not_viable"
    if invalid_markers:
        critical_review["verdict"] = "viable_with_changes"
        critical_review["findings"].append({
            "severity": "high",
            "finding": "El planificador intentó usar marcadores de evidencia inexistentes.",
            "action": "Las citas inválidas fueron retiradas; revisar esas afirmaciones antes de aprobar.",
        })

    now = datetime.now(timezone.utc).isoformat()
    result = {
        "version": "solve-mvp-v1",
        "generated_at": now,
        "inputs": {
            "objective": objective,
            "constraints": constraints,
            "available_data": available_data,
        },
        "problem_understanding": plan.get("problem_understanding") or "",
        "assumptions": plan["assumptions"],
        "alternatives": plan["alternatives"],
        "recommendation": plan["recommendation"],
        "future_process": plan["future_process"],
        "roadmap": plan["roadmap"],
        "risks": plan["risks"],
        "kpis": plan["kpis"],
        "missing_information": plan["missing_information"],
        "critical_review": critical_review,
        "evidence_mode": "chunks" if evidence_sufficient else "general",
        "citations": citations,
        "citation_audit": {
            "valid_markers": sorted(valid_markers),
            "referenced_markers": referenced_markers,
            "invalid_markers": invalid_markers,
        },
        "human_review": {"status": "pending", "note": "", "updated_at": None, "history": []},
    }
    issue.solve = result
    db.add(AuditLog(
        query=search_query[:2000],
        agent_mode="SOLVE_MVP",
        node_ids_consulted=[citation["node_id"] for citation in citations],
        response=json.dumps({
            "verdict": critical_review.get("verdict"),
            "recommendation": plan["recommendation"],
        }, ensure_ascii=False)[:2000],
    ))
    await db.commit()
    return result


@app.patch("/api/issues/{issue_id}/solve/review")
async def review_solve(
    issue_id: str,
    review: SolveReview,
    db: AsyncSession = Depends(get_async_session),
):
    decision = review.decision.strip().lower()
    if decision not in {"approved", "revision_requested"}:
        raise HTTPException(400, "La decisión debe ser approved o revision_requested")
    note = review.note.strip()[:4000]
    if decision == "revision_requested" and not note:
        raise HTTPException(400, "Indicá qué debe corregirse")

    issue = (await db.execute(
        select(Node).where(Node.id == issue_id, Node.is_issue == True)
    )).scalar_one_or_none()
    if issue is None or not isinstance(issue.solve, dict):
        raise HTTPException(404, "El problema todavía no tiene una solución")

    updated = dict(issue.solve)
    previous = updated.get("human_review") if isinstance(updated.get("human_review"), dict) else {}
    history = list(previous.get("history") or [])
    event = {
        "status": decision,
        "note": note,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    history.append(event)
    updated["human_review"] = {**event, "history": history[-20:]}
    issue.solve = updated
    db.add(AuditLog(
        query=note or decision,
        agent_mode="SOLVE_HUMAN_REVIEW",
        node_ids_consulted=[issue_id],
        response=decision,
    ))
    await db.commit()
    return updated


# ── Procesos (inteligencia de procesos, fundada en el grafo) ──────────

@app.post("/api/process")
async def generar_proceso(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """A partir de la descripción de un proceso: lo estructura como flujograma Y lo analiza
    FUNDADO en el grafo de conocimiento (sugerencias/riesgos citando documentos, y qué medir
    y por qué — sin inventar números). MVP: genera y devuelve, no persiste todavía."""
    body = await request.json()
    descripcion = (body.get("descripcion") or "").strip()
    if not descripcion:
        raise HTTPException(400, "Falta la descripción del proceso")

    # Grounding: recuperar conocimiento relevante del grafo.
    scored = await _nodos_relevantes_scored(descripcion, max_n=6, db=db)
    contexto = "\n".join(
        f"- [{int(s['sim'] * 100)}% afinidad] {s['label']}: {(s.get('desc') or '').strip()[:200]}"
        for s in scored
    ) or "(sin conocimiento relevante en el grafo)"
    nodos_fundamento = [s["id"] for s in scored]
    afinidad_max = round(scored[0]["sim"], 2) if scored else 0.0

    prompt = (
        "Sos un analista de procesos. A partir de la descripción, generá la estructura del "
        "proceso como flujograma Y un análisis fundado en el conocimiento disponible.\n\n"
        f"DESCRIPCIÓN DEL PROCESO:\n{descripcion}\n\n"
        "CONOCIMIENTO RELEVANTE DEL GRAFO (con % de afinidad). Fundá las sugerencias/riesgos "
        "en esto; si la afinidad es baja o no aplica, DECILO y no inventes respaldo:\n"
        f"{contexto}\n\n"
        "Devolvé SOLO un JSON con esta estructura EXACTA:\n"
        '{\n'
        '  "titulo": "nombre corto del proceso",\n'
        '  "pasos": [{"id": "p1", "label": "texto del paso (<=8 palabras)", "tipo": "inicio|paso|decision|fin"}],\n'
        '  "conexiones": [{"desde": "p1", "hasta": "p2", "condicion": "opcional (sí/no en decisiones)"}],\n'
        '  "sugerencias": [{"tipo": "mejora|riesgo|automatizacion", "texto": "...", "fundamento": "documento que lo respalda, o \'sin respaldo en el grafo\'"}],\n'
        '  "indicadores": [{"que": "qué medir", "como": "cómo medirlo", "porque": "por qué importa"}]\n'
        '}\n\n'
        "Reglas: el primer paso es 'inicio' y el último 'fin'; los 'decision' pueden tener 2+ "
        "salidas con condicion; en 'indicadores' NO inventes números, proponé QUÉ medir y POR QUÉ; "
        "español; SOLO el JSON, sin texto alrededor."
    )

    try:
        from processor import query_llm, parsear_json
        raw = query_llm(
            [{"role": "user", "content": prompt}],
            system="Sos un experto en análisis y optimización de procesos. Respondés SOLO con JSON válido.",
        )
        data = parsear_json(raw.strip())
    except Exception as e:
        raise HTTPException(500, f"No se pudo generar el proceso: {e}")

    data.setdefault("pasos", [])
    data.setdefault("conexiones", [])
    data.setdefault("sugerencias", [])
    data.setdefault("indicadores", [])
    data["nodos_fundamento"] = nodos_fundamento
    data["afinidad_max"] = afinidad_max
    return data


# ── Ingestion ─────────────────────────────────────────────────────────

def _set_progress(pct: int, msg: str):
    with _ingest_lock:
        # No pisar un estado terminal (error/done): el ticker corre en otro thread
        # y antes ocultaba el mensaje real del error.
        if _ingest.get("state") not in ("error", "done"):
            _ingest["progress"] = pct
            _ingest["message"] = msg


# Veto epistémico del agente, en DOS capas:
#  1) Hard floor: si la mejor coincidencia cae por debajo de esto, se abstiene sin llamar al
#     LLM. Conservador a propósito (los embeddings tienen "piso" alto y un umbral agresivo
#     vetaría consultas válidas — hay solapamiento entre off-topic y cubierto).
#  2) Soft: al LLM se le pasa el % de afinidad y se le instruye decir "no me alcanza" si es bajo.
AGENT_VETO_UMBRAL = 0.28

# Techo de videos por playlist. NO es un capricho: cada video = 1 llamada al LLM, y
# Gemini gratis limita req/min. 50 cubre casi cualquier playlist real; subilo si querés
# (a costa de tiempo de ingesta y posibles 429 con listas enormes).
PLAYLIST_LIMIT = 50


def _es_playlist_youtube(url: str) -> bool:
    """URL de playlist 'pura' (no un video suelto que casualmente está en una lista)."""
    u = (url or "").lower()
    if "youtube.com" not in u and "youtu.be" not in u:
        return False
    return "list=" in u and "watch?v=" not in u


def _ingest_playlist(url: str, skip_umap: bool = False, seccion: str = "personal"):
    """Expande una playlist de YouTube y crea UN NODO POR VIDEO (cada uno enlazable).
    Secuencial (respeta el rate-limit del LLM) y UMAP una sola vez al final."""
    global _ingest
    from processor import expandir_playlist, procesar_youtube
    _set_progress(8, "Leyendo la lista de YouTube…")
    # Listamos TODOS los videos (metadata barata) para saber el total real,
    # pero solo ingerimos los primeros PLAYLIST_LIMIT (cada uno = 1 llamada al LLM).
    videos_all = expandir_playlist(url, limite=200)
    total = len(videos_all)
    if total == 0:
        with _ingest_lock:
            _ingest = {"state": "error",
                       "message": "No se pudieron leer videos de la playlist (¿es pública?)",
                       "label": "", "progress": 0}
        return False
    a_cargar = videos_all[:PLAYLIST_LIMIT]
    n = len(a_cargar)
    ok = 0
    for i, v in enumerate(a_cargar):
        titulo = (v.get("title") or "")[:45]
        _set_progress(int(10 + 78 * i / max(1, n)), f"Video {i+1}/{n}: {titulo}…")
        try:
            # Pasamos título y canal de yt-dlp como respaldo (el oembed a veces viene vacío).
            resultado = procesar_youtube(v["url"], title_hint=v.get("title"), author_hint=v.get("channel"))
            for nodo in resultado.get("nodos", []):
                nodo["dominio"] = seccion or "personal"
                node_chunks = [c for c in resultado.get("chunks", [])
                               if c.get("node_id") == nodo["id"]]
                _save_node_sync(nodo, node_chunks)
                ok += 1
        except Exception as e:
            print(f"Error en video {v['url']}: {e}")
    if not skip_umap:
        _set_progress(90, "Calculando posiciones 3D (UMAP)…")
        try:
            import embeddings_engine
            embeddings_engine.main()
        except Exception as e:
            print(f"Error UMAP playlist: {e}")
    if total > PLAYLIST_LIMIT:
        msg = f"Cargué {ok} de {total} videos (tope {PLAYLIST_LIMIT}). Decime si querés el resto."
    else:
        msg = f"{ok} de {total} videos de la playlist incorporados."
    with _ingest_lock:
        _ingest = {"state": "done", "message": msg, "label": "Playlist", "progress": 100}
    return ok > 0


# Documentos que se extraen en paralelo dentro de un lote. La parte cara de esta etapa
# es ESPERA DE RED (la llamada al LLM), no CPU, así que la concurrencia paga aunque la
# máquina no tenga GPU. El techo lo pone el rate-limit del proveedor, no el hardware:
# subilo si tenés cuota holgada, bajalo a 1 si el proveedor devuelve 429 seguido.
INGEST_WORKERS = max(1, int(os.getenv("ALGEDI_INGEST_WORKERS", "4")))


def _extraer_documento(entrada: str) -> dict:
    """Conector → {nodos, relaciones, chunks}. Es la etapa cara (LLM + embeddings) y no
    toca la base, así que puede correr en paralelo con otras."""
    from processor import (procesar_excel, procesar_html, procesar_pdf,
                           procesar_youtube)

    ext = Path(entrada).suffix.lower() if not entrada.startswith("http") else ""
    if entrada.startswith("http"):
        if any(d in entrada for d in ("youtube.com", "youtu.be")):
            return procesar_youtube(entrada)
        from processor import procesar_url_web
        return procesar_url_web(entrada)
    if ext in (".xlsx", ".xls"):
        return procesar_excel(entrada)
    if ext in (".html", ".htm"):
        return procesar_html(entrada)
    if ext in (".txt", ".md"):
        from processor import procesar_txt
        return procesar_txt(entrada)
    if ext == ".docx":
        from processor import procesar_word
        return procesar_word(entrada)
    if ext in (".pptx", ".pptm"):
        from processor import procesar_pptx
        return procesar_pptx(entrada)
    return procesar_pdf(entrada)


def _persistir_resultado(resultado: dict, seccion: str):
    """Guarda los nodos de un documento ya extraído. Serial a propósito: las escrituras
    y el cálculo de aristas comparten estado en la base."""
    for nodo in resultado.get("nodos", []):
        nodo["dominio"] = seccion or "personal"
        node_chunks = [c for c in resultado.get("chunks", [])
                       if c.get("node_id") == nodo["id"]]
        _save_node_sync(nodo, node_chunks if "chunks" in resultado else None)


def _cerrar_lote(skip_umap: bool):
    """Trabajo que se hace UNA vez por lote, no por documento: clasificar los temas
    pendientes (en lote, una llamada cada TEMAS_LOTE docs) y recalcular la proyección 3D."""
    from processor import asignar_temas_pendientes
    _set_progress(88, "Clasificando temas…")
    asignar_temas_pendientes()
    if not skip_umap:
        _set_progress(94, "Calculando posición 3D (UMAP)…")
        try:
            import embeddings_engine
            embeddings_engine.main()
        except Exception as e:
            print(f"Error al calcular posiciones 3D (UMAP/HDBSCAN): {e}")


def _run_ingest_batch(entradas: list, seccion: str = "personal"):
    """Ingiere varios documentos: extracción EN PARALELO, guardado en serie, y cierre
    (temas + UMAP) una sola vez.

    Antes cada documento del lote hacía todo el recorrido solo y en serie: su llamada al
    LLM, su recálculo completo de aristas y su corrida de UMAP. Un lote de 10 archivos
    pagaba 10 veces un trabajo que corresponde una sola vez.
    """
    global _ingest
    from concurrent.futures import ThreadPoolExecutor, as_completed

    _INGEST_GATE.acquire()
    try:
        total = len(entradas)
        with _ingest_lock:
            _ingest.update({"state": "processing", "progress": 5,
                            "label": f"{total} documentos",
                            "message": f"Analizando {total} documentos…"})

        listos, fallidos = [], []
        completados = 0
        workers = min(INGEST_WORKERS, total)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futuros = {pool.submit(_extraer_documento, e): e for e in entradas}
            for futuro in as_completed(futuros):
                entrada = futuros[futuro]
                nombre = entrada[:60] if entrada.startswith("http") else Path(entrada).name
                completados += 1
                try:
                    listos.append(futuro.result())
                except Exception as exc:
                    # Un documento que falla no debe tumbar el lote entero.
                    fallidos.append((nombre, str(exc)))
                    print(f"Error extrayendo '{nombre}': {exc}")
                _set_progress(5 + int(70 * completados / total),
                              f"Analizados {completados}/{total} documentos…")

        _set_progress(78, "Guardando en el grafo…")
        guardados = 0
        for resultado in listos:
            try:
                _persistir_resultado(resultado, seccion)
                guardados += 1
            except Exception as exc:
                etiqueta = (resultado.get("nodos") or [{}])[0].get("label", "?")
                fallidos.append((etiqueta, str(exc)))
                print(f"Error guardando '{etiqueta}': {exc}")

        _cerrar_lote(skip_umap=False)

        # Se informa lo que quedó EN EL GRAFO, no lo que se logró leer: un documento
        # extraído que después no se pudo guardar no está incorporado.
        mensaje = f"{guardados} de {total} documentos incorporados al grafo."
        if fallidos:
            # El nombre del primero alcanza para saber por dónde empezar a mirar; el
            # detalle completo de cada falla ya quedó en el log del servidor.
            mensaje += f" {len(fallidos)} con error (p. ej. {fallidos[0][0]})."
        with _ingest_lock:
            _ingest = {"state": "done" if guardados else "error", "message": mensaje,
                       "label": f"{guardados} documentos", "progress": 100}
        return bool(guardados)

    except Exception as exc:
        with _ingest_lock:
            _ingest = {"state": "error", "message": str(exc), "label": "", "progress": 0}
        return False
    finally:
        _INGEST_GATE.release()


def _run_ingest(entrada: str, skip_umap: bool = False, seccion: str = "personal"):
    global _ingest
    _INGEST_GATE.acquire()   # una ingesta a la vez (manual o del vault)
    try:
        with _ingest_lock:
            _ingest.update({"state": "processing", "message": "Iniciando…",
                            "label": (entrada[:60] if entrada.startswith("http")
                                      else Path(entrada).name),
                            "progress": 5})
        # Playlist de YouTube → un nodo por video (camino propio, sale temprano).
        if entrada.startswith("http") and _es_playlist_youtube(entrada):
            return _ingest_playlist(entrada, skip_umap, seccion)

        _set_progress(10, "Extrayendo contenido…")

        import threading as _threading
        _stop_ticker = _threading.Event()

        def _ticker():
            steps = [
                (14, "Analizando con IA…"),
                (20, "Analizando con IA…"),
                (27, "Procesando con IA…"),
                (33, "Procesando con IA…"),
                (39, "Generando resumen…"),
                (44, "Generando resumen…"),
                (49, "Extrayendo conceptos…"),
                (54, "Extrayendo conceptos…"),
            ]
            for pct, msg in steps:
                if _stop_ticker.wait(timeout=5):
                    break
                _set_progress(pct, msg)

        _t = _threading.Thread(target=_ticker, daemon=True)
        _t.start()

        resultado = _extraer_documento(entrada)

        _stop_ticker.set()
        _set_progress(70, "Generando embeddings…")

        # El apunte IA (rich_html) NO se genera acá: era una llamada al LLM entera —
        # la más cara del pipeline, ~2000 tokens de HTML— por cada documento ingerido,
        # para un panel que casi nunca se abre. Ahora lo genera on-demand
        # GET /api/node/{id}/rich-preview la primera vez que alguien lo pide.

        # Guardar cada nodo en PostgreSQL, etiquetado con la sección activa.
        _persistir_resultado(resultado, seccion)
        _cerrar_lote(skip_umap)

        label = resultado["nodos"][0]["label"] if resultado["nodos"] else "Nodo"
        msg = f'"{label}" guardado.' if skip_umap else f'"{label}" incorporado al grafo.'
        with _ingest_lock:
            _ingest = {"state": "done", "message": msg, "label": label, "progress": 100}
        return True

    except Exception as exc:
        with _ingest_lock:
            _ingest = {"state": "error", "message": str(exc), "label": "", "progress": 0}
        return False
    finally:
        _INGEST_GATE.release()


@app.post("/api/ingest")
async def ingest(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(default=None),
    url: str = Form(default=None),
    skip_umap: bool = Form(default=False),
    seccion: str = Form(default="personal"),
):
    global _ingest_source
    seccion = (seccion or "personal").strip() or "personal"
    with _ingest_lock:
        if _ingest["state"] == "processing":
            raise HTTPException(409, "Ya hay una ingesta en progreso")
        _ingest.update({"state": "processing", "message": "Iniciando…", "label": "", "progress": 5})
    _ingest_source = "user"

    entradas = []
    if file and file.filename:
        try:
            save_path = await _save_upload(file, INGEST_EXTENSIONS)
            entradas.append(str(save_path))
        except HTTPException:
            with _ingest_lock:
                _ingest.update({"state": "idle", "message": "", "label": "", "progress": 0})
            raise
    elif url and url.strip():
        raw_urls = re.split(r"[,\n]+", url)
        entradas = [u.strip() for u in raw_urls if u.strip().startswith("http")]

    if not entradas:
        with _ingest_lock:
            _ingest.update({"state": "idle", "message": "", "label": ""})
        raise HTTPException(400, "Enviá un archivo o al menos una URL válida (http/https)")

    if len(entradas) == 1:
        background_tasks.add_task(_run_ingest, entradas[0], skip_umap, seccion)
    else:
        # Varias URLs: extracción en paralelo y un solo cierre (temas + UMAP) al final,
        # en vez de una tarea completa por documento.
        background_tasks.add_task(_run_ingest_batch, entradas, seccion)

    return {"ok": True, "count": len(entradas)}


@app.post("/api/umap-refresh")
async def umap_refresh(background_tasks: BackgroundTasks):
    def _run():
        try:
            import embeddings_engine
            embeddings_engine.main()
        except Exception as e:
            print(f"Error UMAP refresh: {e}")

    background_tasks.add_task(_run)
    return {"ok": True}


@app.post("/api/ingest/reset")
def ingest_reset():
    global _ingest
    with _ingest_lock:
        _ingest = {"state": "idle", "message": "", "label": "", "progress": 0}
    return {"ok": True}


@app.get("/api/ingest/status")
def get_ingest_status():
    with _ingest_lock:
        return dict(_ingest)


# ── Vault: Ingesta Continua (carpeta mágica) ──────────────────────────

@app.get("/api/vault/status")
def vault_status():
    import vault_watcher
    w = vault_watcher.get()
    if w is None:
        return {"enabled": False, "available": False, "folder": str(VAULT),
                "count": 0, "queued": 0, "state": "idle", "label": ""}
    st = w.status()
    # Si la ingesta en curso la disparó el vault, exponemos su progreso en vivo
    # para que el badge del front muestre la barra sin depender del panel de subida.
    if _ingest_source == "vault":
        with _ingest_lock:
            st["progress"] = _ingest.get("progress", 0)
            st["message"] = _ingest.get("message", "")
            if _ingest.get("state") == "processing":
                st["state"] = "processing"
                st["label"] = _ingest.get("label") or st.get("label", "")
    return st


@app.post("/api/vault/rescan")
def vault_rescan():
    import vault_watcher
    w = vault_watcher.get()
    if w is None:
        raise HTTPException(400, "La Ingesta Continua no está activa")
    threading.Thread(target=w.rescan, daemon=True).start()
    return {"ok": True}


# ── Issue module ──────────────────────────────────────────────────────

def _run_issue(descripcion: str, ref_url: str = None, filepath: str = None):
    global _issue_state
    try:
        from processor import procesar_issue, query_llm, _extraer_texto_html, extraer_texto_pdf

        if ref_url:
            with _issue_lock:
                _issue_state.update({"progress": 15, "message": "Obteniendo contenido de la URL…"})
            try:
                from security_utils import safe_http_get
                headers = {"User-Agent": "Mozilla/5.0 (compatible; Algedi/1.0)"}
                resp = safe_http_get(ref_url, timeout=20.0, headers=headers)
                resp.raise_for_status()
                url_text = _extraer_texto_html(resp.text)[:3000]
                descripcion = f"{descripcion}\n\nContenido de referencia ({ref_url}):\n{url_text}"
            except Exception as e:
                print(f"Warning: URL fetch failed: {e}")

        if filepath:
            with _issue_lock:
                _issue_state.update({"progress": 15, "message": "Extrayendo contenido del archivo…"})
            try:
                ext = Path(filepath).suffix.lower()
                if ext == ".pdf":
                    file_text = extraer_texto_pdf(filepath)[:3000]
                elif ext in (".html", ".htm"):
                    raw = Path(filepath).read_text(encoding="utf-8", errors="ignore")
                    file_text = _extraer_texto_html(raw)[:3000]
                else:
                    file_text = Path(filepath).read_text(encoding="utf-8", errors="ignore")[:3000]
                descripcion = f"{descripcion}\n\nDocumento adjunto ({Path(filepath).name}):\n{file_text}"
            except Exception as e:
                print(f"Warning: file extraction failed: {e}")

        with _issue_lock:
            _issue_state.update({"state": "processing", "message": "Analizando el problema…", "progress": 20, "result": None})

        nodo = procesar_issue(descripcion)

        with _issue_lock:
            _issue_state.update({"progress": 50, "message": "Guardando en el grafo…"})

        _save_node_sync(nodo)

        with _issue_lock:
            _issue_state.update({"progress": 70, "message": "Buscando conexiones relevantes…"})

        # Búsqueda semántica síncrona desde thread
        from processor import get_embed_model, calcular_similitud_coseno
        from database.models import Node as NodeModel
        related_ids = []
        with get_sync_session() as s:
            all_nodes = s.query(NodeModel).filter(
                NodeModel.is_centroid == False,
                NodeModel.is_issue == False,
                NodeModel.embedding.isnot(None),
            ).all()
            try:
                model = get_embed_model()
                vec = model.encode([descripcion], show_progress_bar=False)[0].tolist()
                scored = []
                for n in all_nodes:
                    emb = n.embedding
                    if hasattr(emb, "tolist"):
                        emb = emb.tolist()
                    sim = calcular_similitud_coseno(vec, emb)
                    if sim and sim > 0:
                        scored.append((sim, n.id))
                scored.sort(reverse=True)
                related_ids = [nid for _, nid in scored[:6]]
            except Exception:
                related_ids = []

        related_nodes = []
        with get_sync_session() as s:
            for rid in related_ids:
                n = s.query(NodeModel).filter(
                    NodeModel.id == rid,
                    NodeModel.is_issue == False,
                ).first()
                if n:
                    related_nodes.append(node_to_dict(n))

        context_str = "\n".join([
            f"- **{n['label']}** ({(n.get('fuente') or '').upper()}): {n.get('desc','')}"
            for n in related_nodes
        ]) if related_nodes else "No se encontraron nodos relacionados."

        base_prompt = (
            f"Problema analizado:\n\"{descripcion}\"\n\n"
            f"Conocimiento relevante en el grafo:\n{context_str}\n\n"
        )

        with _issue_lock:
            _issue_state.update({"progress": 30, "message": "Agente 1/4 — Análisis de procesos…"})

        resp_proceso = query_llm(
            [{"role": "user", "content": base_prompt + (
                "Analizá el problema desde la perspectiva de procesos: ¿dónde está la fricción exacta? "
                "¿qué pasos son prescindibles o automatizables? ¿qué métodos del grafo son directamente "
                "aplicables? Respondé en español, 3-4 párrafos."
            )}],
            system=(
                "Sos un experto en análisis y optimización de procesos. Tu foco es identificar "
                "ineficiencias, cuellos de botella y oportunidades de automatización. Sé específico y práctico."
            ),
        )

        with _issue_lock:
            _issue_state.update({"progress": 50, "message": "Agente 2/4 — Gestión de riesgos…"})

        resp_riesgos = query_llm(
            [{"role": "user", "content": base_prompt + (
                "Identificá los riesgos concretos de este problema: ¿qué puede salir mal? "
                "¿qué dependencias son frágiles? ¿cuáles son los puntos de falla críticos? "
                "Listá cada riesgo con probabilidad e impacto estimados. Respondé en español."
            )}],
            system=(
                "Sos especialista en gestión de riesgos y análisis de fallas. Tu foco es identificar "
                "qué puede salir mal, dependencias frágiles, riesgos ocultos y puntos de falla críticos."
            ),
        )

        with _issue_lock:
            _issue_state.update({"progress": 68, "message": "Agente 3/4 — Perspectiva creativa…"})

        resp_creativo = query_llm(
            [{"role": "user", "content": base_prompt + (
                "Proponé 2-3 soluciones creativas e implementables que crucen el conocimiento del grafo "
                "de formas no obvias. Priorizá lo accionable sobre lo teórico. Respondé en español."
            )}],
            system=(
                "Sos un consultor de innovación. Tu foco es proponer soluciones disruptivas y enfoques "
                "no convencionales. Cruzás conocimiento de distintas fuentes para encontrar lo que otros no ven."
            ),
        )

        with _issue_lock:
            _issue_state.update({"progress": 84, "message": "Agente 4/4 — Red Team epistémico…"})

        resp_red_team = query_llm(
            [{"role": "user", "content": base_prompt + (
                "Hacé Red Teaming de este problema. No lo resuelvas — desafiá el marco mental desde "
                "el que se está planteando. Respondé en español, 3-5 puntos concisos."
            )}],
            system=(
                "Tu rol es hacer Red Teaming epistémico. NO respondas la pregunta ni propongas soluciones. "
                "Tu única función es desafiar los supuestos. Identificá: ¿qué da por sentado quien pregunta? "
                "¿Qué sesgo cognitivo podría estar operando (confirmación, anclaje, disponibilidad, "
                "Dunning-Kruger)? ¿Qué no está siendo considerado? ¿Qué consecuencia de segundo orden "
                "está siendo ignorada? Generá fricción cognitiva intencional. Sé directo y sin rodeos."
            ),
        )

        with _issue_lock:
            _issue_state.update({"progress": 95, "message": "Finalizando…"})

        # Persistir el reporte en el nodo: antes vivía solo en este estado transitorio
        # y se perdía al navegar al detalle del issue (quedaba un chat vacío).
        synthesis = {
            "proceso":  resp_proceso,
            "riesgos":  resp_riesgos,
            "creativo": resp_creativo,
            "red_team": resp_red_team,
        }
        try:
            with get_sync_session() as s:
                s.query(NodeModel).filter(NodeModel.id == nodo["id"]).update({"synthesis": synthesis})
                s.commit()
        except Exception as e:
            print(f"Warning: no se pudo persistir el reporte del issue: {e}")

        with _issue_lock:
            _issue_state.update({
                "state": "done",
                "message": f'Issue "{nodo["label"]}" analizado.',
                "progress": 100,
                "result": {
                    "nodo_id": nodo["id"],
                    "label": nodo["label"],
                    "desc": nodo.get("desc", ""),
                    "related_nodes": [
                        {"id": n["id"], "label": n["label"], "desc": n.get("desc", ""), "fuente": n.get("fuente", "")}
                        for n in related_nodes
                    ],
                    "synthesis": synthesis,
                },
            })

    except Exception as exc:
        with _issue_lock:
            _issue_state.update({"state": "error", "message": str(exc), "progress": 0, "result": None})


@app.post("/api/issue")
async def create_issue(
    background_tasks: BackgroundTasks,
    descripcion: str = Form(...),
    url: str = Form(default=None),
    file: UploadFile = File(default=None),
):
    descripcion = descripcion.strip()
    if not descripcion:
        raise HTTPException(400, "Descripción vacía")
    with _issue_lock:
        if _issue_state["state"] == "processing":
            raise HTTPException(409, "Ya hay un issue en proceso")
        _issue_state.update({"state": "processing", "message": "Iniciando…", "progress": 10, "result": None})

    filepath = None
    if file and file.filename:
        try:
            filepath = str(await _save_upload(file, ISSUE_EXTENSIONS))
        except HTTPException:
            with _issue_lock:
                _issue_state.update({"state": "idle", "message": "", "progress": 0,
                                     "result": None})
            raise

    ref_url = url.strip() if url and url.strip() else None
    background_tasks.add_task(_run_issue, descripcion, ref_url, filepath)
    return {"ok": True}


@app.get("/api/issue/status")
def get_issue_status():
    with _issue_lock:
        return dict(_issue_state)


@app.post("/api/issue/reset")
def reset_issue():
    global _issue_state
    with _issue_lock:
        _issue_state = {"state": "idle", "message": "", "progress": 0, "result": None}
    return {"ok": True}


# ── Static frontend (production) ──────────────────────────────────────
_dist = BASE / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
