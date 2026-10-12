"""Explorador de datos: el modelo de una fuente (tablas, campos, relaciones) y la tabla
dinámica que se arma sobre él, al estilo de DBeaver + Power BI.

Lógica pura (sin FastAPI ni conexiones) para poder testearla sola; main.py y
workbench.py leen las bases y corren el SQL, siempre en sólo lectura.

- Modelo: {"motor", "tablas": [{clave, tabla, esquema, vista, filas_aprox, campos}],
  "relaciones": [{desde: {tabla, columna}, hacia: {tabla, columna}, origen}]}.
  Una tabla se nombra por su `clave` («ventas», o «esquema.tabla» fuera de public).
- Tabla dinámica: filas y columnas (dimensiones), valores (con su agregación) y
  filtros, cada uno sobre «tabla.campo». Las tablas se unen solas siguiendo las
  relaciones del modelo (el camino más corto); el SQL que sale se muestra tal cual.
"""
from __future__ import annotations

import hashlib
import json
from collections import deque

CLASES = ("numerica", "fecha", "booleano", "texto")
AGREGACIONES = {
    "suma": "SUM({})", "promedio": "AVG({})", "conteo": "COUNT({})", "distintos": "COUNT(DISTINCT {})",
    "min": "MIN({})", "max": "MAX({})",
}
NOMBRE_AGREGACION = {"suma": "Suma", "promedio": "Promedio", "conteo": "Cantidad", "distintos": "Distintos",
                     "min": "Mínimo", "max": "Máximo"}
AGRUPAR_FECHA = ("año", "trimestre", "mes", "dia")
OPERADORES = ("=", "!=", ">", ">=", "<", "<=", "contiene", "en")
LIMITE_MAX = 5000


class PivotInvalido(ValueError):
    """La tabla dinámica pedida no se puede armar: el mensaje dice por qué."""


# ── Tipos ─────────────────────────────────────────────────────────────────────

def clase_sql(tipo: str) -> str:
    """Clase de un campo por su tipo SQL (Postgres o SQLite)."""
    t = (tipo or "").lower()
    if any(x in t for x in ("date", "time")):
        return "fecha"
    if "bool" in t:
        return "booleano"
    if any(x in t for x in ("int", "numeric", "decimal", "real", "double", "float", "money", "serial", "number")):
        return "numerica"
    return "texto"


def clase_de_muestra(clases_jev) -> str:
    """Clase de una columna de CSV/Excel a partir de lo que vio jev.clases_de_columna."""
    if "fecha" in clases_jev:
        return "fecha"
    if "numerica" in clases_jev:
        return "numerica"
    return "texto"


def clave_tabla(tabla: str, esquema: str | None = None) -> str:
    return tabla if esquema in (None, "", "public", "main") else f"{esquema}.{tabla}"


def modelo_de_tabla(columnas: list[dict], total_filas: int) -> dict:
    """Modelo de un CSV/Excel: una sola tabla, `datos`, como la ve la consulta SQL."""
    return {
        "motor": "tabla",
        "tablas": [{
            "clave": "datos", "tabla": "datos", "esquema": None, "vista": False,
            "filas_aprox": total_filas,
            "campos": [{"nombre": c["nombre"], "tipo": None, "clase": clase_de_muestra(c["clases"]),
                        "pk": False, "nulos": True, "ref": None} for c in columnas],
        }],
        "relaciones": [],
    }


def armar_modelo(motor: str, columnas: list[dict], claves: list[dict], tablas_meta: dict) -> dict:
    """Modelo a partir de lo que leen workbench.modelo_postgres / modelo_sqlite.

    columnas: [{esquema, tabla, columna, tipo, nulos}] en orden.
    claves:   [{esquema, tabla, columna, tipo: 'p'|'f', ref_esquema, ref_tabla, ref_columna}].
    tablas_meta: {(esquema, tabla): {vista, filas_aprox}}."""
    pk = {(c["esquema"], c["tabla"], c["columna"]) for c in claves if c["tipo"] == "p"}
    fk = {(c["esquema"], c["tabla"], c["columna"]): c for c in claves if c["tipo"] == "f" and c.get("ref_tabla")}
    tablas: dict[tuple, dict] = {}
    for c in columnas:
        k = (c["esquema"], c["tabla"])
        if k not in tablas:
            meta = tablas_meta.get(k, {})
            tablas[k] = {"clave": clave_tabla(c["tabla"], c["esquema"]), "tabla": c["tabla"],
                         "esquema": c["esquema"], "vista": bool(meta.get("vista")),
                         "filas_aprox": meta.get("filas_aprox"), "campos": []}
        ref = fk.get((c["esquema"], c["tabla"], c["columna"]))
        tablas[k]["campos"].append({
            "nombre": c["columna"], "tipo": c.get("tipo"), "clase": clase_sql(c.get("tipo")),
            "pk": (c["esquema"], c["tabla"], c["columna"]) in pk, "nulos": bool(c.get("nulos", True)),
            "ref": {"tabla": clave_tabla(ref["ref_tabla"], ref["ref_esquema"]), "columna": ref["ref_columna"]}
            if ref else None,
        })
    relaciones = [{
        "desde": {"tabla": clave_tabla(c["tabla"], c["esquema"]), "columna": c["columna"]},
        "hacia": {"tabla": clave_tabla(c["ref_tabla"], c["ref_esquema"]), "columna": c["ref_columna"]},
        "origen": "fk",
    } for c in fk.values()]
    return {"motor": motor, "tablas": list(tablas.values()), "relaciones": relaciones}


