"""Helpers de payload del grafo: filtrar aristas, tope por nodo, clustering.

Puros (sin I/O) para poder testearlos y para que /api/graph no recorra toda la tabla
de edges en Python. El look del grafo no cambia: mismas relaciones, menos basura.
"""
from __future__ import annotations

import os
from collections import defaultdict

GRAPH_NODE_CAP = int(os.getenv("ALGEDI_GRAPH_NODE_CAP", "2000"))
GRAPH_CLUSTER_THRESHOLD = int(os.getenv("ALGEDI_GRAPH_CLUSTER_THRESHOLD", "1500"))
GRAPH_EDGES_PER_NODE = int(os.getenv("ALGEDI_GRAPH_EDGES_PER_NODE", "8"))
HNSW_EF_MULT = int(os.getenv("ALGEDI_HNSW_EF_MULT", "4"))


def _get(e, key, default=None):
    return e.get(key, default) if isinstance(e, dict) else getattr(e, key, default)


def aristas_entre(edges: list, node_ids: set, src="source", tgt="target") -> list:
    """Sólo aristas cuyos dos extremos están en `node_ids`."""
    return [e for e in edges if _get(e, src) in node_ids and _get(e, tgt) in node_ids]


def _extremos(e, src="source", tgt="target"):
    return _get(e, src), _get(e, tgt), _get(e, "score") or 0


def cap_edges_per_node(edges: list, k: int | None = None, src="source", tgt="target") -> list:
    """Deja como mucho `k` aristas incidentes por nodo, privilegiando score alto.

    Recorre de mayor a menor score y sólo agrega si AMBOS extremos todavía tienen
    cupo. Un hub deja de irradiar al llenar k; no se cuela por ser el único
    vínculo del otro lado.
    """
    k = GRAPH_EDGES_PER_NODE if k is None else k
    if k <= 0 or not edges:
        return []
    ranked = sorted(edges, key=lambda e: _extremos(e, src, tgt)[2], reverse=True)
    grado = defaultdict(int)
    out = []
    for e in ranked:
        s, t, _ = _extremos(e, src, tgt)
        if s is None or t is None or s == t:
            continue
        if grado[s] >= k or grado[t] >= k:
            continue
        out.append(e)
        grado[s] += 1
        grado[t] += 1
    return out


def clave_cluster(nodo: dict) -> str:
    tema = (nodo.get("tema") or "").strip()
    if tema:
        return tema
    c = nodo.get("cluster")
    if c is not None and c != -1:
        return f"cluster_{c}"
    return "sin_tema"


def agrupar_por_tema(nodos: list[dict], threshold: int | None = None) -> tuple[list[dict], bool]:
    """Si hay más nodos que el umbral, resume por tema/cluster (centroide 3D)."""
    threshold = GRAPH_CLUSTER_THRESHOLD if threshold is None else threshold
    if len(nodos) <= threshold:
        return nodos, False
    grupos: dict[str, list] = defaultdict(list)
    for n in nodos:
        grupos[clave_cluster(n)].append(n)
    out = []
    for key, members in grupos.items():
        n = len(members)
        xs = [m.get("x3d") or 0 for m in members]
        ys = [m.get("y3d") or 0 for m in members]
        zs = [m.get("z3d") or 0 for m in members]
        first = members[0]
        out.append({
            "id": f"cluster:{key}",
            "label": f"{key} ({n})",
            "type": "cluster",
            "is_cluster": True,
            "node_count": n,
            "tema": key,
            "cluster": -1,
            "dominio": first.get("dominio") or "personal",
            "x3d": sum(xs) / n,
            "y3d": sum(ys) / n,
            "z3d": sum(zs) / n,
            "conceptos": [],
            "tags": [],
            "desc": f"{n} documentos",
            "is_centroid": False,
            "is_issue": False,
        })
    return out, True


def hnsw_ef_search(k: int) -> int:
    """ef_search debe ser ≥ k; si no, HNSW recorta el resultado sin avisar."""
    return max(40, int(k) * max(1, HNSW_EF_MULT))


def hnsw_settings_sql(k: int) -> list[str]:
    """SET LOCAL para que un kNN filtrado (sección/doc) siga devolviendo k filas.

    `iterative_scan` (pgvector ≥ 0.8) sigue recorriendo el índice hasta reunir k
    vecinos que pasen el WHERE. Sin eso, HNSW busca k y DESPUÉS filtra: una
    sección chica devolvía 3 de 40.
    """
    return [
        f"SET LOCAL hnsw.ef_search = {hnsw_ef_search(k)}",
        "SET LOCAL hnsw.iterative_scan = 'relaxed_order'",
    ]


def sql_knn_nodos(*, seccion: str | None = None, exclude_id: bool = False) -> str:
    """kNN sobre nodes.embedding, con filtro de sección opcional (prefilter)."""
    wheres = [
        "embedding IS NOT NULL",
        "NOT COALESCE(is_centroid, false)",
        "NOT COALESCE(is_issue, false)",
    ]
    if seccion:
        wheres.append("dominio = :seccion")
    if exclude_id:
        wheres.append("id != :nid")
    return (
        "SELECT id, label, conceptos, dominio, "
        "1 - (embedding <=> CAST(:vec AS vector)) AS sim "
        "FROM nodes WHERE "
        + " AND ".join(wheres)
        + " ORDER BY embedding <=> CAST(:vec AS vector) LIMIT :lim"
    )


def sql_knn_chunks(*, seccion: str | None = None, node_id: bool = False) -> str:
    """kNN sobre chunks.embedding, filtrado por sección o por documento."""
    wheres = [
        "c.embedding IS NOT NULL",
        "NOT COALESCE(n.is_issue, false)",
    ]
    if seccion:
        wheres.append("n.dominio = :seccion")
    if node_id:
        wheres.append("d.node_id = :node_id")
    return (
        "SELECT c.id, n.id AS node_id, (c.embedding <=> CAST(:vec AS vector)) AS dist "
        "FROM chunks c "
        "JOIN documents d ON d.id = c.document_id "
        "JOIN nodes n ON n.id = d.node_id WHERE "
        + " AND ".join(wheres)
        + " ORDER BY dist LIMIT :lim"
    )
