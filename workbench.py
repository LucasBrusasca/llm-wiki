"""Workbench: scripts y datos como nodos del grafo, corridas auditables y
proponer → confirmar antes de ejecutar.

Lógica pura (sin FastAPI ni base de datos) para poder testearla sola; main.py la
expone. El modelo de vínculos toma la idea de Graphify —el código se une en el grafo
con lo que usa— pero no su stack: acá sale de leer el AST del script, sin LLM.

- analizar_script   qué funciones define, qué importa y qué archivos de datos abre.
- vinculos_de_codigo  aristas script → datos (LEE_DATOS) y script → script (IMPORTA).
- plan_ejecucion    lo que se muestra antes de confirmar una corrida.
- ejecutar_en_sandbox  el mismo proceso aislado de siempre, con los datos vinculados
                       copiados a su carpeta temporal (lo que el script escriba queda
                       ahí y se descarta).
- consultar_tabla / consultar_sqlite  SQL de sólo lectura sobre un nodo de datos.
- detectar_pedido_ejecucion  si un mensaje al agente pide correr un script.
"""
from __future__ import annotations

import ast
import hashlib
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

# ── Tipos y extensiones ───────────────────────────────────────────────────────
TIPO_SCRIPT = "SCRIPT"
TIPO_DATOS = "DATOS"

# Runtimes que se pueden ejecutar. Hoy sólo Python: el sandbox existente es para .py.
RUNTIMES = {".py": "python"}
EXT_TABLA = (".csv", ".xlsx", ".xls")
EXT_SQLITE = (".sqlite", ".sqlite3", ".db")
EXT_DATOS = EXT_TABLA + EXT_SQLITE

CODIGO_MAX = 200_000          # caracteres de un script editable desde la UI
SALIDA_RESUMEN = 600          # caracteres de stdout/stderr en el listado de corridas

# Relaciones que salen del código. Score 1: no es una similitud, el código lo dice.
REL_LEE_DATOS = "LEE_DATOS"
REL_IMPORTA = "IMPORTA"
METODO_CODIGO = "analisis_codigo"
BASE_CODIGO = "codigo"

# Módulos de la biblioteca estándar que no dicen nada del tema del script: no entran
# como conceptos (sí pandas, sklearn, sqlite3…, que sí orientan).
_TRIVIALES = {
    "__future__", "abc", "argparse", "base64", "collections", "contextlib", "copy",
    "dataclasses", "datetime", "enum", "functools", "glob", "hashlib", "io",
    "itertools", "json", "logging", "math", "operator", "os", "pathlib", "pprint",
    "random", "re", "shutil", "string", "subprocess", "sys", "tempfile", "textwrap",
    "time", "traceback", "typing", "unicodedata", "uuid", "warnings",
}


def hash_codigo(texto: str) -> str:
    """Versión corta y estable de un código: la corrida guarda con qué versión corrió."""
    return hashlib.sha256((texto or "").encode("utf-8")).hexdigest()[:12]


def normalizar_codigo(texto) -> str:
    """Texto de un script tal como se guarda: sin NUL, saltos de línea Unix y con tope."""
    codigo = str(texto if texto is not None else "").replace("\x00", "")
    codigo = codigo.replace("\r\n", "\n").replace("\r", "\n")
    if len(codigo) > CODIGO_MAX:
        raise ValueError(f"El script supera {CODIGO_MAX} caracteres.")
    return codigo


def slug_archivo(nombre: str, ext: str = ".py") -> str:
    """Nombre de archivo legible para un script nuevo ('Limpieza de ventas' → limpieza_de_ventas.py)."""
    plano = unicodedata.normalize("NFKD", nombre or "").encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "_", plano.lower()).strip("_")[:48] or "script"
    if base[0].isdigit():
        base = f"s_{base}"          # que se pueda importar como módulo
    return f"{base}{ext}"


def plantilla_script(nombre: str) -> str:
    return (
        f'"""{nombre}: contá acá qué hace este script."""\n\n\n'
        "def main():\n"
        "    print(\"Hola desde Algedi\")\n\n\n"
        'if __name__ == "__main__":\n'
        "    main()\n"
    )


# ── Análisis del código ───────────────────────────────────────────────────────

def _es_archivo_de_datos(literal: str) -> bool:
    texto = literal.strip()
    if not texto or len(texto) > 260 or "\n" in texto:
        return False
    return texto.lower().endswith(EXT_DATOS)


