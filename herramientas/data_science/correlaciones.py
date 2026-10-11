"""Correlaciones.

Sirve para: medir qué tan relacionadas están las columnas numéricas entre sí (Pearson,
lineal, y Spearman, por rangos) y detectar variables redundantes o que se mueven junto
con una variable de interés.
Necesita: una tabla con al menos dos columnas numéricas; opcionalmente, una columna
objetivo.
Entrega: los pares de columnas más correlacionados y, si hay objetivo, la correlación de
cada columna con él.
Toca: nada, sólo lee.
Pedidos típicos:
- Calculá las correlaciones de la tabla
- Matriz de correlación del CSV
- ¿Hay variables redundantes?
- ¿Qué variables se mueven junto con el gasto?
"""
import json
import os
import sys

import numpy as np
import pandas as pd

PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "objetivo": {"tipo": "columna", "de": "datos", "clase": "numerica", "opcional": True,
                 "desc": "la variable contra la que comparar las demás"},
}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")


def leer_tabla(archivo):
    if not archivo:
        sys.exit("Falta la tabla: pedile esta herramienta al agente con un nodo de datos seleccionado.")
    if archivo.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(archivo)
    return pd.read_csv(archivo, sep=None, engine="python")


def fmt(v, decimales=3):
    if isinstance(v, (float, np.floating)):
        return "—" if np.isnan(v) else f"{v:.{decimales}f}"
    return str(v)


def tabla_md(df, decimales=3):
    filas = [[str(c) for c in df.columns]] + [[fmt(v, decimales) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def main():
    df = leer_tabla(P.get("datos")).select_dtypes(include="number")
    df = df.loc[:, df.nunique() > 1]
    if df.shape[1] < 2:
        sys.exit("Hacen falta al menos dos columnas numéricas con variación.")
    pearson, spearman = df.corr(method="pearson"), df.corr(method="spearman")
    print(f"# Correlaciones en {P.get('datos')}\n")
    objetivo = P.get("objetivo")
    if objetivo in df.columns:
        filas = [{"columna": c, "pearson": pearson.loc[c, objetivo], "spearman": spearman.loc[c, objetivo]}
                 for c in df.columns if c != objetivo]
        filas.sort(key=lambda f: -abs(f["spearman"]))
        print(f"## Con «{objetivo}»\n")
        print(tabla_md(pd.DataFrame(filas)))
        print()
    pares = []
    cols = list(df.columns)
    for i, a in enumerate(cols):
        for b in cols[i + 1:]:
            pares.append({"columna A": a, "columna B": b, "pearson": pearson.loc[a, b], "spearman": spearman.loc[a, b]})
    pares.sort(key=lambda f: -abs(f["spearman"]))
    print("## Pares más correlacionados\n")
    print(tabla_md(pd.DataFrame(pares[:10])))
    fuertes = [p for p in pares if abs(p["spearman"]) >= 0.8]
    print()
    print(f"{len(fuertes)} pares con |ρ| ≥ 0.8 (posible redundancia)." if fuertes
          else "Ningún par con |ρ| ≥ 0.8: no hay redundancia fuerte.")
    print("Correlación no es causalidad: mide co-movimiento, no efecto.")


if __name__ == "__main__":
    main()