def con_relaciones(modelo: dict, extra: list[dict]) -> dict:
    """El modelo con relaciones marcadas a mano (sólo entre campos que existen)."""
    campos = {(t["clave"], c["nombre"]) for t in modelo["tablas"] for c in t["campos"]}
    ya = {(r["desde"]["tabla"], r["desde"]["columna"], r["hacia"]["tabla"], r["hacia"]["columna"])
          for r in modelo["relaciones"]}
    nuevas = []
    for r in extra or []:
        d, h = r.get("desde") or {}, r.get("hacia") or {}
        k = (d.get("tabla"), d.get("columna"), h.get("tabla"), h.get("columna"))
        if (k[0], k[1]) in campos and (k[2], k[3]) in campos and k not in ya:
            nuevas.append({"desde": {"tabla": k[0], "columna": k[1]}, "hacia": {"tabla": k[2], "columna": k[3]},
                           "origen": "manual"})
            ya.add(k)
    return {**modelo, "relaciones": modelo["relaciones"] + nuevas}


def sugerir_relaciones(modelo: dict) -> list[dict]:
    """Relaciones que el modelo no declara pero los nombres delatan, como hace Power BI:
    `ventas.cliente_id` → `clientes.id`. Son sugerencias: se aceptan a mano."""
    ya = {(r["desde"]["tabla"], r["desde"]["columna"]) for r in modelo["relaciones"]}
    por_nombre = {}
    for t in modelo["tablas"]:
        nombre = t["tabla"].lower()
        for variante in (nombre, nombre.rstrip("s"), nombre[:-2] if nombre.endswith("es") else None):
            if variante:
                por_nombre.setdefault(variante, t)
    salida = []
    for t in modelo["tablas"]:
        for c in t["campos"]:
            n = c["nombre"].lower()
            if c["pk"] or (t["clave"], c["nombre"]) in ya:
                continue
            base = n[:-3] if n.endswith("_id") else (n[3:].lstrip("_") if n.startswith("id_") else None)
            destino = por_nombre.get(base) if base else None
            if not destino or destino["clave"] == t["clave"]:
                continue
            clave = next((x for x in destino["campos"] if x["pk"]), None) or next(
                (x for x in destino["campos"] if x["nombre"].lower() == "id"), None)
            if clave:
                salida.append({"desde": {"tabla": t["clave"], "columna": c["nombre"]},
                               "hacia": {"tabla": destino["clave"], "columna": clave["nombre"]},
                               "origen": "sugerida"})
    return salida


# ── Uniones ───────────────────────────────────────────────────────────────────

def camino(relaciones: list[dict], desde: str, hasta: str) -> list[dict] | None:
    """Las relaciones a recorrer para llegar de una tabla a otra (la menor cantidad de
    uniones), o None si no hay forma. Las relaciones se recorren en los dos sentidos."""
    if desde == hasta:
        return []
    vecinos: dict[str, list] = {}
    for r in relaciones:
        a, b = r["desde"]["tabla"], r["hacia"]["tabla"]
        vecinos.setdefault(a, []).append((b, r))
        vecinos.setdefault(b, []).append((a, r))
    previo = {desde: None}
    cola = deque([desde])
    while cola:
        t = cola.popleft()
        for otra, r in vecinos.get(t, []):
            if otra not in previo:
                previo[otra] = (t, r)
                if otra == hasta:
                    pasos = []
                    x = otra
                    while previo[x]:
                        x_ant, rel = previo[x]
                        pasos.append(rel)
                        x = x_ant
                    return list(reversed(pasos))
                cola.append(otra)
    return None


# ── SQL ───────────────────────────────────────────────────────────────────────