def analizar_script(codigo: str) -> dict:
    """Lo que el script dice de sí mismo, leyendo su AST (sin ejecutarlo).

    {docstring, funciones, clases, imports: [{modulo, linea}], archivos: [{archivo,
    literal, linea}], error: None | "línea N: …"}. Con un error de sintaxis se sigue
    con una lectura por expresiones regulares: un script a medio escribir igual tiene
    que poder vincularse.
    """
    res = {"docstring": None, "funciones": [], "clases": [], "imports": [], "archivos": [], "error": None}
    try:
        arbol = ast.parse(codigo or "")
    except SyntaxError as e:
        res["error"] = f"línea {e.lineno}: {e.msg}"
        for i, linea in enumerate((codigo or "").splitlines(), 1):
            m = re.match(r"\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", linea)
            if m:
                res["imports"].append({"modulo": (m.group(1) or m.group(2)).split(".")[0], "linea": i})
            for lit in re.findall(r"""['"]([^'"\n]+)['"]""", linea):
                if _es_archivo_de_datos(lit):
                    res["archivos"].append({"archivo": Path(lit.strip()).name, "literal": lit, "linea": i})
        return _sin_repetidos(res)

    res["docstring"] = ast.get_docstring(arbol)
    for nodo in arbol.body:
        if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef)):
            res["funciones"].append(nodo.name)
        elif isinstance(nodo, ast.ClassDef):
            res["clases"].append(nodo.name)
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Import):
            for alias in nodo.names:
                res["imports"].append({"modulo": alias.name.split(".")[0], "linea": nodo.lineno})
        elif isinstance(nodo, ast.ImportFrom) and nodo.module:
            res["imports"].append({"modulo": nodo.module.split(".")[0], "linea": nodo.lineno})
        elif isinstance(nodo, ast.Constant) and isinstance(nodo.value, str) and _es_archivo_de_datos(nodo.value):
            res["archivos"].append({
                "archivo": Path(nodo.value.strip()).name, "literal": nodo.value,
                "linea": getattr(nodo, "lineno", None),
            })
    return _sin_repetidos(res)


def _sin_repetidos(res: dict) -> dict:
    vistos, imports = set(), []
    for imp in res["imports"]:
        if imp["modulo"] not in vistos:
            vistos.add(imp["modulo"])
            imports.append(imp)
    res["imports"] = imports
    vistos, archivos = set(), []
    for arch in res["archivos"]:
        clave = arch["archivo"].lower()
        if clave not in vistos:
            vistos.add(clave)
            archivos.append(arch)
    res["archivos"] = archivos
    return res


def resumir_script(nombre: str, analisis: dict, codigo: str = "") -> dict:
    """desc, fragmento y conceptos de un nodo SCRIPT, sin LLM: lo que el código dice."""
    partes = []
    doc = (analisis.get("docstring") or "").strip()
    if doc:
        partes.append(doc.split("\n\n")[0].strip()[:400])
    hechos = ["Script de Python"]
    funciones = analisis.get("funciones") or []
    if funciones:
        muestra = ", ".join(funciones[:4]) + ("…" if len(funciones) > 4 else "")
        hechos.append(f"{len(funciones)} {'función' if len(funciones) == 1 else 'funciones'} ({muestra})")
    archivos = [a["archivo"] for a in analisis.get("archivos") or []]
    if archivos:
        hechos.append("lee " + ", ".join(archivos[:4]) + ("…" if len(archivos) > 4 else ""))
    librerias = [i["modulo"] for i in analisis.get("imports") or [] if i["modulo"] not in _TRIVIALES]
    if librerias:
        hechos.append("usa " + ", ".join(librerias[:5]))
    if analisis.get("error"):
        hechos.append(f"error de sintaxis en {analisis['error']}")
    partes.append(" · ".join(hechos))

    lineas = [l for l in (codigo or "").splitlines() if l.strip()]
    fragmento = doc[:600] if doc else "\n".join(lineas[:20])[:600]
    return {
        "desc": "\n\n".join(partes),
        "fragmento": fragmento,
        "conceptos": librerias[:8],
    }


# ── Vínculos que salen del código ─────────────────────────────────────────────

