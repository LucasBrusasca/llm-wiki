"""Sistema de jobs de ingesta en background.

Permite que el usuario siga usando la UI mientras se procesan documentos/URLs.
Los jobs se persisten en la base de datos para sobrevivir reinicios y
mostrar historial.

Diseño:
- Cola en memoria con persistencia en DB (simple, sin dependencias externas)
- Un worker thread procesa los jobs de a uno (evita conflictos de UMAP/embeddings)
- Estado visible desde el frontend vía polling
- Reintentos manuales desde la UI
"""
import queue
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.connection import get_sync_session
from database.models import IngestJob


CONCURRENCY = 1

JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_DONE = "done"
JOB_STATUS_FAILED = "failed"

JOB_KIND_FILE = "file"
JOB_KIND_URL = "url"
JOB_KIND_YOUTUBE = "youtube"


_ERROR_MESSAGES = {
    "network": "Error de red: no se pudo acceder a la URL. Verificá tu conexión.",
    "timeout": "Tiempo de espera agotado. Intentá de nuevo más tarde.",
    "parse": "No se pudo extraer el contenido del documento.",
    "llm": "Error al procesar con el modelo de lenguaje. Intentá de nuevo.",
    "youtube_unavailable": "El video de YouTube no está disponible o es privado.",
    "youtube_no_captions": "El video no tiene subtítulos disponibles.",
    "file_not_found": "El archivo ya no existe en el servidor.",
    "unsupported_format": "Formato de archivo no soportado.",
    "json_parse": "Error al interpretar la respuesta del modelo. Reintentando puede ayudar.",
    "unknown": "Error inesperado durante la ingesta. Revisá los logs del servidor.",
}


