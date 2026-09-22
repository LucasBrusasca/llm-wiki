import React from 'react';
import Thumb from '@/app/Thumb';
import { tipoMeta, fuenteLabel, colorTipo, colorFuente } from '@/lib/nodes';
import { temaDe } from '@/lib/temas';
import { fechaCorta } from '@/lib/utils';

/**
 * Tarjeta de hover para los grafos (2D y 3D). Título COMPLETO (no el label
 * truncado del nodo), tipo, origen, tema y miniatura. `pointer-events: none`:
 * nunca intercepta el mouse, así que no traba el orbit/pan ni el clic.
 * x/y son relativos al contenedor del lienzo.
 */
export default function NodoTooltip({ node, x, y, ancho, alto, temas }) {
  if (!node) return null;
  const W = 300;
  // Del lado del cursor donde haya lugar.
  const izq = ancho && x + W + 24 > ancho ? x - W - 14 : x + 14;
  const arriba = alto && y + 150 > alto ? Math.max(8, y - 150) : y + 14;
  const t = temas ? temaDe(temas, node) : null;
  const fecha = fechaCorta(node.fecha_doc);

  return (
    <div
      className="pointer-events-none absolute z-20 flex w-[300px] gap-2.5 rounded-md border border-hair-strong bg-surface/95 p-2.5 shadow-xl shadow-black/60 backdrop-blur"
      style={{ left: Math.max(8, izq), top: arriba }}
      role="tooltip"
    >
      <Thumb node={node} eager className="h-[58px] w-[46px]" iconClass="size-4" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium leading-snug text-ink [overflow-wrap:anywhere]">{node.label}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="chip-cat rounded-xs px-1.5 text-[10.5px] leading-4" style={{ '--c': colorTipo(node.type) }}>
            {tipoMeta(node.type).label}
          </span>
          {fuenteLabel(node) && (
            <span className="chip-cat rounded-xs px-1.5 text-[10.5px] leading-4" style={{ '--c': colorFuente(node) }}>
              {fuenteLabel(node)}
            </span>
          )}
          {t && t.key !== 'sin-tema' && (
            <span className="flex min-w-0 items-center gap-1 text-[10.5px] text-ink-muted">
              <span className="size-1.5 shrink-0 rounded-full dot-cat" style={{ '--c': t.color }} />
              <span className="truncate">{t.nombre}</span>
            </span>
          )}
        </div>
        {(node.autor || fecha) && (
          <p className="mt-1 truncate text-[11px] text-ink-dim">{[node.autor, fecha].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </div>
  );
}