def vinculos_de_codigo(script_id: str, analisis: dict, candidatos: list[dict]) -> list[dict]:
    """Aristas del script hacia lo que usa. `candidatos`: nodos de la misma sección con
    {id, type, archivo (nombre del archivo, sin carpeta)}. Coincidencia por nombre de
    archivo, sin distinguir mayúsculas; un import une con el script cuyo archivo se
    llama igual que el módulo."""
    por_archivo, por_modulo = {}, {}
    for c in candidatos:
        if c.get("id") == script_id or not c.get("archivo"):
            continue
        nombre = Path(c["archivo"]).name.lower()
        por_archivo.setdefault(nombre, c)
        if nombre.endswith(".py"):
            por_modulo.setdefault(nombre[:-3], c)

    aristas = []
    for arch in analisis.get("archivos") or []:
        destino = por_archivo.get(arch["archivo"].lower())
        if destino:
            aristas.append(_arista_codigo(
                script_id, destino["id"], REL_LEE_DATOS,
                f"Lee «{arch['archivo']}»" + (f" (línea {arch['linea']})" if arch.get("linea") else ""),
                {"linea": arch.get("linea"), "literal": arch.get("literal"), "archivo": arch["archivo"]},
            ))
    for imp in analisis.get("imports") or []:
        destino = por_modulo.get(imp["modulo"].lower())
        if destino:
            aristas.append(_arista_codigo(
                script_id, destino["id"], REL_IMPORTA,
                f"Importa el módulo «{imp['modulo']}»" + (f" (línea {imp['linea']})" if imp.get("linea") else ""),
                {"linea": imp.get("linea"), "modulo": imp["modulo"]},
            ))
    unicas, vistas = [], set()
    for a in aristas:
        if a["target"] not in vistas:
            vistas.add(a["target"])
            unicas.append(a)
    return unicas


def _arista_codigo(source, target, label, descripcion, evidencia) -> dict:
    return {
        "source": source, "target": target, "score": 1.0, "shared_concepts": [],
        "label": label, "description": descripcion,
        "metodo": METODO_CODIGO, "base_relacion": BASE_CODIGO,
        "evidencia": evidencia, "is_manual": False,
    }


def aristas_codigo_ajenas(aristas: list[dict], node_id: str) -> list[dict]:
    """De las aristas de código que tocan a `node_id`, las que NO salen de él.

    Al reingerir un CSV se borran sus aristas para recalcularlas, pero las que trazó el
    análisis de OTRO script ("limpieza.py lee ventas.csv") no dependen del CSV sino del
    código de ese script: hay que reponerlas. Las que salen del nodo guardado sí se
    recalculan (su código es el que cambió)."""
    return [a for a in aristas if a.get("metodo") == METODO_CODIGO and a.get("source") != node_id]


# ── Plan y ejecución ──────────────────────────────────────────────────────────

def plan_ejecucion(archivo: str, version: str, datos: list[dict], timeout_s: int) -> dict:
    """Lo que se muestra ANTES de correr. Corto y concreto: qué, con qué, qué límites y
    dónde queda registrado."""
    pasos = [f"Correr {archivo} (versión {version}) con Python, en un proceso aparte."]
    if datos:
        nombres = ", ".join(d["archivo"] for d in datos)
        pasos.append(f"Copiar al sandbox los datos que el script lee: {nombres} (una copia; los originales no se tocan).")
    pasos.append("Carpeta temporal propia y sin las variables de entorno del servidor (ni claves ni base).")
    pasos.append(f"Se corta a los {timeout_s} s. Lo que el script escriba queda en esa carpeta y se descarta al terminar.")
    pasos.append("Estado, salida y horas quedan registrados en Corridas.")
    return {
        "archivo": archivo, "version": version, "datos": datos, "timeout_s": timeout_s,
        "pasos": pasos,
        "advertencia": "Corre con los permisos del servidor: ejecutá sólo código que entendés.",
    }


def ejecutar_en_sandbox(ruta: Path, *, datos: list[Path] = (), timeout_s: int = 25,
                        salida_max: int = 20_000) -> dict:
    """Corre un .py en un proceso aparte: sin variables de entorno del servidor (ni
    claves ni DATABASE_URL), en un directorio temporal, con límite de tiempo y con copias
    de los datos que el script lee. Devuelve salida, código, horas y lo que generó."""
    entorno = {
        "PATH": os.getenv("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": "/tmp",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "ALGEDI_RUN": "1",
    }
    with tempfile.TemporaryDirectory(prefix="algedi_run_") as tmp:
        carpeta = Path(tmp)
        copiados = set()
        for d in datos or ():
            try:
                destino = carpeta / Path(d).name
                shutil.copy2(d, destino)
                copiados.add(destino.name)
            except Exception:
                continue
        inicio = time.time()
        inicio_iso = datetime.now(timezone.utc).isoformat()
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(ruta)],
                capture_output=True, text=True, timeout=timeout_s,
                cwd=tmp, env=entorno, input="",
            )
            salida = {
                "stdout": proc.stdout[:salida_max],
                "stderr": proc.stderr[:salida_max],
                "returncode": proc.returncode,
                "timeout": False,
            }
        except subprocess.TimeoutExpired as e:
            salida = {
                "stdout": (e.stdout or "")[:salida_max] if isinstance(e.stdout, str) else "",
                "stderr": f"Cortado por tiempo ({timeout_s}s).",
                "returncode": None,
                "timeout": True,
            }
        generados = []
        for f in sorted(carpeta.rglob("*")):
            if f.is_file() and f.name not in copiados:
                try:
                    generados.append({"archivo": str(f.relative_to(carpeta)), "bytes": f.stat().st_size})
                except OSError:
                    continue
        salida.update({
            "duration_ms": int((time.time() - inicio) * 1000),
            "inicio": inicio_iso,
            "fin": datetime.now(timezone.utc).isoformat(),
            "datos": sorted(copiados),
            "generados": generados[:50],
        })
        return salida