class JobManager:
    """Gestor de jobs de ingesta en background."""

    def __init__(self):
        self._queue: queue.Queue = queue.Queue()
        self._workers: list[threading.Thread] = []
        self._ingest_fn: Optional[Callable] = None
        self._umap_fn: Optional[Callable] = None
        self._lock = threading.Lock()
        self._running = False

    def configure(self, ingest_fn: Callable, umap_fn: Callable):
        """Configura las funciones de ingesta y UMAP que usarán los workers."""
        self._ingest_fn = ingest_fn
        self._umap_fn = umap_fn

    def start(self):
        """Arranca los workers y carga jobs pendientes de la DB."""
        if self._running:
            return
        self._running = True
        for i in range(CONCURRENCY):
            t = threading.Thread(target=self._worker, daemon=True, name=f"ingest-worker-{i}")
            t.start()
            self._workers.append(t)
        self._reload_pending_jobs()

    def stop(self):
        """Detiene los workers (para tests)."""
        self._running = False
        for _ in self._workers:
            self._queue.put(None)
        for t in self._workers:
            t.join(timeout=2)
        self._workers.clear()

    def _reload_pending_jobs(self):
        """Carga jobs queued/running de la DB al iniciar (por si hubo un crash)."""
        try:
            with get_sync_session() as session:
                jobs = session.execute(
                    select(IngestJob).where(
                        IngestJob.status.in_([JOB_STATUS_QUEUED, JOB_STATUS_RUNNING])
                    ).order_by(IngestJob.created_at)
                ).scalars().all()
                for job in jobs:
                    if job.status == JOB_STATUS_RUNNING:
                        job.status = JOB_STATUS_QUEUED
                        job.message = "Reiniciando tras interrupción…"
                        session.commit()
                    self._queue.put(job.id)
        except Exception as e:
            print(f"[jobs] Error cargando jobs pendientes: {e}")

    def create_job(
        self,
        kind: str,
        entrada: str,
        seccion: str,
        label: Optional[str] = None,
    ) -> dict:
        """Crea un job y lo encola para procesamiento."""
        job_id = f"job_{uuid4().hex[:12]}"
        if label is None:
            if kind == JOB_KIND_FILE:
                label = Path(entrada).name
            else:
                label = entrada[:60] + ("…" if len(entrada) > 60 else "")

        job = IngestJob(
            id=job_id,
            kind=kind,
            entrada=entrada,
            seccion=seccion,
            label=label,
            status=JOB_STATUS_QUEUED,
            progress=0,
            message="En cola…",
        )
        with get_sync_session() as session:
            session.add(job)
            session.commit()

        self._queue.put(job_id)
        return {"id": job_id, "status": JOB_STATUS_QUEUED, "label": label}

    def retry_job(self, job_id: str) -> dict:
        """Reencola un job fallido para reintentar."""
        with get_sync_session() as session:
            job = session.get(IngestJob, job_id)
            if not job:
                return {"error": "Job no encontrado", "status": 404}
            if job.status != JOB_STATUS_FAILED:
                return {"error": "Solo se pueden reintentar jobs fallidos", "status": 400}
            job.status = JOB_STATUS_QUEUED
            job.progress = 0
            job.message = "Reintentando…"
            job.error_message = None
            job.retries += 1
            job.started_at = None
            job.finished_at = None
            session.commit()
            result = {
                "id": job.id,
                "status": job.status,
                "label": job.label,
                "retries": job.retries,
            }
        self._queue.put(job_id)
        return result

    def cancel_job(self, job_id: str) -> dict:
        """Cancela un job encolado (no se puede cancelar uno en ejecución)."""
        with get_sync_session() as session:
            job = session.get(IngestJob, job_id)
            if not job:
                return {"error": "Job no encontrado", "status": 404}
            if job.status == JOB_STATUS_RUNNING:
                return {"error": "No se puede cancelar un job en ejecución", "status": 400}
            if job.status in (JOB_STATUS_DONE, JOB_STATUS_FAILED):
                return {"error": "El job ya terminó", "status": 400}
            job.status = JOB_STATUS_FAILED
            job.message = "Cancelado por el usuario"
            job.error_message = "Cancelado"
            job.finished_at = datetime.now(timezone.utc)
            session.commit()
            return {"id": job.id, "status": job.status, "cancelled": True}

    def get_job(self, job_id: str) -> Optional[dict]:
        """Obtiene el estado de un job."""
        with get_sync_session() as session:
            job = session.get(IngestJob, job_id)
            if not job:
                return None
            return self._job_to_dict(job)

    def list_jobs(self, limit: int = 20, include_done: bool = True) -> list[dict]:
        """Lista los jobs recientes."""
        with get_sync_session() as session:
            q = select(IngestJob).order_by(IngestJob.created_at.desc())
            if not include_done:
                q = q.where(IngestJob.status.in_([JOB_STATUS_QUEUED, JOB_STATUS_RUNNING]))
            q = q.limit(limit)
            jobs = session.execute(q).scalars().all()
            return [self._job_to_dict(j) for j in jobs]

    def active_jobs(self) -> list[dict]:
        """Jobs en cola o en ejecución (para mostrar en la UI)."""
        with get_sync_session() as session:
            jobs = session.execute(
                select(IngestJob).where(
                    IngestJob.status.in_([JOB_STATUS_QUEUED, JOB_STATUS_RUNNING])
                ).order_by(IngestJob.created_at)
            ).scalars().all()
            return [self._job_to_dict(j) for j in jobs]

    def recent_completed(self, limit: int = 5) -> list[dict]:
        """Jobs completados o fallidos recientes."""
        with get_sync_session() as session:
            jobs = session.execute(
                select(IngestJob).where(
                    IngestJob.status.in_([JOB_STATUS_DONE, JOB_STATUS_FAILED])
                ).order_by(IngestJob.finished_at.desc()).limit(limit)
            ).scalars().all()
            return [self._job_to_dict(j) for j in jobs]

    def _job_to_dict(self, job: IngestJob) -> dict:
        return {
            "id": job.id,
            "status": job.status,
            "kind": job.kind,
            "label": job.label,
            "seccion": job.seccion,
            "progress": job.progress,
            "message": job.message,
            "error_message": job.error_message,
            "node_id": job.node_id,
            "retries": job.retries,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        }

    def _update_job(self, session: Session, job_id: str, **kwargs):
        """Actualiza campos del job en la DB."""
        job = session.get(IngestJob, job_id)
        if job:
            for k, v in kwargs.items():
                setattr(job, k, v)
            session.commit()

    def _worker(self):
        """Loop del worker que procesa jobs."""
        while self._running:
            try:
                job_id = self._queue.get(timeout=1)
            except queue.Empty:
                continue
            if job_id is None:
                break

            try:
                self._process_job(job_id)
            except Exception as e:
                print(f"[jobs] Error procesando job {job_id}: {e}")
                traceback.print_exc()
                with get_sync_session() as session:
                    self._update_job(
                        session, job_id,
                        status=JOB_STATUS_FAILED,
                        message="Error interno",
                        error_message=_ERROR_MESSAGES["unknown"],
                        finished_at=datetime.now(timezone.utc),
                    )
            finally:
                self._queue.task_done()

    def _process_job(self, job_id: str):
        """Procesa un job de ingesta."""
        with get_sync_session() as session:
            job = session.get(IngestJob, job_id)
            if not job or job.status != JOB_STATUS_QUEUED:
                return

            job.status = JOB_STATUS_RUNNING
            job.started_at = datetime.now(timezone.utc)
            job.message = "Iniciando…"
            job.progress = 5
            session.commit()

            entrada = job.entrada
            seccion = job.seccion
            kind = job.kind

        def update_progress(progress: int, message: str):
            with get_sync_session() as s:
                self._update_job(s, job_id, progress=progress, message=message)

        try:
            if not self._ingest_fn:
                raise RuntimeError("ingest_fn no configurada")

            update_progress(10, "Extrayendo contenido…")
            result = self._ingest_fn(entrada, skip_umap=True, seccion=seccion,
                                      progress_callback=update_progress)

            if result is False:
                raise RuntimeError("La ingesta devolvió False")

            node_id = None
            if isinstance(result, dict):
                node_id = result.get("node_id")

            update_progress(90, "Calculando posiciones…")

            if self._umap_fn:
                try:
                    self._umap_fn()
                except Exception as e:
                    print(f"[jobs] Error en UMAP: {e}")

            with get_sync_session() as session:
                self._update_job(
                    session, job_id,
                    status=JOB_STATUS_DONE,
                    progress=100,
                    message="Completado",
                    node_id=node_id,
                    finished_at=datetime.now(timezone.utc),
                )

        except Exception as e:
            error_str = str(e).lower()
            error_key = "unknown"

            if "timeout" in error_str or "timed out" in error_str:
                error_key = "timeout"
            elif "network" in error_str or "connection" in error_str:
                error_key = "network"
            elif "youtube" in error_str:
                if "unavailable" in error_str or "private" in error_str:
                    error_key = "youtube_unavailable"
                elif "caption" in error_str or "subtitle" in error_str:
                    error_key = "youtube_no_captions"
            elif "not found" in error_str or "no existe" in error_str:
                error_key = "file_not_found"
            elif "json" in error_str or "parse" in error_str:
                error_key = "json_parse"
            elif "format" in error_str or "unsupported" in error_str:
                error_key = "unsupported_format"

            error_msg = _ERROR_MESSAGES.get(error_key, _ERROR_MESSAGES["unknown"])

            with get_sync_session() as session:
                self._update_job(
                    session, job_id,
                    status=JOB_STATUS_FAILED,
                    message="Falló",
                    error_message=error_msg,
                    finished_at=datetime.now(timezone.utc),
                )


_manager: Optional[JobManager] = None


def get_job_manager() -> JobManager:
    """Obtiene la instancia global del job manager."""
    global _manager
    if _manager is None:
        _manager = JobManager()
    return _manager


def init_job_manager(ingest_fn: Callable, umap_fn: Callable):
    """Inicializa y arranca el job manager."""
    mgr = get_job_manager()
    mgr.configure(ingest_fn, umap_fn)
    mgr.start()
    return mgr
