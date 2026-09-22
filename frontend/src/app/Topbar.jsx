import React from 'react';
import { Search, List, Columns2, Share2, Orbit, RotateCw } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const VISTAS = [
  { id: 'lista', label: 'Lista', icon: List, key: '1' },
  { id: 'split', label: 'Split', icon: Columns2, key: '2' },
  { id: 'grafo', label: 'Grafo', icon: Share2, key: '3' },
  { id: '3d', label: '3D', icon: Orbit, key: '4' },
];

/** Marca: dos nodos y una arista; el nodo activo toma el acento con halo. */
function Marca() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" className="fill-surface-3 stroke-hair-strong" />
      <line x1="7.5" y1="16.5" x2="16.5" y2="7.5" className="stroke-ink-dim" strokeWidth="1.3" />
      <circle cx="7.5" cy="16.5" r="2.6" className="fill-ink" />
      <circle cx="16.5" cy="7.5" r="5" className="fill-accent" opacity="0.18" />
      <circle cx="16.5" cy="7.5" r="2.6" className="fill-accent" />
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

export default function Topbar({ seccion, total, vista, onVista, onOpenPalette, onReload, loading }) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <header className="flex items-center gap-3 hairline-b bg-surface/90 px-3 backdrop-blur">
      <div className="flex w-[260px] shrink-0 items-center gap-2.5">
        <Marca />
        <span className="text-[14px] font-semibold tracking-[-0.02em]">Algedi</span>
        <span className="text-ink-dim">/</span>
        <span className="truncate text-[13px] capitalize text-ink-muted">{seccion}</span>
        {total > 0 && <span className="text-[11px] text-ink-dim">{total}</span>}
      </div>

      <button
        onClick={onOpenPalette}
        className="group flex h-8 w-full max-w-[440px] items-center gap-2 rounded-sm border border-hair bg-surface-2 px-2.5 text-left text-[12.5px] text-ink-dim transition-colors hover:border-hair-strong"
      >
        <Search className="size-3.5" />
        <span className="flex-1 truncate">Buscar documentos, secciones, acciones…</span>
        <kbd className="rounded-xs border border-hair-strong px-1 text-[10.5px] text-ink-dim">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
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
