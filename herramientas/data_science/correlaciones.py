"""Correlaciones.

Sirve para: medir qué tan relacionadas están las columnas numéricas entre sí (Pearson,
lineal, y Spearman, por rangos) y detectar variables redundantes o que se mueven junto
con una variable de interés.
Necesita: una tabla con al menos dos columnas numéricas; opcionalmente, una columna
objetivo.
Entrega: los pares de columnas más correlacionados y, si hay objetivo, la correlación de
cada columna con él. Genera un reporte HTML con heatmap.
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

ARTIFACTS = ["report.html"]

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


def color_correlacion(v):
    """Color para el heatmap: rojo (negativo) → blanco (0) → azul (positivo)."""
    if np.isnan(v):
        return "#888"
    if v >= 0:
        intensidad = int(min(255, v * 255))
        return f"rgb({255 - intensidad}, {255 - intensidad}, 255)"
    else:
        intensidad = int(min(255, -v * 255))
        return f"rgb(255, {255 - intensidad}, {255 - intensidad})"


def generar_html(archivo, df, pearson, spearman, objetivo, pares, fuertes):
    """Genera un reporte HTML autocontenido con tablas y heatmap inline."""
    cols = list(df.columns)
    
    heatmap_rows = []
    for col_a in cols:
        celdas = []
        for col_b in cols:
            v = spearman.loc[col_a, col_b]
            color = color_correlacion(v)
            txt = fmt(v, 2) if col_a != col_b else "1.00"
            celdas.append(f'<td style="background:{color};text-align:center;padding:4px;font-size:11px">{txt}</td>')
        heatmap_rows.append(f'<tr><th style="text-align:left;padding:4px;font-size:11px">{col_a}</th>{"".join(celdas)}</tr>')
    
    header_celdas = "".join(f'<th style="padding:4px;font-size:11px;writing-mode:vertical-lr;transform:rotate(180deg)">{c}</th>' for c in cols)
    heatmap_html = f'''
    <table style="border-collapse:collapse;margin:1em 0">
      <thead><tr><th></th>{header_celdas}</tr></thead>
      <tbody>{"".join(heatmap_rows)}</tbody>
    </table>
    '''
    
    def tabla_html(filas, columnas):
        header = "".join(f'<th style="padding:6px 10px;text-align:left;border-bottom:2px solid #333">{c}</th>' for c in columnas)
        rows = []
        for f in filas:
            celdas = "".join(f'<td style="padding:6px 10px;border-bottom:1px solid #ddd">{fmt(f.get(c, ""), 3)}</td>' for c in columnas)
            rows.append(f'<tr>{celdas}</tr>')
        return f'<table style="border-collapse:collapse;margin:1em 0"><thead><tr>{header}</tr></thead><tbody>{"".join(rows)}</tbody></table>'
    
    objetivo_html = ""
    if objetivo in df.columns:
        filas_obj = [{"columna": c, "pearson": pearson.loc[c, objetivo], "spearman": spearman.loc[c, objetivo]}
                     for c in cols if c != objetivo]
        filas_obj.sort(key=lambda f: -abs(f["spearman"]))
        objetivo_html = f'''
        <h2>Correlación con «{objetivo}»</h2>
        {tabla_html(filas_obj, ["columna", "pearson", "spearman"])}
        '''
    
    pares_html = tabla_html(pares[:15], ["columna A", "columna B", "pearson", "spearman"])
    
    redundancia = f"<p><strong>{len(fuertes)} pares con |ρ| ≥ 0.8</strong> (posible redundancia).</p>" if fuertes else "<p>Ningún par con |ρ| ≥ 0.8: no hay redundancia fuerte.</p>"
    
    html = f'''<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Correlaciones — {archivo}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
           max-width: 900px; margin: 0 auto; padding: 20px; color: #333; line-height: 1.5; }}
    h1 {{ color: #1a1a2e; border-bottom: 2px solid #22d3ee; padding-bottom: 10px; }}
    h2 {{ color: #16213e; margin-top: 2em; }}
    table {{ font-size: 13px; }}
    .nota {{ background: #f0f9ff; border-left: 3px solid #22d3ee; padding: 10px 15px; margin: 1em 0; }}
    .leyenda {{ display: flex; align-items: center; gap: 20px; margin: 1em 0; font-size: 12px; }}
    .leyenda-barra {{ width: 200px; height: 20px; 
      background: linear-gradient(to right, rgb(255,0,0), rgb(255,255,255), rgb(0,0,255)); }}
  </style>
</head>
<body>
  <h1>Correlaciones en {archivo}</h1>
  
  <h2>Matriz de correlación (Spearman)</h2>
  <div class="leyenda">
    <span>-1</span>
    <div class="leyenda-barra"></div>
    <span>+1</span>
  </div>
  {heatmap_html}
  
  {objetivo_html}
  
  <h2>Pares más correlacionados</h2>
  {pares_html}
  {redundancia}
  
  <div class="nota">
    <strong>Nota:</strong> Correlación no es causalidad. Mide co-movimiento, no efecto.
    Pearson mide relaciones lineales; Spearman mide relaciones monotónicas (incluso no lineales).
  </div>
</body>
</html>'''
    
    with open("report.html", "w", encoding="utf-8") as f:
        f.write(html)


def main():
    archivo = P.get("datos")
    df = leer_tabla(archivo).select_dtypes(include="number")
    df = df.loc[:, df.nunique() > 1]
    if df.shape[1] < 2:
        sys.exit("Hacen falta al menos dos columnas numéricas con variación.")
    pearson, spearman = df.corr(method="pearson"), df.corr(method="spearman")
    print(f"# Correlaciones en {archivo}\n")
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
    
    generar_html(archivo, df, pearson, spearman, objetivo, pares, fuertes)
    print(f"\n✓ Reporte HTML generado: report.html")


if __name__ == "__main__":
    main()
