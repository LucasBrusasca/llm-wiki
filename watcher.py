"""
Fuentes vivas: monitoreo periódico de URLs para detectar cambios.

El servicio corre en background y:
1. Al arrancar, ejecuta catch-up de fuentes cuyo check está vencido.
2. Periódicamente revisa cada fuente según su frequency_hours.
3. Detecta cambios comparando SHA-256 del contenido.
4. Para PDFs, reingiere el contenido creando un nodo de versión.
5. Para listings, detecta nuevos links y los ingiere.
"""
import asyncio
import hashlib
import re
import os
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx

# Flag global para parar el loop (útil para tests y shutdown)
_stop_flag = False
_watcher_task = None

# Intervalo entre ciclos de revisión (segundos)
CHECK_INTERVAL = int(os.getenv("ALGEDI_WATCHER_INTERVAL", "300"))  # 5 minutos


def _content_hash(data: bytes) -> str:
    """SHA-256 del contenido."""
    return hashlib.sha256(data).hexdigest()


def _extract_pdf_links(html: str, base_url: str) -> list[str]:
    """Extrae links a PDFs de una página HTML (solo extensión .pdf)."""
    from urllib.parse import urljoin, urlparse
    links = set()
    for m in re.finditer(r'href=["\']([^"\']+\.pdf)["\']', html, re.IGNORECASE):
        href = m.group(1)
        full = urljoin(base_url, href)
        if urlparse(full).scheme in ("http", "https"):
            links.add(full)
    return sorted(links)


