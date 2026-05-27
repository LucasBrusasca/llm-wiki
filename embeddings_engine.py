import json
import pickle
import numpy as np
from pathlib import Path

BASE = Path(__file__).parent.resolve()
UMAP_MODEL_PATH = BASE / "umap_model.pkl"


def main():
    path = BASE / "nodes_generated.json"
    if not path.exists():
        print(f"No se encontró {path}")
        return

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    nodos = data["nodos"]
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
        print("Corré primero: python processor.py <archivo>")
        return

    # Separar nodos que ya tienen coordenadas 3D de los nuevos
    nodos_nuevos   = [n for n in nodos_con_emb if n.get("x3d") is None]
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

    # Re-calcular clusters con HDBSCAN sobre todas las coordenadas actuales
    print(f"Calculando clusters HDBSCAN sobre {len(nodos_para_hdbscan)} nodos...")
    min_cs = max(2, len(nodos_para_hdbscan) // 6)
    clusterer = hdbscan.HDBSCAN(min_cluster_size=min_cs, min_samples=1, metric="euclidean")
    labels = clusterer.fit_predict(coords_hdbscan)

    for nodo, label in zip(nodos_para_hdbscan, labels):
        nodo["cluster"] = int(label)

    # Nodos sin embedding
    for nodo in nodos:
        if not nodo.get("embedding"):
            nodo.setdefault("x3d", 0.0)
            nodo.setdefault("y3d", 0.0)
            nodo.setdefault("z3d", 0.0)
            nodo.setdefault("cluster", -1)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_ruido = sum(1 for l in labels if l == -1)
    print(f"✓ {len(nodos_nuevos) if nodos_existentes else len(nodos_con_emb)} nodos proyectados")
    print(f"✓ {n_clusters} clusters, {n_ruido} nodos sin cluster")
    print(f"✓ Guardado en {path}")


if __name__ == "__main__":
    main()
