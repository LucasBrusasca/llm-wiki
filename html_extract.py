"""Texto principal de una página web, para RAG y el grafo.

El HTML crudo (bronze) se guarda o se apunta con `fuente_url`. Lo que busca, cita y
relaciona Algedi es este texto (silver): sin menús, cookies, «Ver más», emojis-viñeta
ni bloques repetidos. Las tablas (tarifas, estados contables) se conservan.

Playwright es opcional: si el GET estático trae demasiado poco texto y
`ALGEDI_HTML_JS=1`, se renderiza Chromium. Si Chromium no está, se sigue con el
estático. Los tests no lanzan el browser (el default del código es 0).
"""
from __future__ import annotations

import os
import re

# ── Flags ────────────────────────────────────────────────────────────────────

def js_habilitado() -> bool:
    return os.getenv("ALGEDI_HTML_JS", "0").strip().lower() in ("1", "true", "yes", "on")


def js_min_chars() -> int:
    try:
        return max(0, int(os.getenv("ALGEDI_HTML_JS_MIN_CHARS", "400")))
    except ValueError:
        return 400


def js_timeout_ms() -> int:
    try:
        return max(1000, int(os.getenv("ALGEDI_HTML_JS_TIMEOUT_MS", "15000")))
    except ValueError:
        return 15000


# ── Limpieza del texto ya extraído ───────────────────────────────────────────

# «Ver másVer menos», «... Ver más», «Leer más», equivalentes en inglés.
_TOGGLE = re.compile(
    r"(?:ver\s*m[aá]s|ver\s*menos|leer\s*m[aá]s|leer\s*menos|"
    r"mostrar\s*m[aá]s|mostrar\s*menos|"
    r"read\s*more|read\s*less|show\s*more|show\s*less|see\s*more|see\s*less)",
    re.IGNORECASE,
)

# Emojis usados como viñeta (flags, pictogramas, dingbats, VS16, ZWJ).
_EMOJI = re.compile(
    "["
    "\U0001F1E6-\U0001F1FF"
    "\U0001F300-\U0001FAFF"
    "\U00002700-\U000027BF"
    "\U00002600-\U000026FF"
    "\U00002300-\U000023FF"
    "\U0000FE0E\U0000FE0F"
    "\U0000200D"
    "]+",
)

_HASHTAG = re.compile(r"#\w+", re.UNICODE)
_HASHTAG_ONLY = re.compile(r"^(?:#\w+\s*)+$")
_COOKIE_LINE = re.compile(
    r"(aceptar(\s+todas)?(\s+las)?\s+cookies|pol[ií]tica de cookies|"
    r"este sitio usa cookies|we use cookies|cookie consent|"
    r"acepto\s+(todas\s+)?las\s+cookies)",
    re.IGNORECASE,
)
_WS = re.compile(r"[ \t]+")


def _quitar_toggles(texto: str) -> str:
    # «... Ver más» / «Ver másVer menos»: se va el toggle y los puntos que lo prefijaban.
    prev = None
    while prev != texto:
        prev = texto
        texto = re.sub(r"(?:\.{2,}\s*)?" + _TOGGLE.pattern, "", texto, flags=re.IGNORECASE)
    texto = re.sub(r"^(?:\.{2,}\s*)+", "", texto.strip())
    texto = re.sub(r"(?:\s*\.{2,})+$", "", texto.strip())
    return _WS.sub(" ", texto).strip()


def _linea_util(linea: str) -> str | None:
    """Quita viñetas-emoji, hashtags sueltos y restos de UI. None = tirar la línea."""
    s = linea.strip()
    if not s:
        return None
    s = _quitar_toggles(s)
    if not s:
        return None
    # Viñeta: uno o más emojis al inicio (con o sin espacio).
    s = re.sub(rf"^(?:{_EMOJI.pattern}\s*)+", "", s).strip()
    s = _EMOJI.sub(" ", s)
    s = _WS.sub(" ", s).strip(" ·•-|")
    if not s or _COOKIE_LINE.search(s):
        return None
    if _HASHTAG_ONLY.match(s):
        return None
    # Hashtags de cierre de post («bla bla #Campaña #Ruta»).
    s = re.sub(r"(?:\s#\w+)+$", "", s).strip()
    s = _HASHTAG.sub(lambda m: m.group(0)[1:], s)  # #Ruta19 en medio → Ruta19
    s = _WS.sub(" ", s).strip()
    if len(s) <= 1:
        return None
    return s


def _dedupe_bloques(lineas: list[str]) -> list[str]:
    """Tira párrafos repetidos (el mismo recorte del feed pegado dos veces)."""
    seen: set[str] = set()
    out: list[str] = []
    for linea in lineas:
        clave = _WS.sub(" ", linea).strip().casefold()
        if not clave or clave in seen:
            continue
        seen.add(clave)
        out.append(linea)
    return out


def limpiar_texto_web(texto: str) -> str:
    """Post-proceso del extracto: toggles, emojis-viñeta, hashtags, duplicados."""
    if not texto:
        return ""
    crudo = texto.replace("\r\n", "\n").replace("\r", "\n")
    lineas: list[str] = []
    for raw in crudo.split("\n"):
        util = _linea_util(raw)
        if util is not None:
            lineas.append(util)
    lineas = _dedupe_bloques(lineas)
    # Reagrupar: líneas sueltas → párrafos separados por blanco si cambió el bloque.
    return "\n".join(lineas).strip()


# ── Extracción del HTML ──────────────────────────────────────────────────────

