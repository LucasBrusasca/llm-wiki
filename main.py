import json
import os
import random
import threading
from pathlib import Path
from urllib.parse import unquote

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi import BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

load_dotenv()

BASE = Path(__file__).parent.resolve()
UPLOADS = BASE / "uploads"
UPLOADS.mkdir(exist_ok=True)

app = FastAPI(title="PragmaForge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ── Ingestion state ───────────────────────────────────────────────────
_ingest = {"state": "idle", "message": "", "label": "", "progress": 0}
_ingest_lock = threading.Lock()

# ── Issue state ────────────────────────────────────────────────────────
_issue_state = {"state": "idle", "message": "", "progress": 0, "result": None}
_issue_lock = threading.Lock()


def _resolve(rel: str) -> Path:
    target = (BASE / unquote(rel)).resolve()
    if not str(target).startswith(str(BASE)):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return target


# ── Graph data ────────────────────────────────────────────────────────
@app.get("/api/graph")
def get_graph():
    path = BASE / "nodes_generated.json"
    if not path.exists():
        return {"nodos": [], "relaciones": []}
    data = json.loads(path.read_text(encoding="utf-8"))

    # Back-compat: assign random 3D positions to nodes that lack x3d/y3d/z3d
    # so react-force-graph-3d can render them immediately (force sim overrides later)
    rng = random.Random(42)
    for n in data.get("nodos", []):
        if n.get("x3d") is None:
            n["x3d"] = rng.uniform(-1, 1)
            n["y3d"] = rng.uniform(-1, 1)
            n["z3d"] = rng.uniform(-1, 1)
        if n.get("cluster") is None:
            n["cluster"] = -1

    return data


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


# ── Ingestion ─────────────────────────────────────────────────────────
def _set_progress(pct: int, msg: str):
    with _ingest_lock:
        _ingest["progress"] = pct
        _ingest["message"] = msg


def _run_ingest(entrada: str, skip_umap: bool = False):
    global _ingest
    try:
        from processor import (
            acumular_resultado,
            procesar_excel,
            procesar_html,
            procesar_pdf,
            procesar_youtube,
        )

        _set_progress(10, "Extrayendo contenido…")

        # Animate progress while LLM processes — smaller steps, more frequent updates
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

        ext = Path(entrada).suffix.lower() if not entrada.startswith("http") else ""
        if entrada.startswith("http"):
            yt_domains = ("youtube.com", "youtu.be")
            if any(d in entrada for d in yt_domains):
                resultado = procesar_youtube(entrada)
            else:
                from processor import procesar_url_web
                resultado = procesar_url_web(entrada)
        elif ext in (".xlsx", ".xls"):
            resultado = procesar_excel(entrada)
        elif ext in (".html", ".htm"):
            resultado = procesar_html(entrada)
        elif ext in (".txt", ".md"):
            from processor import procesar_txt
            resultado = procesar_txt(entrada)
        else:
            resultado = procesar_pdf(entrada)

        _stop_ticker.set()
        _set_progress(60, "Generando embeddings…")

        acumulado = acumular_resultado(resultado)

        _set_progress(75, "Generando apunte IA…")
        try:
            from processor import generar_rich_html
            for new_n in resultado["nodos"]:
                rich_html = generar_rich_html(new_n, acumulado["nodos"], acumulado["relaciones"])
                new_n["rich_html"] = rich_html
                for n in acumulado["nodos"]:
                    if n["id"] == new_n["id"]:
                        n["rich_html"] = rich_html
        except Exception as e:
            print(f"Error generando rich_html en ingesta: {e}")

        salida = BASE / "nodes_generated.json"
        with open(salida, "w", encoding="utf-8") as f:
            json.dump(acumulado, f, ensure_ascii=False, indent=2)

        if not skip_umap:
            _set_progress(85, "Calculando posición 3D (UMAP)…")
            try:
                import embeddings_engine
                embeddings_engine.main()
            except Exception as e:
                print(f"Error al calcular posiciones 3D (UMAP/HDBSCAN): {e}")

        label = resultado["nodos"][0]["label"] if resultado["nodos"] else "Nodo"
        msg = f'"{label}" guardado.' if skip_umap else f'"{label}" incorporado al grafo.'
        with _ingest_lock:
            _ingest = {"state": "done", "message": msg, "label": label, "progress": 100}

    except Exception as exc:
        with _ingest_lock:
            _ingest = {"state": "error", "message": str(exc), "label": "", "progress": 0}


@app.post("/api/ingest")
async def ingest(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(default=None),
    url: str = Form(default=None),
    skip_umap: bool = Form(default=False),
):
    with _ingest_lock:
        if _ingest["state"] == "processing":
            raise HTTPException(409, "Ya hay una ingesta en progreso")
        _ingest.update({"state": "processing", "message": "Iniciando…", "label": "", "progress": 5})

    entradas = []
    if file and file.filename:
        safe_name = Path(file.filename).name
        if not safe_name or safe_name.startswith('.'):
            raise HTTPException(400, "Nombre de archivo inválido")
        save_path = UPLOADS / safe_name
        content = await file.read()
        save_path.write_bytes(content)
        entradas.append(str(save_path))
    elif url and url.strip():
        # Split by comma or newline and clean up
        import re
        raw_urls = re.split(r'[,\n]+', url)
        entradas = [u.strip() for u in raw_urls if u.strip().startswith('http')]
    
    if not entradas:
        with _ingest_lock:
            _ingest.update({"state": "idle", "message": "", "label": ""})
        raise HTTPException(400, "Enviá un archivo o al menos una URL válida (http/https)")

    # We will just iterate and ingest them sequentially for simplicity
    for idx, entrada in enumerate(entradas):
        # We can pass skip_umap=True for all except the last one to save time
        is_last = (idx == len(entradas) - 1)
        background_tasks.add_task(_run_ingest, entrada, skip_umap if is_last else True)
    
    return {"ok": True, "count": len(entradas)}


@app.post("/api/umap-refresh")
async def umap_refresh(background_tasks: BackgroundTasks):
    """Recalcula posiciones UMAP/HDBSCAN sobre todos los nodos existentes."""
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


@app.post("/api/reset")
def reset_graph():
    """Wipe all nodes and relations."""
    path = BASE / "nodes_generated.json"
    path.write_text(json.dumps({"nodos": [], "relaciones": []}, ensure_ascii=False), encoding="utf-8")
    umap_pkl = BASE / "umap_model.pkl"
    if umap_pkl.exists():
        umap_pkl.unlink()
    return {"ok": True}


@app.get("/api/ingest/status")
def get_ingest_status():
    with _ingest_lock:
        return dict(_ingest)


# ── Agent ─────────────────────────────────────────────────────────────
def _nodos_relevantes(pregunta: str, max_n: int = 5) -> list[str]:
    path = BASE / "nodes_generated.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
        
    nodos = data.get("nodos", [])
    if not nodos:
        return []
        
    try:
        from processor import get_embed_model, calcular_similitud_coseno
        model = get_embed_model()
        query_vector = model.encode([pregunta], show_progress_bar=False)[0].tolist()
    except Exception as e:
        print(f"Error al generar embedding para búsqueda semántica: {e}")
        stops = {
            "el","la","los","las","un","una","de","en","que","es","y","a",
            "con","por","para","del","al","se","no","lo","su","sus",
        }
        words = {w for w in pregunta.lower().split() if len(w) > 2 and w not in stops}
        if not words:
            return []
        scored = []
        for n in nodos:
            txt = f"{n.get('label','')} {n.get('desc','')} {n.get('fragmento','')}".lower()
            score = sum(1 for w in words if w in txt)
            if score > 0:
                scored.append((score, n["id"]))
        scored.sort(reverse=True)
        return [nid for _, nid in scored[:max_n]]

    scored = []
    for n in nodos:
        emb = n.get("embedding")
        if not emb:
            continue
        sim = calcular_similitud_coseno(query_vector, emb)
        if sim > 0:
            scored.append((sim, n["id"]))
            
    scored.sort(reverse=True, key=lambda x: x[0])
    return [nid for _, nid in scored[:max_n]]


@app.post("/api/agent")
async def agent_endpoint(request: Request):
    body = await request.json()
    system = body.get("system", "Sos el agente de PragmaForge.")
    messages = body.get("messages", [])
    try:
        # Import dynamic LLM query from processor
        from processor import query_llm
        reply = query_llm(messages, system)
    except Exception as e:
        reply = f"Error: {e}"
    ultima = messages[-1]["content"] if messages else ""
    return {"reply": reply, "nodos_relevantes": _nodos_relevantes(ultima)}


@app.post("/api/recompute-relations")
def recompute_relations():
    """Recalcula todas las relaciones entre nodos existentes."""
    path = BASE / "nodes_generated.json"
    if not path.exists():
        raise HTTPException(404, "Grafo no encontrado")
    data = json.loads(path.read_text(encoding="utf-8"))
    try:
        from processor import _auto_relaciones
        data["relaciones"] = _auto_relaciones(data.get("nodos", []))
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "relaciones": len(data["relaciones"])}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/search")
def semantic_search(q: str, max_n: int = 10):
    """Semantic search using embeddings + keyword fallback. Returns matching node IDs ranked by relevance."""
    if not q or len(q.strip()) < 2:
        return {"ids": []}
    return {"ids": _nodos_relevantes(q.strip(), max_n=max_n)}


