import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCw, Loader2, Download, Image as ImageIcon, FileText, Printer, BarChart3, Table2, Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchReporte } from '@/lib/api';
import { cruzar, aCSV, descargar } from '@/lib/pivot';
import Grafico, { pngClaro, motivoNoDisponible, TIPOS_GRAFICO } from '@/app/Grafico';
import { TablaCruzada } from '@/app/ExploradorDatos';
import { abrirExplorador } from '@/lib/eventos';
import { cn } from '@/lib/utils';

const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** La tabla cruzada en HTML plano (la misma que se ve, con totales si suman). */
function tablaHTML({ dimsFilas, medidas, filas, columnas, totales }) {
  const unaMedida = medidas.length === 1;
  const sumables = medidas.every((m) => /^(Suma|Cantidad)/.test(m.etiqueta));
  const celdas = (f) => columnas.flatMap((c) => medidas.map((_, k) => {
    const v = f.celdas.get(c.clave)?.[k];
    return `<td class="n">${v == null ? '' : fmt.format(v)}</td>`;
  })).join('');
  const cab = [
    ...dimsFilas.map((d) => `<th>${esc(d.etiqueta)}</th>`),
    ...columnas.flatMap((c) => medidas.map((m) => `<th class="n">${esc(c.etiqueta && unaMedida ? c.etiqueta : [c.etiqueta, m.etiqueta].filter(Boolean).join(' · '))}</th>`)),
  ].join('');
  const cuerpo = filas.map((f) => `<tr>${f.etiquetas.map((e) => `<td>${esc(e)}</td>`).join('')}${celdas(f)}</tr>`).join('\n');
  const pie = sumables && filas.length > 1
    ? `<tfoot><tr>${dimsFilas.length ? `<td colspan="${dimsFilas.length}">Total</td>` : ''}${columnas.flatMap((c, ci) => medidas.map((_, k) => `<td class="n">${fmt.format(totales[ci][k])}</td>`)).join('')}</tr></tfoot>`
    : '';
  return `<table><thead><tr>${cab}</tr></thead><tbody>\n${cuerpo}\n</tbody>${pie}</table>`;
}

/** Un reporte autocontenido (sin red): título, de dónde sale, el gráfico en claro, la
 *  tabla y el SQL. Se descarga como .html o se imprime a PDF. */
function htmlReporte({ reporte, datos, resultado }, cruce, png) {
  const fecha = new Date().toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });
  const tipo = TIPOS_GRAFICO.find((g) => g.id === reporte.tipo)?.label || 'Gráfico';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(reporte.titulo)}</title>
