"""Mide la búsqueda de documentos con preguntas reales (eval/preguntas_busqueda_v1.json).

Sólo lectura: no escribe en la base. Compara, a nivel DOCUMENTO (lo que importa para el
buscador y el agente):
  A. base · documentos     los vectores que ya están en la base (el modelo de processor.py)
  B. base · fragmentos     ídem, fragmentos
  C. e5 · documentos       multilingual-e5-small, 512 tokens, con prefijos query:/passage:
  D. e5 · fragmentos       ídem sobre «título + fragmento»
  E. BM25 · fragmentos     palabras (sin acentos salvo ñ, sin stopwords comunes)
  F. híbrido D+E           RRF k=60 (como multi-rag-energy-ar)
  G. híbrido C+D+E         RRF k=60
  H-K. variantes de G      el documento entero con más peso que sus fragmentos
Métricas: acierto@1, acierto@5, recall@10 (parte de los relevantes en el top 10) y MRR.

Uso (en el contenedor del backend):  python eval/evaluar_busqueda.py
Los vectores e5 de los fragmentos se guardan en backups/cache_e5/ para reusarlos.
"""
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from sqlalchemy import create_engine, text

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
PREGUNTAS = BASE / "eval" / "preguntas_busqueda_v1.json"
CACHE = BASE / "backups" / "cache_e5"
E5 = "intfloat/multilingual-e5-small"

from busqueda import BM25, rrf  # noqa: E402


def por_documento(puntajes_frag, frag_nodo):
    """Ranking de documentos por su MEJOR fragmento."""
    mejor = {}
    for i, s in puntajes_frag.items():
        nid = frag_nodo[i]
        if s > mejor.get(nid, -1e9):
            mejor[nid] = s
    return [nid for nid, _ in sorted(mejor.items(), key=lambda x: -x[1])]


def metricas(ranking, relevantes):
    rel = set(relevantes)
    primero = next((i for i, nid in enumerate(ranking) if nid in rel), None)
    return {
        "acierto@1": float(primero == 0),
        "acierto@5": float(primero is not None and primero < 5),
        "recall@10": len(rel & set(ranking[:10])) / len(rel),
        "mrr": 0.0 if primero is None else 1.0 / (primero + 1),
    }