@app.delete("/api/node/{node_id}")
def delete_node(node_id: str):
    path = BASE / "nodes_generated.json"
    if not path.exists():
        raise HTTPException(404, "Grafo no encontrado")
    data = json.loads(path.read_text(encoding="utf-8"))
    nodos = [n for n in data.get("nodos", []) if n["id"] != node_id]
    if len(nodos) == len(data.get("nodos", [])):
        raise HTTPException(404, f"Nodo {node_id} no encontrado")
    # Regenerate relations without the deleted node
    try:
        from processor import _auto_relaciones
        relaciones = _auto_relaciones(nodos)
    except Exception:
        relaciones = [
            r for r in data.get("relaciones", [])
            if r.get("source") != node_id and r.get("target") != node_id
        ]
    data["nodos"] = nodos
    data["relaciones"] = relaciones
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}


@app.put("/api/node/{node_id}/rename")
async def rename_node(node_id: str, request: Request):
    body = await request.json()
    new_label = (body.get("label") or "").strip()
    if not new_label:
        raise HTTPException(400, "Label vacío")
    path = BASE / "nodes_generated.json"
    if not path.exists():
        raise HTTPException(404, "Grafo no encontrado")
    data = json.loads(path.read_text(encoding="utf-8"))
    for n in data.get("nodos", []):
        if n["id"] == node_id:
            n["label"] = new_label
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"ok": True}
    raise HTTPException(404, f"Nodo {node_id} no encontrado")


