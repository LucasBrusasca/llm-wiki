import anthropic
import json
import re
import sys
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

_embed_model = None

# Modelo MULTILINGÜE (384d, misma dimensión que el anterior → sin migración de DB).
# Antes se usaba 'all-MiniLM-L6-v2' (inglés, chico) sobre un corpus en español, lo que
# achataba las similitudes ("todo se parece ~0.4"). Este está pensado para español y es
# el mismo que valida la tesis (paraphrase-multilingual-MiniLM-L12-v2) → mejor separación.
EMBED_MODEL_NAME = 'paraphrase-multilingual-MiniLM-L12-v2'


def get_embed_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        print(f"Cargando modelo de embeddings ({EMBED_MODEL_NAME}, primera vez: ~470MB)...")
        _embed_model = SentenceTransformer(EMBED_MODEL_NAME)
        print("✓ Modelo listo")
    return _embed_model

def generar_embedding(nodo):
    model = get_embed_model()
    conceptos_str = ', '.join(nodo.get('conceptos', []))
    texto = f"{nodo['label']}. {nodo.get('desc','')}. {nodo.get('fragmento','')}. {conceptos_str}"
    vec = model.encode([texto], show_progress_bar=False)[0]
    nodo['embedding'] = vec.tolist()


CHUNK_MAX_CHARS = 1400
CHUNK_OVERLAP_CHARS = 220
CHUNK_LIMIT = 200


def crear_chunks(texto: str, *, page: int | None = None,
                 base_offset: int = 0, start_ordinal: int = 0) -> list[dict]:
    """Divide texto en pasajes solapados, conservando página y posición aproximada."""
    # PostgreSQL text no admite NUL; algunos PDFs/Office lo incluyen invisiblemente.
    text = (texto or "").replace("\x00", " ").strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text) and len(chunks) < CHUNK_LIMIT:
        target = min(len(text), start + CHUNK_MAX_CHARS)
        end = target
        if target < len(text):
            # Cortar cerca de un límite natural sin producir fragmentos demasiado chicos.
            floor = start + int(CHUNK_MAX_CHARS * 0.6)
            candidates = [text.rfind(mark, floor, target) for mark in ("\n\n", ". ", "\n", "; ")]
            natural = max(candidates)
            if natural >= floor:
                end = natural + (1 if text[natural:natural + 2] != "\n\n" else 2)
        content = text[start:end].strip()
        if content:
            chunks.append({
                "ordinal": start_ordinal + len(chunks),
                "content": content,
                "page": page,
                "char_start": base_offset + start,
                "char_end": base_offset + end,
            })
        if end >= len(text):
            break
        start = max(start + 1, end - CHUNK_OVERLAP_CHARS)
    return chunks


def crear_chunks_paginas(paginas: list[tuple[int, str]]) -> list[dict]:
    chunks = []
    offset = 0
    for page, text in paginas:
        remaining = CHUNK_LIMIT - len(chunks)
        if remaining <= 0:
            break
        page_chunks = crear_chunks(
            text, page=page, base_offset=offset, start_ordinal=len(chunks)
        )[:remaining]
        chunks.extend(page_chunks)
        offset += len(text or "") + 1
    return chunks


def asociar_chunks(chunks: list[dict], node_id: str) -> list[dict]:
    return [{**chunk, "node_id": node_id} for chunk in chunks]

def parsear_json(texto):
    if texto.startswith("```"):
        texto = re.sub(r'^```\w*\n?', '', texto).rstrip('`').strip()
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', texto, re.DOTALL)
        if m:
            return json.loads(m.group())
        raise

import httpx

def strip_thinking(text: str) -> str:
    """Elimina el bloque <think>...</think> que emiten los modelos con thinking mode."""
    import re
    # Eliminar bloque think completo
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    # Eliminar backticks de markdown si el modelo los agrega igual
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        text = text.rsplit("```", 1)[0]
    return text.strip()

_PROMPT_SUFIJO = """
Respondé SOLO con un JSON válido, sin bloques de código, sin backticks.
IMPORTANTE: "desc" y "conceptos" SIEMPRE en español, aunque el documento sea en inglés. "label" usá el título original.
{
  "nodo": {
    "id": "identificador_unico_sin_espacios",
    "label": "Título principal del contenido (idioma original)",
    "type": "DOCUMENTO",
    "level": 1,
    "desc": "Descripción en ESPAÑOL de 4-5 oraciones: qué trata, conceptos/métodos principales, qué problema resuelve, relevancia en el campo.",
    "fragmento": "Cita textual o idea central más relevante, 20-50 palabras.",
    "conceptos": ["Concepto 1", "Concepto 2", "Concepto 3", "..."]
  },
  "relaciones": []
}
Incluí entre 8 y 14 conceptos clave. Solo JSON."""


def extraer_paginas_pdf(ruta_pdf) -> list[tuple[int, str]]:
    try:
        import fitz
        doc = fitz.open(ruta_pdf)
        paginas = [(index + 1, page.get_text().strip()) for index, page in enumerate(doc)]
        doc.close()
        return [(page, text) for page, text in paginas if text]
    except Exception as e:
        print(f"Error al extraer texto del PDF: {e}")
        return []


def extraer_texto_pdf(ruta_pdf):
    return "\n".join(text for _, text in extraer_paginas_pdf(ruta_pdf)).strip()

def _post_llm_chat(url, payload, headers, timeout, retries=6):
    """POST a un endpoint OpenAI-compatible con reintentos + backoff ante sobrecarga
    transitoria del proveedor (429 rate-limit por minuto, 5xx como el 503 de Gemini)
    y errores de transporte. Respeta el header Retry-After si el servidor lo manda.
    Evita que los límites de cuota del free tier rompan la ingesta."""
    import time
    last_exc = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, json=payload, headers=headers)
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                # Respetar Retry-After (segundos) si viene; si no, backoff exponencial.
                retry_after = resp.headers.get("retry-after")
                try:
                    wait = float(retry_after) if retry_after else 0
                except ValueError:
                    wait = 0
                # 429 (cuota por minuto) necesita esperas largas; cap 35s.
                wait = max(wait, min(2 ** attempt, 35) if resp.status_code == 429 else min(2 ** attempt, 8))
                print(f"[LLM] {resp.status_code} transitorio → espero {wait:.0f}s y reintento ({attempt + 1}/{retries - 1})…")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except (httpx.TransportError, httpx.TimeoutException) as e:
            last_exc = e
            if attempt < retries - 1:
                time.sleep(min(2 ** attempt, 8))
                continue
            raise
    if last_exc:
        raise last_exc


