"""JEV en Algedi: de una necesidad a la herramienta justa, con recibo.

Ante cada pedido decide, en este orden y sin LLM:
  1. el CAMINO: responder con la biblioteca, usar una herramienta o mirar el grafo;
  2. si es una herramienta, CUÁL (entre los scripts que traen ficha);
  3. sus PARÁMETROS, cada uno elegido entre valores válidos (una columna sólo puede
     ser una columna de la tabla, de la clase que la herramienta pide).
Cada paso es una decisión tipada del decisor (decisor.py): una opción con su
probabilidad, o ninguna —y entonces se pregunta en vez de adivinar—.

Nada se ejecuta acá: se arma la propuesta y la persona confirma. Lógica pura (sin
FastAPI ni base) para poder medirla (eval/evaluar_jev.py) y testearla.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

from decisor import Decision, Opcion, decidir, elegir, puntajes

# ── Caminos ───────────────────────────────────────────────────────────────────
BIBLIOTECA, HERRAMIENTA, GRAFO = "biblioteca", "herramienta", "grafo"
ETIQUETA_CAMINO = {BIBLIOTECA: "Responder con la biblioteca", HERRAMIENTA: "Usar una herramienta",
                   GRAFO: "Mirar el grafo"}

CAMINOS = {
    # Ejemplos sin tema a propósito: con «¿qué dice el libro sobre redes neuronales?»,
    # cualquier pedido que nombrara redes neuronales se iba a la biblioteca por el tema,
    # no por lo que pide. Lo que distingue el camino es la FORMA del pedido.
    BIBLIOTECA: Opcion(BIBLIOTECA, (
        "Pregunta de conocimiento: qué es algo, cómo funciona, por qué, explicar un concepto, "
        "un método o qué dice un documento"), [
        "¿Qué es este concepto?",
        "Explicame cómo funciona este método",
        "¿Para qué sirve esta técnica?",
        "¿Qué dice el libro sobre este tema?",
        "¿Cuál es la diferencia entre estos dos métodos?",
        "¿Cómo se interpreta este resultado?",
        "Resumime este documento",
        "¿Cuándo conviene usar este enfoque?",
    ]),
    HERRAMIENTA: Opcion(HERRAMIENTA, (
        "Pedido de hacer un análisis o un cálculo sobre datos: analizar, calcular, modelar, "
        "comparar, detectar o segmentar con una tabla"), [
        "Analizá estos datos",
        "Hacé una regresión con esta tabla",
        "Calculá las correlaciones del CSV",
        "¿Qué variables explican las ventas en estos datos?",
        "Detectá valores atípicos en la planilla",
        "Agrupá los clientes en segmentos",
        "Compará las ventas entre regiones",
        "Mostrame la tendencia mensual de los ingresos",
        "Entrená un modelo para predecir el abandono",
        "Corré un perfil de la tabla",
    ]),
    GRAFO: Opcion(GRAFO, (
        "Pregunta sobre la biblioteca misma: qué documentos se relacionan o se parecen, qué "
        "está conectado, cuántos documentos o qué temas hay"), [
        "¿Qué documentos se relacionan con este?",
        "¿Con qué está conectado el libro de finanzas?",
        "Mostrame los vecinos de este documento",
        "¿Qué documentos son parecidos a este?",
        "¿Cuántos documentos hay en la sección?",
        "¿Qué temas tiene la biblioteca?",
        "¿Qué une a estos dos documentos?",
    ]),
}

# Señales que no dependen del parecido de frases. Van en unidades de coseno, chicas a
# propósito (0.02 ≈ multiplicar por e la probabilidad); medidas en eval/evaluar_jev.py.
SESGO_VERBO_ACCION = 0.015
SESGO_CONTEXTO_DATOS = 0.02
SESGO_PALABRAS_DATOS = 0.01
SESGO_PALABRAS_GRAFO = 0.015
# La forma de una pregunta de teoría («¿qué es un…?», «¿qué diferencia hay…?», «¿cómo se
# calcula…?», «contame…») pesa más que su tema: «¿cómo se calcula el R² ajustado?» habla
# de regresión pero no pide correr una. Con eso, ni el verbo de cálculo ni tener una
# tabla seleccionada la empujan a una herramienta. Los marcadores son acotados para no
# atrapar pedidos de análisis («¿qué es lo que más influye…?», «¿hay diferencia de
# gasto entre regiones?»).
SESGO_PREGUNTA_CONCEPTO = 0.05

_VERBO_ACCION = re.compile(
    r"\b(analiz\w*|calcul\w*|hace\w*|hac[eé]|arm\w*|corr[eé]\w*|ejecut\w*|entren\w*|compar\w*|"
    r"detect\w*|grafic\w*|perfil\w*|limpi\w*|agrup\w*|segment\w*|predec\w*|predic\w*|estim\w*|"
    r"model\w*|mostrame|sacame|decime|busca\w* (?:outliers|atipicos))\b")
_PALABRAS_DATOS = re.compile(
    r"\b(datos|tabla|csv|planilla|excel|dataset|columna\w*|filas?|variables?)\b")
_PALABRAS_GRAFO = re.compile(r"\b(relacion\w*|conect\w*|vincul\w*|vecin\w*|parec\w*|similar\w*|"
                             r"une|unen|temas?|cuantos documentos|aislad\w*|huerfan\w*)\b")
_PREGUNTA_CONCEPTO = re.compile(
    r"\b(que es (un|una|el|la|los|las)|que son (los|las)|que significa|que dice|que diferencia|"
    r"cual es la diferencia|como (se )?(calcula|interpreta|define|funciona|elige|lee|usa)|"
    r"para que (sirve|se usa)|cuando conviene|explicame|contame|definime)\b")

PROB_CAMINO_HERRAMIENTA = 0.5      # para proponer una herramienta hace falta mayoría
PISO_HERRAMIENTA = 0.80            # coseno mínimo de la mejor herramienta con el pedido
PISO_COLUMNA_OPCIONAL = 0.86       # un parámetro opcional sólo se llena con evidencia clara
SESGO_MENCION = 0.06               # la columna nombrada en el pedido gana


def plano(texto: str) -> str:
    t = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", t).split())


def decidir_camino(pedido: str, contexto_tipo: str | None = None) -> Decision:
    t = plano(pedido)
    concepto = bool(_PREGUNTA_CONCEPTO.search(t))
    sesgos = {
        HERRAMIENTA: 0.0 if concepto else (
            (SESGO_VERBO_ACCION if _VERBO_ACCION.search(t) else 0.0)
            + (SESGO_CONTEXTO_DATOS if contexto_tipo == "DATOS" else 0.0)
            + (SESGO_PALABRAS_DATOS if _PALABRAS_DATOS.search(t) else 0.0)),
        GRAFO: SESGO_PALABRAS_GRAFO if _PALABRAS_GRAFO.search(t) else 0.0,
        BIBLIOTECA: SESGO_PREGUNTA_CONCEPTO if concepto else 0.0,
    }
    opciones = [Opcion(c.clave, c.texto, c.ejemplos, sesgos[c.clave]) for c in CAMINOS.values()]
    d = decidir(puntajes(pedido, opciones), prob_minima=0.0, margen_minimo=0.0)
    # El camino de siempre (biblioteca) no necesita mayoría; los otros sí.
    if d.eleccion != BIBLIOTECA and d.confianza < PROB_CAMINO_HERRAMIENTA:
        d.eleccion, d.motivo = BIBLIOTECA, "ningún otro camino tiene mayoría"
    return d


# ── Herramientas ──────────────────────────────────────────────────────────────

def opcion_de_herramienta(h: dict) -> Opcion:
    f = h["ficha"]
    texto = f"{f.get('titulo', '')}. {f.get('sirve_para', '')} Entrega: {f.get('entrega', '')}".strip()
    return Opcion(h["node_id"], texto, list(f.get("ejemplos") or []), etiqueta=h.get("label") or f.get("titulo"))


# Elegir herramienta = significado + palabras, como la búsqueda de pasajes. Sólo con el
# parecido de frases, palabras comunes a todas las fichas («clientes», «datos») ganaban:
# «¿qué columnas están correlacionadas con…?» iba al perfil del dataset. Medido en
# eval/evaluar_jev.py (24 pedidos de herramienta):
#   máximo parecido (antes)              acierta primero 17 · elige 13 · pregunta 11
#   ficha + mejor ejemplo + palabras     acierta primero 21 · elige 19 · pregunta 5
# sin errores en los dos casos (cuando duda, pregunta). 0.02 está en medio de la zona
# sin errores (0.01 y 0.03 tampoco erran): no es un número ajustado al último decimal.
PESO_PALABRAS = 0.02


def _raiz(w: str) -> str:
    return w[:5]          # «correlacionadas» y «correlaciones» cuentan como la misma


def _texto_ficha(f: dict) -> str:
    return " ".join([f.get("titulo", ""), f.get("sirve_para", ""), f.get("entrega", "")]
                    + list(f.get("ejemplos") or []))


def puntajes_herramientas(pedido: str, herramientas: list[dict]) -> dict[str, float]:
    """Por herramienta: mitad parecido con su ficha, mitad con su pedido típico más
    parecido, más un plus por las palabras del pedido que aparecen en su ficha,
    pesadas por lo raras que son entre herramientas (idf)."""
    import math
    from busqueda import terminos
    from decisor import vectores
    q = vectores([pedido], "consulta")[0]
    bolsas = {h["node_id"]: {_raiz(w) for w in terminos(_texto_ficha(h["ficha"]))} for h in herramientas}
    df = Counter(r for b in bolsas.values() for r in b)
    idf = {r: math.log(len(bolsas) / n) for r, n in df.items()}
    raices = {_raiz(w) for w in terminos(pedido)}
    lexico = {k: sum(idf[r] for r in raices & b) for k, b in bolsas.items()}
    tope = max(max(lexico.values(), default=0.0), 1.0)
    salida = {}
    for h in herramientas:
        op = opcion_de_herramienta(h)
        ficha = float(vectores([op.texto], "pasaje")[0] @ q)
        ejemplo = max((float(v @ q) for v in vectores(op.ejemplos, "consulta")), default=ficha)
        salida[h["node_id"]] = 0.5 * ficha + 0.5 * ejemplo + PESO_PALABRAS * lexico[h["node_id"]] / tope
    return salida


def elegir_herramienta(pedido: str, herramientas: list[dict]) -> Decision:
    if not herramientas:
        return Decision(None, {}, "no hay herramientas con ficha")
    return decidir(puntajes_herramientas(pedido, herramientas),
                   prob_minima=0.4, margen_minimo=0.1, piso=PISO_HERRAMIENTA)


# ── Datos ─────────────────────────────────────────────────────────────────────
_FECHA = re.compile(r"^\d{4}-\d{1,2}(-\d{1,2})?([ T].*)?$|^\d{1,2}/\d{1,2}/\d{2,4}$")


def _numero(v: str) -> float | None:
    try:
        return float(str(v).strip().replace(",", "."))
    except ValueError:
        return None


def clases_de_columna(valores: list) -> set[str]:
    """Qué clase de columna es, mirando una muestra de sus valores (texto)."""
    vals = [str(v).strip() for v in valores if str(v).strip() != ""]
    if not vals:
        return set()
    distintos = set(vals)
    clases = set()
    numeros = [n for n in (_numero(v) for v in vals) if n is not None]
    if len(numeros) >= 0.9 * len(vals):
        clases.add("numerica")
    if sum(bool(_FECHA.match(v)) for v in vals) >= 0.9 * len(vals):
        clases.add("fecha")
        clases.discard("numerica")
    if len(distintos) == 2:
        clases.add("binaria")
    if ("numerica" not in clases and "fecha" not in clases and len(distintos) <= max(20, len(vals) // 20)) \
            or len(distintos) <= 6:
        clases.add("categorica")
    return clases


def describir_tabla(columnas: list[str], filas: list[list]) -> list[dict]:
    salida = []
    for i, nombre in enumerate(columnas):
        muestra = [f[i] for f in filas if i < len(f)]
        salida.append({"nombre": nombre, "clases": sorted(clases_de_columna(muestra))})
    return salida


def _legible(nombre: str) -> str:
    return plano(nombre.replace("_", " "))


def _singular(w: str) -> str:
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s"):
        return w[:-1]
    return w


def _mencionada(nombre: str, pedido_plano: str) -> bool:
    """¿El pedido nombra la columna? Entera («gasto mensual») o por su palabra principal,
    la primera («antigüedad» para antiguedad_meses, «planes» para plan). Una palabra
    secundaria no alcanza: «gasto mensual» no nombra a uso_mensual_gb."""
    n = _legible(nombre)
    if not n:
        return False
    from busqueda import STOP
    palabras = {_singular(w) for w in pedido_plano.split()}
    if f" {n} " in f" {pedido_plano} ":
        return True
    principal = _singular(n.split()[0])
    # 3 letras alcanzan («uso» para uso_mensual_gb) si no es una palabra vacía.
    return len(principal) >= 3 and principal not in STOP and principal in palabras


def _posicion(nombre: str, pedido_plano: str) -> int:
    """Dónde aparece la columna en el pedido (para desempatar: lo que se quiere explicar
    suele ir primero, «el gasto por cada GB de uso»)."""
    n = _legible(nombre)
    palabras = [_singular(w) for w in pedido_plano.split()]
    principal = _singular(n.split()[0]) if n else ""
    return next((i for i, w in enumerate(palabras) if w == principal), len(palabras))


def clase_principal(clases) -> str | None:
    """Lo que la columna ES, antes que lo que PUEDE ser: una satisfacción de 1 a 5 es
    numérica aunque, con 5 valores, también sirva de grupo."""
    for c in ("fecha", "binaria", "numerica", "categorica"):
        if c in clases:
            return c
    return None


def _admite(p: dict, columna: dict) -> bool:
    return not p.get("clase") or p["clase"] in columna["clases"]


def _afinidad(p: dict, columna: dict) -> float:
    """1 si la columna es justo de la clase que el parámetro pide; menos si sólo la admite."""
    if not p.get("clase"):
        return 1.0
    principal = clase_principal(columna["clases"])
    if principal == p["clase"] or (principal == "binaria" and p["clase"] == "categorica"):
        return 1.0
    return 0.5


@dataclass
class Parametros:
    valores: dict = field(default_factory=dict)       # lo que recibe el script
    detalle: list = field(default_factory=list)       # cómo se eligió cada uno (recibo)
    faltan: list = field(default_factory=list)        # lo que hay que preguntar


def _elegir_tabla(pedido: str, contexto: dict | None, tablas: list[dict]) -> tuple[dict | None, str, Decision | None]:
    if contexto and contexto.get("type") == "DATOS":
        t = next((t for t in tablas if t["node_id"] == contexto.get("id")), None)
        if t:
            return t, "es el dato seleccionado", None
    if len(tablas) == 1:
        return tablas[0], "es la única tabla de la biblioteca", None
    if not tablas:
        return None, "no hay tablas", None
    d = elegir(pedido, [Opcion(t["node_id"], f"{t['label']}. {t.get('desc') or ''}",
                               etiqueta=t["label"]) for t in tablas])
    if d.eleccion:
        return next(t for t in tablas if t["node_id"] == d.eleccion), "la más parecida al pedido", d
    return None, "hay varias tablas parecidas", d


def resolver_parametros(pedido: str, ficha: dict, contexto: dict | None, tablas: list[dict],
                        fijados: dict | None = None) -> Parametros:
    """`fijados`: valores que la persona ya eligió (al tocar una opción): no se deciden."""
    res = Parametros()
    fijados = fijados or {}
    t_plano = plano(pedido)
    elegidas: dict[str, dict] = {}            # nombre del parámetro tabla → tabla
    usadas: set[str] = set()
    spec = ficha.get("parametros") or {}

    for nombre, p in spec.items():
        if p["tipo"] != "tabla":
            continue
        fija = next((t for t in tablas if t["node_id"] == fijados.get(nombre)), None)
        tabla, por, d = (fija, "la elegiste vos", None) if fija else _elegir_tabla(pedido, contexto, tablas)
        if tabla:
            elegidas[nombre] = tabla
            res.valores[nombre] = tabla["node_id"]
            res.detalle.append({"nombre": nombre, "valor": tabla["label"], "por": por,
                                "probabilidad": round(d.confianza, 3) if d else None})
        elif not p["opcional"]:
            opciones = ([{"valor": k, "etiqueta": next(t["label"] for t in tablas if t["node_id"] == k),
                          "probabilidad": round(pr, 3)} for k, pr in d.ranking(4)] if d else [])
            res.faltan.append({"nombre": nombre, "pregunta": "¿Sobre qué tabla?" if tablas else
                               "Necesito una tabla: seleccioná un nodo de datos o subí un CSV.",
                               "opciones": opciones})

    # Columnas, en dos pasadas. 1) Las NOMBRADAS en el pedido se reparten entre los
    # parámetros que las admiten, prefiriendo el parámetro de su clase principal
    # («compará la satisfacción entre planes»: plan es el grupo, satisfacción el valor,
    # aunque satisfacción, con 5 valores, también podría ser un grupo). 2) Las que
    # quedan se deciden por parecido; si hay duda, se pregunta.
    de_columna = {}
    for nombre, p in spec.items():
        if p["tipo"] not in ("columna", "columnas"):
            continue
        tabla = elegidas.get(p.get("de") or "datos")
        if not tabla:
            continue
        if fijados.get(nombre) not in (None, "", []):
            res.valores[nombre] = fijados[nombre]
            usadas.update(fijados[nombre] if isinstance(fijados[nombre], list) else [fijados[nombre]])
            res.detalle.append({"nombre": nombre, "valor": fijados[nombre], "por": "la elegiste vos"})
            continue
        de_columna[nombre] = (p, tabla)

    pares = []
    for nombre, (p, tabla) in de_columna.items():
        if p["tipo"] != "columna":
            continue
        for c in tabla["columnas"]:
            if _admite(p, c) and _mencionada(c["nombre"], t_plano):
                pares.append((_afinidad(p, c), _posicion(c["nombre"], t_plano), nombre, c["nombre"]))
    for _, _, nombre, col in sorted(pares, key=lambda x: (-x[0], x[1])):
        if nombre in res.valores or col in usadas:
            continue
        res.valores[nombre] = col
        usadas.add(col)
        res.detalle.append({"nombre": nombre, "valor": col, "por": "nombrada en el pedido"})

    for nombre, (p, tabla) in de_columna.items():
        if nombre in res.valores:
            continue
        compatibles = [c for c in tabla["columnas"] if c["nombre"] not in usadas and _admite(p, c)]
        if p["tipo"] == "columnas":
            nombradas = [c["nombre"] for c in compatibles if _mencionada(c["nombre"], t_plano)]
            res.valores[nombre] = nombradas or None
            usadas.update(nombradas)
            if nombradas:
                res.detalle.append({"nombre": nombre, "valor": ", ".join(nombradas), "por": "nombradas en el pedido"})
            continue
        if not compatibles:
            if not p["opcional"]:
                clase = f" {p['clase']}" if p.get("clase") else ""
                res.faltan.append({"nombre": nombre, "opciones": [],
                                   "pregunta": f"La tabla no tiene una columna{clase} libre para «{nombre}»."})
            continue
        d = elegir(pedido, [Opcion(c["nombre"], f"columna {_legible(c['nombre'])}") for c in compatibles],
                   prob_minima=0.4, margen_minimo=0.1)
        if d.eleccion and (not p["opcional"] or d.puntajes[d.eleccion] >= PISO_COLUMNA_OPCIONAL):
            res.valores[nombre] = d.eleccion
            usadas.add(d.eleccion)
            res.detalle.append({"nombre": nombre, "valor": d.eleccion, "por": "la más parecida al pedido",
                                "probabilidad": round(d.confianza, 3)})
        elif p["opcional"]:
            res.valores[nombre] = p.get("defecto")
        else:
            res.faltan.append({"nombre": nombre, "pregunta": f"¿Qué columna es «{nombre}»?"
                               + (f" ({p['desc']})" if p.get("desc") else ""),
                               "opciones": [{"valor": k, "etiqueta": k, "probabilidad": round(pr, 3)}
                                            for k, pr in d.ranking(4)]})

    numeros = re.findall(r"\b\d+(?:[.,]\d+)?\b", pedido)
    de_numero = [n for n, p in spec.items() if p["tipo"] == "numero"]
    for nombre, p in spec.items():
        if p["tipo"] in ("numero", "opcion", "texto") and nombre in fijados:
            res.valores[nombre] = fijados[nombre]
            res.detalle.append({"nombre": nombre, "valor": fijados[nombre], "por": "lo elegiste vos"})
        elif p["tipo"] == "numero":
            if len(numeros) == 1 and len(de_numero) == 1:
                valor = float(numeros[0].replace(",", "."))
                res.valores[nombre] = int(valor) if valor.is_integer() else valor
                res.detalle.append({"nombre": nombre, "valor": res.valores[nombre], "por": "dicho en el pedido"})
            else:
                res.valores[nombre] = p.get("defecto")
        elif p["tipo"] == "opcion":
            nombrada = next((o for o in p.get("opciones") or [] if f" {plano(o)} " in f" {t_plano} "), None)
            res.valores[nombre] = nombrada or p.get("defecto")
            if nombrada:
                res.detalle.append({"nombre": nombre, "valor": nombrada, "por": "dicha en el pedido"})
        elif p["tipo"] == "texto":
            res.valores[nombre] = p.get("defecto")
    return res


# ── Propuesta completa ────────────────────────────────────────────────────────

def proponer(pedido: str, contexto: dict | None, herramientas: list[dict], tablas: list[dict], *,
             herramienta: str | None = None, fijados: dict | None = None) -> dict:
    """{camino, herramienta?, parametros?, faltan?}: todo lo que hace falta para responder,
    proponer o preguntar. `contexto`: {id, type, label} del nodo en foco, o None.
    `herramienta`: la que la persona ya eligió (por nombre o tocando una opción)."""
    etiquetas = {h["node_id"]: h.get("label") or h["ficha"].get("titulo") for h in herramientas}
    if herramienta in etiquetas:
        camino = Decision(HERRAMIENTA, {HERRAMIENTA: 1.0}, "la pediste vos")
        d = Decision(herramienta, {herramienta: 1.0}, "la pediste vos")
    else:
        camino = decidir_camino(pedido, (contexto or {}).get("type"))
        d = None
    salida = {"camino": camino.a_dict(ETIQUETA_CAMINO), "eleccion_camino": camino.eleccion}
    if camino.eleccion != HERRAMIENTA:
        return salida
    d = d or elegir_herramienta(pedido, herramientas)
    salida["herramienta"] = d.a_dict(etiquetas)
    if not d.eleccion:
        return salida
    h = next(x for x in herramientas if x["node_id"] == d.eleccion)
    params = resolver_parametros(pedido, h["ficha"], contexto, tablas, fijados)
    salida.update({"node_id": h["node_id"], "label": etiquetas[h["node_id"]],
                   "parametros": params.valores, "parametros_detalle": params.detalle,
                   "faltan": params.faltan, "efectos": h["ficha"].get("efectos") or []})
    return salida