def resumen_salida(texto: str, maximo: int = SALIDA_RESUMEN) -> str:
    """Primeras y últimas líneas de una salida larga (lo del medio no suele decidir nada)."""
    texto = (texto or "").strip()
    if len(texto) <= maximo:
        return texto
    mitad = maximo // 2
    return f"{texto[:mitad].rstrip()}\n…\n{texto[-mitad:].lstrip()}"


# ── Consultas de sólo lectura ─────────────────────────────────────────────────

class ConsultaInvalida(ValueError):
    pass


# Lo único que una consulta puede hacer: leer. Todo lo demás (ATTACH, PRAGMA, INSERT,
# CREATE, transacciones…) lo niega el autorizador de SQLite, que corre por cada
# operación que el motor planea hacer: no depende de adivinar el texto del SQL.
_PERMITIDAS = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
if hasattr(sqlite3, "SQLITE_RECURSIVE"):
    _PERMITIDAS.add(sqlite3.SQLITE_RECURSIVE)


def _autorizador(accion, *_):
    return sqlite3.SQLITE_OK if accion in _PERMITIDAS else sqlite3.SQLITE_DENY


def _nombres_columnas(columnas: list) -> list[str]:
    salida, vistos = [], set()
    for i, c in enumerate(columnas):
        base = re.sub(r"\s+", " ", str(c or "").strip()) or f"col_{i + 1}"
        nombre, n = base, 2
        while nombre.lower() in vistos:
            nombre = f"{base}_{n}"
            n += 1
        vistos.add(nombre.lower())
        salida.append(nombre)
    return salida


