import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import Thumb from '@/app/Thumb';
import { claveFuente, colorFuente, fuenteLabel, tipoMeta } from '@/lib/nodes';
import { cn } from '@/lib/utils';

/**
 * El detalle del 3D en HTML: texto nítido, miniatura real y las mismas piezas que
 * el resto de la app. Cada pieza vive dentro de un CSS2DObject que three.js ubica
 * sobre su nodo en cada frame (Graph3DView decide cuáles y dónde); acá sólo se
 * dibuja el contenido.
 *
 * - Tarjeta: de cerca el nodo ES su documento (la esfera se oculta). Título de hasta
 *   3 líneas (4 en el elegido); si no entra, el hover muestra el completo.
 * - Chip: rótulo al costado del punto, hasta 2 líneas.
 *
 * Nada de esto recibe el mouse: hover y clic los resuelve el raycast del lienzo
 * contra un hit-box invisible del mismo tamaño, así la rueda y el arrastre siguen
 * orbitando aunque el cursor esté sobre una tarjeta.
 */

/** Medidas en px de pantalla. Graph3DView las usa para no encimar piezas. */
export const TARJETA = {
  chica: { w: 256, h: 78 },
  grande: { w: 288, h: 92 },   // la del documento elegido
};

const CHIP = { maxW: 240, padX: 8, alto1: 22, alto2: 36 };
const FUENTE_CHIP = '500 11.5px Inter, ui-sans-serif, system-ui, sans-serif';

let lienzo = null;
const medidas = new Map();

/**
 * Medidas del chip en px, midiendo el texto con la misma fuente que su CSS. Si no
 * entra en una línea, busca el corte que deja las dos líneas más parejas y achica
 * la caja a esa medida: al ancho máximo quedaba un hueco a la derecha. `lineas: 3`
 * significa que ni así entra y el CSS lo corta con «…» (el hover muestra el título).
 */
export function medirChip(label) {
  const t = String(label || '');
  const hit = medidas.get(t);
  if (hit) return hit;
  if (!lienzo) lienzo = document.createElement('canvas').getContext('2d');
  lienzo.font = FUENTE_CHIP;
  const ancho = (s) => lienzo.measureText(s).width;
  const extra = CHIP.padX * 2 + 2 + 2;   // padding + borde + 2 px de holgura entre canvas y DOM
  const caja = (texto) => Math.ceil(texto) + extra;
  const util = CHIP.maxW - extra;
  const tw = ancho(t);
  let m;
  if (tw <= util) {
    m = { w: caja(tw), h: CHIP.alto1, lineas: 1 };
  } else {
    const palabras = t.split(/\s+/);
    let mejor = Infinity;
    for (let i = 1; i < palabras.length; i++) {
      if (/^[—–\-·|:,.;)]/.test(palabras[i])) continue;   // la segunda línea no arranca con «— …»
      const peor = Math.max(ancho(palabras.slice(0, i).join(' ')), ancho(palabras.slice(i).join(' ')));
      if (peor <= util && peor < mejor) mejor = peor;
    }
    m = mejor < Infinity
      ? { w: caja(mejor), h: CHIP.alto2, lineas: 2 }
      : { w: CHIP.maxW, h: CHIP.alto2, lineas: 3 };
  }
  // Con Inter todavía cargando se mide con otra fuente: no guardar ese valor.
  if (document.fonts?.check?.(FUENTE_CHIP) !== false) medidas.set(t, m);
  return m;
}

function Tarjeta({ node, estado, color, grande, hover }) {
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
        'flex items-center motion-safe:animate-aparecer gap-2.5 rounded-md border p-2 shadow-lg shadow-black/50',
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
    </div>
  );
}

function Chip({ node, estado, hover, medida }) {
  const fuerte = estado === 'sel' || estado === 'pin';
  return (
    // --sep: distancia al centro del punto (la fija Graph3DView según el radio en pantalla).
    <div style={{ paddingLeft: 'var(--sep, 14px)' }}>
      <div
        className={cn(
          'w-max max-w-[240px] rounded-sm border px-2 py-[3px] text-[11.5px] font-medium leading-[14px] motion-safe:animate-aparecer',
          'line-clamp-2 shadow-md shadow-black/40 [overflow-wrap:anywhere]',
          fuerte ? 'border-accent/80 bg-surface-3/95 text-ink'
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

/**
 * Monta el contenido de cada pieza visible dentro de su elemento (portal). La API es
 * imperativa para que mover la cámara no re-renderice la vista entera: sólo cambia
 * esta capa, y sólo cuando cambia el conjunto de piezas.
 */
const Etiquetas3D = forwardRef(function Etiquetas3D(_, ref) {
  const [items, setItems] = useState([]);
  const [hoverId, setHoverId] = useState(null);
  useImperativeHandle(ref, () => ({ mostrar: setItems, resaltar: setHoverId }), []);

  return items.map((it) => createPortal(
    it.tipo === 'tarjeta'
      ? <Tarjeta node={it.node} estado={it.estado} color={it.color} grande={it.grande} hover={hoverId === it.id} />
      : <Chip node={it.node} estado={it.estado} medida={it.medida} hover={hoverId === it.id} />,
    it.el,
    it.clave,
  ));
});

export default Etiquetas3D;
