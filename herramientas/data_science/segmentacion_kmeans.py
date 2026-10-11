"""Segmentación con k-means.

Sirve para: agrupar filas parecidas en segmentos (por ejemplo, tipos de clientes) con
k-means sobre las variables numéricas estandarizadas, eligiendo la cantidad de grupos
con el coeficiente silhouette.
Necesita: una tabla con columnas numéricas; opcionalmente, la cantidad de grupos y las
variables a usar.
Entrega: la cantidad de grupos elegida (con el silhouette de cada opción), el tamaño de
cada grupo y su perfil promedio.
Toca: nada, sólo lee.
Pedidos típicos:
- Agrupá los clientes en segmentos
- Hacé un clustering de la tabla
- Segmentá los datos en 4 grupos
- ¿Qué tipos de clientes hay?
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.impute import SimpleImputer
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "k": {"tipo": "numero", "opcional": True, "desc": "cantidad de grupos (si no, la elige el silhouette)"},
    "variables": {"tipo": "columnas", "de": "datos", "opcional": True, "desc": "las columnas a usar"},
}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")


def leer_tabla(archivo):
    if not archivo:
        sys.exit("Falta la tabla: pedile esta herramienta al agente con un nodo de datos seleccionado.")
    if archivo.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(archivo)
    return pd.read_csv(archivo, sep=None, engine="python")


def tabla_md(df):
    def fmt(v):
        return f"{v:.2f}".rstrip("0").rstrip(".") if isinstance(v, (float, np.floating)) else str(v)
    filas = [[str(c) for c in df.columns]] + [[fmt(v) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def main():
    df = leer_tabla(P.get("datos"))
    numericas = df.select_dtypes(include="number")
    variables = [c for c in (P.get("variables") or numericas.columns) if c in numericas.columns
                 and numericas[c].nunique() > 2]
    if len(variables) < 2:
        sys.exit("Hacen falta al menos dos columnas numéricas con variación.")
    X = StandardScaler().fit_transform(SimpleImputer(strategy="median").fit_transform(numericas[variables]))
    muestra = np.random.default_rng(0).choice(len(X), min(len(X), 2000), replace=False)
    k_pedido = int(P["k"]) if P.get("k") else None
    candidatos = [k_pedido] if k_pedido else list(range(2, 9))
    sil = {}
    for k in candidatos:
        etiquetas = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(X)
        sil[k] = silhouette_score(X[muestra], etiquetas[muestra])
    k = k_pedido or max(sil, key=sil.get)
    etiquetas = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(X)
    print(f"# Segmentación de {P.get('datos')} en {k} grupos\n")
    print("Variables: " + ", ".join(variables))
    print("Silhouette por cantidad de grupos: " + " · ".join(f"k={c}: {s:.3f}" for c, s in sil.items())
          + ("  (elegido el mayor)" if not k_pedido else "  (k pedido)") + "\n")
    perfil = numericas[variables].assign(grupo=etiquetas).groupby("grupo").mean()
    perfil.insert(0, "filas", pd.Series(etiquetas).value_counts().sort_index())
    print(tabla_md(perfil.reset_index()))
    print(f"\nPromedio general: " + " · ".join(f"{c} {numericas[c].mean():.2f}" for c in variables))
    print("Silhouette cerca de 0 = grupos poco separados; cerca de 1 = muy separados.")


if __name__ == "__main__":
    main()
