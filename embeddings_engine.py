import json
import pickle
import numpy as np
from pathlib import Path

BASE = Path(__file__).parent.resolve()
UMAP_MODEL_PATH = BASE / "umap_model.pkl"


def main():
    from database.connection import get_sync_session
    from database.models import Node as NodeModel

    # ── Leer nodos desde DB ──
    with get_sync_session() as session:
        nodos_db = session.query(NodeModel).filter(
            NodeModel.embedding.isnot(None),
            NodeModel.is_centroid == False,
        ).all()

        if len(nodos_db) < 3:
            print(f"Solo {len(nodos_db)} nodos con embedding. "
                  f"Necesitás al menos 3 para calcular coordenadas.")
            return

        nodos = []
        for n in nodos_db:
            emb = n.embedding
            if hasattr(emb, "tolist"):
                emb = emb.tolist()
            nodos.append({
                "id":      n.id,
                "label":   n.label,
                "embedding": emb,
                "cluster": n.cluster if n.cluster is not None else -1,
                "x3d":     n.x3d,
                "y3d":     n.y3d,
                "z3d":     n.z3d,
            })

    nodos_con_emb = [n for n in nodos if n.get("embedding")]

    # Validar compatibilidad de embeddings (768d vs 384d)
    if nodos_con_emb and len(nodos_con_emb[0]["embedding"]) == 768:
        print("[!] Detectados embeddings de 768 dimensiones del modelo anterior.")
        print("  Eliminando modelo UMAP viejo y embeddings para forzar recálculo...")
        if UMAP_MODEL_PATH.exists():
            UMAP_MODEL_PATH.unlink()
            print("  ✓ Modelo UMAP local eliminado.")
        from processor import generar_embedding
        for n in nodos_con_emb:
            generar_embedding(n)
        print("  ✓ Listo. Re-generando embeddings con modelo nuevo...")
        nodos_con_emb = [n for n in nodos if n.get("embedding")]

    if len(nodos_con_emb) < 3:
        print(f"Solo {len(nodos_con_emb)} nodos con embedding. Necesitás al menos 3.")
        return

    # ── Pipeline UMAP/HDBSCAN existente — SIN CAMBIOS ──
    nodos_nuevos     = [n for n in nodos_con_emb if n.get("x3d") is None]
    nodos_existentes = [n for n in nodos_con_emb if n.get("x3d") is not None]

    import umap
    import hdbscan

    if not UMAP_MODEL_PATH.exists() or not nodos_existentes:
        # Primera ejecución: entrenar UMAP con todos los nodos
        print(f"Entrenando UMAP con {len(nodos_con_emb)} nodos...")
        embeddings = np.array([n["embedding"] for n in nodos_con_emb], dtype=np.float32)
        n_neighbors = min(15, len(nodos_con_emb) - 1)
        reducer = umap.UMAP(
            n_components=3, n_neighbors=n_neighbors,
            min_dist=0.1, metric="cosine", random_state=42,
        )
        coords = reducer.fit_transform(embeddings)

        # Normalizar a [-1, 1]
        for i in range(3):
            col = coords[:, i]
            rng = col.max() - col.min()
            if rng > 0:
                coords[:, i] = (col - col.min()) / rng * 2 - 1

        with open(UMAP_MODEL_PATH, "wb") as f:
            pickle.dump(reducer, f)
        print(f"✓ Modelo UMAP guardado en {UMAP_MODEL_PATH}")

        for nodo, coord in zip(nodos_con_emb, coords):
            nodo["x3d"] = round(float(coord[0]), 4)
            nodo["y3d"] = round(float(coord[1]), 4)
            nodo["z3d"] = round(float(coord[2]), 4)

        nodos_para_hdbscan = nodos_con_emb
        coords_hdbscan = coords

    else:
        # Ejecuciones siguientes: proyectar solo los nodos nuevos
        if not nodos_nuevos:
            print("No hay nodos nuevos para proyectar. Re-ejecutando HDBSCAN sobre todo.")
            nodos_para_hdbscan = nodos_con_emb
            coords_hdbscan = np.array([[n["x3d"], n["y3d"], n["z3d"]] for n in nodos_con_emb])
        else:
            print(f"Cargando modelo UMAP existente...")
            with open(UMAP_MODEL_PATH, "rb") as f:
                reducer = pickle.load(f)

            print(f"Proyectando {len(nodos_nuevos)} nodos nuevos...")
            emb_nuevos = np.array([n["embedding"] for n in nodos_nuevos], dtype=np.float32)
            coords_nuevos = reducer.transform(emb_nuevos)

            # Las coordenadas de los nodos nuevos ya están en el espacio del modelo (no renormalizar,
            # ya que el espacio existente tiene su propia escala)
            for nodo, coord in zip(nodos_nuevos, coords_nuevos):
                nodo["x3d"] = round(float(coord[0]), 4)
                nodo["y3d"] = round(float(coord[1]), 4)
                nodo["z3d"] = round(float(coord[2]), 4)

            nodos_para_hdbscan = nodos_con_emb
            coords_hdbscan = np.array([[n["x3d"], n["y3d"], n["z3d"]] for n in nodos_para_hdbscan])

    # Re-calcular clusters con HDBSCAN.
    # CLAVE: clusterizamos sobre una proyección de MAYOR dimensión derivada de los
    # embeddings — NO sobre las 3D de display. Aplastar 384-D → 3-D destruye la
    # separación semántica y mezcla temas distintos en un mismo cluster (p.ej. un doc
    # de "tratamiento de outliers" caía dentro de un grupo de texto-a-imagen). Las 3D
    # quedan sólo para dibujar; los clusters salen de un espacio que preserva la
    # estructura real del embedding.
    print(f"Calculando clusters HDBSCAN sobre {len(nodos_para_hdbscan)} nodos...")
    emb_cluster = np.array([n["embedding"] for n in nodos_para_hdbscan], dtype=np.float32)
    n_nodos = len(nodos_para_hdbscan)

    if n_nodos >= 8:
        # UMAP intermedia (~10-D) con vecindad coseno: separa bien los temas sin la
        # pérdida brutal de las 3 dimensiones del dibujo.
        reducer_cl = umap.UMAP(
            n_components=min(10, n_nodos - 2),
            n_neighbors=min(15, n_nodos - 1),
            min_dist=0.0, metric="cosine", random_state=42,
        )
        coords_cl = reducer_cl.fit_transform(emb_cluster)
    else:
        # Muy pocos nodos: clusterizar directo sobre el embedding.
        coords_cl = emb_cluster

    # Params honestos: dejamos que los outliers REALES caigan como ruido (cluster -1,
    # gris, sin etiqueta) en vez de pegarlos al grupo más cercano. min_samples alto =
    # más conservador (antes era 1, que forzaba a todo a tener cluster).
    min_cs = max(3, n_nodos // 10)
    min_samp = min(5, max(2, n_nodos // 12))
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cs, min_samples=min_samp,
        metric="euclidean", cluster_selection_method="eom",
    )
    labels = clusterer.fit_predict(coords_cl)

    for nodo, label in zip(nodos_para_hdbscan, labels):
        nodo["cluster"] = int(label)

    # ── Calcular PCA 3D ──
    embeddings_array = np.array([
        n["embedding"] for n in nodos_con_emb
        if n.get("embedding") and len(n["embedding"]) > 0
    ])
    nodos_con_emb_pca = [
        n for n in nodos_con_emb
        if n.get("embedding") and len(n["embedding"]) > 0
    ]

    if len(embeddings_array) >= 3:
        from sklearn.decomposition import PCA
        pca = PCA(n_components=3, random_state=42)
        pca_coords = pca.fit_transform(embeddings_array)

        for axis in range(3):
            col = pca_coords[:, axis]
            mn, mx = col.min(), col.max()
            if mx > mn:
                pca_coords[:, axis] = 2 * (col - mn) / (mx - mn) - 1
            else:
                pca_coords[:, axis] = 0.0

        for idx, n in enumerate(nodos_con_emb_pca):
            n["x_pca"] = float(pca_coords[idx, 0])
            n["y_pca"] = float(pca_coords[idx, 1])
            n["z_pca"] = float(pca_coords[idx, 2])
    else:
        for n in nodos_con_emb_pca:
            n["x_pca"] = n.get("x3d", 0.0)
            n["y_pca"] = n.get("y3d", 0.0)
            n["z_pca"] = n.get("z3d", 0.0)

    # ── Guardar coordenadas en DB ──
    with get_sync_session() as session:
        for n in nodos:
            session.query(NodeModel).filter(
                NodeModel.id == n["id"]
            ).update({
                "x3d":     n.get("x3d"),
                "y3d":     n.get("y3d"),
                "z3d":     n.get("z3d"),
                "x_pca":   n.get("x_pca"),
                "y_pca":   n.get("y_pca"),
                "z_pca":   n.get("z_pca"),
                "cluster": n.get("cluster", -1),
            })
        session.commit()

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_ruido = sum(1 for l in labels if l == -1)
    print(f"✓ Coordenadas UMAP y PCA actualizadas para {len(nodos)} nodos")
    print(f"✓ {n_clusters} clusters, {n_ruido} nodos sin cluster")


if __name__ == "__main__":
    main()