def _a_numero(valor):
    try:
        return float(str(valor).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _ejecutar_consulta(conn, sql: str, limite: int, timeout_s: float) -> dict:
    sql = (sql or "").strip().rstrip(";").strip()
    if not sql:
        raise ConsultaInvalida("Escribí una consulta, por ejemplo: SELECT * FROM datos LIMIT 20")
    conn.set_authorizer(_autorizador)
    fin = time.time() + timeout_s
    conn.set_progress_handler(lambda: 1 if time.time() > fin else 0, 5_000)
    inicio = time.time()
    try:
        cur = conn.execute(sql)
        filas = cur.fetchmany(limite + 1)
    except (sqlite3.Warning, sqlite3.DatabaseError) as e:
        mensaje = str(e)
        if "one statement" in mensaje:
            raise ConsultaInvalida("Una sola consulta por vez.")
        if "interrupted" in mensaje:
            raise ConsultaInvalida(f"La consulta tardó más de {timeout_s:g} s y se cortó.")
        if "not authorized" in mensaje or "prohibited" in mensaje:
            raise ConsultaInvalida("Sólo se permiten consultas de lectura (SELECT).")
        raise ConsultaInvalida(mensaje)
    columnas = [d[0] for d in (cur.description or [])]
    return {
        "columnas": columnas,
        "filas": [["" if v is None else v for v in f] for f in filas[:limite]],
        "truncado": len(filas) > limite,
        "ms": int((time.time() - inicio) * 1000),
    }


def consultar_tabla(columnas: list, filas: list, sql: str, *, limite: int = 500,
                    timeout_s: float = 3.0) -> dict:
    """SQL de sólo lectura sobre una tabla (CSV/Excel ya leídos), cargada como `datos`
    en un SQLite en memoria. Las columnas numéricas (≥80 % de valores numéricos) se
    guardan como número, así SUM/AVG/ORDER BY hacen lo esperable."""
    nombres = _nombres_columnas(columnas) or ["col_1"]
    numericas = []
    for i in range(len(nombres)):
        valores = [f[i] for f in filas if i < len(f) and str(f[i]).strip() != ""]
        numeros = [v for v in valores if _a_numero(v) is not None]
        numericas.append(bool(valores) and len(numeros) >= 0.8 * len(valores))
    conn = sqlite3.connect(":memory:")
    try:
        definicion = ", ".join(f'"{n.replace(chr(34), "")}" {"REAL" if es else "TEXT"}'
                               for n, es in zip(nombres, numericas))
        conn.execute(f"CREATE TABLE datos ({definicion})")
        marcas = ", ".join("?" for _ in nombres)
        filas_sql = []
        for f in filas:
            fila = []
            for i, es in enumerate(numericas):
                valor = f[i] if i < len(f) else None
                if valor is None or str(valor).strip() == "":
                    fila.append(None)
                else:
                    fila.append(_a_numero(valor) if es else str(valor))
            filas_sql.append(fila)
        conn.executemany(f"INSERT INTO datos VALUES ({marcas})", filas_sql)
        res = _ejecutar_consulta(conn, sql, limite, timeout_s)
        res["tabla"] = {"nombre": "datos", "columnas": nombres, "filas": len(filas_sql)}
        return res
    finally:
        conn.close()


def esquema_sqlite(ruta: Path) -> list[dict]:
    """Tablas y columnas de una base SQLite, abierta en sólo lectura."""
    conn = sqlite3.connect(f"file:{Path(ruta).as_posix()}?mode=ro", uri=True)
    try:
        tablas = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        salida = []
        for t in tablas[:50]:
            cols = [r[1] for r in conn.execute(f'PRAGMA table_info("{t.replace(chr(34), "")}")')]
            salida.append({"tabla": t, "columnas": cols})
        return salida
    finally:
        conn.close()


def consultar_sqlite(ruta: Path, sql: str, *, limite: int = 500, timeout_s: float = 5.0) -> dict:
    """SQL de sólo lectura sobre una base SQLite real: se abre en modo `ro` y además con
    el autorizador, así ni un ATTACH ni un PRAGMA que escriba pasan."""
    conn = sqlite3.connect(f"file:{Path(ruta).as_posix()}?mode=ro", uri=True)
    try:
        return _ejecutar_consulta(conn, sql, limite, timeout_s)
    finally:
        conn.close()


# ── Pedidos de ejecución dirigidos al agente ──────────────────────────────────

_VERBO_EJECUTAR = re.compile(
    r"\b(corre|corr[eé]lo|correlo|correr|ejecuta|ejecut[aá]lo|ejecutalo|ejecutar|run|lanza|lanzar|lanzalo)\b"
)
_PRONOMBRE = re.compile(r"\b(esto|este|este script|el script|lo|correlo|ejecutalo|lanzalo)\b")


def _plano(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9_. ]+", " ", t)


def detectar_pedido_ejecucion(texto: str, scripts: list[dict], contexto_id: str | None = None) -> dict | None:
    """¿El mensaje pide correr un script de la sección? Devuelve {node_id, por} o
    {ambiguo: [ids]}; None si no es un pedido de ejecución o no nombra ningún script
    (entonces la pregunta sigue su camino normal: "¿cómo se corre una regresión?" no es
    una orden). `scripts`: [{id, label, archivo}]."""
    plano = _plano(texto)
    if not _VERBO_EJECUTAR.search(plano):
        return None
    tokens = set(plano.split())
    puntajes = []
    for s in scripts:
        archivo = (s.get("archivo") or "").lower()
        stem = archivo[:-3] if archivo.endswith(".py") else archivo
        puntos = 0
        if archivo and archivo in plano:
            puntos = 3
        elif stem and len(stem) >= 3 and stem in tokens:
            puntos = 2
        else:
            palabras = [w for w in _plano(s.get("label")).split() if len(w) >= 3]
            if palabras and sum(w in tokens for w in palabras) >= max(1, round(len(palabras) * 0.6)):
                puntos = 1
        if puntos:
            puntajes.append((puntos, s["id"]))
    if puntajes:
        puntajes.sort(reverse=True)
        mejores = [i for p, i in puntajes if p == puntajes[0][0]]
        if len(mejores) == 1:
            return {"node_id": mejores[0], "por": "nombre"}
        if contexto_id in mejores:
            return {"node_id": contexto_id, "por": "contexto"}
        return {"ambiguo": mejores[:5]}
    ids = {s["id"] for s in scripts}
    if contexto_id and contexto_id in ids and _PRONOMBRE.search(plano):
        return {"node_id": contexto_id, "por": "contexto"}
    return None
