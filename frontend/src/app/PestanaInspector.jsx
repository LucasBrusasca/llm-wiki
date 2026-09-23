import React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { iconoDe } from '@/lib/nodes';
import { truncar } from '@/lib/utils';

/**
 * Con el panel derecho oculto queda esta pestaña en el borde: dice qué documento
 * está elegido (si hay) y lo vuelve a abrir. El centro usa todo el ancho.
 */
export default function PestanaInspector({ node, onAbrir }) {
  const Icon = node ? iconoDe(node) : PanelRightOpen;
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={node ? `Mostrar detalle de «${node.label}» · ]` : 'Mostrar panel derecho · ]'}
      aria-label="Mostrar detalle"
      className="group flex w-8 shrink-0 flex-col items-center gap-2 hairline-l bg-surface py-2.5 text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-3.5 shrink-0" />
      {/* Rótulo arriba y título debajo: abajo vive el botón del agente. */}
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em]" style={{ writingMode: 'vertical-rl' }}>
        Detalle
      </span>
      {node && (
        <span
          className="min-h-0 overflow-hidden pb-12 text-[11px] text-ink-muted"
          style={{ writingMode: 'vertical-rl' }}
        >
          {truncar(node.label, 40)}
        </span>
      )}
    </button>
  );
}
