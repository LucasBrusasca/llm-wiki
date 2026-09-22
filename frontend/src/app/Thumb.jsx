import React, { useState } from 'react';
import { iconoDe, colorFuente } from '@/lib/nodes';
import { cn } from '@/lib/utils';

// Miniaturas que ya dieron 404: no se vuelven a pedir en esta sesión, ni desde la
// lista ni desde el grafo (el backend las cachea en disco, pero el 404 no).
const fallidas = new Set();

export function tieneThumb(node) {
  return !!node && (!!node.fuente_path || !!node.fuente_url) && !fallidas.has(node.id);
}

/**
 * Miniatura del documento (`/thumb/{id}`) con caída a un ícono teñido por el
 * color de su origen. `color` permite forzar otro color (p.ej. cluster en el grafo).
 */
export default function Thumb({ node, className, color, iconClass = 'size-3.5', rounded = 'rounded-xs', eager = false }) {
  const [fallo, setFallo] = useState(() => !tieneThumb(node));
  const Icon = iconoDe(node);
  const c = color || colorFuente(node);

  return (
    <span
      className={cn('relative grid shrink-0 place-items-center overflow-hidden', rounded, className)}
      style={{ '--c': c, background: 'color-mix(in oklab, var(--c) 14%, var(--color-surface-2))' }}
    >
      {fallo ? (
        <Icon className={cn(iconClass, 'text-cat')} />
      ) : (
        <img
          src={`/thumb/${encodeURIComponent(node.id)}`}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => { fallidas.add(node.id); setFallo(true); }}
          className="size-full object-cover object-top"
        />
      )}
    </span>
  );
}
