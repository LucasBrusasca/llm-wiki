"""Vista previa de Word y PowerPoint con su estructura: títulos, párrafos, listas,
tablas, imágenes y, en un .pptx, cada diapositiva en orden.

Antes se mostraba una miniatura de texto estirada al ancho del inspector: se veía
borrosa y sin párrafos. Un .docx y un .pptx son ZIPs de XML, así que se leen con la
biblioteca estándar (sin LibreOffice ni dependencias nuevas). No es una copia exacta
del diseño, es el contenido legible y nítido; las imágenes se sirven aparte.
"""
from __future__ import annotations

import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
_R_ID = f"{{{NS['r']}}}id"
_R_EMBED = f"{{{NS['r']}}}embed"
_W_VAL = f"{{{NS['w']}}}val"

# Imágenes que un navegador muestra (EMF/WMF no).
IMAGENES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
            ".bmp": "image/bmp", ".webp": "image/webp", ".svg": "image/svg+xml"}
CARPETAS_MEDIA = ("word/media/", "ppt/media/")
FUENTES_CODIGO = {"consolas", "courier new", "courier", "lucida console", "menlo", "monaco",
                  "source code pro", "cascadia code", "cascadia mono", "fira code"}
MAX_BLOQUES = 3000
MAX_DIAPOSITIVAS = 150


class OfficeInvalido(ValueError):
    pass


def _leer(z: zipfile.ZipFile, nombre: str) -> ET.Element | None:
    try:
        return ET.fromstring(z.read(nombre))
    except (KeyError, ET.ParseError):
        return None


def _relaciones(z: zipfile.ZipFile, parte: str) -> dict[str, str]:
    """rId → ruta dentro del ZIP, para la parte dada (p. ej. word/document.xml)."""
    carpeta, archivo = posixpath.split(parte)
    raiz = _leer(z, posixpath.join(carpeta, "_rels", archivo + ".rels"))
    if raiz is None:
        return {}
    salida = {}
    for rel in raiz.findall("rel:Relationship", NS):
        destino = rel.get("Target") or ""
        if rel.get("TargetMode") == "External":
            continue
        salida[rel.get("Id")] = posixpath.normpath(posixpath.join(carpeta, destino)).lstrip("/")
    return salida


def _imagen(ruta: str | None) -> str | None:
    """La ruta si es una imagen que el navegador puede mostrar."""
    if ruta and ruta.startswith(CARPETAS_MEDIA) and posixpath.splitext(ruta)[1].lower() in IMAGENES:
        return ruta
    return None


def _texto_runs(runs: list[dict]) -> str:
    return "".join(r["texto"] for r in runs).strip()


def _juntar(runs: list[dict]) -> list[dict]:
    """Une runs contiguos con el mismo formato (Word parte el texto en muchos)."""
    salida: list[dict] = []
    for r in runs:
        if not r["texto"]:
            continue
        if salida and all(salida[-1].get(k) == r.get(k) for k in ("b", "i", "mono")):
            salida[-1]["texto"] += r["texto"]
        else:
            salida.append(dict(r))
    return salida


# ── Word ──────────────────────────────────────────────────────────────────────

def _estilos_word(z: zipfile.ZipFile) -> dict[str, str]:
    """styleId → nombre del estilo. Los estilos de fábrica se guardan con su nombre en
    inglés («heading 1», «Title») aunque Word esté en castellano."""
    raiz = _leer(z, "word/styles.xml")
    if raiz is None:
        return {}
    salida = {}
    for st in raiz.findall("w:style", NS):
        nombre = st.find("w:name", NS)
        salida[st.get(f"{{{NS['w']}}}styleId")] = (nombre.get(_W_VAL) if nombre is not None else "").lower()
    return salida


def _nivel_titulo(nombre_estilo: str) -> int | None:
    if nombre_estilo in ("title", "titulo", "título"):
        return 1
    m = re.match(r"(heading|título|titulo)\s*(\d)", nombre_estilo)
    return min(int(m.group(2)), 4) if m else None


def _activo(rpr: ET.Element | None, tag: str) -> bool:
    if rpr is None:
        return False
    el = rpr.find(f"w:{tag}", NS)
    return el is not None and el.get(_W_VAL, "true").lower() not in ("0", "false", "none")