def main():
    from sentence_transformers import SentenceTransformer
    from processor import embed_consulta

    preguntas = json.loads(PREGUNTAS.read_text(encoding="utf-8"))["preguntas"]
    eng = create_engine(os.environ["DATABASE_URL_SYNC"])
    with eng.connect() as c:
        nodos = c.execute(text("""
            SELECT id, label, coalesce("desc", ''), coalesce(fragmento, ''), conceptos, embedding::text
            FROM nodes WHERE NOT coalesce(is_centroid, false) AND NOT coalesce(is_issue, false)
              AND embedding IS NOT NULL ORDER BY id""")).all()
        frags = c.execute(text("""
            SELECT ch.id, d.node_id, n.label, ch.content, ch.embedding::text
            FROM chunks ch JOIN documents d ON d.id = ch.document_id JOIN nodes n ON n.id = d.node_id
            WHERE ch.embedding IS NOT NULL AND NOT coalesce(n.is_issue, false) ORDER BY ch.id""")).all()
    ids_nodo = [r[0] for r in nodos]
    validos = set(ids_nodo)
    frags = [f for f in frags if f[1] in validos]
    frag_nodo = [f[1] for f in frags]
    print(f"{len(ids_nodo)} documentos · {len(frags)} fragmentos · {len(preguntas)} preguntas")
    faltan = sorted({r for p in preguntas for r in p["relevantes"]} - validos)
    if faltan:
        print("relevantes que no existen (revisar):", faltan)

    def unit(m):
        m = np.asarray(m, dtype=np.float32)
        return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)

    # Lo que está en la base.
    A_docs = unit([json.loads(r[5]) for r in nodos])
    B_frags = unit([json.loads(f[4]) for f in frags])

    # e5: documentos y fragmentos (con caché).
    e5 = SentenceTransformer(E5)
    e5.max_seq_length = 512
    textos_doc = [f"passage: {r[1]}. {r[2]}. {r[3]}. {', '.join(r[4] or [])}" for r in nodos]
    t0 = time.time()
    C_docs = e5.encode(textos_doc, batch_size=16, normalize_embeddings=True, show_progress_bar=False)
    print(f"e5 documentos: {time.time() - t0:.0f} s")
    CACHE.mkdir(parents=True, exist_ok=True)
    cache = CACHE / "fragmentos_e5.npz"
    ids_frag = [f[0] for f in frags]
    if cache.exists() and list(np.load(cache, allow_pickle=True)["ids"]) == ids_frag:
        D_frags = np.load(cache, allow_pickle=True)["vec"]
        print("e5 fragmentos: desde la caché")
    else:
        t0 = time.time()
        D_frags = e5.encode([f"passage: {f[2]}\n{f[3]}" for f in frags], batch_size=32,
                            normalize_embeddings=True, show_progress_bar=False)
        dur = time.time() - t0
        print(f"e5 fragmentos: {dur:.0f} s ({len(frags) / dur:.1f} fragmentos/s)")
        np.savez_compressed(cache, ids=np.array(ids_frag, dtype=object), vec=D_frags)

    t0 = time.time()
    bm25 = BM25([f"{f[2]}\n{f[3]}" for f in frags])
    print(f"índice BM25: {time.time() - t0:.1f} s")

    metodos = defaultdict(list)
    tiempos = defaultdict(float)
    fallas = defaultdict(list)
    for p in preguntas:
        q = p["pregunta"]
        t = time.time(); qm = np.asarray(embed_consulta(q), dtype=np.float32)
        A = [ids_nodo[i] for i in np.argsort(-(A_docs @ qm))]
        tiempos["A. base · documentos"] += time.time() - t
        t = time.time()
        B = por_documento(dict(enumerate(B_frags @ qm)), frag_nodo)
        tiempos["B. base · fragmentos"] += time.time() - t
        t = time.time(); qe = e5.encode([f"query: {q}"], normalize_embeddings=True)[0]
        C = [ids_nodo[i] for i in np.argsort(-(C_docs @ qe))]
        tiempos["C. e5 · documentos"] += time.time() - t
        t = time.time()
        D = por_documento(dict(enumerate(D_frags @ qe)), frag_nodo)
        tiempos["D. e5 · fragmentos"] += time.time() - t
        t = time.time()
        E = por_documento(bm25.puntuar(q), frag_nodo)
        tiempos["E. BM25 · fragmentos"] += time.time() - t
        rankings = {
            "A. base · documentos": A, "B. base · fragmentos": B, "C. e5 · documentos": C,
            "D. e5 · fragmentos": D, "E. BM25 · fragmentos": E,
            "F. híbrido e5 frag + BM25": rrf(D, E), "G. híbrido e5 doc + frag + BM25": rrf(C, D, E),
            # Variantes: el documento entero pesa más que sus fragmentos sueltos.
            "H. e5 doc + BM25": rrf(C, E),
            "I. e5 doc ×2 + frag + BM25": rrf(C, D, E, pesos=[2, 1, 1]),
            "J. e5 doc ×3 + frag + BM25": rrf(C, D, E, pesos=[3, 1, 1]),
            "K. e5 doc ×2 + BM25": rrf(C, E, pesos=[2, 1]),
        }
        for nombre, r in rankings.items():
            m = metricas(r, p["relevantes"])
            metodos[nombre].append(m)
            if not m["acierto@5"]:
                fallas[nombre].append(p["id"])

    print(f"\n{'método':<34} {'acierto@1':>9} {'acierto@5':>9} {'recall@10':>9} {'MRR':>6} {'ms/consulta':>11}")
    for nombre, ms in metodos.items():
        prom = {k: sum(m[k] for m in ms) / len(ms) for k in ms[0]}
        ms_q = 1000 * tiempos.get(nombre, 0) / len(preguntas)
        print(f"{nombre:<34} {prom['acierto@1']:>9.2f} {prom['acierto@5']:>9.2f} {prom['recall@10']:>9.2f} "
              f"{prom['mrr']:>6.2f} {ms_q:>11.0f}")
    print("\nsin acierto en el top 5:")
    for nombre in metodos:
        print(f"  {nombre:<34} {', '.join(fallas[nombre]) or '—'}")


if __name__ == "__main__":
    main()