@app.get("/api/node/{node_id}/report")
def get_node_report(node_id: str):
    path = BASE / "nodes_generated.json"
    if not path.exists():
        raise HTTPException(404, "Grafo no encontrado")
        
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(500, "Error al leer el grafo")
        
    nodos = data.get("nodos", [])
    relaciones = data.get("relaciones", [])
    
    # Find active node
    node = next((n for n in nodos if n["id"] == node_id), None)
    if not node:
        raise HTTPException(404, f"Nodo con ID {node_id} no encontrado")
        
    # Find connected nodes
    connected_ids = set()
    for rel in relaciones:
        s = rel.get("source")
        t = rel.get("target")
        s_id = s.get("id") if isinstance(s, dict) else s
        t_id = t.get("id") if isinstance(t, dict) else t
        if s_id == node_id:
            connected_ids.add(t_id)
        elif t_id == node_id:
            connected_ids.add(s_id)
            
    connected_nodes = [n for n in nodos if n["id"] in connected_ids]
    
    # Generate markdown report
    md = f"# Reporte de Conexiones Semánticas\n\n"
    md += f"## Nodo Principal: {node.get('label', 'Sin título')}\n"
    md += f"- **ID**: `{node['id']}`\n"
    md += f"- **Fuente**: {node.get('fuente', 'concepto').upper()}\n"
    md += f"- **Nivel**: {node.get('level', 3)}\n"
    if node.get("cluster") is not None:
        md += f"- **Cluster**: {node['cluster']}\n"
    md += "\n"
    
    md += "### Descripción\n"
    md += f"> {node.get('desc', 'Sin descripción.')}\n\n"
    
    if node.get("fragmento"):
        md += "### Fragmento Extraído\n"
        md += f"```text\n{node['fragmento']}\n```\n\n"
        
    if node.get("conceptos"):
        md += "### Conceptos Clave\n"
        md += ", ".join([f"`{c}`" for c in node["conceptos"]]) + "\n\n"
        
    md += "---\n\n"
    md += f"## Conexiones y Relaciones ({len(connected_nodes)})\n\n"
    
    if not connected_nodes:
        md += "*Este nodo no tiene conexiones directas con otros nodos.*\n"
    else:
        for idx, conn in enumerate(connected_nodes, 1):
            md += f"### {idx}. {conn.get('label', 'Sin título')} (`{conn['id']}`)\n"
            md += f"- **Fuente**: {conn.get('fuente', 'concepto').upper()}\n"
            if conn.get("cluster") is not None:
                md += f"- **Cluster**: {conn['cluster']}\n"
            md += f"- **Descripción**: {conn.get('desc', 'Sin descripción.')}\n"
            if conn.get("fragmento"):
                md += f"- **Fragmento**: *\"{conn['fragmento']}\"*\n"
            
            # Show shared concepts if any
            shared_concepts = set(node.get("conceptos", [])) & set(conn.get("conceptos", []))
            if shared_concepts:
                md += f"- **Conceptos Compartidos**: " + ", ".join([f"`{c}`" for c in shared_concepts]) + "\n"
            
            # Show cosine similarity if embeddings are present
            try:
                from processor import calcular_similitud_coseno
                sim = calcular_similitud_coseno(node.get("embedding"), conn.get("embedding"))
                if sim > 0:
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
def get_rich_preview(node_id: str):
    """Genera un HTML de estudio enriquecido para el nodo dado."""
    path = BASE / "nodes_generated.json"
    if not path.exists():
        raise HTTPException(404, "Grafo no encontrado")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(500, "Error al leer el grafo")

    nodos = data.get("nodos", [])
    relaciones = data.get("relaciones", [])
    node = next((n for n in nodos if n["id"] == node_id), None)
    if not node:
        raise HTTPException(404, f"Nodo {node_id} no encontrado")

    if node.get("rich_html"):
        return Response(content=node["rich_html"], media_type="text/html")

    from processor import generar_rich_html
    try:
        html_content = generar_rich_html(node, nodos, relaciones)
        node["rich_html"] = html_content
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise HTTPException(500, f"Error al generar el apunte: {e}")

    return Response(content=html_content, media_type="text/html")