def query_llm(messages: list, system: str = None) -> str:
    provider = os.getenv("LLM_PROVIDER", "anthropic").lower()
    model = os.getenv("LLM_MODEL", "").strip()

    if provider == "ollama":
        if not model:
            model = os.getenv("LLM_MODEL", "qwen3.5:27b")
        url = os.getenv("OLLAMA_URL", "http://localhost:11434/v1/chat/completions")
        headers = {"Content-Type": "application/json"}
        payload_messages = []
        if system:
            payload_messages.append({"role": "system", "content": system})
        for msg in messages:
            content = msg["content"]
            if isinstance(content, list):
                text_content = ""
                for block in content:
                    if block["type"] == "text":
                        text_content += block["text"]
                content = text_content
            payload_messages.append({"role": msg["role"], "content": content})

        # Modelos Qwen3 (p.ej. qwen3.5:27b) traen "thinking" activado: generan cientos
        # de tokens de razonamiento antes de responder → impracticablemente lento en
        # hardware modesto. El soft-switch /no_think lo desactiva y acelera ~10x.
        if "qwen3" in model.lower():
            for m in reversed(payload_messages):
                if m["role"] == "user":
                    m["content"] = f"{m['content']}\n\n/no_think"
                    break

        payload = {
            "model": model,
            "messages": payload_messages,
            "temperature": 0.1
        }
        data = _post_llm_chat(url, payload, headers, httpx.Timeout(900.0, connect=10.0))
        return strip_thinking(data["choices"][0]["message"]["content"])

    elif provider == "gemini":
        if not model:
            model = "gemini-2.5-flash"
        api_key = os.getenv("GEMINI_API_KEY", "")
        # Capa de compatibilidad OpenAI de Google (NO el endpoint nativo generateContent).
        # Path correcto: /v1beta/openai/chat/completions con auth Bearer.
        url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
        payload_messages = []
        if system:
            payload_messages.append({"role": "system", "content": system})
        for msg in messages:
            content = msg["content"]
            if isinstance(content, list):
                text_content = ""
                for block in content:
                    if block["type"] == "text":
                        text_content += block["text"]
                content = text_content
            payload_messages.append({"role": msg["role"], "content": content})

        # Modelos Qwen3 (p.ej. qwen3.5:27b) traen "thinking" activado: generan cientos
        # de tokens de razonamiento antes de responder → impracticablemente lento en
        # hardware modesto. El soft-switch /no_think lo desactiva y acelera ~10x.
        if "qwen3" in model.lower():
            for m in reversed(payload_messages):
                if m["role"] == "user":
                    m["content"] = f"{m['content']}\n\n/no_think"
                    break

        payload = {
            "model": model,
            "messages": payload_messages,
            "temperature": 0.1
        }
        data = _post_llm_chat(url, payload, headers, httpx.Timeout(900.0, connect=10.0))
        return strip_thinking(data["choices"][0]["message"]["content"])

    else:
        # Default: Anthropic
        if not model:
            model = "claude-3-5-sonnet-latest"
        # Sólo se resuelven los ALIAS sueltos ("sonnet", "haiku"). Un identificador
        # completo del .env se respeta tal cual: reescribirlo en silencio rompía el
        # requisito de "benchmark bloqueado: prompt, modelo y configuración".
        elif model.strip().lower() in ("sonnet", "claude-sonnet"):
            model = "claude-3-5-sonnet-latest"
        elif model.strip().lower() in ("haiku", "claude-haiku"):
            model = "claude-3-5-haiku-latest"

        import anthropic
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        resp = client.messages.create(
            model=model,
            # El tope de 1200 truncaba los JSON largos (plan de Architect: clasificación
            # + 3 alternativas + matriz de 5 criterios) y el parseo reventaba con 502.
            max_tokens=int(os.getenv("ALGEDI_MAX_TOKENS", "8000")),
            # Misma temperatura que la rama Gemini: sin esto, la métrica de
            # repetibilidad no es comparable entre proveedores.
            temperature=float(os.getenv("ALGEDI_TEMPERATURE", "0.1")),
            system=system,
            messages=messages
        )
        return strip_thinking(resp.content[0].text)


