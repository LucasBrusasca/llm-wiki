import json
import pickle
import numpy as np
from pathlib import Path

BASE = Path(__file__).parent.resolve()
UMAP_MODEL_PATH = BASE / "umap_model.pkl"

# ── Temas (clusters) POR SECCIÓN ──────────────────────────────────────────────
# Configuración elegida midiendo, no a ojo (2026-10-06, sección de 221 documentos): de
# 144 combinaciones de UMAP intermedia × HDBSCAN, la que mejor combinó coherencia
# (silueta coseno en el espacio ORIGINAL de los embeddings), estabilidad entre semillas
# (ARI ≈ 0,79) y poco ruido dio 17 temas con 12 % sin tema. Antes se agrupaban todas las
# secciones juntas con grupos de ≥10 % del corpus: 2 temas para 221 documentos.
TEMAS_VERSION = 2
MIN_DOCS_TEMAS = 12       # con menos documentos, la sección todavía no arma temas
UMAP_TEMAS = dict(n_neighbors=10, min_dist=0.0, metric="cosine", random_state=42)


def _min_tema(n: int) -> int:
    """Tamaño mínimo de un tema: 4 documentos en una sección chica, crece con la sección."""
    return max(4, n // 50)


def _unitarios(emb) -> np.ndarray:
    m = np.asarray(emb, dtype=np.float32)
    normas = np.linalg.norm(m, axis=1, keepdims=True)
    return m / np.where(normas > 0, normas, 1.0)


def _centroides(emb_u: np.ndarray, labels) -> dict:
    """Por tema: su centroide y el umbral para pertenecer: lo que se parece al centroide el`n    10 % menos típico de sus miembros (un documento nuevo tan parecido como ellos entra)."""
    salida = {}
    for t in set(int(x) for x in labels if x >= 0):
        miembros = emb_u[np.asarray(labels) == t]
        c = miembros.mean(axis=0)
        c /= (np.linalg.norm(c) or 1.0)
        salida[t] = (c, float(np.percentile(miembros @ c, 10)))
    return salida


def _tema_mas_cercano(vec_u: np.ndarray, centroides: dict) -> int:
    """El tema al que un documento se parece DE VERDAD (tanto como sus miembros típicos);
    si no hay ninguno, queda sin tema."""
    mejor, sim_mejor = -1, -1.0
    for t, (c, umbral) in centroides.items():
        s = float(vec_u @ c)
        if s >= umbral and s > sim_mejor:
            mejor, sim_mejor = t, s
    return mejor


def agrupar_seccion(emb) -> np.ndarray:
    """Temas de UNA sección: UMAP intermedia (~10-D, coseno) + HDBSCAN «eom». Los que
    HDBSCAN deja como ruido pero se parecen de verdad a un tema se suman a ese tema."""
    import hdbscan
    import umap
    emb_u = _unitarios(emb)
    n = len(emb_u)
    coords = umap.UMAP(n_components=min(10, n - 2), **{**UMAP_TEMAS, "n_neighbors": min(10, n - 1)}
                       ).fit_transform(emb_u)
    labels = hdbscan.HDBSCAN(
        min_cluster_size=_min_tema(n), min_samples=min(3, max(1, n // 20)),
        metric="euclidean", cluster_selection_method="eom",
    ).fit_predict(coords).astype(int)
    centroides = _centroides(emb_u, labels)
    for i in np.where(labels < 0)[0]:
        labels[i] = _tema_mas_cercano(emb_u[i], centroides)
    return labels


def _tiene_tema(n: dict) -> bool:
    return n.get("cluster") is not None and n["cluster"] >= 0


def calcular_temas(nodos: list, reagrupar: bool, ids_nuevos: set) -> dict:
    """Asigna `cluster` (id global, único entre secciones) a cada nodo y devuelve
    {sección: cantidad de temas}.

    - Reagrupar (o la primera vez de una sección): se agrupa la sección entera.
    - Si no: cada documento NUEVO se suma al tema más cercano de su sección y los demás
      no se tocan, así los temas no cambian cada vez que se ingiere algo.
    """
    por_seccion = {}
    for n in nodos:
        por_seccion.setdefault(n.get("dominio") or "personal", []).append(n)
    if reagrupar:
        siguiente = 0
    else:
        siguiente = 1 + max((n["cluster"] for n in nodos if _tiene_tema(n)), default=-1)
    resumen = {}
    for seccion in sorted(por_seccion):
        grupo = por_seccion[seccion]
        if len(grupo) < MIN_DOCS_TEMAS:
            for n in grupo:
                n["cluster"] = -1
            resumen[seccion] = 0
            continue
        con_tema = [n for n in grupo if _tiene_tema(n) and n["id"] not in ids_nuevos]
        if reagrupar or not con_tema:
            labels = agrupar_seccion([n["embedding"] for n in grupo])
            locales = sorted(set(int(x) for x in labels if x >= 0))
            mapa = {t: siguiente + k for k, t in enumerate(locales)}
            siguiente += len(locales)
            for n, t in zip(grupo, labels):
                n["cluster"] = mapa.get(int(t), -1)
        else:
            emb_u = _unitarios([n["embedding"] for n in con_tema])
            centroides = _centroides(emb_u, [n["cluster"] for n in con_tema])
            for n in grupo:
                if n["id"] in ids_nuevos:
                    n["cluster"] = _tema_mas_cercano(_unitarios([n["embedding"]])[0], centroides)
        resumen[seccion] = len(set(n["cluster"] for n in grupo if n["cluster"] >= 0))
    return resumen


def _normalization_for(coords: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Parámetros que llevan cada eje UMAP al rango [-1, 1]."""
    mins = coords.min(axis=0)
    ranges = coords.max(axis=0) - mins
    ranges = np.where(ranges > 0, ranges, 1.0)
    return mins, ranges


def _apply_normalization(coords: np.ndarray, mins, ranges) -> np.ndarray:
    mins = np.asarray(mins, dtype=np.float32)
    ranges = np.asarray(ranges, dtype=np.float32)
    ranges = np.where(ranges > 0, ranges, 1.0)
    return (coords - mins) / ranges * 2 - 1


def _version_temas(session) -> int | None:
    from database.models import GraphStat
    fila = session.query(GraphStat).filter(GraphStat.key == "temas").one_or_none()
    return (fila.value or {}).get("version") if fila and isinstance(fila.value, dict) else None


def _guardar_version_temas(session, resumen: dict, reagrupado: bool):
    from datetime import datetime, timezone
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from database.models import GraphStat
    valor = {"version": TEMAS_VERSION, "temas_por_seccion": resumen,
             "reagrupado": reagrupado, "medido_en": datetime.now(timezone.utc).isoformat()}
    session.execute(pg_insert(GraphStat).values(key="temas", value=valor)
                    .on_conflict_do_update(index_elements=["key"], set_={"value": valor}))


def main(reagrupar: bool = False):
    """Posiciones 3D (UMAP de dibujo + PCA) y temas por sección.

    `reagrupar=True` rehace los temas de todas las secciones (botón «Reagrupar»); si no,
    sólo se ubican los documentos nuevos. La primera vez con esta versión de los temas
    se reagrupa solo.
    """
    from database.connection import get_sync_session
    from database.models import Node as NodeModel

    # ── Leer nodos desde DB ──
    with get_sync_session() as session:
        nodos_db = session.query(NodeModel).filter(
            NodeModel.embedding.isnot(None),
            NodeModel.is_centroid == False,
            NodeModel.is_issue == False,
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
                "dominio": n.dominio or "personal",
                "embedding": emb,
                "cluster": n.cluster if n.cluster is not None else -1,
                "x3d":     n.x3d,
                "y3d":     n.y3d,
                "z3d":     n.z3d,
            })
        if _version_temas(session) != TEMAS_VERSION:
            reagrupar = True

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
    ids_nuevos = {n["id"] for n in nodos_nuevos}

    import umap
    import hdbscan

    saved_bundle = None
    if UMAP_MODEL_PATH.exists():
        try:
            with open(UMAP_MODEL_PATH, "rb") as f:
                candidate = pickle.load(f)
            if (isinstance(candidate, dict) and candidate.get("version") == 2
                    and candidate.get("reducer") is not None):
                saved_bundle = candidate
            else:
                print("Modelo UMAP legado detectado; se reentrenará una vez para guardar su escala.")
        except Exception as exc:
            print(f"No se pudo cargar el modelo UMAP; se reentrenará: {exc}")

    if saved_bundle is None or not nodos_existentes:
        # Primera ejecución: entrenar UMAP con todos los nodos
        print(f"Entrenando UMAP con {len(nodos_con_emb)} nodos...")
        embeddings = np.array([n["embedding"] for n in nodos_con_emb], dtype=np.float32)
        n_neighbors = min(15, len(nodos_con_emb) - 1)
        reducer = umap.UMAP(
            n_components=3, n_neighbors=n_neighbors,
            min_dist=0.1, metric="cosine", random_state=42,
        )
        raw_coords = reducer.fit_transform(embeddings)
        norm_mins, norm_ranges = _normalization_for(raw_coords)
        coords = _apply_normalization(raw_coords, norm_mins, norm_ranges)

        with open(UMAP_MODEL_PATH, "wb") as f:
            pickle.dump({
                "version": 2,
                "reducer": reducer,
                "normalization_mins": norm_mins.tolist(),
                "normalization_ranges": norm_ranges.tolist(),
            }, f)
        print(f"✓ Modelo UMAP guardado en {UMAP_MODEL_PATH}")

        for nodo, coord in zip(nodos_con_emb, coords):
            nodo["x3d"] = round(float(coord[0]), 4)
            nodo["y3d"] = round(float(coord[1]), 4)
            nodo["z3d"] = round(float(coord[2]), 4)


    else:
        # Ejecuciones siguientes: proyectar solo los nodos nuevos
        if not nodos_nuevos:
            print("No hay nodos nuevos para proyectar.")
        else:
            print(f"Cargando modelo UMAP existente...")
            reducer = saved_bundle["reducer"]

            print(f"Proyectando {len(nodos_nuevos)} nodos nuevos...")
            emb_nuevos = np.array([n["embedding"] for n in nodos_nuevos], dtype=np.float32)
            raw_coords_nuevos = reducer.transform(emb_nuevos)
            coords_nuevos = _apply_normalization(
                raw_coords_nuevos,
                saved_bundle["normalization_mins"],
                saved_bundle["normalization_ranges"],
            )

            # Reutilizar la escala aprendida evita mezclar coordenadas crudas de
            # transform() con las coordenadas normalizadas del corpus original.
            for nodo, coord in zip(nodos_nuevos, coords_nuevos):
                nodo["x3d"] = round(float(coord[0]), 4)
                nodo["y3d"] = round(float(coord[1]), 4)
                nodo["z3d"] = round(float(coord[2]), 4)


    # Temas por sección. CLAVE: se agrupa sobre una proyección de MAYOR dimensión de los
    # embeddings (UMAP ~10-D, coseno), NO sobre las 3D del dibujo: aplastar 384-D → 3-D
    # mezcla temas distintos. Las 3D quedan sólo para dibujar.
    print("Reagrupando los temas de cada sección..." if reagrupar
          else "Ubicando los documentos nuevos en sus temas...")
    resumen_temas = calcular_temas(nodos_con_emb, reagrupar, ids_nuevos)

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
        _guardar_version_temas(session, resumen_temas, reagrupar)
        session.commit()

    n_ruido = sum(1 for n in nodos_con_emb if not _tiene_tema(n))
    print(f"✓ Coordenadas UMAP y PCA actualizadas para {len(nodos)} nodos")
    print(f"✓ Temas por sección: {resumen_temas} · {n_ruido} documentos sin tema")
    return resumen_temas


if __name__ == "__main__":
    main()
