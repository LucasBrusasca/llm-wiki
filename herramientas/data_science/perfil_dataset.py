"""Perfil del dataset.

Sirve para: ver de un vistazo cómo es una tabla: cuántas filas y columnas tiene, de qué
tipo es cada columna, cuántos vacíos y valores distintos hay y sus estadísticas básicas.
Necesita: una tabla (CSV o Excel).
Entrega: un resumen general y una fila por columna con tipo, vacíos, distintos,
mínimo, mediana, máximo o los valores más frecuentes.
Toca: nada, sólo lee.
Pedidos típicos:
- ¿Cómo son estos datos?
- Describime la tabla
- Hacé un análisis exploratorio del dataset
- ¿Qué columnas tiene y cuántos vacíos hay?
- Dame un resumen estadístico del CSV
"""
import json
import os
import sys

import numpy as np
import pandas as pd

PARAMETROS = {"datos": {"tipo": "tabla", "desc": "la tabla a describir"}}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")


def leer_tabla(archivo):
    if not archivo:
        sys.exit("Falta la tabla: pedile esta herramienta al agente con un nodo de datos seleccionado.")
    if archivo.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(archivo)
    return pd.read_csv(archivo, sep=None, engine="python")


def fmt(v, decimales=3):
    if isinstance(v, (float, np.floating)):
        if np.isnan(v):
            return "—"
        s = f"{v:.{decimales}f}"
        return s.rstrip("0").rstrip(".")
    return str(v)


def tabla_md(df, decimales=3):
    filas = [[str(c) for c in df.columns]] + [[fmt(v, decimales) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def main():
    df = leer_tabla(P.get("datos"))
    print(f"# Perfil de {P.get('datos')}\n")
    print(f"{len(df)} filas · {df.shape[1]} columnas · {int(df.duplicated().sum())} filas duplicadas · "
          f"{int(df.isna().sum().sum())} celdas vacías\n")
    filas = []
    for col in df.columns:
        s = df[col]
        numerica = pd.api.types.is_numeric_dtype(s)
        fila = {"columna": col, "tipo": "número" if numerica else "texto",
                "vacíos": int(s.isna().sum()), "distintos": int(s.nunique())}
        if numerica:
            fila["resumen"] = f"mín {fmt(s.min())} · mediana {fmt(s.median())} · máx {fmt(s.max())}"
        else:
            top = s.value_counts().head(3)
            fila["resumen"] = " · ".join(f"{k} ({v})" for k, v in top.items())
        filas.append(fila)
    print(tabla_md(pd.DataFrame(filas)))


if __name__ == "__main__":
    main()
