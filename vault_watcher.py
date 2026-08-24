"""Ingesta Continua — vigila una carpeta y auto-ingiere los archivos nuevos.

Modelo "vault" (estilo Obsidian / Graphify): el usuario suelta archivos en
``<repo>/vault/`` (o en subcarpetas, que se toman como *secciones*) y el grafo
se actualiza solo, sin abrir la app ni clickear nada.

Diseño:
  * Un hilo *watcher* (watchfiles, en modo polling sobre bind-mount de Windows)
    detecta altas/modificaciones y encola rutas.
  * Un hilo *worker* consume la cola y llama a ``ingest_fn`` (el mismo
    ``_run_ingest`` del backend), que serializa con el resto vía un lock global.
  * Deduplicación por **hash de contenido**: si el archivo ya se ingirió (mismo
    sha1) no se repite, aunque el watcher dispare varios eventos por copia.
  * UMAP se recalcula UNA sola vez cuando la cola se vacía (no por archivo).
"""
from __future__ import annotations

import hashlib
import json
import queue
import re
import threading
import time
from pathlib import Path

# Única fuente de verdad de formatos (espejo del ACCEPT_EXT del frontend).
SUPPORTED = {".pdf", ".xlsx", ".xls", ".html", ".htm", ".txt", ".md",
             ".docx", ".pptx", ".pptm"}

# Archivos que representan ENLACES, no documentos:
#   - .url  → acceso directo de Windows (arrastrar un link del navegador a la carpeta)
#   - .links → lista de URLs (una por línea)
#   - links.txt / urls.txt / enlaces.txt → lista de URLs (una por línea)
LINK_LIST_NAMES = {"links.txt", "urls.txt", "enlaces.txt"}


def _is_link_file(p: Path) -> bool:
    return p.suffix.lower() in (".url", ".links") or p.name.lower() in LINK_LIST_NAMES


def _extract_urls(p: Path) -> list:
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    urls = []
    if p.suffix.lower() == ".url":
        # INI de Windows: línea "URL=https://..."
        for line in text.splitlines():
            s = line.strip()
            if s.lower().startswith("url="):
                u = s[4:].strip()
                if u.startswith("http"):
                    urls.append(u)
    else:
        # Una URL por línea (tolera viñetas markdown "- " / "* ").
        for line in text.splitlines():
            m = re.search(r"https?://\S+", line)
            if m:
                urls.append(m.group(0))
    return urls

_lock = threading.Lock()
_instance: "VaultWatcher | None" = None


def get() -> "VaultWatcher | None":
    return _instance


