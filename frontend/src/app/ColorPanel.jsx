import React from 'react';
import { MODOS_COLOR, claveFuente, fuenteLabel, tipoMeta } from '@/lib/nodes';
import { temaDe } from '@/lib/temas';
import { cn } from '@/lib/utils';

/** Qué significa cada color en el modo actual, contando sólo lo que está a la vista. */
export function calcularLeyenda(nodes, visibleIds, colorMode, temas, max = 8) {
  const modo = MODOS_COLOR[colorMode] || MODOS_COLOR.cluster;
  const m = new Map();
  for (const n of nodes) {
    if (!visibleIds.has(n.id)) continue;
    let k; let label; let color;
    if (colorMode === 'tipo') { k = n.type || 'otro'; label = tipoMeta(n.type).plural; color = modo.de(n); }
    else if (colorMode === 'fuente') { k = claveFuente(n); label = fuenteLabel(n) || 'Otro'; color = modo.de(n); }
    else {
      const t = temaDe(temas, n);
      k = t.key; label = t.nombre; color = t.color;
    }
    const cur = m.get(k) || { k, label, color, n: 0 };
    cur.n += 1;
    m.set(k, cur);
  }
  return [...m.values()]
    .sort((a, b) => (a.k === 'sin-tema') - (b.k === 'sin-tema') || b.n - a.n)
    .slice(0, max);
}

/** Selector de "color por" + leyenda. Lo usan el grafo 2D y el 3D. */
export default function ColorPanel({ modo, onModo, leyenda }) {
  return (
    <div className="pointer-events-auto ml-auto flex w-[250px] flex-col gap-1.5 rounded-sm border border-hair bg-surface/90 p-1.5 backdrop-blur">
      <div className="flex items-center gap-1">
        <span className="px-1 text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">Color</span>
        {Object.entries(MODOS_COLOR).map(([k, m]) => (
          <button
            key={k}
            type="button"
            onClick={() => onModo(k)}
            className={cn(
              'rounded-xs px-1.5 py-0.5 text-[11px] transition-colors',
              modo === k ? 'bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-hair-strong)]' : 'text-ink-dim hover:text-ink',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {leyenda.length > 0 && (
        <ul className="flex flex-col gap-0.5 px-1">
          {leyenda.map((l) => (
            <li key={l.k} className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-muted" style={{ '--c': l.color }}>
              <span className="size-2 shrink-0 rounded-full dot-cat" />
              <span className="truncate">{l.label}</span>
              <span className="ml-auto text-ink-dim">{l.n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
