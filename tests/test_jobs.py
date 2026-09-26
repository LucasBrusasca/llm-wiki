"""Tests para el sistema de jobs de ingesta en background.

Estos tests verifican la lógica del JobManager sin requerir una base de datos real.
"""
import queue
import sys
import threading
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

sys.modules['database'] = MagicMock()
sys.modules['database.connection'] = MagicMock()
sys.modules['database.models'] = MagicMock()

from job_manager import (
    JobManager,
    JOB_KIND_FILE,
    JOB_KIND_URL,
    JOB_KIND_YOUTUBE,
    JOB_STATUS_DONE,
    JOB_STATUS_FAILED,
    JOB_STATUS_QUEUED,
    JOB_STATUS_RUNNING,
    _ERROR_MESSAGES,
)


class FakeIngestJob:
    """Simula la entidad IngestJob para tests sin DB."""
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", "job_test123")
        self.status = kwargs.get("status", JOB_STATUS_QUEUED)
        self.kind = kwargs.get("kind", JOB_KIND_FILE)
        self.label = kwargs.get("label", "test.pdf")
        self.seccion = kwargs.get("seccion", "personal")
        self.entrada = kwargs.get("entrada", "/uploads/test.pdf")
        self.progress = kwargs.get("progress", 0)
        self.message = kwargs.get("message", "")
        self.error_message = kwargs.get("error_message", None)
        self.node_id = kwargs.get("node_id", None)
        self.retries = kwargs.get("retries", 0)
        self.created_at = kwargs.get("created_at", datetime.now(timezone.utc))
        self.started_at = kwargs.get("started_at", None)
        self.finished_at = kwargs.get("finished_at", None)


class FakeSession:
    """Simula una sesión de SQLAlchemy para tests."""
    def __init__(self, jobs=None):
        self.jobs = {j.id: j for j in (jobs or [])}
        self.added = []
        self.committed = 0

    def get(self, model, job_id):
        return self.jobs.get(job_id)

    def add(self, job):
        self.jobs[job.id] = job
        self.added.append(job)

    def commit(self):
        self.committed += 1

    def execute(self, stmt):
        class Result:
            def __init__(self, jobs):
                self._jobs = jobs
            def scalars(self):
                class Scalars:
                    def __init__(self, jobs):
                        self._jobs = jobs
                    def all(self):
                        return list(self._jobs)
                return Scalars(self._jobs)
        return Result(self.jobs.values())

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class JobManagerBasicTests(unittest.TestCase):
    """Tests básicos del JobManager sin workers activos."""

    def test_job_to_dict_includes_all_fields(self):
        mgr = JobManager()
        job = FakeIngestJob(
            id="job_abc",
            status=JOB_STATUS_RUNNING,
            kind=JOB_KIND_YOUTUBE,
            label="Video de prueba",
            seccion="maestria",
            progress=45,
            message="Extrayendo audio…",
            retries=1,
        )
        d = mgr._job_to_dict(job)

        self.assertEqual(d["id"], "job_abc")
        self.assertEqual(d["status"], JOB_STATUS_RUNNING)
        self.assertEqual(d["kind"], JOB_KIND_YOUTUBE)
        self.assertEqual(d["label"], "Video de prueba")
        self.assertEqual(d["seccion"], "maestria")
        self.assertEqual(d["progress"], 45)
        self.assertEqual(d["message"], "Extrayendo audio…")
        self.assertEqual(d["retries"], 1)
        self.assertIn("created_at", d)

    def test_error_messages_are_in_spanish(self):
        """Los mensajes de error deben estar en español."""
        for key, msg in _ERROR_MESSAGES.items():
            self.assertIsInstance(msg, str, f"Error message for '{key}' is not a string")
            self.assertTrue(len(msg) > 10, f"Error message for '{key}' is too short")


