import anthropic
import json
import re
import sys
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

_embed_model = None

def get_embed_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        print("Cargando modelo de embeddings (primera vez: ~80MB)...")
        _embed_model = SentenceTransformer('all-MiniLM-L6-v2')
        print("✓ Modelo listo")
    return _embed_model

def generar_embedding(nodo):
    model = get_embed_model()
    conceptos_str = ', '.join(nodo.get('conceptos', []))
    texto = f"{nodo['label']}. {nodo.get('desc','')}. {nodo.get('fragmento','')}. {conceptos_str}"
    vec = model.encode([texto], show_progress_bar=False)[0]
    nodo['embedding'] = vec.tolist()

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


def extraer_texto_pdf(ruta_pdf):
    try:
        import fitz
        doc = fitz.open(ruta_pdf)
        texto = ""
        for page in doc:
            texto += page.get_text()
        doc.close()
        return texto.strip()
    except Exception as e:
        print(f"Error al extraer texto del PDF: {e}")
        return ""

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
        if "sonnet" in model:
            model = "claude-3-5-sonnet-latest"
        elif "haiku" in model:
            model = "claude-3-5-haiku-latest"
            
        import anthropic
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        resp = client.messages.create(
            model=model,
            max_tokens=1200,
            system=system,
            messages=messages
        )
        return strip_thinking(resp.content[0].text)


def procesar_pdf(ruta_pdf):
    """Un único nodo por PDF con metadata de conceptos interna."""
    provider = os.getenv("LLM_PROVIDER", "anthropic").lower()
    
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
        pdf_text = extraer_texto_pdf(ruta_pdf)
        prompt = f"Analizá el siguiente documento y generá UN ÚNICO nodo de resumen.\n\nDOCUMENTO:\n{pdf_text[:20000]}\n\n" + _PROMPT_SUFIJO
        messages = [{"role": "user", "content": prompt}]
        response_text = query_llm(messages)
        
    resultado = parsear_json(response_text.strip())
    nodo = resultado["nodo"]
    pdf_path = Path(ruta_pdf)
    nodo["fuente"] = "pdf"
    nodo["fuente_path"] = str(pdf_path).replace("\\", "/")
    nodo["fuente_label"] = pdf_path.stem
    nodo["autor"] = _pdf_autor(ruta_pdf)   # autor desde los metadatos del PDF (si tiene)
    generar_embedding(nodo)
    print(f"✓ Nodo '{nodo['label']}' con {len(nodo.get('conceptos',[]))} conceptos")
    return {"nodos": [nodo], "relaciones": []}


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


def _youtube_uploader(url):
    """Canal del video vía yt-dlp (fallback cuando oembed viene vacío). Una llamada
    extra — solo se usa en videos sueltos; en playlists pasamos el canal de la lista."""
    try:
        import yt_dlp
        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        return (info.get("channel") or info.get("uploader") or "").strip() or None
    except Exception:
        return None


def procesar_youtube(url, title_hint=None, author_hint=None):
    """Un nodo por video de YouTube. Si hay transcripción, el resumen/conceptos se basan
    en lo que el video REALMENTE dice (no en una inferencia del título).
    title_hint / author_hint: título y canal ya conocidos (p.ej. de yt-dlp al expandir una
    playlist), usados si el oembed viene vacío."""
    title, author = _youtube_metadata(url)
    if not title and title_hint:
        title = title_hint
    if not author:
        author = author_hint or _youtube_uploader(url)
    vid = _video_id(url)
    transcript = obtener_transcript(vid)

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
    return {"nodos": [nodo], "relaciones": []}


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
    generar_embedding(nodo)
    print(f"✓ Nodo '{nodo['label']}' con {len(nodo.get('conceptos',[]))} conceptos")
    return {"nodos": [nodo], "relaciones": []}


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
        texto_limpio = _extraer_texto_html(texto)[:6000]
    except Exception:
        texto_limpio = f"[Archivo HTML: {Path(ruta_html).name}]"

    prompt = f"Contenido HTML:\n{texto_limpio}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
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
    return {"nodos": [nodo], "relaciones": []}


