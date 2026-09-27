import React from 'react';
import Thumb from '@/app/Thumb';
import { TARJETA } from '@/lib/detalle';
import { claveFuente, colorFuente, fuenteLabel, tipoMeta } from '@/lib/nodes';
import { cn } from '@/lib/utils';

/**
 * Cómo se ve un nodo de cerca, igual en el grafo 2D y en el 3D (lib/detalle decide
 * cuándo). Tamaño fijo en pantalla, texto nítido y las mismas piezas que el resto de
 * la app.
 *
 * - Tarjeta: el nodo ES su documento. Miniatura real, título de hasta 3 líneas (4 en
 *   el elegido) y el origen con su color; el borde lleva el color del modo actual.
 * - Chip: rótulo al costado del punto, hasta 2 líneas con el corte parejo.
 *
 * Si el título no entra, el hover del nodo muestra el completo (NodoTooltip).
 */

export function Tarjeta({ node, estado, color, grande = false, hover = false, marcado = false }) {
  const video = claveFuente(node) === 'video';
  const fuerte = estado === 'sel' || estado === 'pin';
  const origen = fuenteLabel(node) || tipoMeta(node.type).label;
  const { w, h } = grande ? TARJETA.grande : TARJETA.chica;
  const thumb = video
    ? (grande ? 'h-[54px] w-[96px]' : 'h-[45px] w-[80px]')
    : (grande ? 'h-[76px] w-[58px]' : 'h-[62px] w-[48px]');

  return (
    <div
      className={cn(
        'relative flex items-center gap-2.5 rounded-md border p-2 shadow-lg shadow-black/50 motion-safe:animate-aparecer',
        fuerte ? 'border-accent bg-surface-3 glow-sel'
          : estado === 'origen' ? 'border-dashed border-accent-soft/70 bg-surface'
          : hover ? 'border-[var(--c)] bg-surface-2' : 'borde-cat bg-surface',
      )}
      style={{ '--c': color, width: w, height: h }}
    >
      <Thumb node={node} color={color} eager rounded="rounded-sm" className={cn(thumb, 'shadow-sm shadow-black/40')} iconClass="size-5" />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <p
          className={cn(
            'text-[12px] font-medium leading-[15px] text-ink [overflow-wrap:anywhere]',
            grande ? 'line-clamp-4' : 'line-clamp-3',
          )}
        >
          {node.label}
        </p>
        <p className="mt-auto flex min-w-0 items-center gap-1.5 text-[10.5px] leading-[14px] text-ink-dim">
          <span className="size-1.5 shrink-0 rounded-full dot-cat" style={{ '--c': colorFuente(node) }} />
          <span className="truncate">{origen}</span>
        </p>
      </div>
      {marcado && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" title="Marcado por el agente" />}
    </div>
  );
}

export function Chip({ node, estado, medida, hover = false, marcado = false }) {
  const fuerte = estado === 'sel' || estado === 'pin';
  return (
    // --sep: distancia al centro del punto (la fija cada vista según el radio en pantalla).
    <div style={{ paddingLeft: 'var(--sep, 14px)' }}>
      <div
        className={cn(
          'w-max max-w-[240px] rounded-sm border px-2 py-[3px] text-[11.5px] font-medium leading-[14px] motion-safe:animate-aparecer',
          'line-clamp-2 shadow-md shadow-black/40 [overflow-wrap:anywhere]',
          fuerte ? 'border-accent/80 bg-surface-3/95 text-ink'
            : marcado ? 'border-accent-soft/60 bg-surface/95 text-ink'
            : hover ? 'border-ink-dim bg-surface-2/95 text-ink'
            : 'border-hair-strong bg-surface/95 text-ink/90',
        )}
        // En dos líneas, el ancho justo del corte parejo (ver medirChip).
        style={medida?.lineas === 2 ? { width: medida.w } : undefined}
      >
        {node.label}
      </div>
    </div>
  );
}
