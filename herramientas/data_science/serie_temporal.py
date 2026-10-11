"""Tendencia en el tiempo.

Sirve para: ver cómo evoluciona una variable en el tiempo: la suma por día, semana o mes
(o cuenta filas si no hay variable), estima la tendencia y muestra la estacionalidad por
mes del año.
Necesita: una tabla con una columna de fecha; opcionalmente, la variable a sumar y el
período.
Entrega: la serie de los últimos períodos, la tendencia (cuánto cambia por período), la
variación del último período y el promedio por mes del año.
Toca: nada, sólo lee.
Pedidos típicos:
- Mostrame la tendencia mensual de las altas
- ¿Cómo evolucionaron las ventas en el tiempo?
- ¿Hay estacionalidad en los datos?
- Serie de tiempo semanal de los ingresos
"""
import json
import os
import sys

import numpy as np
import pandas as pd

PARAMETROS = {
    "datos": {"tipo": "tabla"},
    "fecha": {"tipo": "columna", "de": "datos", "clase": "fecha", "desc": "la columna de fecha"},
    "valor": {"tipo": "columna", "de": "datos", "clase": "numerica", "opcional": True,
              "desc": "la variable a sumar (si no, se cuentan filas)"},
    "periodo": {"tipo": "opcion", "opciones": ["dia", "semana", "mes"], "defecto": "mes", "opcional": True},
}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")
FRECUENCIA = {"dia": "D", "semana": "W-MON", "mes": "MS"}
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]


def leer_tabla(archivo):
    if not archivo:
        sys.exit("Falta la tabla: pedile esta herramienta al agente con un nodo de datos seleccionado.")
    if archivo.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(archivo)
    return pd.read_csv(archivo, sep=None, engine="python")


def tabla_md(df):
    def fmt(v):
        if isinstance(v, pd.Timestamp):
            return v.strftime("%Y-%m-%d")
        return f"{v:.2f}".rstrip("0").rstrip(".") if isinstance(v, (float, np.floating)) else str(v)
    filas = [[str(c) for c in df.columns]] + [[fmt(v) for v in f] for f in df.itertuples(index=False)]
    anchos = [max(len(f[i]) for f in filas) for i in range(len(filas[0]))]
    lineas = ["| " + " | ".join(c.ljust(a) for c, a in zip(f, anchos)) + " |" for f in filas]
    lineas.insert(1, "|" + "|".join("-" * (a + 2) for a in anchos) + "|")
    return "\n".join(lineas)


def main():
    df = leer_tabla(P.get("datos"))
    fecha, valor = P.get("fecha"), P.get("valor")
    periodo = P.get("periodo") if P.get("periodo") in FRECUENCIA else "mes"
    if fecha not in df.columns:
        sys.exit("Falta «fecha»: la columna con las fechas.")
    texto = df[fecha].astype(str)
    dia_primero = texto.str.match(r"^\d{1,2}/\d{1,2}/\d{2,4}$").mean() > 0.5
    df["_f"] = pd.to_datetime(df[fecha], errors="coerce", dayfirst=dia_primero)
    df = df[df["_f"].notna()]
    if df.empty:
        sys.exit(f"No pude leer fechas en «{fecha}».")
    if valor in df.columns:
        serie = df.set_index("_f")[valor].resample(FRECUENCIA[periodo]).sum()
        nombre = f"suma de {valor}"
    else:
        serie = df.set_index("_f").resample(FRECUENCIA[periodo]).size()
        nombre = "cantidad de filas"
    print(f"# {nombre.capitalize()} por {periodo} ({serie.index.min():%Y-%m-%d} a {serie.index.max():%Y-%m-%d})\n")
    print(tabla_md(pd.DataFrame({"período": serie.index, nombre: serie.values}).tail(12)))
    x = np.arange(len(serie))
    if len(serie) >= 3:
        pendiente = np.polyfit(x, serie.values.astype(float), 1)[0]
        media = serie.mean()
        print(f"\nTendencia: {pendiente:+.2f} por {periodo}"
              + (f" ({pendiente / media:+.1%} del promedio por {periodo})." if media else "."))
    if len(serie) >= 2 and serie.iloc[-2]:
        print(f"Último {periodo} contra el anterior: {serie.iloc[-1] / serie.iloc[-2] - 1:+.1%} "
              "(el último puede estar incompleto).")
    mensual = df.set_index("_f")[valor].resample("MS").sum() if valor in df.columns \
        else df.set_index("_f").resample("MS").size()
    if len(mensual) >= 12:
        por_mes = mensual.groupby(mensual.index.month).mean()
        indice = por_mes / por_mes.mean()
        print("\n## Estacionalidad (promedio de cada mes ÷ promedio general)\n")
        print(" · ".join(f"{MESES[m - 1]} {indice[m]:.2f}" for m in indice.index))
        altos = [MESES[m - 1] for m in indice.index if indice[m] >= 1.15]
        if altos:
            print(f"Meses por encima del promedio (≥ 15 %): {', '.join(altos)}.")


if __name__ == "__main__":
    main()
