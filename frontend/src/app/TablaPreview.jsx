import React, { useEffect, useState } from 'react';
import { Loader2, BarChart3, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchTabla } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Grilla de sólo lectura de un xlsx/xls/csv, con selector de hoja y un resumen
 * por columna (no vacíos, distintos, min/máx/promedio). No edita nada.
 */
export default function TablaPreview({ node }) {
  const [datos, setDatos] = useState(null);
  const [hoja, setHoja] = useState(null);
  const [error, setError] = useState(null);
  const [verStats, setVerStats] = useState(false);

  useEffect(() => { setHoja(null); setVerStats(false); }, [node.id]);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    fetchTabla(node.id, { hoja, limite: 200, stats: verStats })
      .then((d) => vivo && setDatos(d))
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [node.id, hoja, verStats]);

  if (error) return <p className="text-[12px] text-danger">No se pudo leer la tabla: {error}</p>;
  if (!datos) return <p className="flex items-center gap-1.5 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo la planilla…</p>;

  const { columnas = [], filas = [], hojas = [], total_filas: total = 0, stats } = datos;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-dim">
        <span className="flex items-center gap-1"><Table2 className="size-3.5" /> {total} filas · {columnas.length} columnas</span>
        {hojas.length > 1 && (
          <select
            value={datos.hoja || ''}
            onChange={(e) => setHoja(e.target.value)}
            className="h-6 rounded-sm border border-hair bg-surface-2 px-1 text-[11.5px] text-ink"
            aria-label="Hoja"
          >
            {hojas.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setVerStats((v) => !v)}>
          <BarChart3 /> {verStats ? 'Ver tabla' : 'Resumen de columnas'}
        </Button>
      </div>

      {verStats && stats ? (
        <ul className="flex flex-col gap-1.5">
          {stats.map((c) => (
            <li key={c.columna} className="rounded-sm border border-hair bg-surface-2 px-2.5 py-2">
              <p className="flex items-center gap-2 text-[12px] text-ink">
                {c.columna}
                <span className="text-[10.5px] text-ink-dim">{c.numerica ? 'numérica' : 'texto'}</span>
              </p>
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                {c.no_vacios} con dato · {c.vacios} vacíos · {c.distintos} distintos
                {c.numerica && <> · min {c.min} · máx {c.max} · promedio {c.promedio}</>}
              </p>
              {!c.numerica && c.mas_frecuentes?.length > 0 && (
                <p className="mt-0.5 truncate text-[11px] text-ink-dim">
                  más frecuentes: {c.mas_frecuentes.map((f) => `${f.valor} (${f.veces})`).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-md border border-hair">
          <table className="w-full border-collapse text-[11.5px]">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {columnas.map((c, i) => (
                  <th key={`${c}-${i}`} className="hairline-b whitespace-nowrap px-2 py-1.5 text-left font-medium text-ink">
                    {c || <span className="text-ink-dim">col {i + 1}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} className={cn(i % 2 && 'bg-surface-2/40')}>
                  {columnas.map((_, j) => (
                    <td key={j} className="max-w-[220px] truncate px-2 py-1 text-ink-muted" title={f[j]}>{f[j]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filas.length < total && !verStats && (
        <p className="text-[11px] text-ink-dim">Mostrando las primeras {filas.length} de {total} filas.</p>
      )}
    </div>
  );
}
