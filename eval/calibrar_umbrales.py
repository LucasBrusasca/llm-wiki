"""Traslada los umbrales de similitud de MiniLM a multilingual-e5-small, con datos.

Cada modelo usa su propia escala de coseno: con e5 hasta dos textos sin relación dan
~0.75, así que 0.62 (el piso de MiniLM) uniría todo con todo. No se adivina el número
nuevo: se mide.

- Umbrales entre DOCUMENTOS (piso de relación, piso con conceptos, «complementa»):
  mismo PERCENTIL de los pares reales de la biblioteca. Si 0.62 dejaba arriba al 5 % de
  los pares con MiniLM, el piso e5 es el valor que deja arriba al mismo 5 %.
- Umbrales del AGENTE (citar, abstenerse): mapa lineal anclado en dos grupos de preguntas
  medidos con los dos modelos: con respaldo (eval/preguntas_busqueda_v1.json) y sin
  respaldo (preguntas fuera de tema, abajo). El umbral queda en la misma posición
  relativa entre ambos grupos.

Corre ANTES del reindexado (lee los vectores MiniLM que todavía están en la base).
Uso: python eval/calibrar_umbrales.py  → imprime y guarda eval/calibracion_e5.json
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from sqlalchemy import create_engine, text

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
CACHE = BASE / "backups" / "cache_e5" / "fragmentos_e5.npz"
E5 = "intfloat/multilingual-e5-small"

FUERA_DE_TEMA = [
    "¿Cómo se prepara un asado a la parrilla?",
    "¿Quién ganó el Mundial de fútbol de 1986?",
    "Receta de empanadas tucumanas",
    "¿Cómo le cambio el aceite al auto?",
    "¿Cuál es la capital de Mongolia?",
    "¿Cómo se cuida una planta de potus?",
    "¿Cómo se juega al truco?",
    "Síntomas del dengue y cuándo ir al médico",
    "¿Cuántos huesos tiene el cuerpo humano?",
    "Historia de la Revolución de Mayo",
    "¿Cómo tejer una bufanda con dos agujas?",
    "Mejores playas de Brasil para ir de vacaciones",
    "¿Cómo arreglo una canilla que gotea?",
    "¿Qué raza de perro es mejor para un departamento?",
    "¿Cómo se hace el dulce de leche casero?",
]

# Umbrales vigentes con MiniLM (processor.py / main.py).
DOC = {"piso_relacion": 0.62, "piso_conceptos": 0.52, "complementa": 0.75}
AGENTE = {"cita": 0.62, "veto": 0.28}


def unit(m):
    m = np.asarray(m, dtype=np.float32)
    return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


def pares(v):
    s = v @ v.T
    return s[np.triu_indices(len(v), k=1)]


def main():
    from sentence_transformers import SentenceTransformer
    from processor import texto_de_documento

    eng = create_engine(os.environ["DATABASE_URL_SYNC"])
    with eng.connect() as c:
        nodos = c.execute(text("""
            SELECT id, label, coalesce("desc", ''), coalesce(fragmento, ''), conceptos, embedding::text, dominio
            FROM nodes WHERE NOT coalesce(is_centroid, false) AND NOT coalesce(is_issue, false)
              AND embedding IS NOT NULL ORDER BY id""")).all()
        frags = c.execute(text("""
            SELECT ch.id, d.node_id, ch.embedding::text
            FROM chunks ch JOIN documents d ON d.id = ch.document_id JOIN nodes n ON n.id = d.node_id
            WHERE ch.embedding IS NOT NULL AND NOT coalesce(n.is_issue, false) ORDER BY ch.id""")).all()

    minilm_docs = unit([json.loads(r[5]) for r in nodos])
    minilm_frags = unit([json.loads(f[2]) for f in frags])
    cache = np.load(CACHE, allow_pickle=True)
    por_id = dict(zip(cache["ids"], cache["vec"]))
    e5_frags = unit([por_id[f[0]] for f in frags])

    minilm = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    e5 = SentenceTransformer(E5)
    e5.max_seq_length = 512
    e5_docs = e5.encode(["passage: " + texto_de_documento(
        {"label": r[1], "desc": r[2], "fragmento": r[3], "conceptos": r[4] or []}) for r in nodos],
        batch_size=16, normalize_embeddings=True, show_progress_bar=False)

    # ── Documentos: mismo percentil ─────────────────────────────────────────────
    pm, pe = pares(minilm_docs), pares(e5_docs)
    print(f"pares de documentos: {len(pm)}")
    for nombre, a in (("MiniLM", pm), ("e5", pe)):
        print(f"  {nombre:<7} p50={np.percentile(a, 50):.3f} p90={np.percentile(a, 90):.3f} "
              f"p95={np.percentile(a, 95):.3f} p99={np.percentile(a, 99):.3f}")
    nuevos = {}
    for k, t in DOC.items():
        q = float((pm < t).mean())
        nuevos[k] = round(float(np.quantile(pe, q)), 3)
        print(f"  {k:<15} MiniLM {t:.2f} (deja arriba {100 * (1 - q):.1f} % de los pares) → e5 {nuevos[k]:.3f}")

    # ── Agente: preguntas con y sin respaldo ────────────────────────────────────
    preguntas = [p["pregunta"] for p in json.loads(
        (BASE / "eval" / "preguntas_busqueda_v1.json").read_text(encoding="utf-8"))["preguntas"]]

    def mejores(modelo, frags_m, qs, pre=""):
        q = modelo.encode([pre + x for x in qs], normalize_embeddings=True, show_progress_bar=False)
        return (q @ frags_m.T).max(axis=1)

    con_m, sin_m = mejores(minilm, minilm_frags, preguntas), mejores(minilm, minilm_frags, FUERA_DE_TEMA)
    con_e, sin_e = mejores(e5, e5_frags, preguntas, "query: "), mejores(e5, e5_frags, FUERA_DE_TEMA, "query: ")
    print("\nmejor pasaje por pregunta (coseno):")
    for nombre, con, sin in (("MiniLM", con_m, sin_m), ("e5", con_e, sin_e)):
        print(f"  {nombre:<7} con respaldo {con.min():.3f}–{con.max():.3f} (media {con.mean():.3f}) · "
              f"sin respaldo {sin.min():.3f}–{sin.max():.3f} (media {sin.mean():.3f})")
    # Mapa lineal anclado en las medias de los dos grupos.
    escala = (con_e.mean() - sin_e.mean()) / (con_m.mean() - sin_m.mean())
    for k, t in AGENTE.items():
        nuevos[k] = round(float(sin_e.mean() + (t - sin_m.mean()) * escala), 3)
        print(f"  {k:<15} MiniLM {t:.2f} → e5 {nuevos[k]:.3f}")
    for nombre, con, sin, t in (("MiniLM", con_m, sin_m, AGENTE["cita"]), ("e5", con_e, sin_e, nuevos["cita"])):
        print(f"  {nombre:<7} con el umbral de cita {t:.3f}: cita {int((con >= t).sum())}/{len(con)} con respaldo, "
              f"{int((sin >= t).sum())}/{len(sin)} fuera de tema")

    # ── El caso que preguntó Lucas: el libro de ML en finanzas ──────────────────
    ids = [r[0] for r in nodos]
    etiquetas = {r[0]: (r[1], r[6]) for r in nodos}
    libro = next((i for i, r in enumerate(nodos) if (r[1] or "").lower().startswith("overview of the book")), None)
    if libro is not None:
        for nombre, v in (("MiniLM", minilm_docs), ("e5", e5_docs)):
            s = v @ v[libro]
            orden = [j for j in np.argsort(-s) if j != libro][:8]
            print(f"\nvecinos de «{nodos[libro][1]}» con {nombre}:")
            for j in orden:
                lab, dom = etiquetas[ids[j]]
                print(f"  {s[j]:.3f}  [{dom}] {lab}")

    salida = BASE / "eval" / "calibracion_e5.json"
    salida.write_text(json.dumps({
        "modelo": E5, "desde": "paraphrase-multilingual-MiniLM-L12-v2", "umbrales": nuevos,
        "pares_documentos": len(pm), "preguntas_con_respaldo": len(preguntas),
        "preguntas_fuera_de_tema": len(FUERA_DE_TEMA),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n→ {salida.relative_to(BASE)}")


if __name__ == "__main__":
    main()
