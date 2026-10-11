"""Reindexado completo al cambiar el modelo de embeddings.

Los vectores de un modelo no se comparan con los de otro: al cambiarlo hay que
recalcular TODOS (documentos y fragmentos), reentrenar el mapa 3D y rehacer lo que se
apoya en ellos (relaciones, piso de similitud medido y temas). Lo que decidió una persona
(aristas a mano, revisiones) sobrevive: lo conserva el recálculo de relaciones.

El modelo con el que se calcularon los vectores queda anotado en graph_stats
("embeddings"), así se puede ver si la base está al día con el código.
"""
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent.resolve()
CACHE = BASE / "backups" / "cache_e5" / "fragmentos_e5.npz"


def modelo_de_la_base(session) -> str | None:
    from database.models import GraphStat
    fila = session.query(GraphStat).filter(GraphStat.key == "embeddings").one_or_none()
    return (fila.value or {}).get("modelo") if fila and isinstance(fila.value, dict) else None


def anotar_modelo(session, modelo: str, **extra):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from database.models import GraphStat
    valor = {"modelo": modelo, **extra, "calculado_en": datetime.now(timezone.utc).isoformat()}
    session.execute(pg_insert(GraphStat).values(key="embeddings", value=valor)
                    .on_conflict_do_update(index_elements=["key"], set_={"value": valor}))


def reindexar(avisar=print) -> dict:
    from sqlalchemy import text, update
    from database.connection import get_sync_session
    from database.models import Chunk, Document, Node
    from processor import EMBED_MODEL_NAME, embed_pasajes, texto_de_documento, texto_de_fragmento
    import embeddings_engine

    with get_sync_session() as s:
        nodos = s.query(Node).filter(Node.is_centroid == False).all()
        con_texto = [n for n in nodos if n.label]
        avisar(f"documentos: {len(con_texto)}")
        vecs = embed_pasajes([texto_de_documento({"label": n.label, "desc": n.desc, "fragmento": n.fragmento,
                                                  "conceptos": n.conceptos or []}) for n in con_texto])
        for n, v in zip(con_texto, vecs):
            n.embedding = v.tolist()
        s.commit()

        filas = (s.query(Chunk.id, Chunk.content, Node.label)
                 .join(Document, Document.id == Chunk.document_id)
                 .join(Node, Node.id == Document.node_id).order_by(Chunk.id).all())
        ids = [f[0] for f in filas]
        reusados = None
        if CACHE.exists() and "e5" in EMBED_MODEL_NAME.lower():
            cache = np.load(CACHE, allow_pickle=True)
            por_id = dict(zip(cache["ids"], cache["vec"]))
            if all(i in por_id for i in ids):
                reusados = [por_id[i] for i in ids]
        avisar(f"fragmentos: {len(ids)} ({'desde la medición' if reusados is not None else 'calculando'})")
        if reusados is None:
            reusados = []
            for i in range(0, len(filas), 512):
                lote = filas[i:i + 512]
                reusados.extend(embed_pasajes([texto_de_fragmento(f[2], f[1]) for f in lote]))
                avisar(f"  {min(i + 512, len(filas))}/{len(filas)}")
        for i in range(0, len(ids), 1000):
            s.execute(update(Chunk), [{"id": cid, "embedding": np.asarray(v).tolist()}
                                      for cid, v in zip(ids[i:i + 1000], reusados[i:i + 1000])])
        anotar_modelo(s, EMBED_MODEL_NAME, documentos=len(con_texto), fragmentos=len(ids))
        s.commit()
        # Reescribir todos los vectores deja el grafo HNSW lleno de entradas muertas.
        s.execute(text("REINDEX INDEX nodes_embedding_hnsw"))
        s.execute(text("REINDEX INDEX chunks_embedding_hnsw"))
        s.commit()

    # El mapa 3D se aprendió sobre los vectores viejos: sin el modelo guardado, el
    # próximo cálculo lo reentrena con todos los documentos.
    if embeddings_engine.UMAP_MODEL_PATH.exists():
        embeddings_engine.UMAP_MODEL_PATH.unlink()

    import main
    avisar("relaciones…")
    main._recompute_edges_background()
    avisar("temas…")
    temas = embeddings_engine.main(reagrupar=True)
    return {"modelo": EMBED_MODEL_NAME, "documentos": len(con_texto), "fragmentos": len(ids), "temas": temas}


if __name__ == "__main__":
    print(reindexar())
