import React from 'react';
import { Search, List, Columns2, Share2, RotateCw } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const VISTAS = [
  { id: 'lista', label: 'Lista', icon: List, key: '1' },
  { id: 'split', label: 'Split', icon: Columns2, key: '2' },
  { id: 'grafo', label: 'Grafo', icon: Share2, key: '3' },
];

/** Marca: dos nodos y una arista. Sin gradientes. */
function Marca() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden>
      <rect x="0.5" y="0.5" width="19" height="19" rx="5" className="fill-surface-3 stroke-hair-strong" />
      <line x1="6.5" y1="13.5" x2="13.5" y2="6.5" className="stroke-ink-dim" strokeWidth="1.2" />
      <circle cx="6.5" cy="13.5" r="2.2" className="fill-ink" />
      <circle cx="13.5" cy="6.5" r="2.2" className="fill-accent" />
    </svg>
  );
}

export default function Topbar({ seccion, total, vista, onVista, onOpenPalette, onReload, loading }) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <header className="flex items-center gap-3 hairline-b bg-surface px-3">
      <div className="flex w-[244px] shrink-0 items-center gap-2">
        <Marca />
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Algedi</span>
        <span className="text-ink-dim">/</span>
        <span className="truncate text-[13px] capitalize text-ink-muted">{seccion}</span>
        {total > 0 && <span className="text-[11px] text-ink-dim">{total}</span>}
      </div>

      <button
        onClick={onOpenPalette}
        className="group flex h-7 w-full max-w-[460px] items-center gap-2 rounded-sm border border-hair bg-surface-2 px-2 text-left text-[12.5px] text-ink-dim transition-colors hover:border-hair-strong"
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
        <div role="tablist" aria-label="Vista" className="flex h-7 items-center rounded-sm border border-hair bg-surface-2 p-0.5">
          {VISTAS.map((v) => {
            const Icon = v.icon;
            const activa = vista === v.id;
            return (
              <Hint key={v.id} texto={`${v.label} · tecla ${v.key}`}>
                <button
                  role="tab"
                  aria-selected={activa}
                  onClick={() => onVista(v.id)}
                  className={cn(
                    'flex h-full items-center gap-1.5 rounded-xs px-2 text-[12px] transition-colors',
                    activa ? 'bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-hair-strong)]' : 'text-ink-dim hover:text-ink',
                  )}
                >
                  <Icon className="size-3.5" />
                  {v.label}
                </button>
              </Hint>
            );
          })}
        </div>
      </div>
    </header>
  );
}
