"""Valores atípicos.

Sirve para: encontrar valores fuera de lo común en columnas numéricas, con dos criterios:
los cuartiles (fuera de Q1 − 1.5·IQR y Q3 + 1.5·IQR) y el z-score robusto (mediana y
MAD, |z| > 3.5).
Necesita: una tabla con columnas numéricas; opcionalmente, la columna a revisar.
Entrega: cuántos atípicos hay en cada columna según cada criterio, sus límites y los
casos más extremos.
Toca: nada, sólo lee.
Pedidos típicos:
- Detectá valores atípicos en la tabla
- ¿Hay outliers en los ingresos?
- Buscá valores raros o extremos
- ¿Qué filas tienen valores fuera de rango?
"""
import json
import os
import sys

import numpy as np
import pandas as pd

PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "columna": {"tipo": "columna", "de": "datos", "clase": "numerica", "opcional": True,
                "desc": "la columna a revisar (si no, todas las numéricas)"},
}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")


def leer_tabla(archivo):
    if not archivo:
        sys.exit("Falta la tabla: pedile esta herramienta al agente con un nodo de datos seleccionado.")
    if archivo.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(archivo)
    return pd.read_csv(archivo, sep=None, engine="python")


def fmt(v, decimales=2):
    if isinstance(v, (float, np.floating)):
        return "—" if np.isnan(v) else f"{v:.{decimales}f}".rstrip("0").rstrip(".")
    return str(v)


def tabla_md(df, decimales=2):
    filas = [[str(c) for c in df.columns]] + [[fmt(v, decimales) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def main():
    df = leer_tabla(P.get("datos"))
    numericas = df.select_dtypes(include="number")
    columna = P.get("columna")
    columnas = [columna] if columna in numericas.columns else list(numericas.columns)
    if not columnas:
        sys.exit("La tabla no tiene columnas numéricas.")
    print(f"# Valores atípicos en {P.get('datos')}\n")
    resumen, extremos = [], []
    for c in columnas:
        s = numericas[c].dropna()
        if s.nunique() < 3:
            continue
        q1, q3 = s.quantile([0.25, 0.75])
        iqr = q3 - q1
        bajo, alto = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        mad = (s - s.median()).abs().median()
        z = 0.6745 * (s - s.median()) / mad if mad else pd.Series(0.0, index=s.index)
        fuera_iqr = (s < bajo) | (s > alto)
        fuera_z = z.abs() > 3.5
        resumen.append({"columna": c, "atípicos IQR": int(fuera_iqr.sum()), "atípicos z robusto": int(fuera_z.sum()),
                        "límite inferior": bajo, "límite superior": alto})
        for i in z.abs().sort_values(ascending=False).index[:3]:
            if fuera_z[i]:
                extremos.append({"columna": c, "fila": int(i) + 2, "valor": s[i], "z robusto": z[i]})
    print(tabla_md(pd.DataFrame(resumen)))
    if extremos:
        print("\n## Casos más extremos (fila = renglón del archivo, contando el encabezado)\n")
        print(tabla_md(pd.DataFrame(extremos)))
    print("\nUn atípico no es un error: revisá si es un dato mal cargado o un caso real antes de sacarlo.")


if __name__ == "__main__":
    main()
