"""Mide a JEV (jev.py) con pedidos reales: ¿elige bien el camino, la herramienta y los
parámetros? Sin base ni servidor: lee las fichas de herramientas/data_science y la
tabla de prueba herramientas/ejemplos/clientes_demo.csv.

Métricas
- camino: aciertos sobre todos los pedidos, y la matriz de confusión.
- herramienta (sólo pedidos de herramienta con el camino bien elegido):
    acierto  = eligió la correcta;
    pregunta = no eligió (pidió aclaración): no es error, pero cuesta un clic;
    error    = eligió otra;
    top-3    = la correcta está entre las 3 opciones más probables.
- parámetros: de los pedidos con la herramienta correcta, cuántos tienen TODOS los
  parámetros esperados bien (lo que no se espera no se mira).
- sin herramienta: pedidos para los que nada de la navaja sirve; bien si no fuerza una.

Uso (en el contenedor del backend): python eval/evaluar_jev.py
"""
import csv
import json
import sys
import time
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

import jev  # noqa: E402
import workbench as wb  # noqa: E402

PEDIDOS = BASE / "eval" / "preguntas_jev_v1.json"


def cargar():
    herramientas = []
    for ruta in sorted((BASE / "herramientas" / "data_science").glob("*.py")):
        ficha = wb.leer_ficha(ruta.read_text(encoding="utf-8"))
        if ficha:
            herramientas.append({"node_id": ruta.stem, "label": ficha["titulo"], "ficha": ficha})
    with (BASE / "herramientas" / "ejemplos" / "clientes_demo.csv").open(encoding="utf-8") as fh:
        filas = list(csv.reader(fh))
    tablas = [{"node_id": "tabla", "label": "clientes_demo.csv", "desc": "",
               "columnas": jev.describir_tabla(filas[0], filas[1:501])}]
    return herramientas, tablas


def igual(esperado, obtenido) -> bool:
    if isinstance(esperado, list):
        return isinstance(obtenido, list) and set(esperado) == set(obtenido)
    if isinstance(esperado, (int, float)) and isinstance(obtenido, (int, float)):
        return float(esperado) == float(obtenido)
    return esperado == obtenido


def main():
    herramientas, tablas = cargar()
    pedidos = json.loads(PEDIDOS.read_text(encoding="utf-8"))["pedidos"]
    contextos = {"datos": {"id": "tabla", "type": "DATOS", "label": "clientes_demo.csv"},
                 "documento": {"id": "doc", "type": "DOCUMENTO", "label": "un documento"}, None: None}
    jev.proponer("calentar el modelo", None, herramientas, tablas)

    confusion = Counter()
    herr = Counter()
    params_ok = params_total = 0
    fallas = []
    t0 = time.time()
    sin_herramienta = Counter()
    for p in pedidos:
        r = jev.proponer(p["pedido"], contextos[p.get("contexto")], herramientas, tablas)
        camino = r["eleccion_camino"]
        if p["camino"] == jev.HERRAMIENTA and p.get("herramienta") is None:
            # Nada de la navaja sirve: bien si no elige ninguna (pregunta o responde la biblioteca).
            eligio = (r.get("herramienta") or {}).get("eleccion")
            sin_herramienta["bien" if not eligio else "mal"] += 1
            if eligio:
                fallas.append(f"{p['id']} eligió {eligio} y ninguna sirve — {p['pedido']}")
            continue
        confusion[(p["camino"], camino)] += 1
        if camino != p["camino"]:
            fallas.append(f"{p['id']} camino: esperaba {p['camino']}, eligió {camino} — {p['pedido']}")
            continue
        if p["camino"] != jev.HERRAMIENTA:
            continue
        d = r.get("herramienta") or {}
        top3 = [o["clave"] for o in d.get("opciones", [])[:3]]
        herr["top-3"] += p["herramienta"] in top3
        if d.get("eleccion") is None:
            herr["pregunta"] += 1
            fallas.append(f"{p['id']} preguntó entre {top3} — {p['pedido']}")
            continue
        if d["eleccion"] != p["herramienta"]:
            herr["error"] += 1
            fallas.append(f"{p['id']} herramienta: esperaba {p['herramienta']}, eligió {d['eleccion']} — {p['pedido']}")
            continue
        herr["acierto"] += 1
        params_total += 1
        malos = {k: r["parametros"].get(k) for k, v in (p.get("parametros") or {}).items()
                 if not igual(v, r["parametros"].get(k))}
        faltan = [f["nombre"] for f in r.get("faltan") or []]
        if malos or faltan:
            fallas.append(f"{p['id']} parámetros: esperaba {p.get('parametros')}, obtuvo {malos or ''}"
                          f"{' y pregunta ' + str(faltan) if faltan else ''} — {p['pedido']}")
        else:
            params_ok += 1
    ms = 1000 * (time.time() - t0) / len(pedidos)

    caminos = [jev.BIBLIOTECA, jev.HERRAMIENTA, jev.GRAFO]
    total = sum(confusion.values())
    bien = sum(confusion[(c, c)] for c in caminos)
    n_herr = sum(1 for p in pedidos if p["camino"] == jev.HERRAMIENTA and p.get("herramienta"))
    print(f"{total} pedidos · {len(herramientas)} herramientas · {ms:.0f} ms por pedido\n")
    print(f"Camino: {bien}/{total} ({bien / total:.0%})")
    print(f"{'esperado ↓ / elegido →':<24}" + "".join(f"{c:>13}" for c in caminos))
    for e in caminos:
        print(f"{e:<24}" + "".join(f"{confusion[(e, c)]:>13}" for c in caminos))
    llegaron = herr["acierto"] + herr["pregunta"] + herr["error"]
    print(f"\nHerramienta ({llegaron} de {n_herr} pedidos de herramienta con el camino bien):")
    print(f"  acierto {herr['acierto']} · pregunta {herr['pregunta']} · error {herr['error']} · "
          f"correcta en el top-3 {herr['top-3']}")
    print(f"Parámetros: {params_ok}/{params_total} con todos los esperados bien")
    if sin_herramienta:
        print(f"Pedidos para los que ninguna herramienta sirve: {sin_herramienta['bien']}/"
              f"{sum(sin_herramienta.values())} sin forzar una")
    print("\nFallas:")
    for f in fallas or ["—"]:
        print(f"  {f}")


if __name__ == "__main__":
    main()