_CHROME_TAGS = (
    "script", "style", "noscript", "nav", "header", "footer", "aside",
    "form", "iframe", "svg", "button",
)
_CHROME_RE = re.compile(
    r"(cookie|consent|gdpr|banner|navbar|nav-bar|site-header|site-footer|"
    r"sidebar|share|social|popup|modal|newsletter|subscribe)",
    re.IGNORECASE,
)


def _soup(html: str):
    from bs4 import BeautifulSoup
    return BeautifulSoup(html, "html.parser")


def _sacar_chrome(soup) -> None:
    for tag in soup(_CHROME_TAGS):
        tag.decompose()
    for tag in list(soup.find_all(True)):
        marca = " ".join(filter(None, [
            tag.get("id") if isinstance(tag.get("id"), str) else "",
            " ".join(tag.get("class") or []),
            tag.get("role") if isinstance(tag.get("role"), str) else "",
        ]))
        if marca and _CHROME_RE.search(marca):
            tag.decompose()


def _tablas_a_texto(soup) -> list[str]:
    """Tablas como filas `celda | celda`. Importa para tarifas / estados contables."""
    bloques: list[str] = []
    for table in soup.find_all("table"):
        filas: list[str] = []
        for tr in table.find_all("tr"):
            celdas = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
            celdas = [_WS.sub(" ", c).strip() for c in celdas if c and c.strip()]
            if celdas:
                filas.append(" | ".join(celdas))
        if filas:
            bloques.append("\n".join(filas))
    return bloques


def _texto_con_estructura(soup) -> str:
    """Títulos y párrafos con saltos de línea; las tablas se agregan aparte."""
    partes: list[str] = []
    for el in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"]):
        if el.find_parent("table"):
            continue
        t = _WS.sub(" ", el.get_text(" ", strip=True)).strip()
        if t:
            partes.append(t)
    return "\n".join(partes)


def _texto_soup(html: str) -> str:
    try:
        soup = _soup(html)
    except Exception:
        plano = re.sub(r"<[^>]+>", " ", html)
        return re.sub(r"\s+", " ", plano).strip()
    _sacar_chrome(soup)
    titulos_y_p = _texto_con_estructura(soup)
    tablas = _tablas_a_texto(soup)
    if not titulos_y_p:
        titulos_y_p = _WS.sub(" ", soup.get_text(" ", strip=True)).strip()
    cuerpo = titulos_y_p
    for tab in tablas:
        marca = tab.split("\n", 1)[0]
        if marca and marca not in cuerpo:
            cuerpo = (cuerpo.rstrip() + "\n\n" + tab).strip()
    return cuerpo


def _texto_trafilatura(html: str) -> str:
    try:
        import trafilatura
        principal = trafilatura.extract(
            html,
            include_tables=True,
            include_comments=False,
            include_links=False,
            include_formatting=False,
            favor_recall=True,
            deduplicate=True,
        ) or ""
        return principal.strip()
    except Exception:
        return ""


def html_a_texto(html: str) -> str:
    """Contenido principal + tablas, ya limpio. No vuelca el chrome de la página."""
    if not html or not html.strip():
        return ""
    principal = _texto_trafilatura(html)
    soup_txt = _texto_soup(html)
    # Trafilatura a veces omite tablas o portadas cortas: nos quedamos con lo más
    # útil, nunca con el HTML entero (menú + cookies + feed).
    if not principal:
        elegido = soup_txt
    elif len(principal) < 200:
        # Portadas cortas: trafilatura a veces deja el <nav>. El soup ya sacó chrome.
        elegido = soup_txt or principal
    else:
        elegido = principal
        # Si el principal no trae las tablas, las pegamos del soup.
        try:
            soup = _soup(html)
            _sacar_chrome(soup)
            for tab in _tablas_a_texto(soup):
                marca = tab.split("\n", 1)[0]
                if marca and marca not in elegido:
                    elegido = (elegido.rstrip() + "\n\n" + tab).strip()
        except Exception:
            pass
        # Títulos que trafilatura aplanó: si el soup tiene un h1/h2 que no está, lo
        # dejamos al principio.
        try:
            soup = _soup(html)
            _sacar_chrome(soup)
            for h in soup.find_all(["h1", "h2"]):
                t = _WS.sub(" ", h.get_text(" ", strip=True)).strip()
                if t and t not in elegido and len(t) < 200:
                    elegido = t + "\n\n" + elegido
        except Exception:
            pass
    return limpiar_texto_web(elegido)


def renderizar_js(url: str, timeout_ms: int | None = None) -> str | None:
    """HTML ya ejecutado por Chromium. None si Playwright no está o falla."""
    if not url:
        return None
    ms = timeout_ms if timeout_ms is not None else js_timeout_ms()
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print(f"[html_extract] Playwright no importable: {e}")
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                page = browser.new_page()
                page.goto(url, wait_until="networkidle", timeout=ms)
                return page.content()
            finally:
                browser.close()
    except Exception as e:
        print(f"[html_extract] Chromium no disponible o falló al renderizar {url}: {e}")
        return None


def extraer_texto_pagina(html: str, url: str | None = None) -> str:
    """Texto para ingesta. Si el estático es corto y JS está prendido, renderiza."""
    texto = html_a_texto(html or "")
    umbral = js_min_chars()
    if url and js_habilitado() and len(texto) < umbral:
        renderizado = renderizar_js(url)
        if renderizado:
            texto_js = html_a_texto(renderizado)
            if len(texto_js) > len(texto):
                texto = texto_js
    return texto
