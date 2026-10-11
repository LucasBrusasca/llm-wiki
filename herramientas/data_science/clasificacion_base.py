"""Modelo de clasificación base.

Sirve para: predecir una variable categórica (por ejemplo, si un cliente abandona) con
modelos simples y medir qué tan bien funcionan con validación cruzada, antes de probar
algo más complejo.
Necesita: una tabla con la columna a predecir (objetivo, categórica o binaria).
Entrega: exactitud, F1 y AUC de una regresión logística y de un árbol de decisión,
comparados con predecir siempre la clase más frecuente, y la matriz de confusión del
mejor modelo.
Toca: nada, sólo lee.
Pedidos típicos:
- Entrená un modelo para predecir el abandono
- ¿Se puede predecir qué clientes se van?
- Armá un clasificador para la columna objetivo
- Probá una regresión logística y un árbol de decisión
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier

warnings.filterwarnings("ignore")
PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "objetivo": {"tipo": "columna", "de": "datos", "clase": "categorica", "desc": "la variable a predecir"},
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
        return f"{v:.3f}" if isinstance(v, (float, np.floating)) else str(v)
    filas = [[str(c) for c in df.columns]] + [[fmt(v) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def preparar(df, objetivo):
    num, cat = [], []
    for c in df.columns:
        if c == objetivo:
            continue
        s = df[c]
        if pd.api.types.is_numeric_dtype(s):
            if s.nunique() > 1:
                num.append(c)
        elif 2 <= s.nunique() <= 30:
            cat.append(c)
    pre = ColumnTransformer([
        ("num", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), num),
        ("cat", make_pipeline(SimpleImputer(strategy="most_frequent"), OneHotEncoder(handle_unknown="ignore")), cat),
    ])
    return pre, num + cat


def main():
    df = leer_tabla(P.get("datos"))
    objetivo = P.get("objetivo")
    if objetivo not in df.columns:
        sys.exit("Falta «objetivo»: la columna a predecir.")
    df = df[df[objetivo].notna()].copy()
    y = df[objetivo].astype(str).str.strip()
    if y.nunique() < 2 or y.nunique() > 20:
        sys.exit(f"«{objetivo}» tiene {y.nunique()} clases: para clasificar hacen falta entre 2 y 20.")
    for c in df.columns:
        if not pd.api.types.is_numeric_dtype(df[c]):
            df[c] = df[c].astype(str).str.strip().replace({"nan": np.nan})
    pre, usadas = preparar(df, objetivo)
    X = df[usadas]
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
    binaria = y.nunique() == 2
    positiva = sorted(y.unique())[-1]
    modelos = {
        "siempre la más frecuente": DummyClassifier(strategy="most_frequent"),
        "regresión logística": LogisticRegression(max_iter=2000),
        "árbol de decisión (prof. 4)": DecisionTreeClassifier(max_depth=4, random_state=0),
    }
    filas, preds = [], {}
    for nombre, m in modelos.items():
        pipe = make_pipeline(pre, m)
        proba = cross_val_predict(pipe, X, y, cv=folds, method="predict_proba")
        clases = sorted(y.unique())
        pred = np.array(clases)[proba.argmax(axis=1)]
        preds[nombre] = pred
        auc = (roc_auc_score((y == positiva).astype(int), proba[:, clases.index(positiva)]) if binaria
               else roc_auc_score(y, proba, multi_class="ovr"))
        filas.append({"modelo": nombre, "exactitud": accuracy_score(y, pred),
                      "F1 (macro)": f1_score(y, pred, average="macro"), "AUC": auc})
    print(f"# Clasificación de «{objetivo}» ({len(df)} filas, validación cruzada de 5 partes)\n")
    print(f"Clases: " + " · ".join(f"{k}: {v}" for k, v in y.value_counts().items()))
    print(f"Variables usadas: {', '.join(usadas)}\n")
    print(tabla_md(pd.DataFrame(filas)))
    mejor = max(filas[1:], key=lambda f: f["AUC"])["modelo"]
    clases = sorted(y.unique())
    cm = pd.DataFrame(confusion_matrix(y, preds[mejor], labels=clases),
                      index=[f"real {c}" for c in clases], columns=[f"pred. {c}" for c in clases])
    print(f"\n## Matriz de confusión — {mejor}\n")
    print(tabla_md(cm.reset_index().rename(columns={"index": ""})))
    print("\nSi el modelo no le gana claramente a «siempre la más frecuente», las variables no alcanzan.")


if __name__ == "__main__":
    main()
