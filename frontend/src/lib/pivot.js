/**
 * La tabla dinámica llega del backend en formato largo (una fila por combinación de
 * dimensiones, con sus medidas). Acá se cruza en filas × columnas, se sacan totales y
 * se arman los datos para graficar y exportar.
 */

const SEP = ' · ';

const vacio = (v) => (v === null || v === undefined || v === '' ? '(vacío)' : String(v));

/** {dimsFilas, dimsCols, medidas, filas: [{clave, etiquetas, celdas}], columnas: [{clave, etiqueta}], totales} */
export function cruzar(res) {
  const dims = res?.dimensiones || [];
  const medidas = res?.medidas || [];
  const nF = dims.filter((d) => d.eje === 'filas').length;
  const nC = dims.length - nF;
  const filasMap = new Map();
  const colsMap = new Map();
  for (const r of res?.filas || []) {
    const etiquetasF = r.slice(0, nF).map(vacio);
    const etiquetaC = nC ? r.slice(nF, nF + nC).map(vacio).join(SEP) : '';
    const claveF = etiquetasF.join('\u0000');
    if (!filasMap.has(claveF)) filasMap.set(claveF, { clave: claveF, etiquetas: etiquetasF, celdas: new Map() });
    if (!colsMap.has(etiquetaC)) colsMap.set(etiquetaC, { clave: etiquetaC, etiqueta: etiquetaC });
    filasMap.get(claveF).celdas.set(etiquetaC, r.slice(nF + nC).map((v) => (v == null ? null : Number(v))));
  }
  const columnas = [...colsMap.values()];
  if (nC) columnas.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { numeric: true }));
  const filas = [...filasMap.values()];
  const totales = columnas.map((c) => medidas.map((_, m) => filas.reduce((s, f) => s + (f.celdas.get(c.clave)?.[m] ?? 0), 0)));
  return {
    dimsFilas: dims.slice(0, nF), dimsCols: dims.slice(nF), medidas, filas, columnas, totales,
  };
}

const num = (v) => (v == null || Number.isNaN(v) ? '' : String(Math.round(v * 1000) / 1000));

/** La tabla cruzada como CSV (lo que se ve, con encabezados). */
export function aCSV(cruce) {
  const { dimsFilas, medidas, filas, columnas } = cruce;
  const cab = [...dimsFilas.map((d) => d.etiqueta)];
  for (const c of columnas) for (const m of medidas) cab.push([c.etiqueta, m.etiqueta].filter(Boolean).join(SEP));
  const lineas = [cab];
  for (const f of filas) {
    const fila = [...f.etiquetas];
    for (const c of columnas) for (let m = 0; m < medidas.length; m++) fila.push(num(f.celdas.get(c.clave)?.[m]));
    lineas.push(fila);
  }
  const esc = (s) => (/[",\n;]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  return lineas.map((l) => l.map(esc).join(',')).join('\n');
}

export function descargar(nombre, texto, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', texto], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** El gráfico que mejor cuenta lo que hay: tiempo → líneas; dos ejes → barras apiladas. */
export function graficoSugerido(spec, cruce) {
  if ((spec.filas || [])[0]?.fecha) return 'lineas';
  if (cruce.dimsCols.length) return 'apiladas';
  if (cruce.medidas.length >= 2 && !cruce.dimsFilas.length) return 'barras';
  return 'barras';
}