def procesar_pdf(ruta_pdf):
    """Un único nodo por PDF con metadata de conceptos interna."""
    provider = os.getenv("LLM_PROVIDER", "anthropic").lower()
    paginas = extraer_paginas_pdf(ruta_pdf)
    pdf_text = "\n".join(text for _, text in paginas)
    
    if provider == "anthropic":
        import base64
        pdf_b64 = base64.standard_b64encode(Path(ruta_pdf).read_bytes()).decode("utf-8")
        prompt = "Analizá este documento y generá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
        messages = [{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64}},
            {"type": "text", "text": prompt},
        ]}]
        response_text = query_llm(messages)
    else:
        prompt = f"Analizá el siguiente documento y generá UN ÚNICO nodo de resumen.\n\nDOCUMENTO:\n{pdf_text[:20000]}\n\n" + _PROMPT_SUFIJO
        messages = [{"role": "user", "content": prompt}]
        response_text = query_llm(messages)
        
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    pdf_path = Path(ruta_pdf)
    nodo["fuente"] = "pdf"
    nodo["fuente_path"] = str(pdf_path).replace("\\", "/")
    nodo["fuente_label"] = pdf_path.stem
    nodo["autor"] = _pdf_autor(ruta_pdf)     # autor desde los metadatos del PDF (si tiene)
    nodo["fecha_doc"] = _pdf_fecha(ruta_pdf) # fecha de creación del PDF (si tiene)
    generar_embedding(nodo)
    print(f"✓ Nodo '{nodo['label']}' con {len(nodo.get('conceptos',[]))} conceptos")
    chunks = asociar_chunks(crear_chunks_paginas(paginas), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def _pdf_autor(ruta_pdf):
    """Autor desde los metadatos del PDF (a veces vacío; muchos PDFs no lo traen)."""
    try:
        import fitz
        doc = fitz.open(str(ruta_pdf))
        a = ((doc.metadata or {}).get("author") or "").strip()
        doc.close()
        return a or None
    except Exception:
        return None


def _pdf_fecha(ruta_pdf):
    """Fecha de creación desde los metadatos del PDF (formato 'D:YYYYMMDD…').
    Muchos PDFs no la traen o traen la del generador — best-effort."""
    try:
        import fitz
        doc = fitz.open(str(ruta_pdf))
        raw = ((doc.metadata or {}).get("creationDate") or (doc.metadata or {}).get("modDate") or "")
        doc.close()
        m = re.search(r"(\d{4})(\d{2})(\d{2})", raw or "")
        if m:
            y, mo, d = m.groups()
            if "1990" <= y <= "2099" and "01" <= mo <= "12" and "01" <= d <= "31":
                return f"{y}-{mo}-{d}"
        return None
    except Exception:
        return None


def _youtube_metadata(url):
    """Obtiene título y autor del video usando la API oEmbed (sin API key)."""
    try:
        oembed = f"https://www.youtube.com/oembed?url={url}&format=json"
        with httpx.Client(timeout=10.0) as client:
            r = client.get(oembed)
            if r.status_code == 200:
                d = r.json()
                return d.get("title", ""), d.get("author_name", "")
    except Exception:
        pass
    return "", ""


def _video_id(url):
    """Extrae el ID de 11 chars de una URL de YouTube (watch?v=, youtu.be/, embed/)."""
    m = re.search(r"(?:youtu\.be/|v=|embed/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else None


def obtener_transcript(video_id):
    """Transcripción completa del video (subtítulos) o None si no hay/está bloqueada.
    Prioriza español, luego inglés. No descarga el video — solo el texto de los subtítulos."""
    if not video_id:
        return None
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id, languages=["es", "es-419", "en", "en-US", "en-GB", "pt"])
        txt = " ".join(s.text for s in fetched).strip()
        return txt or None
    except Exception as e:
        print(f"Sin transcript para {video_id}: {type(e).__name__} {str(e)[:80]}")
        return None


def _muestra_representativa(txt, max_chars=20000):
    """Para transcripts largos: inicio + medio + final (representa todo el video sin
    pasarle 80k chars al LLM)."""
    if len(txt) <= max_chars:
        return txt
    t = max_chars // 3
    n = len(txt)
    return (txt[:t] + "\n[…]\n" + txt[n // 2 - t // 2: n // 2 + t // 2] + "\n[…]\n" + txt[-t:])


def _youtube_extra(url):
    """Canal + fecha de publicación del video vía yt-dlp (una sola llamada).
    Devuelve (canal, fecha_iso) — la fecha como 'YYYY-MM-DD' o None."""
    try:
        import yt_dlp
        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        canal = (info.get("channel") or info.get("uploader") or "").strip() or None
        ud = str(info.get("upload_date") or "")  # 'YYYYMMDD'
        fecha = f"{ud[:4]}-{ud[4:6]}-{ud[6:8]}" if len(ud) == 8 and ud.isdigit() else None
        return canal, fecha
    except Exception:
        return None, None


def procesar_youtube(url, title_hint=None, author_hint=None):
    """Un nodo por video de YouTube. Si hay transcripción, el resumen/conceptos se basan
    en lo que el video REALMENTE dice (no en una inferencia del título).
    title_hint / author_hint: título y canal ya conocidos (p.ej. de yt-dlp al expandir una
    playlist), usados si el oembed viene vacío."""
    title, author = _youtube_metadata(url)
    if not title and title_hint:
        title = title_hint
    vid = _video_id(url)
    transcript = obtener_transcript(vid)   # PRIORIDAD: el transcript primero
    # Canal + fecha de publicación. En playlist el canal viene de la lista (author_hint) y
    # NO hacemos un extract por video → evita que YouTube nos limite y rompa los transcripts.
    fecha_yt = None
    if author_hint:
        if not author:
            author = author_hint
    else:
        canal_yt, fecha_yt = _youtube_extra(url)  # solo videos sueltos: 1 extract (canal + fecha)
        if not author:
            author = canal_yt

    titulo_frase = f' titulado "{title}"' if title else ''
    canal_frase  = f' (canal: {author})' if author else ''
    label_instr  = (f'El label debe ser EXACTAMENTE: "{title}".' if title
                    else 'Generá un label conciso (≤ 8 palabras) que describa el video.')

    if transcript:
        cuerpo = _muestra_representativa(transcript)
        prompt = (
            f'Video de YouTube{titulo_frase}{canal_frase}.\n'
            f'Abajo está la TRANSCRIPCIÓN real del video. Generá el nodo resumiendo lo que '
            f'REALMENTE se dice — NO inventes ni infieras del título. {label_instr}\n\n'
            f'TRANSCRIPCIÓN:\n{cuerpo}\n'
            + _PROMPT_SUFIJO
        )
    else:
        prompt = (
            f"Video de YouTube: {url}\nVideo{titulo_frase}{canal_frase}. {label_instr}\n"
            f"NO hay transcripción disponible: generá un resumen APROXIMADO basándote solo "
            f"en el título (dejá claro en la desc que es aproximado)." + _PROMPT_SUFIJO
        )

    messages = [{"role": "user", "content": prompt}]
    response_text = query_llm(messages)
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    nodo["fuente"] = "youtube"
    nodo["fuente_url"] = url
    nodo["fuente_label"] = title or nodo.get("label", "Video")
    nodo["autor"] = author or None   # canal de YouTube
    nodo["fecha_doc"] = fecha_yt     # fecha de publicación del video
    if title:
        nodo["label"] = title
    if not nodo.get("label"):
        nodo["label"] = "Video de YouTube"
    if transcript:
        nodo["transcript"] = transcript          # se guarda completo (columna transcript)
    elif title and not nodo.get("desc"):
        nodo["desc"] = (f"Video de {author}: {title} (resumen aproximado, sin transcripción)."
                        if author else f"Video: {title} (resumen aproximado).")
    generar_embedding(nodo)
    print(f"✓ YT '{nodo['label']}' | transcript: {'sí' if transcript else 'NO'} | {len(nodo.get('conceptos',[]))} conceptos")
    chunks = asociar_chunks(crear_chunks(transcript or ""), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def expandir_playlist(url, limite=12):
    """
    Lista los videos de una playlist de YouTube — SOLO metadata, sin descargar nada
    (extract_flat). Devuelve [{'url', 'title'}, ...] hasta 'limite' videos.
    Cada url es de un video individual (watch?v=ID) → reproducible y enlazable.
    """
    import yt_dlp
    opts = {
        "quiet": True, "no_warnings": True,
        "extract_flat": True, "skip_download": True,
        "playlistend": limite,
    }
    videos = []
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        # El canal vive a nivel playlist (los entries flat no lo traen).
        canal = (info.get("uploader") or info.get("channel") or "").strip() or None
        for e in (info.get("entries") or [])[:limite]:
            vid = e.get("id")
            if not vid:
                continue
            videos.append({
                "url": f"https://www.youtube.com/watch?v={vid}",
                "title": e.get("title") or "",
                "channel": canal,
            })
    except Exception as ex:
        print(f"Error expandiendo playlist: {ex}")
    return videos


def procesar_excel(ruta_excel):
    """Un único nodo por archivo Excel."""
    try:
        import openpyxl
        wb = openpyxl.load_workbook(str(ruta_excel), read_only=True, data_only=True)
        ws = wb.active
        rows = []
        for i, row in enumerate(ws.iter_rows(max_row=20, values_only=True)):
            row_txt = ' | '.join(str(c) for c in row if c is not None)
            if row_txt.strip():
                rows.append(row_txt)
            if i >= 19:
                break
        wb.close()
        contenido = '\n'.join(rows[:20])
    except ImportError:
        contenido = f"[Archivo Excel: {Path(ruta_excel).name}]"

    prompt = f"Archivo Excel con este contenido:\n{contenido}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    messages = [{"role": "user", "content": prompt}]
    response_text = query_llm(messages)
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    xl_path = Path(ruta_excel)
    nodo["fuente"] = "excel"
    nodo["fuente_path"] = str(xl_path).replace("\\", "/")
    nodo["fuente_label"] = xl_path.stem
    nodo["autor"], nodo["fecha_doc"] = _office_meta(ruta_excel)  # xlsx también es OOXML
    generar_embedding(nodo)
    print(f"✓ Nodo '{nodo['label']}' con {len(nodo.get('conceptos',[]))} conceptos")
    chunks = asociar_chunks(crear_chunks(contenido), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def _extraer_texto_html(html_str: str) -> str:
    """Extrae texto limpio de HTML. Usa BeautifulSoup si está disponible."""
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_str, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()
        texto = soup.get_text(separator=" ")
    except ImportError:
        texto = re.sub(r'<[^>]+>', ' ', html_str)
    return re.sub(r'\s+', ' ', texto).strip()


def procesar_html(ruta_html):
    """Un único nodo por archivo HTML."""
    try:
        texto = Path(ruta_html).read_text(encoding="utf-8", errors="ignore")
        texto_completo = _extraer_texto_html(texto)
    except Exception:
        texto_completo = f"[Archivo HTML: {Path(ruta_html).name}]"

    prompt = f"Contenido HTML:\n{texto_completo[:6000]}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    messages = [{"role": "user", "content": prompt}]
    response_text = query_llm(messages)
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    h_path = Path(ruta_html)
    nodo["fuente"] = "html"
    nodo["fuente_path"] = str(h_path).replace("\\", "/")
    nodo["fuente_label"] = h_path.stem
    generar_embedding(nodo)
    print(f"✓ Nodo '{nodo['label']}' con {len(nodo.get('conceptos',[]))} conceptos")
    chunks = asociar_chunks(crear_chunks(texto_completo), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def procesar_url_web(url: str):
    """Descarga y procesa cualquier URL web (artículo, Wikipedia, GitHub, etc.)."""
    from security_utils import safe_http_get
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Algedi/1.0; +https://github.com/algedi)"
    }
    try:
        resp = safe_http_get(url, timeout=30.0, headers=headers)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "pdf" in content_type:
            raise ValueError("URL apunta a un PDF — subilo como archivo")
        html = resp.text
    except httpx.HTTPStatusError as e:
        raise ValueError(f"No se pudo acceder a la URL: HTTP {e.response.status_code}")
    except Exception as e:
        raise ValueError(f"Error al descargar URL: {e}")

    # Try to get page title
    title_m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    page_title = re.sub(r'\s+', ' ', title_m.group(1)).strip() if title_m else ""

    texto_completo = _extraer_texto_html(html)
    if not texto_completo.strip():
        raise ValueError("No se pudo extraer texto de la página")

    title_hint = f'Título de la página: "{page_title}"\n' if page_title else ""
    prompt = (
        f"URL: {url}\n{title_hint}"
        f"Contenido de la página web:\n{texto_completo[:6000]}\n\n"
        f"Generá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    )
    messages = [{"role": "user", "content": prompt}]
    response_text = query_llm(messages)
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    if page_title and (not nodo.get("label") or len(nodo["label"]) < 5):
        nodo["label"] = page_title
    nodo["fuente"] = "html"
    nodo["fuente_url"] = url
    nodo["fuente_label"] = page_title or url
    generar_embedding(nodo)
    print(f"✓ Nodo '{nodo['label']}' con {len(nodo.get('conceptos',[]))} conceptos")
    chunks = asociar_chunks(crear_chunks(texto_completo), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def procesar_issue(descripcion: str):
    """Crea un nodo de issue/problema y genera embedding para buscar conexiones. Intenta extraer un flujograma si corresponde."""
    prompt = f"""Analizá este problema, issue o proceso y generá UN ÚNICO nodo de resumen. Si el texto describe un proceso con múltiples pasos o etapas, extraé también un flujograma.

TEXTO:
{descripcion[:3000]}

Respondé SOLO con JSON válido siguiendo EXACTAMENTE esta estructura:
{{
  "nodo": {{
    "id": "issue_identificador_unico_sin_espacios",
    "label": "Título conciso del issue/proceso",
    "type": "ISSUE",
    "level": 1,
    "desc": "Descripción general en 3-4 oraciones.",
    "fragmento": "La parte más crítica o central en 20-40 palabras.",
    "conceptos": ["Concepto 1", "Concepto 2", "Concepto 3", "..."]
  }},
  "flujograma": {{
    "etapas": [
      {{ "id": "e1", "label": "Nombre corto de la etapa 1", "desc": "Descripción breve" }},
      {{ "id": "e2", "label": "Nombre corto de la etapa 2", "desc": "Descripción breve" }}
    ],
    "conexiones": [
      {{ "source": "e1", "target": "e2", "label": "pasa a" }}
    ]
  }}
}}
Si no es un proceso que se pueda dividir en etapas, dejá "etapas" y "conexiones" vacíos ([]).
Incluí 6-10 conceptos clave. Solo JSON."""
    messages = [{"role": "user", "content": prompt}]
    response_text = query_llm(messages)
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    nodo["fuente"] = "issue"
    nodo["is_issue"] = True
    nodo["problema_texto"] = descripcion[:1000]
    if "flujograma" in resultado and resultado["flujograma"].get("etapas"):
        nodo["flujograma"] = resultado["flujograma"]
    generar_embedding(nodo)
    print(f"✓ Issue '{nodo['label']}' creado")
    return nodo


def procesar_txt(ruta: str):
    """Un único nodo por archivo de texto plano o markdown."""
    try:
        texto = Path(ruta).read_text(encoding="utf-8", errors="ignore").strip()
    except Exception:
        texto = f"[Archivo: {Path(ruta).name}]"

    prompt = f"Documento de texto:\n{texto[:6000]}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    messages = [{"role": "user", "content": prompt}]
    response_text = query_llm(messages)
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    p = Path(ruta)
    nodo["fuente"] = "concepto"
    nodo["fuente_path"] = str(p).replace("\\", "/")
    nodo["fuente_label"] = p.stem
    generar_embedding(nodo)
    print(f"✓ Nodo '{nodo['label']}' con {len(nodo.get('conceptos',[]))} conceptos")
    chunks = asociar_chunks(crear_chunks(texto), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def _extraer_texto_office(ruta: str, partes: list) -> str:
    """Extrae texto de .docx/.pptx (son ZIPs de XML) sin dependencias externas:
    toma el contenido de los tags <w:t> (Word) y <a:t> (PowerPoint)."""
    import zipfile
    texto = ""
    try:
        with zipfile.ZipFile(ruta) as z:
            names = []
            for patron in partes:
                if patron.endswith("/"):
                    names += sorted(n for n in z.namelist()
                                    if n.startswith(patron) and n.endswith(".xml"))
                elif patron in z.namelist():
                    names.append(patron)
            for name in names:
                xml = z.read(name).decode("utf-8", errors="ignore")
                for frag in re.findall(r"<(?:w|a):t[^>]*>(.*?)</(?:w|a):t>", xml, re.DOTALL):
                    texto += re.sub(r"<[^>]+>", "", frag) + " "
                texto += "\n"
    except Exception as e:
        print(f"Error extrayendo Office: {e}")
    return texto.strip()


def _office_meta(ruta: str):
    """Autor y fecha de creación desde docProps/core.xml (.docx/.pptx). Best-effort."""
    import zipfile
    autor, fecha = None, None
    try:
        with zipfile.ZipFile(ruta) as z:
            if "docProps/core.xml" in z.namelist():
                xml = z.read("docProps/core.xml").decode("utf-8", errors="ignore")
                m = re.search(r"<dc:creator>(.*?)</dc:creator>", xml, re.DOTALL)
                if m:
                    autor = (re.sub(r"<[^>]+>", "", m.group(1)).strip() or None)
                m = re.search(r"<dcterms:created[^>]*>(\d{4})-(\d{2})-(\d{2})", xml)
                if m:
                    fecha = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    except Exception as e:
        print(f"Error metadata Office: {e}")
    return autor, fecha


def procesar_word(ruta: str):
    """Un único nodo por documento de Word (.docx)."""
    texto = _extraer_texto_office(ruta, ["word/document.xml"]) or f"[Documento Word: {Path(ruta).name}]"
    prompt = f"Documento de Word:\n{texto[:20000]}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    response_text = query_llm([{"role": "user", "content": prompt}])
    nodo = parsear_json(response_text.strip())["nodo"]
    p = Path(ruta)
    nodo["fuente"] = "word"
    nodo["fuente_path"] = str(p).replace("\\", "/")
    nodo["fuente_label"] = p.stem
    nodo["autor"], nodo["fecha_doc"] = _office_meta(ruta)
    generar_embedding(nodo)
    print(f"✓ Nodo Word '{nodo['label']}' con {len(nodo.get('conceptos', []))} conceptos")
    chunks = asociar_chunks(crear_chunks(texto), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def procesar_pptx(ruta: str):
    """Un único nodo por presentación de PowerPoint (.pptx)."""
    texto = _extraer_texto_office(ruta, ["ppt/slides/"]) or f"[Presentación: {Path(ruta).name}]"
    prompt = f"Presentación de PowerPoint (texto de las diapositivas):\n{texto[:20000]}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    response_text = query_llm([{"role": "user", "content": prompt}])
    nodo = parsear_json(response_text.strip())["nodo"]
    p = Path(ruta)
    nodo["fuente"] = "ppt"
    nodo["fuente_path"] = str(p).replace("\\", "/")
    nodo["fuente_label"] = p.stem
    nodo["autor"], nodo["fecha_doc"] = _office_meta(ruta)
    generar_embedding(nodo)
    print(f"✓ Nodo PPT '{nodo['label']}' con {len(nodo.get('conceptos', []))} conceptos")
    chunks = asociar_chunks(crear_chunks(texto), nodo["id"])
    return {"nodos": [nodo], "relaciones": [], "chunks": chunks}


def calcular_similitud_coseno(a_emb, b_emb):
    if not a_emb or not b_emb:
        return 0.0
    import numpy as np
    vec_a = np.array(a_emb)
    vec_b = np.array(b_emb)
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))


import unicodedata

# Palabras vacías del español que no aportan a comparar conceptos.
_STOP_ES = {"de", "la", "el", "los", "las", "del", "con", "por", "para", "que",
            "una", "uno", "unos", "unas", "y", "en", "su", "sus", "al", "es",
            "como", "sobre", "entre", "sin", "the", "of", "and", "to", "in"}


def _norm_txt(s: str) -> str:
    """Minúsculas + sin acentos (NFKD → ASCII). Para comparar sin ruido diacrítico."""
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def _tokens_concepto(concepto: str) -> set:
    """Palabras de contenido de un concepto (normalizadas, ≥4 letras, sin stopwords)."""
    limpio = _norm_txt(concepto).replace("/", " ").replace("-", " ").replace(",", " ")
    return {w for w in limpio.split() if len(w) >= 4 and w not in _STOP_ES}


def _palabra_comun(ta: set, tb: set) -> bool:
    """True si dos conceptos comparten una palabra COMPLETA (no substring): igual, o
    prefijo con diferencia ≤3 letras (tolera plural/género: red↔redes, modelo↔modelos).
    Evita el falso positivo de substring ("dato" dentro de "database")."""
    for a in ta:
        for b in tb:
            if a == b:
                return True
            lo, hi = (a, b) if len(a) <= len(b) else (b, a)
            if hi.startswith(lo) and (len(hi) - len(lo)) <= 3:
                return True
    return False


# Vínculos que conserva cada nodo (kNN). Hace de parámetro tipo "clustering": con K
# chico el grafo queda legible; subirlo rearma la telaraña.
RELACIONES_K = 5
# Piso de similitud cuando todavía no se corrió un recálculo global que lo mida.
# Sólo se usa en el camino incremental y como red de seguridad.
PISO_SIMILITUD_DEFAULT = 0.35


def _conceptos_compartidos(nombres_a, toks_a, toks_b) -> list:
    """Conceptos de A que comparten palabra completa con algún concepto de B.
    Devuelve los nombres originales de A, deduplicados y en orden."""
    shared = []
    for indice, ta in enumerate(toks_a):
        if not ta:
            continue
        if any(tb and _palabra_comun(ta, tb) for tb in toks_b):
            shared.append(nombres_a[indice])
    return list(dict.fromkeys(shared))


# Conceptos compartidos necesarios para considerar el vínculo EXPLÍCITO: dos o más
# conceptos que aparecen escritos en ambos documentos. Uno solo es demasiado frágil
# (un término genérico basta para producirlo).
CONCEPTOS_PARA_EXPLICITA = 2

# Métodos con los que puede nacer una arista. Se guardan en la arista porque no son
# equivalentes: el incremental sólo mira el top-K del nodo nuevo y usa el último piso
# medido; el global recorre todos los pares y mide el piso sobre este corpus.
METODO_INCREMENTAL = "knn_incremental"
METODO_GLOBAL = "recalculo_global"
METODO_MANUAL = "manual"


def _clasificar_base(sim: float, shared: list, piso: float | None,
                     piso_medido: bool) -> str:
    """Qué sostiene la arista. Es la respuesta a "¿por qué están relacionados?".

    - `explicita`: los documentos comparten conceptos escritos. La evidencia es
      inspeccionable: son palabras que están en ambos.
    - `semantica`: no comparten conceptos suficientes; sólo sus vectores quedaron por
      encima de un piso MEDIDO sobre este corpus.
    - `inferida`: superó un piso que nadie midió sobre este corpus (el default de la
      ingesta, cuando todavía no corrió un recálculo global). Cumplió un supuesto,
      no un umbral observado. Es la clase automática más débil y se marca como tal.
    """
    if len(shared) >= CONCEPTOS_PARA_EXPLICITA:
        return "explicita"
    if piso is not None and sim >= piso and piso_medido:
        return "semantica"
    return "inferida"


def _describir_relacion(source: str, target: str, sim: float, shared: list,
                        *, metodo: str = METODO_GLOBAL, piso: float | None = None,
                        piso_medido: bool = False) -> dict:
    """Arma la arista final con su etiqueta, su explicación y su procedencia.

    ÚNICA fuente de esta lógica: la usan el recálculo global y el incremental. Si cada
    camino etiquetara por su cuenta, una misma arista significaría cosas distintas según
    cómo fue creada, y el RelationPanel mentiría.

    `label` y `description` son INTERPRETACIÓN derivada de los números, no medición:
    "COMPLEMENTA_A" no significa que un documento complemente al otro, significa que el
    coseno pasó 0.75. Por eso viajan junto a `evidencia`, que sí son los números crudos,
    y el panel los presenta separados.
    """
    comparten = len(shared) >= CONCEPTOS_PARA_EXPLICITA
    if sim >= 0.75:
        label = "COMPLEMENTA_A"
    elif sim >= 0.55 and comparten:
        label = "PROFUNDIZA_EN"
    elif sim >= 0.38 and comparten:
        label = "RELACIONADO_CON"
    elif comparten:
        label = "COMPARTE_CONCEPTOS_CON"
    else:
        label = "SEMANTICAMENTE_SIMILAR_A"
    if shared:
        description = (f"Comparten {len(shared)} conceptos ({', '.join(shared[:5])}) "
                       f"con similitud semántica del {int(sim * 100)}%.")
    else:
        description = f"Similitud semántica del {int(sim * 100)}%."
    return {
        "source": source, "target": target, "score": sim,
        "shared_concepts": shared, "label": label, "description": description,
        "metodo": metodo,
        "base_relacion": _clasificar_base(sim, shared, piso, piso_medido),
        "evidencia": {
            "similitud_coseno": sim,
            "piso_usado": piso,
            "piso_medido": bool(piso_medido),
            "supera_piso": (piso is not None and sim >= piso),
            "conceptos_compartidos": list(shared),
            "n_conceptos_compartidos": len(shared),
            "comparte_conceptos_suficientes": comparten,
            "k_vecinos": RELACIONES_K,
            "modelo_embeddings": EMBED_MODEL_NAME,
        },
    }


def relaciones_incrementales(nodo: dict, vecinos: list, piso: float | None = None) -> list:
    """Aristas de UN nodo contra un conjunto de vecinos ya preseleccionado.

    Es el camino de la ingesta. `vecinos` viene de una consulta kNN por pgvector (índice
    HNSW), así que el costo es O(log n) en vez de comparar contra el corpus entero: a 800
    documentos el recálculo global tardaba 92 s POR DOCUMENTO INGERIDO — medido.

    Diferencia honesta con el recálculo global: acá sólo se conserva el top-K del nodo
    NUEVO. En el global una arista también sobrevive si está en el top-K del otro extremo.
    Agregar un documento casi nunca reordena el top-K de los que ya estaban; cuando sí
    pasa, lo corrige el recálculo global explícito (✦ / POST /api/recompute-relations).
    """
    if not nodo.get("embedding") or not vecinos:
        return []
    # Si nunca corrió un recálculo global no hay piso medido: se cae al default y las
    # aristas que sobrevivan sólo por coseno quedan clasificadas como `inferida`.
    piso_medido = piso is not None
    piso = PISO_SIMILITUD_DEFAULT if piso is None else piso
    dominio = nodo.get("dominio") or "personal"

    nombres_a = nodo.get("conceptos") or []
    toks_a = [_tokens_concepto(c) for c in nombres_a]

    candidatos = []
    for vecino in vecinos:
        # Secciones = grafos independientes (mismo criterio que el global).
        if (vecino.get("dominio") or "personal") != dominio:
            continue
        if vecino.get("id") == nodo.get("id"):
            continue
        toks_b = [_tokens_concepto(c) for c in (vecino.get("conceptos") or [])]
        shared = _conceptos_compartidos(nombres_a, toks_a, toks_b)
        sim = vecino.get("sim")
        if sim is None:
            sim = calcular_similitud_coseno(nodo.get("embedding"), vecino.get("embedding"))
        sim = round(float(sim), 2) if sim else 0.0
        candidatos.append({
            "id": vecino["id"], "sim": sim, "shared": shared,
            "comparten": len(shared) >= 2,
            "strength": sim + 0.06 * min(len(shared), 4),
        })

    candidatos.sort(key=lambda c: c["strength"], reverse=True)
    rels = []
    for c in candidatos[:RELACIONES_K]:
        if c["sim"] >= piso or c["comparten"]:
            rels.append(_describir_relacion(
                nodo["id"], c["id"], c["sim"], c["shared"],
                metodo=METODO_INCREMENTAL, piso=piso, piso_medido=piso_medido,
            ))
    return rels


def _auto_relaciones(nodos, stats: dict | None = None):
    """
    Genera relaciones con metadata semántica completa. Sin LLM — determinístico.

    Es el recálculo GLOBAL: O(n²) a propósito, porque mide la distribución real de
    similitudes del corpus. No corre en la ingesta (ahí va `relaciones_incrementales`),
    sino cuando se pide explícitamente reagrupar el grafo.

    Dos mejoras sobre el enfoque anterior:
    - Conceptos compartidos por PALABRA COMPLETA (no substring) → menos falsos positivos.
    - Umbral DATA-DRIVEN: kNN por nodo (cada nodo se queda con sus K vínculos más
      fuertes) + piso por percentil de la distribución real de similitudes. Sin el 0.38
      mágico → se adapta solo al modelo de embeddings y al corpus.

    Si se pasa `stats`, se deja ahí el piso medido para que la ingesta incremental use el
    mismo criterio en vez de inventar uno.
    """
    docs = [n for n in nodos if not n.get("is_centroid")]
    if len(docs) < 2:
        return []

    toks = {n["id"]: [_tokens_concepto(c) for c in (n.get("conceptos") or [])] for n in docs}
    names = {n["id"]: (n.get("conceptos") or []) for n in docs}

    # 1. Candidatos: similitud coseno + conceptos compartidos (palabra completa) por par.
    cand = []
    for i, a in enumerate(docs):
        ta_list = toks[a["id"]]
        for b in docs[i + 1:]:
            # Secciones = grafos independientes: no conectar nodos de distinta sección.
            if (a.get("dominio") or "personal") != (b.get("dominio") or "personal"):
                continue
            tb_list = toks[b["id"]]
            shared = _conceptos_compartidos(names[a["id"]], ta_list, tb_list)

            sim = calcular_similitud_coseno(a.get("embedding"), b.get("embedding"))
            sim = round(sim, 2) if sim else 0.0
            comparten = len(shared) >= 2
            strength = sim + 0.06 * min(len(shared), 4)  # conceptos compartidos suman
            cand.append({"a": a["id"], "b": b["id"], "sim": sim,
                         "shared": shared, "comparten": comparten, "strength": strength})

    if not cand:
        return []

    # 2. Umbral data-driven: piso = percentil 40 de las similitudes reales. Con un modelo
    #    de embeddings mejor, la distribución baja y el piso baja SOLO (sin re-tunear).
    sims = sorted(c["sim"] for c in cand)
    floor = sims[int(len(sims) * 0.40)]
    if stats is not None:
        stats["floor"] = floor
        stats["n_docs"] = len(docs)
        stats["n_pares"] = len(cand)

    # 3. kNN por nodo: cada nodo conserva sus K vínculos más fuertes (por encima del piso).
    #    Una arista sobrevive si está en el top-K de ALGUNO de sus extremos, o si
    #    comparten ≥2 conceptos (señal explícita fuerte, siempre vale). Así el K hace de
    #    parámetro tipo "clustering" y ningún outlier se llena de líneas débiles.
    K = RELACIONES_K
    por_nodo = {}
    for c in cand:
        por_nodo.setdefault(c["a"], []).append(c)
        por_nodo.setdefault(c["b"], []).append(c)
    keep = set()
    for lst in por_nodo.values():
        lst.sort(key=lambda c: c["strength"], reverse=True)
        for c in lst[:K]:
            # Piso data-driven, salvo que compartan conceptos explícitos (señal fuerte que
            # puede valer aunque el coseno sea algo menor). Igual respeta el tope top-K por
            # nodo → no rearma el hairball.
            if c["sim"] >= floor or c["comparten"]:
                keep.add((c["a"], c["b"]))

    # 4. Relaciones finales con label/description (el label describe la fuerza, no filtra).
    rels = []
    for c in cand:
        if (c["a"], c["b"]) not in keep:
            continue
        rels.append(_describir_relacion(
            c["a"], c["b"], c["sim"], c["shared"],
            # El global es el único que MIDE el piso sobre este corpus.
            metodo=METODO_GLOBAL, piso=floor, piso_medido=True,
        ))
    return rels


# Documentos por llamada al clasificar temas. Antes era 1 doc = 1 llamada: subir 30
# archivos costaba 30 llamadas cortas, casi todas esperando red. En lote la taxonomía
# viaja una sola vez y el modelo ve los documentos juntos.
TEMAS_LOTE = 25


def _resolver_tema(respuesta: str, temas: list) -> str:
    """Lleva la respuesta del LLM a un tema EXISTENTE o a 'Sin clasificar'.
    Nunca inventa un tema nuevo: la taxonomía sólo la crea el reagrupado global (✦)."""
    limpio = (respuesta or "").strip().strip('"').strip()
    if limpio in temas:
        return limpio
    if "sin clasificar" in limpio.lower():
        return "Sin clasificar"
    # Puntuación o mayúsculas distintas: matcheo laxo, honesto si no hay coincidencia.
    low = limpio.lower()
    return next((t for t in temas if t.lower() in low or low in t.lower()), "Sin clasificar")


def _temas_existentes(session) -> list:
    from database.models import Node as NodeModel
    return [t[0] for t in session.query(NodeModel.tema).filter(
        NodeModel.tema.isnot(None),
        NodeModel.tema != "Sin clasificar",
        NodeModel.is_issue == False,
    ).distinct().all()]


def _clasificar_lote(nodos: list, temas: list) -> dict:
    """Una llamada al LLM para hasta TEMAS_LOTE documentos. Devuelve {id: tema}.
    Si la respuesta no se puede parsear, devuelve {} y el caller lo reintenta más tarde:
    un documento sin tema es recuperable, uno mal clasificado ensucia la taxonomía."""
    listado = "\n".join(
        f'{i + 1}. "{(n.get("label") or "")[:120]}" — conceptos: '
        f'{", ".join((n.get("conceptos") or [])[:8]) or "(sin conceptos)"}'
        for i, n in enumerate(nodos)
    )
    prompt = (
        "Temas disponibles:\n" + "\n".join(f"- {t}" for t in temas) +
        f"\n\nDocumentos:\n{listado}\n\n"
        "Asigná CADA documento a UNO de los temas de la lista. Si alguno no encaja "
        'claramente en ninguno, usá exactamente "Sin clasificar". No inventes temas '
        "nuevos ni cambies los nombres.\n"
        'Respondé SOLO un JSON: {"1": "Tema", "2": "Sin clasificar", ...} '
        "con una clave por número de documento."
    )
    crudo = query_llm([{"role": "user", "content": prompt}])
    try:
        data = parsear_json(crudo.strip())
    except Exception as exc:
        print(f"Warning: no se pudo parsear la clasificación de temas: {exc}")
        return {}
    if not isinstance(data, dict):
        return {}
    asignados = {}
    for indice, nodo in enumerate(nodos, 1):
        respuesta = data.get(str(indice), data.get(indice))
        if respuesta is None:
            continue
        asignados[nodo["id"]] = _resolver_tema(str(respuesta), temas)
    return asignados


def asignar_temas_pendientes():
    """Clasifica TODOS los docs sin tema dentro de la taxonomía EXISTENTE, en lotes.

    Se llama tras cada ingesta: cubre los documentos recién subidos y también los que
    quedaron pendientes por errores anteriores (p.ej. cuota de la API agotada) — el
    sistema se auto-repara. Mantiene la taxonomía estable: no re-baraja los demás nodos
    ni cambia los nombres. Si aún no hay taxonomía, no hace nada: la crea el
    reagrupado global (✦)."""
    try:
        from database.connection import get_sync_session
        from database.models import Node as NodeModel
        with get_sync_session() as s:
            temas = _temas_existentes(s)
            if not temas:
                return
            faltan = s.query(NodeModel).filter(
                NodeModel.tema.is_(None),
                NodeModel.is_issue == False,
                NodeModel.is_centroid == False,
            ).all()
            nodos = [{"id": n.id, "label": n.label, "conceptos": n.conceptos or []}
                     for n in faltan]
        if not nodos:
            return
        for inicio in range(0, len(nodos), TEMAS_LOTE):
            lote = nodos[inicio:inicio + TEMAS_LOTE]
            try:
                asignados = _clasificar_lote(lote, temas)
            except Exception as exc:
                print(f"Warning: lote de temas falló, queda pendiente: {exc}")
                continue
            if not asignados:
                continue
            with get_sync_session() as s:
                for node_id, tema in asignados.items():
                    s.query(NodeModel).filter(NodeModel.id == node_id).update({"tema": tema})
                s.commit()
            print(f"✓ Temas asignados a {len(asignados)}/{len(lote)} documentos del lote")
    except Exception as e:
        print(f"Warning asignar_temas_pendientes: {e}")


def asignar_tema(nodo: dict):
    """Clasifica UN documento en la taxonomía existente. Envoltorio del camino en lote,
    para que exista una sola definición de cómo se resuelve un tema."""
    try:
        from database.connection import get_sync_session
        from database.models import Node as NodeModel
        with get_sync_session() as s:
            temas = _temas_existentes(s)
        if not temas:
            return
        asignados = _clasificar_lote([nodo], temas)
        if not asignados:
            return
        with get_sync_session() as s:
            for node_id, tema in asignados.items():
                s.query(NodeModel).filter(NodeModel.id == node_id).update({"tema": tema})
            s.commit()
        print(f"✓ Tema asignado a '{str(nodo.get('label', ''))[:40]}': "
              f"{asignados.get(nodo['id'])}")
    except Exception as e:
        print(f"Warning asignar_tema: {e}")


def acumular_resultado(nuevo: dict) -> dict:
    """
    Wrapper de compatibilidad. Guarda nodos en PostgreSQL
    y recalcula relaciones. Retorna el dict original.
    """
    try:
        from main import _save_node_sync
        for nodo in nuevo.get("nodos", []):
            node_chunks = [c for c in nuevo.get("chunks", [])
                           if c.get("node_id") == nodo["id"]]
            _save_node_sync(nodo, node_chunks if "chunks" in nuevo else None)
        asignar_temas_pendientes()   # clasifica el nuevo + los pendientes de intentos fallidos
    except Exception as e:
        print(f"Warning acumular_resultado: {e}")
    return nuevo


def _get_all_nodes_sync() -> list[dict]:
    """Lee todos los nodos no-centroide de la DB de forma síncrona."""
    from database.connection import get_sync_session
    from database.models import Node as NodeModel
    with get_sync_session() as session:
        nodes = session.query(NodeModel).filter(
            NodeModel.is_centroid == False
        ).all()
        result = []
        for n in nodes:
            emb = n.embedding
            if hasattr(emb, 'tolist'):
                emb = emb.tolist()
            result.append({
                "id": n.id, "label": n.label,
                "conceptos": n.conceptos or [],
                "embedding": emb,
                "is_centroid": False,
            })
        return result


def main():
    if len(sys.argv) < 2:
        print("Uso: python processor.py <archivo_o_url>")
        print("  Soporta: PDF, XLSX, HTML, URLs de YouTube")
        sys.exit(1)

    entrada = sys.argv[1]
    print(f"Procesando: {entrada}")

    ext = Path(entrada).suffix.lower()
    if entrada.startswith("http"):
        resultado = procesar_youtube(entrada)
    elif ext in ('.xlsx', '.xls'):
        resultado = procesar_excel(entrada)
    elif ext in ('.html', '.htm'):
        resultado = procesar_html(entrada)
    else:
        resultado = procesar_pdf(entrada)

    acumular_resultado(resultado)
    print(f"✓ Nodo guardado en DB")


def generar_rich_html(node, nodos, relaciones) -> str:
    conceptos_str = ", ".join(node.get("conceptos", []))
    connected_ids = set()
    for rel in relaciones:
        s = rel.get("source"); t = rel.get("target")
        s_id = s.get("id") if isinstance(s, dict) else s
        t_id = t.get("id") if isinstance(t, dict) else t
        if s_id == node["id"]: connected_ids.add(t_id)
        elif t_id == node["id"]: connected_ids.add(s_id)
    conexiones = [n["label"] for n in nodos if n["id"] in connected_ids]
    conexiones_str = ", ".join(conexiones[:6]) if conexiones else "ninguna"

    prompt = f"""Eres un generador de apuntes de estudio en HTML.
Generá un documento HTML completo y autocontenido (con CSS inline en <style>) sobre el siguiente tema.

TÍTULO: {node.get('label', '')}
DESCRIPCIÓN: {node.get('desc', '')}
FRAGMENTO CLAVE: {node.get('fragmento', '')}
CONCEPTOS: {conceptos_str}
CONECTADO CON: {conexiones_str}

REGLAS DE DISEÑO OBLIGATORIAS:
- Fondo: #f5f1e8 (crema/papel)
- Tipografía principal: 'Fraunces', Georgia, serif (importar de Google Fonts)
- Tipografía código/mono: 'JetBrains Mono', monospace (importar de Google Fonts)
- Color accent: #b8441f (terracota)
- Color ink: #1a1a1a
- Color muted: #6b6558
- Layout: sidebar izquierdo de navegación (240px fijo) + contenido principal con scroll
- El sidebar debe tener links a cada sección (position:sticky top:24px)
- Cada sección debe tener un número y título (1. Introducción, 2. Conceptos Clave, etc.)
- Usar blockquote para el fragmento clave con borde izquierdo terracota 4px
- Usar "pill tags" (border-radius:100px, padding:2px 12px) para los conceptos
- Máximo 5 secciones: Introducción, Conceptos Clave, Análisis, Conexiones Temáticas, Síntesis
- El documento debe ser completamente funcional como HTML standalone
- No uses frameworks externos excepto Google Fonts

Respondé ÚNICAMENTE con el código HTML completo, sin explicaciones, sin markdown, sin backticks."""

    html_content = query_llm(
        [{"role": "user", "content": prompt}],
        system="Sos un generador de documentos HTML de estudio. Respondés SOLO con código HTML válido y completo, nada más."
    )
    
    html_content = html_content.strip()
    if html_content.startswith("```"):
        import re
        html_content = re.sub(r'^```\w*\n?', '', html_content).rstrip('`').strip()
        
    return html_content

if __name__ == "__main__":
    main()