<style>
  body { font: 13px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; background: #fff; margin: 32px auto; max-width: 1000px; padding: 0 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 12px; margin: 0 0 20px; }
  img { width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tfoot td { font-weight: 600; border-top: 2px solid #d1d5db; }
  details { margin-top: 24px; color: #6b7280; font-size: 11px; }
  pre { white-space: pre-wrap; background: #f9fafb; padding: 8px; border-radius: 4px; }
  @media print { body { margin: 0; max-width: none; } details { display: none; } thead { display: table-header-group; } tr, img { break-inside: avoid; } }
</style></head><body>
<h1>${esc(reporte.titulo)}</h1>
<p class="meta">${esc(reporte.desc || '')}<br>Fuente: ${esc(datos.label)} · ${resultado.filas.length} filas${resultado.truncado ? ' (recortado)' : ''} · ${esc(fecha)}</p>
${png ? `<img src="${png}" alt="${esc(tipo)}">` : ''}
${tablaHTML(cruce)}
<details><summary>SQL que se corrió</summary><pre>${esc(resultado.sql)}</pre></details>
</body></html>`;
}

/** Imprimir sin abrir otra pestaña: un iframe invisible con el reporte. */
function imprimir(html) {
  const f = Object.assign(document.createElement('iframe'), { srcdoc: html, title: 'reporte' });
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.onload = () => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 60000);
  };
  document.body.appendChild(f);
}

/**
 * Un nodo REPORTE en el inspector: la tabla dinámica guardada, corrida otra vez sobre
 * los datos de hoy. Se ve como tabla o gráfico, se sigue trabajando en el explorador y
 * se exporta (CSV, PNG, HTML o PDF).
 */
export default function ReporteVista({ node }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState(null);
  const [hora, setHora] = useState(null);
  const pedido = useRef(0);

  const cargar = useCallback((actualizar = false) => {
    const n = ++pedido.current;
    setCargando(true);
    setError(null);
    fetchReporte(node.id, { actualizar })
      .then((r) => { if (n === pedido.current) { setD(r); setHora(new Date()); } })
      .catch((e) => { if (n === pedido.current) setError(e.message); })
      .finally(() => { if (n === pedido.current) setCargando(false); });
  }, [node.id]);

  useEffect(() => { setD(null); setVista(null); cargar(); }, [cargar]);

  const cruce = useMemo(() => (d ? cruzar(d.resultado) : null), [d]);
  const tipo = d?.reporte.tipo || 'barras';
  const v = vista || d?.reporte.vista || 'tabla';
  const archivo = (node.label || 'reporte').replace(/[^\p{L}\p{N}.-]+/gu, '_').slice(0, 80);
  const png = () => pngClaro(tipo, cruce);
  const html = () => htmlReporte(d, cruce, png());

  if (error && !d) {
    return <pre className="m-4 whitespace-pre-wrap rounded-sm border border-danger/30 bg-danger/[0.06] p-2 text-[11.5px] text-danger">{error}</pre>;
  }
  if (!d) {
    return <p className="flex items-center gap-1.5 p-4 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Corriendo el reporte…</p>;
  }

  return (
    <div className="flex flex-col gap-2 p-4 pb-6">
      <p className="text-[11.5px] leading-relaxed text-ink-dim">
        <Database className="mr-1 inline size-3 -translate-y-px" />
        {d.datos.label} · {d.resultado.filas.length} filas{d.resultado.truncado ? ' (recortado)' : ''} · {d.resultado.duracion_ms} ms
        {hora && <> · datos de las {hora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</>}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-sm border border-hair p-0.5 text-[11.5px] text-ink-dim">
          {[['tabla', 'Tabla', Table2], ['grafico', 'Gráfico', BarChart3]].map(([id, l, I]) => (
            <button key={id} type="button" onClick={() => setVista(id)}
              className={cn('flex items-center gap-1 rounded-xs px-2 py-0.5', v === id ? 'bg-surface-3 text-ink' : 'hover:text-ink')}>
              <I className="size-3" /> {l}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => cargar(true)} disabled={cargando} title="Volver a correrlo y anotarlo en Corridas">
          {cargando ? <Loader2 className="animate-spin" /> : <RotateCw />} Actualizar
        </Button>
        <Button variant="ghost" size="sm" title="Seguir trabajándolo en la tabla dinámica"
          onClick={() => abrirExplorador(d.datos, null, { spec: d.reporte.spec, vista: d.reporte.vista, tipo: d.reporte.tipo })}>
          <BarChart3 /> Explorador
        </Button>
      </div>

      {error && <pre className="whitespace-pre-wrap rounded-sm border border-danger/30 bg-danger/[0.06] p-2 text-[11.5px] text-danger">{error}</pre>}

      {v === 'tabla'
        ? <div className="[&>div]:max-h-[440px]"><TablaCruzada cruce={cruce} /></div>
        : <div className="rounded-md border border-hair p-1.5"><Grafico tipo={tipo} cruce={cruce} alto={300} /></div>}

      <div className="flex flex-wrap items-center gap-1 pt-1">
        <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">Exportar</span>
        <Button variant="ghost" size="sm" onClick={() => descargar(`${archivo}.csv`, aCSV(cruce))}><Download /> CSV</Button>
        <Button variant="ghost" size="sm" disabled={!!motivoNoDisponible(tipo, cruce)} onClick={() => {
          const url = png();
          if (url) Object.assign(document.createElement('a'), { href: url, download: `${archivo}.png` }).click();
        }}><ImageIcon /> PNG</Button>
        <Button variant="ghost" size="sm" onClick={() => descargar(`${archivo}.html`, html(), 'text/html;charset=utf-8')}><FileText /> HTML</Button>
        <Button variant="ghost" size="sm" onClick={() => imprimir(html())} title="Abre el diálogo de impresión: elegí «Guardar como PDF»"><Printer /> PDF</Button>
      </div>

      <details className="pt-1">
        <summary className="cursor-pointer list-none text-[11px] text-ink-dim hover:text-ink">SQL que se corrió ▸</summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded-sm bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-ink-muted">{d.resultado.sql}</pre>
      </details>
    </div>
  );
}
