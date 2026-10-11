"""Comparar grupos.

Sirve para: comparar una variable numérica entre grupos (por ejemplo, el gasto por
región o por plan) y saber si la diferencia es estadísticamente significativa o puede
ser azar.
Necesita: una tabla con una columna de grupos (categórica) y una columna numérica.
Entrega: cantidad, media y mediana por grupo, y la prueba que corresponde: t de Welch y
Mann-Whitney con dos grupos; ANOVA y Kruskal-Wallis con más de dos.
Toca: nada, sólo lee.
Pedidos típicos:
- Compará el gasto entre regiones
- ¿Hay diferencia significativa de satisfacción entre planes?
- ¿Los que abandonan gastan distinto que los que se quedan?
- Hacé un test de diferencia de medias por grupo
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy import stats

PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "grupo": {"tipo": "columna", "de": "datos", "clase": "categorica", "desc": "la columna que define los grupos"},
    "valor": {"tipo": "columna", "de": "datos", "clase": "numerica", "desc": "la variable a comparar"},
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
        return "—" if np.isnan(v) else f"{v:.{decimales}f}".rstrip("0").rstrip(".")
    return str(v)


def tabla_md(df, decimales=3):
    filas = [[str(c) for c in df.columns]] + [[fmt(v, decimales) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def main():
    df = leer_tabla(P.get("datos"))
    grupo, valor = P.get("grupo"), P.get("valor")
    if grupo not in df.columns or valor not in df.columns:
        sys.exit("Faltan las columnas: «grupo» (categórica) y «valor» (numérica).")
    d = df[[grupo, valor]].dropna()
    d[grupo] = d[grupo].astype(str).str.strip()
    grupos = {g: s[valor].to_numpy(dtype=float) for g, s in d.groupby(grupo) if len(s) >= 3}
    if len(grupos) < 2:
        sys.exit("Hacen falta al menos dos grupos con 3 o más casos.")
    print(f"# «{valor}» por «{grupo}»\n")
    resumen = pd.DataFrame([{"grupo": g, "n": len(v), "media": v.mean(), "mediana": np.median(v), "desvío": v.std(ddof=1)}
                            for g, v in grupos.items()]).sort_values("media", ascending=False)
    print(tabla_md(resumen))
    muestras = list(grupos.values())
    print()
    if len(muestras) == 2:
        t = stats.ttest_ind(*muestras, equal_var=False)
        u = stats.mannwhitneyu(*muestras, alternative="two-sided")
        print(f"t de Welch: t = {t.statistic:.3f}, p = {t.pvalue:.4g}")
        print(f"Mann-Whitney (no paramétrica): U = {u.statistic:.0f}, p = {u.pvalue:.4g}")
        p = min(t.pvalue, u.pvalue)
    else:
        f = stats.f_oneway(*muestras)
        k = stats.kruskal(*muestras)
        print(f"ANOVA: F = {f.statistic:.3f}, p = {f.pvalue:.4g}")
        print(f"Kruskal-Wallis (no paramétrica): H = {k.statistic:.3f}, p = {k.pvalue:.4g}")
        p = min(f.pvalue, k.pvalue)
    print()
    print("Con p < 0.05 la diferencia difícilmente sea azar." if p < 0.05
          else "Con p ≥ 0.05 no hay evidencia de diferencia entre los grupos.")


if __name__ == "__main__":
    main()
