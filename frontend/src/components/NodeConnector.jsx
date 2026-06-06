import React, { useEffect, useRef } from 'react';

/* Conector estilo "Vigilados": línea fina con quiebre en ángulo recto desde el
   nodo (círculo de mira en su extremo) hasta el borde del panel flotante.
   Se actualiza imperativamente por refs (sin setState → cero re-renders de React
   por frame) y sólo escribe el DOM cuando las coordenadas cambian. */
export default function NodeConnector({ node, projectRef, panelRef }) {
  const svgRef    = useRef(null);
  const pathRef   = useRef(null);
  const nodeGRef  = useRef(null);
  const anchorRef = useRef(null);

  useEffect(() => {
    if (!node) return;
    let raf;
    let last = { nx: null, ny: null, ax: null, ay: null };
    const moved = (a, b) => Math.abs(a - (b ?? 1e9)) > 0.5;

    const update = () => {
      const proj = projectRef?.current;
      const panelEl = panelRef?.current;
      const svg = svgRef.current;
      if (proj && panelEl && svg) {
        const p = proj(node.x ?? 0, node.y ?? 0, node.z ?? 0);
        const rect = panelEl.getBoundingClientRect();
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && rect.width) {
          const center = rect.left + rect.width / 2;
          const ax = p.x < center ? rect.left : rect.right;
          const ay = Math.min(Math.max(p.y, rect.top + 18), rect.bottom - 18);
          const nx = p.x, ny = p.y;
          if (moved(nx, last.nx) || moved(ny, last.ny) || moved(ax, last.ax) || moved(ay, last.ay)) {
            last = { nx, ny, ax, ay };
            if (svg.style.display === 'none') svg.style.display = '';
            pathRef.current?.setAttribute('d', `M ${nx} ${ny} L ${nx} ${ay} L ${ax} ${ay}`);
            nodeGRef.current?.setAttribute('transform', `translate(${nx} ${ny})`);
            anchorRef.current?.setAttribute('cx', ax);
            anchorRef.current?.setAttribute('cy', ay);
          }
        } else if (svg.style.display !== 'none') {
          svg.style.display = 'none';
        }
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [node, projectRef, panelRef]);

  return (
    <svg ref={svgRef} className="node-connector" width="100%" height="100%">
      <path ref={pathRef} className="nc-line" />
      <g ref={nodeGRef}>
        <circle r="9" className="nc-reticle" />
        <line x1="0"   y1="-14" x2="0"  y2="-8" className="nc-tick" />
        <line x1="0"   y1="8"   x2="0"  y2="14" className="nc-tick" />
        <line x1="-14" y1="0"   x2="-8" y2="0"  className="nc-tick" />
        <line x1="8"   y1="0"   x2="14" y2="0"  className="nc-tick" />
        <circle r="1.6" className="nc-dot" />
      </g>
      <circle ref={anchorRef} r="2.5" className="nc-anchor" />
    </svg>
  );
}
