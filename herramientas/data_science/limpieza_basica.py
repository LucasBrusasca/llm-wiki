"""Diagnóstico de limpieza.

Sirve para: encontrar problemas de calidad antes de analizar: filas duplicadas, columnas
vacías o constantes, números guardados como texto, espacios de más y categorías que
sólo difieren en mayúsculas o espacios.
Necesita: una tabla (CSV o Excel).
Entrega: la lista de problemas encontrados, cuántos casos tiene cada uno y qué conviene
hacer.
Toca: nada, sólo lee: no corrige la tabla.
Pedidos típicos:
- ¿Los datos están limpios?
- Revisá la calidad de la tabla
- ¿Hay duplicados o errores en el CSV?
- ¿Qué hay que limpiar antes de analizar?
"""
import json
import os
import sys

import pandas as pd

PARAMETROS = {"datos": {"tipo": "tabla", "desc": "la tabla a revisar"}}
P = json.loads(os.environ.get("ALGEDI_PARAMS") or "{}")


def leer_tabla(archivo):
    if not archivo:
        sys.exit("Falta la tabla: pedile esta herramienta al agente con un nodo de datos seleccionado.")
    if archivo.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(archivo)
    return pd.read_csv(archivo, sep=None, engine="python")


def main():
    df = leer_tabla(P.get("datos"))
    problemas = []
    dup = int(df.duplicated().sum())
    if dup:
        problemas.append(f"{dup} filas duplicadas exactas → quitarlas con drop_duplicates() si no son casos reales repetidos.")
    for col in df.columns:
        s = df[col]
        vacios = int(s.isna().sum())
        if vacios == len(s):
            problemas.append(f"«{col}» está vacía → descartarla.")
            continue
        if s.nunique(dropna=True) == 1:
            problemas.append(f"«{col}» tiene un solo valor → no aporta información.")
        if vacios:
            problemas.append(f"«{col}» tiene {vacios} vacíos ({vacios / len(s):.1%}) → decidir si imputar o excluir esas filas.")
        if pd.api.types.is_numeric_dtype(s):
            continue
        texto = s.dropna().astype(str)
        como_numero = pd.to_numeric(texto.str.replace(",", ".", regex=False), errors="coerce")
        if len(texto) and como_numero.notna().mean() >= 0.9:
            problemas.append(f"«{col}» son números guardados como texto → convertir con pd.to_numeric.")
            continue
        espacios = int((texto != texto.str.strip()).sum())
        if espacios:
            problemas.append(f"«{col}» tiene {espacios} valores con espacios al principio o al final → aplicar .str.strip().")
        normal = texto.str.strip().str.casefold()
        if normal.nunique() < texto.nunique():
            grupos = texto.groupby(normal).unique()
            ejemplos = [" / ".join(map(repr, v)) for v in grupos if len(v) > 1][:3]
            problemas.append(f"«{col}» escribe la misma categoría de varias formas: {'; '.join(ejemplos)} → unificar.")
    print(f"# Diagnóstico de limpieza de {P.get('datos')}\n")
    print(f"{len(df)} filas · {df.shape[1]} columnas\n")
    if not problemas:
        print("No encontré problemas de calidad con estos criterios.")
    for p in problemas:
        print(f"- {p}")


if __name__ == "__main__":
    main()