def _runs_word(p: ET.Element, rels: dict[str, str], imagenes: list[str]) -> list[dict]:
    runs = []
    for r in p.iter(f"{{{NS['w']}}}r"):
        rpr = r.find("w:rPr", NS)
        fuente = rpr.find("w:rFonts", NS) if rpr is not None else None
        mono = fuente is not None and (fuente.get(f"{{{NS['w']}}}ascii") or "").lower() in FUENTES_CODIGO
        texto = ""
        for hijo in r:
            etiqueta = hijo.tag.split("}")[-1]
            if etiqueta == "t":
                texto += hijo.text or ""
            elif etiqueta == "tab":
                texto += "\t"
            elif etiqueta in ("br", "cr"):
                texto += "\n"
            elif etiqueta == "drawing":
                for blip in hijo.iter(f"{{{NS['a']}}}blip"):
                    ruta = _imagen(rels.get(blip.get(_R_EMBED)))
                    if ruta:
                        imagenes.append(ruta)
        runs.append({"texto": texto, "b": _activo(rpr, "b"), "i": _activo(rpr, "i"), "mono": mono})
    return _juntar(runs)


def _tabla_word(tbl: ET.Element) -> list[list[str]]:
    filas = []
    for tr in tbl.findall("w:tr", NS):
        celdas = []
        for tc in tr.findall("w:tc", NS):
            partes = ["".join(t.text or "" for t in p.iter(f"{{{NS['w']}}}t")) for p in tc.findall("w:p", NS)]
            celdas.append("\n".join(x for x in partes if x.strip()))
        filas.append(celdas)
    return filas


def leer_word(z: zipfile.ZipFile) -> dict:
    cuerpo_raiz = _leer(z, "word/document.xml")
    if cuerpo_raiz is None:
        raise OfficeInvalido("El archivo no tiene el cuerpo de un documento de Word.")
    cuerpo = cuerpo_raiz.find("w:body", NS)
    rels = _relaciones(z, "word/document.xml")
    estilos = _estilos_word(z)
    bloques: list[dict] = []
    for el in list(cuerpo if cuerpo is not None else []):
        if len(bloques) >= MAX_BLOQUES:
            bloques.append({"t": "aviso", "texto": "El documento sigue: abrí el original para verlo entero."})
            break
        etiqueta = el.tag.split("}")[-1]
        if etiqueta == "tbl":
            filas = _tabla_word(el)
            if filas:
                bloques.append({"t": "tabla", "filas": filas})
            continue
        if etiqueta != "p":
            continue
        ppr = el.find("w:pPr", NS)
        estilo_id = ppr.find("w:pStyle", NS).get(_W_VAL) if ppr is not None and ppr.find("w:pStyle", NS) is not None else ""
        nombre = estilos.get(estilo_id, (estilo_id or "").lower())
        imagenes: list[str] = []
        runs = _runs_word(el, rels, imagenes)
        for ruta in imagenes:
            bloques.append({"t": "img", "src": ruta})
        if not _texto_runs(runs):
            continue
        nivel = _nivel_titulo(nombre)
        num = ppr.find("w:numPr", NS) if ppr is not None else None
        if nivel:
            bloques.append({"t": "h", "nivel": nivel, "runs": runs})
        elif num is not None:
            ilvl = num.find("w:ilvl", NS)
            bloques.append({"t": "li", "nivel": int(ilvl.get(_W_VAL, "0")) if ilvl is not None else 0, "runs": runs})
        elif "code" in nombre or "preformat" in nombre or all(r["mono"] for r in runs):
            bloques.append({"t": "code", "texto": _texto_runs(runs) if len(runs) > 1 else runs[0]["texto"]})
        else:
            bloques.append({"t": "p", "runs": runs})
    return {"tipo": "word", "bloques": bloques}


# ── PowerPoint ────────────────────────────────────────────────────────────────

def _parrafos_ppt(tx: ET.Element) -> list[dict]:
    salida = []
    for p in tx.findall("a:p", NS):
        ppr = p.find("a:pPr", NS)
        nivel = int(ppr.get("lvl", "0")) if ppr is not None else 0
        runs = []
        for hijo in p:
            etiqueta = hijo.tag.split("}")[-1]
            if etiqueta in ("r", "fld"):
                rpr = hijo.find("a:rPr", NS)
                t = hijo.find("a:t", NS)
                runs.append({"texto": (t.text or "") if t is not None else "",
                             "b": rpr is not None and rpr.get("b") == "1",
                             "i": rpr is not None and rpr.get("i") == "1", "mono": False})
            elif etiqueta == "br":
                runs.append({"texto": "\n", "b": False, "i": False, "mono": False})
        runs = _juntar(runs)
        if _texto_runs(runs):
            salida.append({"t": "li", "nivel": nivel, "runs": runs})
    return salida


