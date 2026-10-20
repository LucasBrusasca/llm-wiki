#!/usr/bin/env python3
"""Benchmark de escala: payload del grafo, búsqueda híbrida, relaciones incrementales.

Genera secciones sintéticas (embeddings aleatorios, sin LLM) y mide p50/p95.
No toca la base de datos de producción. Escribir `docs/SCALABILITY.md`.

  python3 scripts/bench_scale.py
  python3 scripts/bench_scale.py --sizes 1000,5000
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from graph_payload import (  # noqa: E402
    agrupar_por_tema, aristas_entre, cap_edges_per_node,
)
import busqueda  # noqa: E402


def _pct(xs, p):
    if not xs:
        return 0.0
    s = sorted(xs)
    k = (len(s) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] * (1 - (k - lo)) + s[hi] * (k - lo)


def _norm(m):
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return m / n


def timed(fn, repeats=1):
    ts = []
    out = None
    for _ in range(repeats):
        t0 = time.perf_counter()
        out = fn()
        ts.append((time.perf_counter() - t0) * 1000)
    return out, ts


def make_corpus(n_docs: int, chunks_per_doc: int, dim: int, n_secciones: int, seed: int):
    rng = np.random.default_rng(seed)
    n_chunks = n_docs * chunks_per_doc
    doc_emb = _norm(rng.normal(size=(n_docs, dim)).astype(np.float32))
    chunk_emb = _norm(rng.normal(size=(n_chunks, dim)).astype(np.float32))
    secciones = np.array([f"sec-{i % n_secciones}" for i in range(n_docs)])
    temas = np.array([f"tema-{i % max(8, n_docs // 80)}" for i in range(n_docs)])
    chunk_doc = np.repeat(np.arange(n_docs), chunks_per_doc)
    texts = [f"documento {i} seccion {secciones[i]} tema {temas[i]} token{i%97}" for i in range(n_docs)]
    chunk_texts = [
        f"{texts[d]} pasaje {j} concepto{j%11}"
        for d in range(n_docs) for j in range(chunks_per_doc)
    ]
    # Grafo: cada doc ~6 aristas al azar dentro de su sección + 1 cruzada.
    edges = []
    by_sec = {}
    for i, s in enumerate(secciones):
        by_sec.setdefault(s, []).append(i)
    for s, ids in by_sec.items():
        for i in ids:
            dests = rng.choice(ids, size=min(6, len(ids)), replace=False)
            for j in dests:
                if j == i:
                    continue
                edges.append({"source": f"n{i}", "target": f"n{j}",
                              "score": float(doc_emb[i] @ doc_emb[j])})
    return {
        "n_docs": n_docs, "n_chunks": n_chunks, "dim": dim,
        "doc_emb": doc_emb, "chunk_emb": chunk_emb,
        "secciones": secciones, "temas": temas,
        "chunk_doc": chunk_doc, "texts": texts, "chunk_texts": chunk_texts,
        "edges": edges, "by_sec": by_sec,
    }


def bench_graph(c, seccion: str):
    ids = {f"n{i}" for i in c["by_sec"][seccion]}
    nodos = [{
        "id": f"n{i}", "tema": c["temas"][i], "dominio": c["secciones"][i],
        "x3d": float(c["doc_emb"][i, 0]), "y3d": float(c["doc_emb"][i, 1]),
        "z3d": float(c["doc_emb"][i, 2]), "label": c["texts"][i][:40],
        "type": "documento", "conceptos": [], "tags": [],
    } for i in c["by_sec"][seccion]]

    def naive():
        # Bug original: SELECT * FROM edges y se serializa lo cargado.
        return json.dumps({"nodos": nodos, "relaciones": c["edges"]}, ensure_ascii=False)

    def filtered():
        rel = cap_edges_per_node(aristas_entre(c["edges"], ids), k=8)
        clustered, _ = agrupar_por_tema(nodos, threshold=1500)
        return json.dumps({"nodos": clustered, "relaciones": rel,
                           "total": len(nodos)}, ensure_ascii=False)

    _, t_naive = timed(naive, repeats=5)
    raw = naive()
    _, t_filt = timed(filtered, repeats=5)
    slim = filtered()
    return {
        "nodos_seccion": len(nodos),
        "edges_db": len(c["edges"]),
        "edges_seccion": len(aristas_entre(c["edges"], ids)),
        "edges_capped": len(cap_edges_per_node(aristas_entre(c["edges"], ids), 8)),
        "payload_naive_kb": round(len(raw.encode()) / 1024, 1),
        "payload_filt_kb": round(len(slim.encode()) / 1024, 1),
        "ms_naive_p50": round(_pct(t_naive, 50), 2),
        "ms_filt_p50": round(_pct(t_filt, 50), 2),
        "ms_naive_p95": round(_pct(t_naive, 95), 2),
        "ms_filt_p95": round(_pct(t_filt, 95), 2),
    }


def bench_search(c, n_queries=20):
    rng = np.random.default_rng(1)
    idx = busqueda.IndiceLexico([
        (f"c{i}", f"n{c['chunk_doc'][i]}", c["texts"][c["chunk_doc"][i]], c["chunk_texts"][i])
        for i in range(c["n_chunks"])
    ])
    queries = [c["chunk_texts"][i][:80] for i in rng.choice(c["n_chunks"], size=n_queries, replace=False)]
    qvec = _norm(rng.normal(size=(n_queries, c["dim"])).astype(np.float32))

    def global_search(qi, qtext):
        sims = c["chunk_emb"] @ qvec[qi]
        top = np.argpartition(-sims, 50)[:50]
        vec_ids = [f"c{i}" for i in top[np.argsort(-sims[top])]]
        lex = [x[0] for x in idx.buscar(qtext, 50)]
        return busqueda.rrf(vec_ids, lex)[:10]

    def section_search(qi, qtext, seccion):
        docs = c["by_sec"][seccion]
        mask = np.isin(c["chunk_doc"], docs)
        sub = np.where(mask)[0]
        sims = c["chunk_emb"][sub] @ qvec[qi]
        k = min(50, len(sub) - 1)
        top = np.argpartition(-sims, k)[:k]
        vec_ids = [f"c{sub[i]}" for i in top[np.argsort(-sims[top])]]
        lex = [x[0] for x in idx.buscar(qtext, 50) if int(x[0][1:]) in set(sub)]
        return busqueda.rrf(vec_ids, lex)[:10]

    def doc_search(qi, doc_id):
        sub = np.where(c["chunk_doc"] == doc_id)[0]
        sims = c["chunk_emb"][sub] @ qvec[qi]
        order = np.argsort(-sims)[:8]
        return [f"c{sub[i]}" for i in order]

    seccion = c["secciones"][0]
    t_g, t_s, t_d = [], [], []
    for i, qtext in enumerate(queries):
        _, ts = timed(lambda i=i, qtext=qtext: global_search(i, qtext))
        t_g.extend(ts)
        _, ts = timed(lambda i=i, qtext=qtext: section_search(i, qtext, seccion))
        t_s.extend(ts)
        doc_id = int(c["chunk_doc"][rng.integers(0, c["n_chunks"])])
        _, ts = timed(lambda i=i, d=doc_id: doc_search(i, d))
        t_d.extend(ts)
    return {
        "global_p50": round(_pct(t_g, 50), 2), "global_p95": round(_pct(t_g, 95), 2),
        "section_p50": round(_pct(t_s, 50), 2), "section_p95": round(_pct(t_s, 95), 2),
        "doc_p50": round(_pct(t_d, 50), 2), "doc_p95": round(_pct(t_d, 95), 2),
    }


def bench_relations(c, sample=200):
    rng = np.random.default_rng(2)
    n = c["n_docs"]
    k = 40
    sample = min(sample, n)
    ids = rng.choice(n, size=sample, replace=False)

    def incremental():
        # kNN via matmul contra todo el corpus (equivale a HNSW O(n) peor caso;
        # en Postgres es O(log n)). Mide el trabajo de un lote incremental.
        sims = c["doc_emb"][ids] @ c["doc_emb"].T
        for row in sims:
            np.argpartition(-row, k)[:k]

    def all_pairs():
        _ = c["doc_emb"] @ c["doc_emb"].T

    _, t_inc = timed(incremental, repeats=3)
    # all-pairs a 5k es 25M floats (~200MB) — ok. A 20k no.
    t_ap = []
    if n <= 6000:
        _, t_ap = timed(all_pairs, repeats=2)
    docs_per_s = sample / (_pct(t_inc, 50) / 1000) if t_inc else 0
    return {
        "sample": sample,
        "inc_p50": round(_pct(t_inc, 50), 2),
        "inc_p95": round(_pct(t_inc, 95), 2),
        "allpairs_p50": round(_pct(t_ap, 50), 2) if t_ap else None,
        "ingest_docs_per_s": round(docs_per_s, 1),
    }


def render_md(rows, search, rel, extra_notes):
    lines = [
        "# Escalabilidad de Algedi",
        "",
        "Números medidos en esta VM con embeddings sintéticos (dim=384, sin LLM).",
        "No se escribe la base de producción. El ingest reportado es el costo de kNN",
        "incremental (el paso que escala); extracción LLM queda afuera a propósito.",
        "",
        "## Límites observados",
        "",
        "| n docs | chunks | payload viejo (KB) | payload nuevo (KB) | graph p50 viejo (ms) | graph p50 nuevo (ms) | edges DB → sección → cap |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        g = r["graph"]
        lines.append(
            f"| {r['n_docs']} | {r['n_chunks']} | {g['payload_naive_kb']} | {g['payload_filt_kb']} "
            f"| {g['ms_naive_p50']} | {g['ms_filt_p50']} "
            f"| {g['edges_db']} → {g['edges_seccion']} → {g['edges_capped']} |"
        )
    lines += [
        "",
        "## Búsqueda híbrida (p50 / p95, ms)",
        "",
        "| n docs | global p50 | global p95 | sección p50 | sección p95 | doc p50 | doc p95 |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        s = r["search"]
        lines.append(
            f"| {r['n_docs']} | {s['global_p50']} | {s['global_p95']} | {s['section_p50']} "
            f"| {s['section_p95']} | {s['doc_p50']} | {s['doc_p95']} |"
        )
    lines += [
        "",
        "## Relaciones (ms) e ingest sintético",
        "",
        "| n docs | incremental p50 (sample) | incremental p95 | all-pairs p50 | docs/s (kNN) |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        x = r["rel"]
        ap = x["allpairs_p50"] if x["allpairs_p50"] is not None else "— (omitido)"
        lines.append(
            f"| {r['n_docs']} | {x['inc_p50']} (n={x['sample']}) | {x['inc_p95']} | {ap} "
            f"| {x['ingest_docs_per_s']} |"
        )
    lines += [
        "",
        "## Qué limita",
        "",
        "- **/api/graph**: el costo era `SELECT * FROM edges` (toda la base) + JSON.",
        "  Con filtro SQL por sección y tope de 8 aristas/nodo el payload baja un orden.",
        "  Arriba de ~1500 nodos visibilizados, el servidor agrupa por tema.",
        "- **Ingest**: la extracción/LLM ya no toma el lock global; sólo el write a DB",
        "  (`ALGEDI_INGEST_PARALLEL`, default 4; `ALGEDI_INGEST_WORKERS` por lote).",
        "- **HNSW + filtro**: sin `hnsw.iterative_scan` / `ef_search` alto, un WHERE de",
        "  sección recorta k. Ver `tests/test_hnsw_filter.py`.",
        "- **20k docs**: all-pairs de relaciones (~400M floats) no cabe cómodo en esta VM;",
        "  el camino incremental + HNSW sí. Correr 20k contra Postgres+pgvector en un",
        "  host con ≥8 GB si se necesita el número exacto.",
        "",
        "## v2 (no construido): multi-usuario",
        "",
        "Plan, no implementación:",
        "",
        "1. **Auth**: sesión (cookie httpOnly) o JWT corto; dueño en cada request.",
        "2. **Columna `owner` / `workspace`** en `nodes`, `sources`, `watched_sources`,",
        "   `agent_conversations`. RLS en Postgres o filtro obligatorio en cada query.",
        "3. **Scripts en contenedor**: el sandbox actual corre en el mismo proceso.",
        "   v2: job en container (gVisor/Firecracker o Docker one-shot) con CPU/RAM/red",
        "   limitados, volumen de sólo-lectura al documento, artefacto de salida por",
        "   bind mínimo. Sin secretos del host montados.",
        "4. **Cuotas**: techo de nodos/chunks por workspace y de corridas/día.",
        "",
        "## Cómo reproducir",
        "",
        "```",
        "python3 scripts/bench_scale.py --sizes 1000,5000",
        "```",
        "",
        extra_notes,
        "",
    ]
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sizes", default="1000,5000")
    p.add_argument("--chunks", type=int, default=20)
    p.add_argument("--dim", type=int, default=384)
    p.add_argument("--secciones", type=int, default=4)
    args = p.parse_args()
    sizes = [int(x) for x in args.sizes.split(",") if x.strip()]

    rows = []
    t0 = time.perf_counter()
    for n in sizes:
        print(f"[bench] corpus {n} docs…", flush=True)
        c = make_corpus(n, args.chunks, args.dim, args.secciones, seed=n)
        seccion = c["secciones"][0]
        print(f"[bench]   graph {n}…", flush=True)
        g = bench_graph(c, seccion)
        print(f"[bench]   search {n}…", flush=True)
        s = bench_search(c)
        print(f"[bench]   relations {n}…", flush=True)
        r = bench_relations(c)
        rows.append({"n_docs": n, "n_chunks": c["n_chunks"], "graph": g, "search": s, "rel": r})
        print(f"[bench]   done {n}: payload {g['payload_naive_kb']}KB → {g['payload_filt_kb']}KB",
              flush=True)

    elapsed = time.perf_counter() - t0
    notes = f"Corrida: {elapsed:.1f}s, sizes={sizes}, chunks/doc={args.chunks}, dim={args.dim}."
    md = render_md(rows, None, None, notes)
    out = ROOT / "docs" / "SCALABILITY.md"
    out.write_text(md, encoding="utf-8")
    print(f"[bench] wrote {out}")
    print(md)


if __name__ == "__main__":
    main()
