"""Genera frontend/public/demo-graph.json: snapshot del grafo + miniaturas inline
(data URLs) para el demo estatico en GitHub Pages (sin backend)."""
import base64
import json
import urllib.request
import urllib.parse
from pathlib import Path

API = "http://localhost:8000"
OUT = Path("frontend/public/demo-graph.json")
OUT.parent.mkdir(parents=True, exist_ok=True)


def get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


data = json.loads(get(f"{API}/api/graph"))
nodos = data.get("nodos", [])
rels = data.get("relaciones", [])

inlined = 0
for n in nodos:
    n.pop("rich_html", None)  # pesado y no se usa para mostrar
    nid = n.get("id")
    if not nid:
        continue
    try:
        png = get(f"{API}/thumb/{urllib.parse.quote(str(nid))}", timeout=30)
        if png and len(png) > 200:
            n["thumb_data"] = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
            inlined += 1
    except Exception:
        pass  # nodo sin miniatura -> tarjeta neutra en el demo

OUT.write_text(json.dumps({"nodos": nodos, "relaciones": rels}, ensure_ascii=False), encoding="utf-8")
size_kb = OUT.stat().st_size / 1024
print(f"OK -> {OUT}  ({len(nodos)} nodos, {len(rels)} relaciones, {inlined} miniaturas inline, {size_kb:.0f} KB)")
