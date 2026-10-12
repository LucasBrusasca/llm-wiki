import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, HeatmapChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent, CanvasRenderer,
]);

export const TIPOS_GRAFICO = [
  { id: 'barras', label: 'Barras' },
  { id: 'apiladas', label: 'Barras apiladas' },
  { id: 'lineas', label: 'Líneas' },
  { id: 'torta', label: 'Torta' },
  { id: 'dispersion', label: 'Dispersión' },
  { id: 'calor', label: 'Mapa de calor' },
];

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function tema() {
  const css = getComputedStyle(document.documentElement);
  const v = (n, d) => css.getPropertyValue(n).trim() || d;
  return {
    paleta: Array.from({ length: 10 }, (_, i) => v(`--cl-${i}`, '#22d3ee')),
    ink: v('--color-ink', '#e9edf7'),
    muted: v('--color-ink-muted', '#9aa3bd'),
    dim: v('--color-ink-dim', '#636c88'),
    hair: v('--color-hair', '#191d2e'),
    surface: v('--color-surface', '#0a0c16'),
    accent: v('--color-accent', '#22d3ee'),
  };
}

/** Por qué no se puede un tipo de gráfico con estos datos (o null si se puede). */
export function motivoNoDisponible(tipo, cruce) {
  if (!cruce?.filas.length) return 'sin datos';
  if (tipo === 'dispersion' && cruce.medidas.length < 2) return 'necesita dos valores';
  if (tipo === 'calor' && !cruce.dimsCols.length) return 'necesita un campo en Columnas';
  return null;
}

function opcion(tipo, cruce) {
  const t = tema();
  const ejes = { axisLine: { lineStyle: { color: t.hair } }, axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.hair } } };
  const base = {
    color: t.paleta,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: t.muted },
    tooltip: {
      trigger: tipo === 'torta' || tipo === 'dispersion' || tipo === 'calor' ? 'item' : 'axis',
      backgroundColor: t.surface, borderColor: t.hair, textStyle: { color: t.ink, fontSize: 12 },
      valueFormatter: (v) => (typeof v === 'number' ? fmt.format(v) : v),
    },
    legend: { type: 'scroll', top: 0, textStyle: { color: t.muted, fontSize: 11 }, pageTextStyle: { color: t.muted } },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
  };
  const categorias = cruce.filas.map((f) => f.etiquetas.join(' · ') || 'Total');
  const variasCols = cruce.dimsCols.length > 0;

  if (tipo === 'torta') {
    return {
      ...base,
      series: [{
        type: 'pie', radius: ['38%', '70%'], top: 24,
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        label: { color: t.muted, fontSize: 11 },
        data: cruce.filas.map((f, i) => ({
          name: categorias[i],
          value: cruce.columnas.reduce((s, c) => s + (f.celdas.get(c.clave)?.[0] ?? 0), 0),
        })),
      }],
    };
  }
  if (tipo === 'dispersion') {
    const c0 = cruce.columnas[0]?.clave ?? '';
    return {
      ...base,
      xAxis: { ...ejes, type: 'value', name: cruce.medidas[0].etiqueta, nameTextStyle: { color: t.dim } },
      yAxis: { ...ejes, type: 'value', name: cruce.medidas[1].etiqueta, nameTextStyle: { color: t.dim } },
      series: [{
        type: 'scatter', symbolSize: 9,
        data: cruce.filas.map((f, i) => ({ name: categorias[i], value: f.celdas.get(c0) || [null, null] })),
      }],
      tooltip: { ...base.tooltip, formatter: (p) => `${p.name}<br/>${fmt.format(p.value[0])} · ${fmt.format(p.value[1])}` },
    };
  }
  if (tipo === 'calor') {
    const datos = [];
    let max = 0;
    cruce.filas.forEach((f, y) => cruce.columnas.forEach((c, x) => {
      const v = f.celdas.get(c.clave)?.[0];
      if (v != null) { datos.push([x, y, v]); max = Math.max(max, v); }
    }));
    return {
      ...base,
      grid: { ...base.grid, bottom: 56 },
      xAxis: { ...ejes, type: 'category', data: cruce.columnas.map((c) => c.etiqueta), splitArea: { show: false } },
      yAxis: { ...ejes, type: 'category', data: categorias },
      visualMap: {
        min: 0, max: max || 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
        textStyle: { color: t.muted }, inRange: { color: [t.surface, t.accent] },
      },
      series: [{ type: 'heatmap', data: datos, label: { show: datos.length <= 120, color: t.ink, fontSize: 10,
        formatter: (p) => fmt.format(p.value[2]) } }],
    };
  }

  // Barras, barras apiladas y líneas: una serie por columna (o por medida si no hay columnas).
  const series = variasCols
    ? cruce.columnas.map((c) => ({ name: c.etiqueta, data: cruce.filas.map((f) => f.celdas.get(c.clave)?.[0] ?? null) }))
    : cruce.medidas.map((m, i) => ({ name: m.etiqueta, data: cruce.filas.map((f) => f.celdas.get('')?.[i] ?? null) }));
  const muchas = categorias.length > 30;
  return {
    ...base,
    grid: { ...base.grid, bottom: muchas ? 40 : 8 },
    xAxis: { ...ejes, type: 'category', data: categorias,
      axisLabel: { ...ejes.axisLabel, rotate: categorias.length > 8 ? 35 : 0, hideOverlap: true } },
    yAxis: { ...ejes, type: 'value', axisLabel: { ...ejes.axisLabel, formatter: (v) => fmt.format(v) } },
    dataZoom: muchas ? [{ type: 'slider', height: 16, bottom: 6, textStyle: { color: t.dim } }, { type: 'inside' }] : [],
    series: series.map((s) => ({
      ...s,
      type: tipo === 'lineas' ? 'line' : 'bar',
      stack: tipo === 'apiladas' ? 'total' : undefined,
      smooth: tipo === 'lineas' ? 0.2 : undefined,
      showSymbol: tipo === 'lineas' && categorias.length <= 40,
      barMaxWidth: 36,
    })),
  };
}

/** Gráfico de una tabla dinámica ya cruzada (lib/pivot.cruzar). `ref.png()` lo exporta. */
const Grafico = forwardRef(function Grafico({ tipo, cruce, alto = 360 }, ref) {
  const caja = useRef(null);
  const chart = useRef(null);

  useEffect(() => {
    chart.current = echarts.init(caja.current, null, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(caja.current);
    return () => { ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    if (!chart.current || !cruce || motivoNoDisponible(tipo, cruce)) return;
    chart.current.setOption(opcion(tipo, cruce), { notMerge: true });
  }, [tipo, cruce]);

  useImperativeHandle(ref, () => ({
    png: () => chart.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: tema().surface }),
  }));

  const motivo = motivoNoDisponible(tipo, cruce);
  return (
    <div className="relative" style={{ height: alto }}>
      <div ref={caja} className="size-full" style={{ visibility: motivo ? 'hidden' : 'visible' }} />
      {motivo && (
        <p className="absolute inset-0 grid place-items-center text-[12px] text-ink-dim">
          Este gráfico {motivo}.
        </p>
      )}
    </div>
  );
});

export default Grafico;
