"""Genera clientes_demo.csv: datos INVENTADOS para probar las herramientas.

600 clientes de un servicio por suscripción, con relaciones plantadas a propósito para
que cada herramienta tenga algo que encontrar:
- el abandono sube con los reclamos, la baja satisfacción, la poca antigüedad y el
  plan Básico;
- el gasto depende del plan y del uso;
- hay altas que crecen con el tiempo y algo de estacionalidad (picos en marzo y
  septiembre).
También trae los problemas típicos que la limpieza tiene que ver: filas duplicadas,
edades vacías, regiones con espacios de más y un par de gastos fuera de escala.

Uso: python herramientas/ejemplos/generar_clientes_demo.py  (semilla fija: siempre igual)
"""
import csv
from datetime import date, timedelta
from pathlib import Path

import numpy as np

SALIDA = Path(__file__).with_name("clientes_demo.csv")


def main():
    rng = np.random.default_rng(20261011)
    n = 600
    regiones = np.array(["Norte", "Sur", "Centro", "Cuyo", "Patagonia"])
    planes = np.array(["Básico", "Estándar", "Premium"])

    region = rng.choice(regiones, n, p=[0.2, 0.2, 0.35, 0.15, 0.1])
    plan = rng.choice(planes, n, p=[0.45, 0.35, 0.2])
    edad = rng.integers(18, 75, n).astype(float)
    antiguedad = np.clip(rng.gamma(2.0, 9.0, n).round(), 1, 72)
    ingresos = np.round(rng.lognormal(13.2, 0.45, n), -2)
    uso = np.round(np.clip(rng.normal(35, 15, n) + (plan == "Premium") * 25, 1, None), 1)
    reclamos = rng.poisson(0.6 + (plan == "Básico") * 0.8, n)
    satisfaccion = np.clip(np.round(4.2 - 0.6 * reclamos + rng.normal(0, 0.7, n)), 1, 5)
    base_plan = np.select([plan == "Básico", plan == "Estándar"], [9000, 15000], 24000)
    gasto = np.round(base_plan + uso * 120 + rng.normal(0, 1500, n), -1)

    logit = (-1.2 + 0.55 * reclamos - 0.7 * (satisfaccion - 3) - 0.035 * antiguedad
             + 0.6 * (plan == "Básico") - 0.4 * (plan == "Premium"))
    abandono = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)

    # Altas entre 2023 y 2025, más en los últimos meses y con picos en marzo y septiembre.
    inicio = date(2023, 1, 1)
    dias = np.sort(rng.beta(1.6, 1.0, n) * 1095).astype(int)
    fechas = [inicio + timedelta(days=int(d)) for d in dias]
    for i, f in enumerate(fechas):
        if f.month not in (3, 9) and rng.random() < 0.12:
            fechas[i] = f.replace(month=3 if f.month < 7 else 9, day=min(f.day, 28))

    # Problemas de calidad, a propósito.
    edad[rng.choice(n, 18, replace=False)] = np.nan
    gasto[rng.choice(n, 2, replace=False)] *= 25
    region = region.astype(object)
    for i in rng.choice(n, 9, replace=False):
        region[i] = f" {region[i]}"

    filas = []
    for i in range(n):
        filas.append({
            "cliente_id": f"C{1000 + i}",
            "fecha_alta": fechas[i].isoformat(),
            "region": region[i],
            "plan": plan[i],
            "edad": "" if np.isnan(edad[i]) else int(edad[i]),
            "antiguedad_meses": int(antiguedad[i]),
            "ingresos_mensuales": int(ingresos[i]),
            "uso_mensual_gb": uso[i],
            "reclamos": int(reclamos[i]),
            "satisfaccion": int(satisfaccion[i]),
            "gasto_mensual": int(gasto[i]),
            "abandono": int(abandono[i]),
        })
    filas.extend(filas[i] for i in rng.choice(n, 6, replace=False))   # duplicados

    with SALIDA.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(filas[0]))
        w.writeheader()
        w.writerows(filas)
    print(f"{SALIDA.name}: {len(filas)} filas, abandono {abandono.mean():.0%}")


if __name__ == "__main__":
    main()