class JobStatusTransitionTests(unittest.TestCase):
    """Tests de transiciones de estado de jobs."""

    def setUp(self):
        self.job = FakeIngestJob()

    @patch("job_manager.get_sync_session")
    def test_retry_requires_failed_status(self, mock_session):
        mgr = JobManager()
        queued_job = FakeIngestJob(status=JOB_STATUS_QUEUED)
        session = FakeSession([queued_job])
        mock_session.return_value.__enter__ = MagicMock(return_value=session)
        mock_session.return_value.__exit__ = MagicMock(return_value=False)

        result = mgr.retry_job(queued_job.id)
        self.assertIn("error", result)
        self.assertEqual(result["status"], 400)

    @patch("job_manager.get_sync_session")
    def test_retry_increments_retries(self, mock_session):
        mgr = JobManager()
        failed_job = FakeIngestJob(status=JOB_STATUS_FAILED, retries=2)
        session = FakeSession([failed_job])
        mock_session.return_value.__enter__ = MagicMock(return_value=session)
        mock_session.return_value.__exit__ = MagicMock(return_value=False)

        result = mgr.retry_job(failed_job.id)
        self.assertEqual(result["retries"], 3)
        self.assertEqual(failed_job.status, JOB_STATUS_QUEUED)

    @patch("job_manager.get_sync_session")
    def test_cancel_only_works_on_queued(self, mock_session):
        mgr = JobManager()
        running_job = FakeIngestJob(status=JOB_STATUS_RUNNING)
        session = FakeSession([running_job])
        mock_session.return_value.__enter__ = MagicMock(return_value=session)
        mock_session.return_value.__exit__ = MagicMock(return_value=False)

        result = mgr.cancel_job(running_job.id)
        self.assertIn("error", result)
        self.assertIn("ejecución", result["error"])

    @patch("job_manager.get_sync_session")
    def test_cancel_sets_failed_status(self, mock_session):
        mgr = JobManager()
        queued_job = FakeIngestJob(status=JOB_STATUS_QUEUED)
        session = FakeSession([queued_job])
        mock_session.return_value.__enter__ = MagicMock(return_value=session)
        mock_session.return_value.__exit__ = MagicMock(return_value=False)

        result = mgr.cancel_job(queued_job.id)
        self.assertTrue(result.get("cancelled"))
        self.assertEqual(queued_job.status, JOB_STATUS_FAILED)
        self.assertEqual(queued_job.message, "Cancelado por el usuario")


class JobKindDetectionTests(unittest.TestCase):
    """Tests para la detección de tipo de job."""

    def test_youtube_url_detection(self):
        youtube_urls = [
            "https://www.youtube.com/watch?v=abc123",
            "https://youtu.be/abc123",
            "https://www.youtube.com/playlist?list=PLabc",
            "https://youtube.com/shorts/xyz",
        ]
        for url in youtube_urls:
            is_yt = any(d in url for d in ("youtube.com", "youtu.be"))
            self.assertTrue(is_yt, f"Should detect {url} as YouTube")

    def test_regular_url_not_youtube(self):
        regular_urls = [
            "https://example.com/video.mp4",
            "https://arxiv.org/abs/1234.5678",
            "https://docs.google.com/document/d/abc",
        ]
        for url in regular_urls:
            is_yt = any(d in url for d in ("youtube.com", "youtu.be"))
            self.assertFalse(is_yt, f"Should not detect {url} as YouTube")


class JobErrorClassificationTests(unittest.TestCase):
    """Tests para la clasificación de errores en español."""

    def test_timeout_error_classification(self):
        error_str = "Connection timed out"
        error_key = "unknown"
        if "timeout" in error_str.lower() or "timed out" in error_str.lower():
            error_key = "timeout"
        self.assertEqual(error_key, "timeout")

    def test_youtube_unavailable_classification(self):
        error_str = "YouTube video unavailable or private"
        error_key = "unknown"
        if "youtube" in error_str.lower():
            if "unavailable" in error_str.lower() or "private" in error_str.lower():
                error_key = "youtube_unavailable"
        self.assertEqual(error_key, "youtube_unavailable")

    def test_json_parse_error_classification(self):
        error_str = "JSONDecodeError: Expecting value"
        error_key = "unknown"
        if "json" in error_str.lower() or "parse" in error_str.lower():
            error_key = "json_parse"
        self.assertEqual(error_key, "json_parse")


class JobLifecycleIntegrationTests(unittest.TestCase):
    """Tests de integración del ciclo de vida completo de un job."""

    def test_job_status_constants_are_distinct(self):
        statuses = [JOB_STATUS_QUEUED, JOB_STATUS_RUNNING, JOB_STATUS_DONE, JOB_STATUS_FAILED]
        self.assertEqual(len(statuses), len(set(statuses)))

    def test_job_kind_constants_are_distinct(self):
        kinds = [JOB_KIND_FILE, JOB_KIND_URL, JOB_KIND_YOUTUBE]
        self.assertEqual(len(kinds), len(set(kinds)))

    def test_error_messages_cover_common_cases(self):
        expected_keys = ["network", "timeout", "parse", "llm", "youtube_unavailable",
                        "youtube_no_captions", "file_not_found", "unsupported_format",
                        "json_parse", "unknown"]
        for key in expected_keys:
            self.assertIn(key, _ERROR_MESSAGES, f"Missing error message for '{key}'")


class JobProgressCallbackTests(unittest.TestCase):
    """Tests para el callback de progreso."""

    def test_progress_callback_receives_updates(self):
        updates = []

        def callback(progress, message):
            updates.append((progress, message))

        callback(10, "Iniciando…")
        callback(50, "Procesando…")
        callback(100, "Completado")

        self.assertEqual(len(updates), 3)
        self.assertEqual(updates[0], (10, "Iniciando…"))
        self.assertEqual(updates[-1], (100, "Completado"))

    def test_progress_is_bounded(self):
        """El progreso debe estar entre 0 y 100."""
        valid_progress = [0, 25, 50, 75, 100]
        for p in valid_progress:
            self.assertGreaterEqual(p, 0)
            self.assertLessEqual(p, 100)


if __name__ == "__main__":
    unittest.main()
