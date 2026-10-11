"""Importancia de variables.

Sirve para: saber qué variables explican más a otra (por ejemplo, qué explica el
abandono o el gasto) con un bosque aleatorio y la importancia por permutación: cuánto
empeora el modelo si se mezclan los valores de cada variable.
Necesita: una tabla con la variable a explicar (objetivo, numérica o categórica).
Entrega: el ranking de variables por importancia, con su variación, y qué tan bien
predice el modelo con los datos que no vio.
Toca: nada, sólo lee.
Pedidos típicos:
- ¿Qué variables explican el abandono?
- ¿Qué es lo que más influye en el gasto?
- Ranking de importancia de variables para predecir las ventas
- ¿Qué factores pesan más en la satisfacción?
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder

warnings.filterwarnings("ignore")
PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "objetivo": {"tipo": "columna", "de": "datos", "desc": "la variable a explicar"},
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
        return f"{v:.4f}" if isinstance(v, (float, np.floating)) else str(v)
    filas = [[str(c) for c in df.columns]] + [[fmt(v) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def main():
    df = leer_tabla(P.get("datos"))
    objetivo = P.get("objetivo")
    if objetivo not in df.columns:
        sys.exit("Falta «objetivo»: la columna a explicar.")
    df = df[df[objetivo].notna()].copy()
    for c in df.columns:
        if not pd.api.types.is_numeric_dtype(df[c]):
            df[c] = df[c].astype(str).str.strip().replace({"nan": np.nan})
    regresion = pd.api.types.is_numeric_dtype(df[objetivo]) and df[objetivo].nunique() > 10
    num = [c for c in df.columns if c != objetivo and pd.api.types.is_numeric_dtype(df[c]) and df[c].nunique() > 1]
    cat = [c for c in df.columns if c != objetivo and c not in num and 2 <= df[c].nunique() <= 30]
    pre = ColumnTransformer([
        ("num", SimpleImputer(strategy="median"), num),
        ("cat", make_pipeline(SimpleImputer(strategy="most_frequent"), OneHotEncoder(handle_unknown="ignore")), cat),
    ])
    modelo = (RandomForestRegressor(n_estimators=200, min_samples_leaf=3, random_state=0, n_jobs=1) if regresion
              else RandomForestClassifier(n_estimators=200, min_samples_leaf=3, random_state=0, n_jobs=1))
    pipe = make_pipeline(pre, modelo)
    X, y = df[num + cat], (df[objetivo] if regresion else df[objetivo].astype(str))
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=0,
                                              stratify=None if regresion else y)
    pipe.fit(X_tr, y_tr)
    puntaje = pipe.score(X_te, y_te)
    # Un solo proceso: los procesos paralelos de joblib no heredan el filtro de
    # advertencias y ensuciaban la salida; con estas tablas no hace falta paralelizar.
    imp = permutation_importance(pipe, X_te, y_te, n_repeats=10, random_state=0, n_jobs=1)
    ranking = pd.DataFrame({"variable": X.columns, "importancia": imp.importances_mean, "desvío": imp.importances_std})
    ranking = ranking.sort_values("importancia", ascending=False)
    metrica = "R²" if regresion else "exactitud"
    print(f"# Qué explica «{objetivo}» ({'regresión' if regresion else 'clasificación'}, bosque aleatorio)\n")
    print(f"{metrica} con datos no vistos (25 %): {puntaje:.3f}\n")
    print(tabla_md(ranking))
    print(f"\nImportancia = cuánto cae la {metrica} si se mezclan los valores de esa variable. "
          "Cerca de 0 (o negativa): la variable no aporta. Mide asociación, no causa.")


if __name__ == "__main__":
    main()
