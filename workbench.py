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
- conexiones_postgres / consultar_postgres  lo mismo contra una base Postgres externa,
                       declarada en el entorno del backend.
- detectar_pedido_ejecucion  si un mensaje al agente pide correr un script.
"""
from __future__ import annotations

import ast
import decimal
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
from datetime import date, datetime, time as hora, timezone
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


# ── Bases Postgres externas (sólo lectura) ────────────────────────────────────
#
# Cada conexión se declara en el entorno del backend, nunca en la base de Algedi:
#     ALGEDI_PG_<NOMBRE>=postgresql://usuario:clave@host:5432/base
# La clave no sale de ahí: el nodo guarda sólo `postgres:<nombre>` y la UI ve nombre,
# host, base y usuario.
#
# Una consulta pasa por varias barreras, cada una suficiente para el caso común:
#   1. tiene que empezar con SELECT, WITH, TABLE, VALUES, EXPLAIN o SHOW (se rechaza
#      antes de conectar);
#   2. corre como sentencia preparada: Postgres no deja encadenar otra con «;»;
#   3. dentro de una transacción READ ONLY, en una sesión que además arranca con
#      default_transaction_read_only: cualquier escritura la rechaza Postgres mismo;
#   4. con statement_timeout, leyendo como mucho `limite + 1` filas con un cursor.
# Y no usa un superusuario ni un rol que lea o escriba archivos del servidor: para
# consultar desde acá hay que darle a Algedi un usuario de sólo lectura.

PREFIJO_PG = "ALGEDI_PG_"
_ESQUEMAS_PG = ("postgresql", "postgres")
_PRIMERAS_PG = {"select", "with", "table", "values", "explain", "show"}
_TEXTO_MAX = 2000     # caracteres por celda que viajan a la UI


class ConexionFallida(ConsultaInvalida):
    """No se pudo conectar: el mensaje ya dice a qué y por qué, sin la clave."""

    def __init__(self, conexion: dict, motivo: str):
        self.conexion = conexion
        super().__init__(
            f"No se pudo conectar a «{conexion['nombre']}» "
            f"({conexion['host']}:{conexion['puerto']}/{conexion['base']}): {motivo}.")


def conexiones_postgres(entorno=None) -> dict[str, dict]:
    """Las conexiones declaradas como ALGEDI_PG_<NOMBRE>, por nombre en minúsculas.
    Las que no son una URL postgresql:// válida se ignoran."""
    from urllib.parse import unquote, urlsplit
    entorno = os.environ if entorno is None else entorno
    salida = {}
    for clave, valor in entorno.items():
        valor = str(valor or "").strip()
        if not clave.upper().startswith(PREFIJO_PG) or not valor:
            continue
        nombre = re.sub(r"[^a-z0-9_]+", "_", clave[len(PREFIJO_PG):].lower()).strip("_")
        try:
            partes = urlsplit(valor)
            puerto = partes.port or 5432
        except ValueError:
            continue
        if not nombre or partes.scheme not in _ESQUEMAS_PG or not partes.hostname:
            continue
        usuario = unquote(partes.username or "")
        salida[nombre] = {
            "nombre": nombre,
            "url": valor,
            "host": partes.hostname,
            "puerto": puerto,
            "base": unquote(partes.path.lstrip("/")) or usuario,
            "usuario": usuario,
        }
    return dict(sorted(salida.items()))


def conexion_publica(conexion: dict) -> dict:
    """Lo que se puede mostrar de una conexión: todo menos la URL, que lleva la clave."""
    return {k: v for k, v in conexion.items() if k != "url"}


def _sin_comentarios_iniciales(sql: str) -> str:
    texto = sql.lstrip()
    while True:
        if texto.startswith("--"):
            fin = texto.find("\n")
            texto = "" if fin < 0 else texto[fin + 1:].lstrip()
        elif texto.startswith("/*"):
            fin = texto.find("*/")
            texto = "" if fin < 0 else texto[fin + 2:].lstrip()
        elif texto.startswith("("):
            texto = texto[1:].lstrip()
        else:
            return texto


def validar_consulta_pg(sql: str) -> str:
    """La consulta sin el «;» final, o ConsultaInvalida si no empieza leyendo."""
    sql = (sql or "").strip()
    while sql.endswith(";"):
        sql = sql[:-1].rstrip()
    if not sql:
        raise ConsultaInvalida("Escribí una consulta, por ejemplo: SELECT * FROM clientes LIMIT 20")
    primera = re.match(r"[A-Za-z]+", _sin_comentarios_iniciales(sql))
    if not primera or primera.group(0).lower() not in _PRIMERAS_PG:
        raise ConsultaInvalida("Sólo se permiten consultas de lectura (SELECT).")
    return sql