class VaultWatcher:
    def __init__(self, vault_dir, ingest_fn, umap_fn):
        self.dir = Path(vault_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.ingest_fn = ingest_fn            # (...) -> bool; confirma éxito real
        self.umap_fn = umap_fn                # () -> None
        self.seen_path = self.dir / ".algedi_seen.json"
        self.q: "queue.Queue" = queue.Queue()
        self.seen: dict = {}                  # sha1 -> {name, ts, seccion}
        self.pending: set[str] = set()         # hashes reservados pero aún no confirmados
        self._queue_lock = threading.Lock()
        self._batch_changed = False
        self._stop = threading.Event()
        self.state = "idle"                   # idle | processing
        self.last_label = ""
        self.last_event = 0.0
        self.available = True
        self._load_seen()

    # ── registro persistente de vistos ────────────────────────────────
    def _load_seen(self):
        try:
            if self.seen_path.exists():
                self.seen = json.loads(self.seen_path.read_text(encoding="utf-8"))
        except Exception:
            self.seen = {}

    def _save_seen(self):
        try:
            self.seen_path.write_text(
                json.dumps(self.seen, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    def _reserve(self, digest: str) -> bool:
        """Reserva un hash atómicamente para que eventos repetidos no dupliquen la cola."""
        with self._queue_lock:
            if digest in self.seen or digest in self.pending:
                return False
            self.pending.add(digest)
            return True

    @staticmethod
    def _hash(p: Path) -> str:
        h = hashlib.sha1()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    def _seccion_for(self, p: Path) -> str:
        """Subcarpeta directa bajo vault/ = sección. Archivos sueltos = 'personal'."""
        try:
            rel = p.relative_to(self.dir)
        except ValueError:
            return "personal"
        parts = rel.parts
        return parts[0] if len(parts) >= 2 and parts[0] else "personal"

    def _settled(self, p: Path) -> bool:
        """Evita ingerir a mitad de una copia: espera a que el tamaño se estabilice."""
        try:
            s1 = p.stat().st_size
            time.sleep(0.8)
            s2 = p.stat().st_size
        except OSError:
            return False
        return s1 == s2 and s2 > 0

    # ── encolado ───────────────────────────────────────────────────────
    def enqueue_path(self, path):
        p = Path(path)
        if p.name == self.seen_path.name:
            return
        if not (p.exists() and p.is_file()):
            return
        if not self._settled(p):
            return

        # Archivo de ENLACES (.url / .links / links.txt): encola cada URL, no el archivo.
        if _is_link_file(p):
            seccion = self._seccion_for(p)
            for u in _extract_urls(p):
                digest = "url:" + hashlib.sha1(u.encode("utf-8")).hexdigest()
                if not self._reserve(digest):
                    continue
                self.last_event = time.time()
                self.q.put((u, seccion, digest, u[:60]))
            return

        # Documento normal: dedup por hash de contenido.
        if p.suffix.lower() not in SUPPORTED:
            return
        try:
            digest = self._hash(p)
        except Exception:
            return
        if not self._reserve(digest):
            return                              # mismo contenido ya ingerido
        self.last_event = time.time()
        self.q.put((str(p), self._seccion_for(p), digest, p.name))

    def rescan(self):
        """Barrido inicial: encola lo que ya estuviera en la carpeta al arrancar."""
        try:
            for p in self.dir.rglob("*"):
                if p.is_file():
                    self.enqueue_path(p)
        except Exception as e:
            print(f"[vault] rescan falló: {e}")

    # ── hilos ───────────────────────────────────────────────────────────
    def _worker(self):
        while not self._stop.is_set():
            try:
                path, seccion, digest, name = self.q.get(timeout=1.0)
            except queue.Empty:
                continue
            self.state = "processing"
            self.last_label = name
            try:
                # skip_umap=True siempre: el UMAP lo corre el worker al vaciar la cola.
                result = self.ingest_fn(path, True, seccion)
                if result is False:
                    raise RuntimeError("la ingesta terminó con estado de error")
                with self._queue_lock:
                    self.seen[digest] = {"name": name, "ts": time.time(), "seccion": seccion}
                self._batch_changed = True
                self._save_seen()
            except Exception as e:
                print(f"[vault] error ingiriendo {name}: {e}")
            finally:
                with self._queue_lock:
                    self.pending.discard(digest)
                self.q.task_done()
            if self.q.empty():
                if self._batch_changed:
                    try:
                        self.umap_fn()
                        self._batch_changed = False
                    except Exception as e:
                        print(f"[vault] error UMAP: {e}")
                self.state = "idle"

    def _watch(self):
        try:
            from watchfiles import Change, watch
        except Exception as e:
            print(f"[vault] watchfiles no disponible: {e}")
            self.available = False
            return
        print(f"[vault] Ingesta Continua vigilando: {self.dir}")
        try:
            for changes in watch(str(self.dir), stop_event=self._stop):
                for change, path in changes:
                    if change in (Change.added, Change.modified):
                        self.enqueue_path(path)
        except Exception as e:
            print(f"[vault] watcher detenido: {e}")
            self.available = False

    def start(self):
        threading.Thread(target=self._worker, daemon=True, name="vault-worker").start()
        threading.Thread(target=self._watch, daemon=True, name="vault-watch").start()
        threading.Thread(target=self.rescan, daemon=True, name="vault-rescan").start()

    def stop(self):
        self._stop.set()

    def status(self) -> dict:
        return {
            "enabled": True,
            "available": self.available,
            "folder": str(self.dir),
            "count": len(self.seen),
            "queued": self.q.qsize(),
            "state": self.state,
            "label": self.last_label,
        }


def start(vault_dir, ingest_fn, umap_fn) -> VaultWatcher:
    """Arranque idempotente: en un reload de uvicorn reemplaza la instancia previa."""
    global _instance
    with _lock:
        if _instance is not None:
            _instance.stop()
        _instance = VaultWatcher(vault_dir, ingest_fn, umap_fn)
        _instance.start()
    return _instance