async def _fetch_url(url: str, timeout: float = 60.0) -> tuple[bytes, str]:
    """Descarga una URL y devuelve (contenido, content_type)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Algedi-Watcher/1.0)"
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, headers=headers, follow_redirects=True)
        resp.raise_for_status()
        return resp.content, resp.headers.get("content-type", "")


def _check_single_source_sync(source_id: int, on_new_content: Callable | None = None):
    """Revisa una fuente y actualiza su estado (síncrono, para correr en thread)."""
    from database.connection import get_sync_session
    from database.models import WatchedSource
    
    with get_sync_session() as session:
        ws = session.query(WatchedSource).filter(WatchedSource.id == source_id).first()
        if not ws or not ws.enabled:
            return
        
        now = datetime.now(timezone.utc)
        ws.check_count = (ws.check_count or 0) + 1
        ws.last_check = now
        
        try:
            import httpx as httpx_sync
            headers = {"User-Agent": "Mozilla/5.0 (compatible; Algedi-Watcher/1.0)"}
            with httpx_sync.Client(timeout=60.0) as client:
                resp = client.get(ws.url, headers=headers, follow_redirects=True)
                resp.raise_for_status()
                content = resp.content
                content_type = resp.headers.get("content-type", "")
            
            new_hash = _content_hash(content)
            
            if ws.kind == "pdf":
                if ws.last_hash and ws.last_hash == new_hash:
                    ws.status = "ok"
                    ws.last_error = None
                else:
                    ws.status = "changed"
                    ws.change_count = (ws.change_count or 0) + 1
                    version_entry = {
                        "hash": new_hash,
                        "detected_at": now.isoformat(),
                        "previous_hash": ws.last_hash,
                    }
                    if on_new_content:
                        try:
                            node_id = on_new_content(ws.url, ws.seccion, content, "pdf")
                            version_entry["node_id"] = node_id
                            if node_id:
                                ws.node_ids = (ws.node_ids or []) + [node_id]
                        except Exception as e:
                            version_entry["error"] = str(e)[:200]
                    ws.version_history = (ws.version_history or []) + [version_entry]
                    ws.last_hash = new_hash
                    ws.last_error = None
                    
            elif ws.kind == "listing":
                from processor import decodificar_html
                html = decodificar_html(content, content_type)
                links = _extract_pdf_links(html, ws.url)
                known = set(ws.known_links or [])
                new_links = [l for l in links if l not in known]
                
                if new_links:
                    ws.status = "changed"
                    ws.change_count = (ws.change_count or 0) + 1
                    for link in new_links:
                        version_entry = {
                            "link": link,
                            "detected_at": now.isoformat(),
                        }
                        if on_new_content:
                            try:
                                node_id = on_new_content(link, ws.seccion, None, "pdf_link")
                                version_entry["node_id"] = node_id
                                if node_id:
                                    ws.node_ids = (ws.node_ids or []) + [node_id]
                            except Exception as e:
                                version_entry["error"] = str(e)[:200]
                        ws.version_history = (ws.version_history or []) + [version_entry]
                    ws.known_links = list(known | set(new_links))
                else:
                    ws.status = "ok"
                ws.last_hash = new_hash
                ws.last_error = None
                
            elif ws.kind == "html":
                if ws.last_hash and ws.last_hash == new_hash:
                    ws.status = "ok"
                    ws.last_error = None
                else:
                    ws.status = "changed"
                    ws.change_count = (ws.change_count or 0) + 1
                    version_entry = {
                        "hash": new_hash,
                        "detected_at": now.isoformat(),
                        "previous_hash": ws.last_hash,
                    }
                    if on_new_content:
                        try:
                            node_id = on_new_content(ws.url, ws.seccion, content, "html")
                            version_entry["node_id"] = node_id
                            if node_id:
                                ws.node_ids = (ws.node_ids or []) + [node_id]
                        except Exception as e:
                            version_entry["error"] = str(e)[:200]
                    ws.version_history = (ws.version_history or []) + [version_entry]
                    ws.last_hash = new_hash
                    ws.last_error = None
            
            ws.error_count = 0
            
        except Exception as e:
            ws.status = "error"
            ws.error_count = (ws.error_count or 0) + 1
            ws.last_error = str(e)[:500]
        
        session.commit()


def _ingest_new_content(url: str, seccion: str, content: bytes | None, kind: str) -> str | None:
    """Ingiere contenido nuevo y retorna el node_id creado."""
    import tempfile
    from processor import procesar_url_web, procesar_pdf, acumular_resultado
    
    try:
        if kind == "pdf" and content:
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            try:
                resultado = procesar_pdf(tmp_path)
                for nodo in resultado.get("nodos", []):
                    nodo["fuente_url"] = url
                    nodo["dominio"] = seccion
                    nodo["known_since"] = datetime.now(timezone.utc).isoformat()
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        elif kind == "pdf_link":
            resultado = procesar_url_web(url, allow_pdf=True)
            for nodo in resultado.get("nodos", []):
                nodo["dominio"] = seccion
                nodo["known_since"] = datetime.now(timezone.utc).isoformat()
        elif kind == "html" and content:
            from processor import decodificar_html, procesar_html, _extraer_texto_html
            import tempfile
            html = decodificar_html(content, "text/html")
            with tempfile.NamedTemporaryFile(suffix=".html", delete=False, mode="w", encoding="utf-8") as tmp:
                tmp.write(html)
                tmp_path = tmp.name
            try:
                resultado = procesar_html(tmp_path)
                for nodo in resultado.get("nodos", []):
                    nodo["fuente_url"] = url
                    nodo["dominio"] = seccion
                    nodo["known_since"] = datetime.now(timezone.utc).isoformat()
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        else:
            return None
        
        acumular_resultado(resultado)
        nodos = resultado.get("nodos", [])
        return nodos[0]["id"] if nodos else None
        
    except Exception as e:
        print(f"[Watcher] Error ingiriendo {url}: {e}")
        raise


def _get_due_sources() -> list[int]:
    """Obtiene IDs de fuentes que necesitan revisión."""
    from database.connection import get_sync_session
    from database.models import WatchedSource
    
    with get_sync_session() as session:
        now = datetime.now(timezone.utc)
        sources = session.query(WatchedSource).filter(
            WatchedSource.enabled == True
        ).all()
        
        due = []
        for ws in sources:
            if ws.last_check is None:
                due.append(ws.id)
            else:
                next_check = ws.last_check + timedelta(hours=ws.frequency_hours or 24)
                if now >= next_check:
                    due.append(ws.id)
        return due


def run_catchup():
    """Ejecuta catch-up de todas las fuentes vencidas (llamar al arranque)."""
    due = _get_due_sources()
    if not due:
        print("[Watcher] No hay fuentes vencidas para catch-up")
        return
    
    print(f"[Watcher] Catch-up: {len(due)} fuentes vencidas")
    for source_id in due:
        try:
            _check_single_source_sync(source_id, on_new_content=_ingest_new_content)
        except Exception as e:
            print(f"[Watcher] Error en catch-up de source {source_id}: {e}")


async def _watcher_loop():
    """Loop principal del watcher (corre en background)."""
    global _stop_flag
    print(f"[Watcher] Iniciando loop (intervalo: {CHECK_INTERVAL}s)")
    
    while not _stop_flag:
        try:
            due = _get_due_sources()
            if due:
                print(f"[Watcher] Revisando {len(due)} fuentes")
                for source_id in due:
                    if _stop_flag:
                        break
                    try:
                        await asyncio.get_event_loop().run_in_executor(
                            None,
                            lambda sid=source_id: _check_single_source_sync(sid, on_new_content=_ingest_new_content)
                        )
                    except Exception as e:
                        print(f"[Watcher] Error revisando source {source_id}: {e}")
        except Exception as e:
            print(f"[Watcher] Error en loop: {e}")
        
        await asyncio.sleep(CHECK_INTERVAL)
    
    print("[Watcher] Loop detenido")


def start_watcher():
    """Inicia el watcher en background (llamar desde el evento startup de FastAPI)."""
    global _watcher_task, _stop_flag
    _stop_flag = False
    
    run_catchup()
    
    loop = asyncio.get_event_loop()
    _watcher_task = loop.create_task(_watcher_loop())
    print("[Watcher] Tarea de background iniciada")


def stop_watcher():
    """Detiene el watcher (llamar desde el evento shutdown de FastAPI)."""
    global _stop_flag, _watcher_task
    _stop_flag = True
    if _watcher_task:
        _watcher_task.cancel()
        _watcher_task = None
    print("[Watcher] Detenido")


def get_pending_updates_count(seccion: str | None = None) -> int:
    """Cuenta cuántas fuentes tienen status='changed' (para el badge de UI)."""
    from database.connection import get_sync_session
    from database.models import WatchedSource
    
    with get_sync_session() as session:
        q = session.query(WatchedSource).filter(
            WatchedSource.status == "changed",
            WatchedSource.enabled == True,
        )
        if seccion:
            q = q.filter(WatchedSource.seccion == seccion)
        return q.count()


def get_recent_changes(seccion: str | None = None, limit: int = 10) -> list[dict]:
    """Obtiene los cambios más recientes para mostrar en UI."""
    from database.connection import get_sync_session
    from database.models import WatchedSource
    
    with get_sync_session() as session:
        q = session.query(WatchedSource).filter(
            WatchedSource.enabled == True,
        ).order_by(WatchedSource.updated_at.desc())
        
        if seccion:
            q = q.filter(WatchedSource.seccion == seccion)
        
        sources = q.limit(limit).all()
        return [
            {
                "id": ws.id,
                "url": ws.url,
                "kind": ws.kind,
                "label": ws.label,
                "status": ws.status,
                "last_check": ws.last_check.isoformat() if ws.last_check else None,
                "change_count": ws.change_count or 0,
                "last_error": ws.last_error,
                "version_count": len(ws.version_history or []),
            }
            for ws in sources
        ]


def mark_as_seen(source_id: int):
    """Marca una fuente como vista (cambia status de 'changed' a 'ok')."""
    from database.connection import get_sync_session
    from database.models import WatchedSource
    
    with get_sync_session() as session:
        ws = session.query(WatchedSource).filter(WatchedSource.id == source_id).first()
        if ws and ws.status == "changed":
            ws.status = "ok"
            session.commit()


def check_source_now(source_id: int) -> dict:
    """Fuerza una revisión inmediata de una fuente (acción manual del usuario)."""
    from database.connection import get_sync_session
    from database.models import WatchedSource
    
    _check_single_source_sync(source_id, on_new_content=_ingest_new_content)
    
    with get_sync_session() as session:
        ws = session.query(WatchedSource).filter(WatchedSource.id == source_id).first()
        if ws:
            return {
                "id": ws.id,
                "status": ws.status,
                "last_check": ws.last_check.isoformat() if ws.last_check else None,
                "last_error": ws.last_error,
                "change_count": ws.change_count or 0,
            }
    return {"error": "Fuente no encontrada"}