def _id(nombre: str) -> str:
    return '"' + str(nombre).replace('"', '""') + '"'


def _literal(valor) -> str:
    if isinstance(valor, bool):
        return "TRUE" if valor else "FALSE"
    if isinstance(valor, (int, float)):
        return repr(valor)
    return "'" + str(valor).replace("'", "''") + "'"


def _expr_fecha(expr: str, agrupar: str, dialecto: str) -> str:
    if dialecto == "postgres":
        if agrupar == "trimestre":
            return f"(to_char({expr}, 'YYYY') || '-T' || to_char({expr}, 'Q'))"
        formato = {"año": "YYYY", "mes": "YYYY-MM", "dia": "YYYY-MM-DD"}[agrupar]
        return f"to_char({expr}, '{formato}')"
    if agrupar == "trimestre":
        return f"(strftime('%Y', {expr}) || '-T' || ((CAST(strftime('%m', {expr}) AS INTEGER) + 2) / 3))"
    formato = {"año": "%Y", "mes": "%Y-%m", "dia": "%Y-%m-%d"}[agrupar]
    return f"strftime('{formato}', {expr})"


def etiqueta_campo(c: dict) -> str:
    base = f"{c['columna']}" if c.get("tabla") in (None, "datos") else f"{c['tabla']}.{c['columna']}"
    return f"{base} ({c['fecha']})" if c.get("fecha") else base


def etiqueta_valor(v: dict) -> str:
    if v.get("columna") == "*":
        return "Cantidad de filas"
    return f"{NOMBRE_AGREGACION[v['agregacion']]} de {v['columna']}"


def armar_pivot(modelo: dict, spec: dict, dialecto: str) -> dict:
    """SQL de una tabla dinámica en formato largo: una fila por combinación de filas y
    columnas, con un valor por medida. Devuelve {sql, dimensiones, medidas, tablas}."""
    tablas = {t["clave"]: t for t in modelo["tablas"]}
    campos = {(t["clave"], c["nombre"]): c for t in modelo["tablas"] for c in t["campos"]}

    def campo(c: dict, para: str) -> dict:
        if not isinstance(c, dict) or c.get("tabla") not in tablas:
            raise PivotInvalido(f"{para}: falta la tabla o no existe.")
        if c.get("columna") == "*" and para == "valores":
            return {"clase": "numerica"}
        f = campos.get((c["tabla"], c.get("columna")))
        if not f:
            raise PivotInvalido(f"{para}: «{c.get('tabla')}» no tiene el campo «{c.get('columna')}».")
        return f

    filas = list(spec.get("filas") or [])
    columnas = list(spec.get("columnas") or [])
    valores = list(spec.get("valores") or [])
    filtros = list(spec.get("filtros") or [])
    if not valores:
        valores = [{"tabla": (filas or columnas or [{}])[0].get("tabla"), "columna": "*", "agregacion": "conteo"}]
    if not (filas or columnas or valores):
        raise PivotInvalido("Elegí al menos un campo.")
    for v in valores:
        if v.get("agregacion") not in AGREGACIONES:
            raise PivotInvalido(f"Agregación desconocida: «{v.get('agregacion')}».")
        f = campo(v, "valores")
        if v["agregacion"] in ("suma", "promedio") and f.get("clase") != "numerica":
            raise PivotInvalido(f"«{v['columna']}» no es numérico: se puede contar, no sumar ni promediar.")
    for d in filas + columnas:
        f = campo(d, "filas/columnas")
        if d.get("fecha"):
            if d["fecha"] not in AGRUPAR_FECHA:
                raise PivotInvalido(f"No sé agrupar fechas por «{d['fecha']}».")
            if f.get("clase") != "fecha":
                raise PivotInvalido(f"«{d['columna']}» no es una fecha.")
    for fl in filtros:
        campo(fl, "filtros")
        if fl.get("op") not in OPERADORES:
            raise PivotInvalido(f"Operador desconocido: «{fl.get('op')}».")

    # La tabla base es la de la primera medida (la de los hechos); las demás se unen.
    base = valores[0]["tabla"]
    usadas = [base] + [x["tabla"] for x in filas + columnas + valores + filtros if x["tabla"] != base]
    alias = {base: "t0"}
    uniones = []
    for destino in dict.fromkeys(usadas):
        if destino in alias:
            continue
        pasos = camino(modelo["relaciones"], base, destino)
        if pasos is None:
            raise PivotInvalido(f"No hay relación entre «{base}» y «{destino}»: marcala en el modelo.")
        actual = base
        for r in pasos:
            otra = r["hacia"]["tabla"] if r["desde"]["tabla"] == actual else r["desde"]["tabla"]
            if otra not in alias:
                alias[otra] = f"t{len(alias)}"
                col_actual = r["desde"]["columna"] if r["desde"]["tabla"] == actual else r["hacia"]["columna"]
                col_otra = r["hacia"]["columna"] if r["desde"]["tabla"] == actual else r["desde"]["columna"]
                uniones.append(f"LEFT JOIN {_tabla_sql(tablas[otra], dialecto)} AS {alias[otra]} "
                               f"ON {alias[actual]}.{_id(col_actual)} = {alias[otra]}.{_id(col_otra)}")
            actual = otra

    def expr(x: dict) -> str:
        e = f"{alias[x['tabla']]}.{_id(x['columna'])}"
        return _expr_fecha(e, x["fecha"], dialecto) if x.get("fecha") else e

    select, dims, meds = [], [], []
    for i, d in enumerate(filas + columnas):
        select.append(f"{expr(d)} AS d{i}")
        dims.append({"clave": f"d{i}", "etiqueta": etiqueta_campo(d), "eje": "filas" if i < len(filas) else "columnas"})
    for i, v in enumerate(valores):
        e = "*" if v.get("columna") == "*" else expr(v)
        select.append(f"{AGREGACIONES[v['agregacion']].format(e)} AS m{i}")
        meds.append({"clave": f"m{i}", "etiqueta": etiqueta_valor(v)})

    donde = []
    for fl in filtros:
        e, op, valor = expr(fl), fl["op"], fl.get("valor")
        if op == "contiene":
            como = "ILIKE" if dialecto == "postgres" else "LIKE"
            donde.append(f"CAST({e} AS TEXT) {como} {_literal('%' + str(valor) + '%')}")
        elif op == "en":
            lista = valor if isinstance(valor, list) else [valor]
            if lista:
                donde.append(f"{e} IN ({', '.join(_literal(x) for x in lista)})")
        else:
            donde.append(f"{e} {op} {_literal(valor)}")

    sql = f"SELECT {', '.join(select)}\nFROM {_tabla_sql(tablas[base], dialecto)} AS t0"
    if uniones:
        sql += "\n" + "\n".join(uniones)
    if donde:
        sql += "\nWHERE " + " AND ".join(donde)
    if dims:
        sql += "\nGROUP BY " + ", ".join(str(i + 1) for i in range(len(dims)))
        # Fechas en orden de calendario; lo demás, de mayor a menor por la primera medida.
        if any(d.get("fecha") for d in filas + columnas) or spec.get("orden") == "etiqueta":
            sql += "\nORDER BY " + ", ".join(str(i + 1) for i in range(len(dims)))
        else:
            sql += f"\nORDER BY {len(dims) + 1} DESC"
    limite = max(1, min(int(spec.get("limite") or 1000), LIMITE_MAX))
    sql += f"\nLIMIT {limite}"
    return {"sql": sql, "dimensiones": dims, "medidas": meds, "tablas": list(alias), "limite": limite}


