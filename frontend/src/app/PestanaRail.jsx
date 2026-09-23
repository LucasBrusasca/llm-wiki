import React from 'react';
import { PanelLeftOpen } from 'lucide-react';

/**
 * Con el rail izquierdo oculto queda esta pestaña en el borde: es el ÚNICO control
 * visible para traerlo de vuelta (el atajo `[` no dibuja nada). Misma regla que la
 * pestaña del inspector: un solo lugar donde volver, no dos.
 */
export default function PestanaRail({ seccion, onAbrir }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      title="Mostrar la barra de secciones · ["
      aria-label="Mostrar barra de secciones"
      className="group flex w-8 shrink-0 flex-col items-center gap-2 hairline-r bg-surface py-2.5 text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <PanelLeftOpen className="size-3.5 shrink-0" />
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em]" style={{ writingMode: 'vertical-rl' }}>
        Secciones
      </span>
      {seccion && (
        <span className="min-h-0 overflow-hidden text-[11px] capitalize text-ink-muted" style={{ writingMode: 'vertical-rl' }}>
          {seccion}
        </span>
      )}
    </button>
  );
}