def _tabla_ppt(tbl: ET.Element) -> list[list[str]]:
    return [["".join(t.text or "" for t in tc.iter(f"{{{NS['a']}}}t")) for tc in tr.findall("a:tc", NS)]
            for tr in tbl.findall("a:tr", NS)]


def _formas(arbol: ET.Element, rels: dict[str, str], diapo: dict):
    """Recorre las formas de una diapositiva (también dentro de grupos)."""
    for forma in arbol:
        etiqueta = forma.tag.split("}")[-1]
        if etiqueta == "grpSp":
            _formas(forma, rels, diapo)
        elif etiqueta == "sp":
            ph = forma.find("p:nvSpPr/p:nvPr/p:ph", NS)
            tx = forma.find("p:txBody", NS)
            if tx is None:
                continue
            parrafos = _parrafos_ppt(tx)
            es_titulo = ph is not None and ph.get("type") in ("title", "ctrTitle")
            # Muchas presentaciones no usan el marcador de título: el primer cuadro de
            # texto, de un solo renglón corto, hace de título.
            sin_texto_aun = not any(b["t"] in ("li", "tabla") for b in diapo["bloques"])
            primero_corto = (ph is None or ph.get("type") not in ("body", "subTitle")) and sin_texto_aun \
                and len(parrafos) == 1 and len(_texto_runs(parrafos[0]["runs"])) <= 100
            if (es_titulo or primero_corto) and not diapo["titulo"]:
                diapo["titulo"] = " ".join(_texto_runs(p["runs"]) for p in parrafos)
            else:
                diapo["bloques"].extend(parrafos)
        elif etiqueta == "pic":
            blip = forma.find(".//a:blip", NS)
            ruta = _imagen(rels.get(blip.get(_R_EMBED))) if blip is not None else None
            if ruta:
                diapo["bloques"].append({"t": "img", "src": ruta})
        elif etiqueta == "graphicFrame":
            tbl = forma.find(".//a:tbl", NS)
            if tbl is not None:
                diapo["bloques"].append({"t": "tabla", "filas": _tabla_ppt(tbl)})


def leer_ppt(z: zipfile.ZipFile) -> dict:
    pres = _leer(z, "ppt/presentation.xml")
    if pres is None:
        raise OfficeInvalido("El archivo no tiene la estructura de una presentación.")
    rels = _relaciones(z, "ppt/presentation.xml")
    orden = [rels.get(s.get(_R_ID)) for s in pres.findall("p:sldIdLst/p:sldId", NS)]
    diapositivas = []
    for n, parte in enumerate([o for o in orden if o], start=1):
        if n > MAX_DIAPOSITIVAS:
            break
        raiz = _leer(z, parte)
        arbol = raiz.find("p:cSld/p:spTree", NS) if raiz is not None else None
        diapo = {"n": n, "titulo": "", "bloques": []}
        if arbol is not None:
            _formas(arbol, _relaciones(z, parte), diapo)
        diapositivas.append(diapo)
    return {"tipo": "ppt", "diapositivas": diapositivas, "total": len(orden)}


# ── Entrada ───────────────────────────────────────────────────────────────────

def vista_previa(ruta: str) -> dict:
    """{tipo: word, bloques} o {tipo: ppt, diapositivas, total}."""
    try:
        with zipfile.ZipFile(ruta) as z:
            nombres = set(z.namelist())
            if "word/document.xml" in nombres:
                return leer_word(z)
            if "ppt/presentation.xml" in nombres:
                return leer_ppt(z)
    except zipfile.BadZipFile as e:
        raise OfficeInvalido("No es un .docx ni un .pptx (los .doc y .ppt viejos no se pueden leer así).") from e
    raise OfficeInvalido("No es un documento de Word ni una presentación.")


def medio(ruta: str, parte: str) -> tuple[bytes, str]:
    """Bytes y tipo de una imagen del documento. Sólo sirve lo que está en la carpeta
    de medios del ZIP y es una imagen: nada de rutas arbitrarias."""
    if not _imagen(parte):
        raise OfficeInvalido("Esa parte no es una imagen del documento.")
    with zipfile.ZipFile(ruta) as z:
        if parte not in z.namelist():
            raise OfficeInvalido("Esa imagen no está en el documento.")
        return z.read(parte), IMAGENES[posixpath.splitext(parte)[1].lower()]