def valor_json(v):
    """Un valor de Postgres en algo que la UI puede mostrar tal cual."""
    if v is None or isinstance(v, (bool, int)):
        return v
    if isinstance(v, str):
        return v if len(v) <= _TEXTO_MAX else v[:_TEXTO_MAX] + "…"
    if isinstance(v, float):
        return v if v == v and abs(v) != float("inf") else str(v)
    if isinstance(v, decimal.Decimal):
        return float(v) if v.is_finite() else str(v)
    if isinstance(v, (date, hora)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return f"<{len(bytes(v))} bytes>"
    if isinstance(v, (list, tuple)):
        return [valor_json(x) for x in v]
    return valor_json(str(v))


def _motivo_conexion(e: BaseException) -> str:
    nombre = type(e).__name__
    texto = str(e)
    if nombre == "InvalidPasswordError" or "password authentication failed" in texto:
        return "usuario o clave incorrectos"
    if nombre == "InvalidCatalogNameError":
        return "esa base no existe en el servidor"
    if isinstance(e, TimeoutError) or nombre == "TimeoutError":
        return "el servidor no respondió a tiempo"
    if "Name or service not known" in texto or "Temporary failure in name resolution" in texto \
            or "nodename nor servname" in texto or "getaddrinfo failed" in texto:
        return "no se encuentra el servidor"
    if isinstance(e, ConnectionRefusedError) or "Connect call failed" in texto:
        return "el servidor no acepta conexiones"
    return texto or nombre


async def _conectar_pg(conexion: dict, timeout_s: float):
    import asyncpg
    try:
        conn = await asyncpg.connect(
            conexion["url"], timeout=5,
            server_settings={
                "application_name": "algedi-workbench",
                "default_transaction_read_only": "on",
                "statement_timeout": str(int(timeout_s * 1000)),
                "lock_timeout": "2000",
                "idle_in_transaction_session_timeout": str(int(timeout_s * 1000) + 5000),
            },
        )
    except Exception as e:
        raise ConexionFallida(conexion, _motivo_conexion(e)) from None
    try:
        try:
            peligroso = await conn.fetchval(
                "SELECT rolsuper"
                " OR pg_has_role(current_user, 'pg_read_server_files', 'MEMBER')"
                " OR pg_has_role(current_user, 'pg_write_server_files', 'MEMBER')"
                " OR pg_has_role(current_user, 'pg_execute_server_program', 'MEMBER')"
                " FROM pg_roles WHERE rolname = current_user")
        except asyncpg.exceptions.PostgresError:   # Postgres < 11: sin esos roles
            peligroso = await conn.fetchval("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
        if peligroso:
            raise ConsultaInvalida(
                f"La conexión «{conexion['nombre']}» usa el usuario «{conexion['usuario']}», que es "
                "superusuario o puede tocar archivos del servidor. Para consultar desde Algedi "
                "configurá un usuario de sólo lectura.")
    except BaseException:
        await conn.close()
        raise
    return conn


async def esquema_postgres(conexion: dict, *, timeout_s: float = 5.0) -> list[dict]:
    """Tablas y vistas que el usuario de la conexión puede leer, con sus columnas y
    (en tablas) las filas que estima Postgres."""
    conn = await _conectar_pg(conexion, timeout_s)
    try:
        filas = await conn.fetch(
            "SELECT c.table_schema AS esquema, c.table_name AS tabla,"
            "       array_agg(c.column_name::text ORDER BY c.ordinal_position) AS columnas,"
            "       max(pc.relkind::text) AS tipo, max(pc.reltuples)::bigint AS filas"
            "  FROM information_schema.columns c"
            "  LEFT JOIN pg_namespace pn ON pn.nspname = c.table_schema"
            "  LEFT JOIN pg_class pc ON pc.relnamespace = pn.oid AND pc.relname = c.table_name"
            " WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')"
            "   AND c.table_schema !~ '^pg_'"
            " GROUP BY 1, 2 ORDER BY (c.table_schema <> 'public'), 1, 2 LIMIT 60")
    except Exception as e:
        raise ConsultaInvalida(f"No se pudo leer el esquema: {e}") from None
    finally:
        await conn.close()
    return [{
        "tabla": f["tabla"],
        "esquema": f["esquema"],
        "columnas": list(f["columnas"]),
        "vista": f["tipo"] == "v",
        "filas_aprox": (int(f["filas"]) if f["tipo"] in ("r", "p", "m")
                        and f["filas"] is not None and f["filas"] >= 0 else None),
    } for f in filas]


async def consultar_postgres(conexion: dict, sql: str, *, limite: int = 500,
                             timeout_s: float = 5.0) -> dict:
    """SQL de sólo lectura sobre una base Postgres configurada (ver barreras arriba)."""
    import asyncpg
    sql = validar_consulta_pg(sql)
    conn = await _conectar_pg(conexion, timeout_s)
    inicio = time.time()
    try:
        async with conn.transaction(readonly=True):
            sentencia = await conn.prepare(sql)
            columnas = [a.name for a in sentencia.get_attributes()]
            cursor = await sentencia.cursor()
            filas = await cursor.fetch(limite + 1)
    except asyncpg.exceptions.QueryCanceledError:
        raise ConsultaInvalida(f"La consulta tardó más de {timeout_s:g} s y se cortó.") from None
    except asyncpg.exceptions.ReadOnlySQLTransactionError:
        raise ConsultaInvalida("Sólo se permiten consultas de lectura (SELECT).") from None
    except asyncpg.exceptions.InsufficientPrivilegeError as e:
        raise ConsultaInvalida(f"El usuario «{conexion['usuario']}» no tiene permiso: {e}") from None
    except asyncpg.exceptions.PostgresError as e:
        if "multiple commands" in str(e):
            raise ConsultaInvalida("Una sola consulta por vez.") from None
        raise ConsultaInvalida(str(e)) from None
    finally:
        await conn.close()
    return {
        "columnas": columnas,
        "filas": [["" if v is None else valor_json(v) for v in f] for f in filas[:limite]],
        "truncado": len(filas) > limite,
        "ms": int((time.time() - inicio) * 1000),
    }


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