# ── Issue module ──────────────────────────────────────────────────────
def _run_issue(descripcion: str, ref_url: str = None, filepath: str = None):
    global _issue_state
    try:
        from processor import procesar_issue, acumular_resultado, query_llm, _extraer_texto_html, extraer_texto_pdf

        # Enrich description with URL/file content
        if ref_url:
            with _issue_lock:
                _issue_state.update({"progress": 15, "message": "Obteniendo contenido de la URL…"})
            try:
                import httpx
                headers = {"User-Agent": "Mozilla/5.0 (compatible; PragmaForge/1.0)"}
                with httpx.Client(timeout=20.0, follow_redirects=True) as client:
                    resp = client.get(ref_url, headers=headers)
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

        resultado = {"nodos": [nodo], "relaciones": []}
        acumulado = acumular_resultado(resultado)
        salida = BASE / "nodes_generated.json"
        with open(salida, "w", encoding="utf-8") as f:
            json.dump(acumulado, f, ensure_ascii=False, indent=2)

        with _issue_lock:
            _issue_state.update({"progress": 70, "message": "Buscando conexiones relevantes…"})

        related_ids = _nodos_relevantes(descripcion, max_n=6)
        related_nodes = [n for n in acumulado["nodos"] if n["id"] in related_ids and not n.get("is_issue")]

        with _issue_lock:
            _issue_state.update({"progress": 85, "message": "Generando síntesis con el agente…"})

        if related_nodes:
            context = "\n".join([
                f"- **{n['label']}** ({n.get('fuente','').upper()}): {n.get('desc','')}"
                for n in related_nodes
            ])
            synthesis_prompt = (
                f"Dado este problema:\n\"{descripcion}\"\n\n"
                f"El grafo de conocimiento tiene estos recursos relacionados:\n{context}\n\n"
                f"Analizá específicamente cómo cada recurso puede aplicarse para abordar el problema. "
                f"Sé práctico: qué técnicas, métodos o conceptos son directamente aplicables y cómo usarlos. "
                f"Respondé en español, 4-6 párrafos bien desarrollados."
            )
            synthesis = query_llm([{"role": "user", "content": synthesis_prompt}])
        else:
            synthesis = "No se encontraron nodos relacionados en el grafo. Incorporá más conocimiento para obtener sugerencias específicas."

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
        safe_name = Path(file.filename).name
        save_path = UPLOADS / safe_name
        content = await file.read()
        save_path.write_bytes(content)
        filepath = str(save_path)

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


from pydantic import BaseModel
class TagsUpdate(BaseModel):
    tags: list[str]

@app.post("/api/node/{node_id}/tags")
def update_node_tags(node_id: str, payload: TagsUpdate):
    path = BASE / "nodes_generated.json"
    if not path.exists():
        raise HTTPException(404, "Grafo no encontrado")
    with _issue_lock: # Using same lock to avoid race conditions with file writes
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            nodos = data.get("nodos", [])
            node = next((n for n in nodos if n["id"] == node_id), None)
            if not node:
                raise HTTPException(404, "Nodo no encontrado")
            node["tags"] = payload.tags
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            raise HTTPException(500, str(e))
    return {"ok": True, "tags": payload.tags}

# ── Static frontend (production) ──────────────────────────────────────
_dist = BASE / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
