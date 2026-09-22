import React, { useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Separador vertical arrastrable. No sabe de anchos: informa el desplazamiento
 * acumulado desde que empezó el arrastre (`onDrag(dx, inicio)`), y el dueño del
 * layout decide y acota. Doble clic = volver al ancho por defecto.
 */
export default function Splitter({ onStart, onDrag, onReset, etiqueta = 'Redimensionar panel' }) {
  const inicio = useRef(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={etiqueta}
      title={`${etiqueta} · doble clic para restablecer`}
      tabIndex={-1}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        inicio.current = { x: e.clientX, base: onStart?.() };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        if (!inicio.current) return;
        onDrag(e.clientX - inicio.current.x, inicio.current.base);
      }}
      onPointerUp={(e) => {
        if (!inicio.current) return;
        inicio.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }}
      className={cn(
        'group relative z-20 -mx-[3px] w-[6px] shrink-0 cursor-col-resize',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
        'hover:after:bg-accent/60 active:after:bg-accent',
      )}
    />
  );
}