def _tabla_sql(t: dict, dialecto: str) -> str:
    if dialecto == "postgres" and t.get("esquema"):
        return f"{_id(t['esquema'])}.{_id(t['tabla'])}"
    return _id(t["tabla"])


POZOS = ("filas", "columnas", "valores", "filtros")


def spec_completo(spec: dict | None) -> dict:
    """La definición de una tabla dinámica con los cuatro pozos siempre presentes (más
    límite y orden si vinieron). Así se guarda un reporte y así lo reabre el explorador."""
    spec = spec or {}
    return {**{k: spec[k] for k in ("limite", "orden") if spec.get(k) is not None},
            **{p: list(spec.get(p) or []) for p in POZOS}}


def huella_reporte(datos_id: str, spec: dict | None) -> str:
    """Seis caracteres que identifican «esta tabla dinámica sobre estos datos». Ignora
    los pozos vacíos: guardar dos veces lo mismo pisa el mismo nodo."""
    canonica = {k: v for k, v in spec_completo(spec).items() if v}
    return hashlib.sha256(json.dumps([datos_id, canonica], sort_keys=True).encode()).hexdigest()[:6]


def describir_pivot(spec: dict) -> str:
    """Una frase para el nodo de un reporte («Suma de cantidad por provincia y mes»)."""
    valores = [etiqueta_valor(v) for v in spec.get("valores") or []] or ["Cantidad de filas"]
    dims = [etiqueta_campo(d) for d in (spec.get("filas") or []) + (spec.get("columnas") or [])]
    texto = " y ".join(valores)
    return f"{texto} por {', '.join(dims)}" if dims else texto