def procesar_url_web(url: str):
    """Descarga y procesa cualquier URL web (artículo, Wikipedia, GitHub, etc.)."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; PragmaForge/1.0; +https://github.com/pragmaforge)"
    }
    try:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
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

    texto_limpio = _extraer_texto_html(html)[:6000]
    if not texto_limpio.strip():
        raise ValueError("No se pudo extraer texto de la página")

    title_hint = f'Título de la página: "{page_title}"\n' if page_title else ""
    prompt = (
        f"URL: {url}\n{title_hint}"
        f"Contenido de la página web:\n{texto_limpio}\n\n"
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
    return {"nodos": [nodo], "relaciones": []}


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
        texto = Path(ruta).read_text(encoding="utf-8", errors="ignore").strip()[:6000]
    except Exception:
        texto = f"[Archivo: {Path(ruta).name}]"

    prompt = f"Documento de texto:\n{texto}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
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
    return {"nodos": [nodo], "relaciones": []}


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


def procesar_word(ruta: str):
    """Un único nodo por documento de Word (.docx)."""
    texto = _extraer_texto_office(ruta, ["word/document.xml"])[:20000] or f"[Documento Word: {Path(ruta).name}]"
    prompt = f"Documento de Word:\n{texto}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    response_text = query_llm([{"role": "user", "content": prompt}])
    nodo = parsear_json(response_text.strip())["nodo"]
    p = Path(ruta)
    nodo["fuente"] = "word"
    nodo["fuente_path"] = str(p).replace("\\", "/")
    nodo["fuente_label"] = p.stem
    generar_embedding(nodo)
    print(f"✓ Nodo Word '{nodo['label']}' con {len(nodo.get('conceptos', []))} conceptos")
    return {"nodos": [nodo], "relaciones": []}


def procesar_pptx(ruta: str):
    """Un único nodo por presentación de PowerPoint (.pptx)."""
    texto = _extraer_texto_office(ruta, ["ppt/slides/"])[:20000] or f"[Presentación: {Path(ruta).name}]"
    prompt = f"Presentación de PowerPoint (texto de las diapositivas):\n{texto}\n\nGenerá UN ÚNICO nodo de resumen." + _PROMPT_SUFIJO
    response_text = query_llm([{"role": "user", "content": prompt}])
    nodo = parsear_json(response_text.strip())["nodo"]
    p = Path(ruta)
    nodo["fuente"] = "ppt"
    nodo["fuente_path"] = str(p).replace("\\", "/")
    nodo["fuente_label"] = p.stem
    generar_embedding(nodo)
    print(f"✓ Nodo PPT '{nodo['label']}' con {len(nodo.get('conceptos', []))} conceptos")
    return {"nodos": [nodo], "relaciones": []}


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


def _conceptos_overlap(ca_list, cb_list):
    """True si los nodos comparten ≥ 2 conceptos, con matching por substring además de exacto."""
    sa = [c.lower() for c in ca_list]
    sb = [c.lower() for c in cb_list]
    exact = len(set(sa) & set(sb))
    if exact >= 2:
        return True
    # Substring match: any term of ≥4 chars that appears inside another term counts
    matches = exact
    for a_term in sa:
        for b_term in sb:
            if a_term in set(sa) & set(sb):
                continue  # already counted as exact
            if len(a_term) >= 4 and len(b_term) >= 4:
                if a_term in b_term or b_term in a_term:
                    matches += 1
                    if matches >= 2:
                        return True
    return False


def _auto_relaciones(nodos):
    """
    Genera relaciones con metadata semántica completa.
    Cada relación incluye score, shared_concepts, label y description.
    Sin llamadas al LLM — todo determinístico.
    """
    rels, pares = [], set()

    for i, a in enumerate(nodos):
        if a.get("is_centroid"):
            continue
        for b in nodos[i+1:]:
            if b.get("is_centroid"):
                continue

            ca = [c.lower() for c in a.get("conceptos", [])]
            cb = [c.lower() for c in b.get("conceptos", [])]

            # Conceptos compartidos: exact match + substring match
            exact = set(ca) & set(cb)
            partial = set()
            for x in ca:
                for y in cb:
                    if x in exact or y in exact:
                        continue
                    if len(x) >= 4 and len(y) >= 4:
                        if x in y or y in x:
                            partial.add(x if len(x) <= len(y) else y)
            shared = list(exact | partial)

            sim = calcular_similitud_coseno(
                a.get("embedding"), b.get("embedding")
            )
            sim = round(sim, 2) if sim else 0.0
            comparten = len(shared) >= 2

            if not (comparten or sim >= 0.38):
                continue

            key = (a["id"], b["id"])
            if key in pares:
                continue
            pares.add(key)

            # Label determinístico por reglas de prioridad
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

            # Description automática
            if shared:
                nombres = ", ".join(shared[:5])
                description = (
                    f"Comparten {len(shared)} conceptos ({nombres}) "
                    f"con similitud semántica del {int(sim * 100)}%."
                )
            else:
                description = f"Similitud semántica del {int(sim * 100)}%."

            rels.append({
                "source":          a["id"],
                "target":          b["id"],
                "score":           sim,
                "shared_concepts": shared,
                "label":           label,
                "description":     description,
            })

    return rels


def acumular_resultado(nuevo: dict) -> dict:
    """
    Wrapper de compatibilidad. Guarda nodos en PostgreSQL
    y recalcula relaciones. Retorna el dict original.
    """
    try:
        from main import _save_node_sync
        for nodo in nuevo.get("nodos", []):
            _save_node_sync(nodo)
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
