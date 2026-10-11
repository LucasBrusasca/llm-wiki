"""Regresión lineal.

Sirve para: explicar o predecir una variable numérica con otras columnas mediante una
regresión lineal por mínimos cuadrados, y revisar si el modelo es confiable.
Necesita: una tabla con una columna numérica a explicar (objetivo); opcionalmente, las
columnas explicativas (si no, usa las demás numéricas y las categóricas con pocas
categorías).
Entrega: R² y R² ajustado, coeficientes con error estándar y p-valor, normalidad de los
residuos (Shapiro-Wilk) y multicolinealidad (VIF).
Toca: nada, sólo lee.
Pedidos típicos:
- Hacé una regresión lineal del gasto
- ¿Cuánto influye cada variable en los ingresos?
- Ajustá un modelo lineal para explicar las ventas
- Estimá los coeficientes de la regresión
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy import stats

PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "objetivo": {"tipo": "columna", "de": "datos", "clase": "numerica", "desc": "la variable a explicar"},
    "predictoras": {"tipo": "columnas", "de": "datos", "opcional": True,
                    "desc": "las variables explicativas (si no, todas las que sirvan)"},
}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")


def leer_tabla(archivo):
    if not archivo:
        sys.exit("Falta la tabla: pedile esta herramienta al agente con un nodo de datos seleccionado.")
    if archivo.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(archivo)
    return pd.read_csv(archivo, sep=None, engine="python")


def fmt(v, decimales=4):
    if isinstance(v, (float, np.floating)):
        if np.isnan(v):
            return "—"
        return f"{v:.3g}" if 0 < abs(v) < 1e-3 else f"{v:.{decimales}f}".rstrip("0").rstrip(".")
    return str(v)


def tabla_md(df, decimales=4):
    filas = [[str(c) for c in df.columns]] + [[fmt(v, decimales) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def candidatas(df, objetivo):
    """Columnas que tiene sentido usar: numéricas con variación y categóricas chicas
    (no identificadores ni fechas)."""
    salida = []
    for c in df.columns:
        if c == objetivo:
            continue
        s = df[c]
        if pd.api.types.is_numeric_dtype(s):
            if s.nunique() > 1:
                salida.append(c)
        elif 2 <= s.nunique() <= 12:
            salida.append(c)
    return salida


def main():
    df = leer_tabla(P.get("datos"))
    objetivo = P.get("objetivo")
    if objetivo not in df.columns or not pd.api.types.is_numeric_dtype(df[objetivo]):
        sys.exit("Falta «objetivo»: una columna numérica de la tabla.")
    predictoras = [c for c in (P.get("predictoras") or candidatas(df, objetivo)) if c in df.columns and c != objetivo]
    d = df[[objetivo] + predictoras].dropna()
    for c in predictoras:
        if not pd.api.types.is_numeric_dtype(d[c]):
            d[c] = d[c].astype(str).str.strip()
    X = pd.get_dummies(d[predictoras], drop_first=True, dtype=float)
    X.insert(0, "(intercepto)", 1.0)
    y = d[objetivo].to_numpy(dtype=float)
    n, k = X.shape
    if n <= k + 5:
        sys.exit(f"Muy pocas filas completas ({n}) para {k} coeficientes.")
    A = X.to_numpy()
    beta, *_ = np.linalg.lstsq(A, y, rcond=None)
    resid = y - A @ beta
    gl = n - k
    sigma2 = resid @ resid / gl
    cov = sigma2 * np.linalg.pinv(A.T @ A)
    se = np.sqrt(np.diag(cov))
    t = beta / se
    p = 2 * stats.t.sf(np.abs(t), gl)
    r2 = 1 - (resid @ resid) / ((y - y.mean()) @ (y - y.mean()))
    r2_aj = 1 - (1 - r2) * (n - 1) / gl
    print(f"# Regresión lineal de «{objetivo}» ({n} filas completas)\n")
    print(f"R² = {r2:.3f} · R² ajustado = {r2_aj:.3f} · error típico = {np.sqrt(sigma2):.4g}\n")
    coefs = pd.DataFrame({"variable": X.columns, "coeficiente": beta, "error est.": se, "t": t, "p-valor": p})
    coefs["signif."] = np.where(p < 0.001, "***", np.where(p < 0.01, "**", np.where(p < 0.05, "*", "")))
    print(tabla_md(coefs))
    print("\n*** p<0.001 · ** p<0.01 · * p<0.05. Las categóricas se comparan contra su primera categoría.\n")
    muestra = resid if len(resid) <= 5000 else np.random.default_rng(0).choice(resid, 5000, replace=False)
    sw = stats.shapiro(muestra)
    print(f"Residuos: Shapiro-Wilk p = {sw.pvalue:.4g} → "
          + ("no se rechaza la normalidad." if sw.pvalue >= 0.05 else
             "no son normales: los p-valores son aproximados (con muchas filas suele alcanzar igual)."))
    vifs = []
    num = X.drop(columns="(intercepto)")
    for c in num.columns:
        otras = np.column_stack([np.ones(n), num.drop(columns=c).to_numpy()])
        b, *_ = np.linalg.lstsq(otras, num[c].to_numpy(), rcond=None)
        r = num[c].to_numpy() - otras @ b
        r2_c = 1 - (r @ r) / max(((num[c] - num[c].mean()) ** 2).sum(), 1e-12)
        vifs.append((c, 1 / max(1 - r2_c, 1e-12)))
    altos = [f"{c} ({v:.1f})" for c, v in vifs if v > 5]
    print("Multicolinealidad (VIF > 5): " + (", ".join(altos) if altos else "ninguna."))


if __name__ == "__main__":
    main()
