import json
from pathlib import Path

BASE = Path(__file__).parent.resolve()
data = json.loads((BASE / "nodes_generated.json").read_text(encoding="utf-8"))
pdfs = sorted((BASE / "uploads").glob("*.pdf"))

# Semantic mapping: fragment of node label -> fragment of PDF filename
MAPPING = [
    ("Infoxic",      "Lost in the Middle"),
    ("Motor",        "Dense Passage Retrieval"),
    ("Limitaci",     "Seven Failure Points"),
    ("Ingesta",      "Agentic Retrieval-Augmented Generation_ A Survey on Agentic RAG.pdf"),
    ("Estructur",    "Modular RAG"),
    ("Orquest",      "AutoGen"),
    ("Second Brain", "A Comprehensive Survey"),
    ("Transfor",     "Medicin_Inteligente"),
]

def normalize(s):
    for a, b in [("ó","o"),("ú","u"),("é","e"),("í","i"),("á","a"),("ñ","n")]:
        s = s.replace(a, b).replace(a.upper(), b.upper())
    return s.lower()

def find_pdf(hint):
    for p in pdfs:
        if normalize(hint[:15]) in normalize(p.name):
            return p
    return None

used_paths = set()
for node in data["nodos"]:
    if node.get("fuente") == "pdf" and not node.get("fuente_path"):
        label_norm = normalize(node["label"])
        matched = None
        for key, hint in MAPPING:
            if normalize(key) in label_norm:
                matched = find_pdf(hint)
                break
        if not matched:
            # fallback: first unused PDF
            for p in pdfs:
                sp = str(p).replace("\\", "/")
                if sp not in used_paths:
                    matched = p
                    break
        if matched:
            sp = str(matched).replace("\\", "/")
            node["fuente_path"] = sp
            node["fuente_label"] = matched.stem[:50]
            used_paths.add(sp)
            print(f"  {node['label'][:40]:40} -> {matched.name[:55]}")
        else:
            print(f"  NO MATCH: {node['label']}")

(BASE / "nodes_generated.json").write_text(
    json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("\nGuardado. Recargá el grafo.")
