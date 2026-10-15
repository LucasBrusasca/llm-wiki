import React from 'react';
import { Search, List, Columns2, Share2, Orbit, Box, RotateCw } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const VISTAS = [
  { id: 'lista', label: 'Lista', icon: List, key: '1' },
  { id: 'split', label: 'Split', icon: Columns2, key: '2' },
  { id: 'grafo', label: 'Grafo', icon: Share2, key: '3' },
  { id: '3d', label: '3D', icon: Orbit, key: '4' },
  { id: '4d', label: '4D', icon: Box, key: '5' },
];

/** Marca: dos nodos y una arista; el nodo activo toma el acento con halo. */
/** Algedi es una estrella doble (α Capricorni): dos estrellas unidas por su órbita,
 *  como dos documentos unidos por una relación. */
function Marca() {
  return (
    <svg viewBox="0 0 24 24" className="size-[26px]" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" className="fill-surface-3 stroke-hair-strong" />
      <ellipse cx="11.15" cy="12.8" rx="8.3" ry="3" transform="rotate(-44 11.15 12.8)" fill="none" className="stroke-ink-dim" strokeWidth="0.7" opacity="0.6" />
      <circle cx="14.6" cy="9.3" r="5.2" className="fill-accent" opacity="0.16" />
      <path d="M14.60 3.10 Q15.84 8.06 20.80 9.30 Q15.84 10.54 14.60 15.50 Q13.36 10.54 8.40 9.30 Q13.36 8.06 14.60 3.10Z" className="fill-accent" />
      <path d="M7.70 12.90 Q8.38 15.62 11.10 16.30 Q8.38 16.98 7.70 19.70 Q7.02 16.98 4.30 16.30 Q7.02 15.62 7.70 12.90Z" className="fill-ink" />
    </svg>
  );
}

function Segmentado({ items, value, onChange, etiqueta, hint }) {
  return (
    <div role="tablist" aria-label={etiqueta} className="flex h-7 items-center rounded-sm border border-hair bg-surface-2 p-0.5">
      {items.map((v) => {
        const Icon = v.icon;
        const activa = value === v.id;
        return (
          <Hint key={v.id} texto={hint?.(v)}>
            <button
              role="tab"
              aria-selected={activa}
              onClick={() => onChange(v.id)}
              className={cn(
                'flex h-full items-center gap-1.5 rounded-xs px-2 text-[12px] transition-colors',
                activa ? 'bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-hair-strong)]' : 'text-ink-dim hover:text-ink',
              )}
            >
              <Icon className={cn('size-3.5', activa && 'text-accent')} />
              {v.label}
            </button>
          </Hint>
        );
      })}
    </div>
  );
}

export default function Topbar({ seccion, total, vista, onVista, onOpenPalette, onReload, loading, jobsBadge }) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <header className="flex items-center gap-3 hairline-b bg-surface/90 px-3 backdrop-blur">
      <div className="flex w-[260px] shrink-0 items-center gap-2.5">
        <Marca />
        <span className="text-[15px] font-semibold tracking-[-0.02em]">Algedi</span>
        <span className="text-ink-dim">/</span>
        <span className="truncate text-[13px] capitalize text-ink-muted">{seccion}</span>
        {total > 0 && <span className="text-[11px] text-ink-dim">{total}</span>}
      </div>

      <button
        onClick={onOpenPalette}
        className="group flex h-9 w-full max-w-[460px] items-center gap-2 rounded-sm border border-hair bg-surface-2 px-2.5 text-left text-[12.5px] text-ink-dim transition-colors hover:border-hair-strong"
      >
        <Search className="size-3.5" />
        <span className="flex-1 truncate">Buscar documentos, secciones, acciones…</span>
        <kbd className="rounded-xs border border-hair-strong px-1 text-[10.5px] text-ink-dim">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {jobsBadge}
        <Hint texto="Recargar sección">
          <Button variant="ghost" size="icon" onClick={onReload} aria-label="Recargar">
            <RotateCw className={cn(loading && 'animate-spin')} />
          </Button>
        </Hint>
        <Segmentado
          etiqueta="Vista"
          items={VISTAS}
          value={vista}
          onChange={onVista}
          hint={(v) => `${v.label} · tecla ${v.key}`}
        />
      </div>
    </header>
  );
}
