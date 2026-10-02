import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Handle, Position, useReactFlow, useStoreApi } from 'reactflow';
import { Plus, Minus, Maximize } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { planta, fondoDe, encuadre } from '@/lib/salas';
import { cn } from '@/lib/utils';

/**
 * Habitaciones del grafo de grafos, con el aire del teseracto de Interstellar: cada
 * habitación es una caja vista de frente (marco, pared del fondo, aristas en
 * perspectiva, estantes) y adentro muestra en miniatura lo que contiene: sus propias
 * habitaciones (el edificio) o sus documentos (una sección). Entrar es hacer clic.
 */

const centro = { left: '50%', top: '50%', opacity: 0, pointerEvents: 'none', width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

/** Caja vista de frente en el rectángulo dado (coordenadas del SVG que la contiene). */
function Caja({ x, y, w, h, clase }) {
  const f = fondoDe(w, h);
  const [fx, fy] = [x + f.x, y + f.y];
  return (
    <g className={clase}>
      <rect className="caja-frente" x={x} y={y} width={w} height={h} />
      <rect className="caja-fondo" x={fx} y={fy} width={f.w} height={f.h} />
      <line x1={x} y1={y} x2={fx} y2={fy} />
      <line x1={x + w} y1={y} x2={fx + f.w} y2={fy} />
      <line x1={x} y1={y + h} x2={fx} y2={fy + f.h} />
      <line x1={x + w} y1={y + h} x2={fx + f.w} y2={fy + f.h} />
    </g>
  );
}

const SalaNode = memo(({ data }) => {
  const { w, h, color, nombre, detalle, contenido, hover, tenue, actual, vacia } = data;
  const f = fondoDe(w, h);
  // Estantes: la pared del fondo partida en franjas, como la biblioteca del teseracto.
  const estantes = [];
  for (let i = 1; i < 6; i++) estantes.push(f.y + (f.h * i) / 6);
  return (
    <div
      className="sala-2d"
      style={{ width: w, height: h, '--c': color, '--w': w }}
      data-hover={hover || undefined}
      data-tenue={tenue || undefined}
      data-actual={actual || undefined}
      data-vacia={vacia || undefined}
    >
      <Handle type="target" position={Position.Top} style={centro} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={centro} isConnectable={false} />
      <svg className="sala-2d-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <Caja x={0} y={0} w={w} h={h} clase="sala-caja" />
        {estantes.map((yy) => <line key={yy} className="sala-estante" x1={f.x} y1={yy} x2={f.x + f.w} y2={yy} />)}
        {contenido?.salas?.map((s) => (
          <g key={s.key} style={{ '--c': s.color }}>
            <Caja x={s.x} y={s.y} w={s.w} h={s.h} clase="sala-sub" />
          </g>
        ))}
        {contenido?.puntos?.map((p) => (
          <circle key={p.id} className="sala-punto" cx={p.x} cy={p.y} r={Math.max(Math.min(w, h) * 0.007, 2.5)} />
        ))}
      </svg>
      <div className="sala-2d-rotulo">
        <b>{nombre}</b>
        <span>{detalle}</span>
      </div>
    </div>
  );
});
SalaNode.displayName = 'SalaNode';

const tipos = { sala: SalaNode };

/** Fondo: un túnel de marcos que se pierde hacia el centro (el teseracto, de lejos). */
export function FondoTeseracto() {
  const marcos = [];
  for (let k = 0; k < 7; k++) {
    const s = 0.94 * 0.72 ** k;
    marcos.push({ s, o: 0.1 * (1 - k / 8) });
  }
  const min = marcos[marcos.length - 1].s;
  const [ix, iw] = [50 - 50 * min, 100 * min];
  const vigas = [];
  for (const t of [1 / 3, 2 / 3]) {
    vigas.push([100 * t, 0, ix + iw * t, ix], [100 * t, 100, ix + iw * t, ix + iw],
      [0, 100 * t, ix, ix + iw * t], [100, 100 * t, ix + iw, ix + iw * t]);
  }
  return (
    <svg className="fondo-teseracto" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {marcos.map(({ s, o }) => (
        <rect key={s} x={50 - 50 * s} y={50 - 50 * s} width={100 * s} height={100 * s} style={{ strokeOpacity: o }} />
      ))}
      {[[0, 0, ix, ix], [100, 0, ix + iw, ix], [0, 100, ix, ix + iw], [100, 100, ix + iw, ix + iw]].map(([x1, y1, x2, y2]) => (
        <line key={`${x1}-${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
      {vigas.map(([x1, y1, x2, y2]) => <line key={`${x1}-${y1}-${x2}`} className="viga" x1={x1} y1={y1} x2={x2} y2={y2} />)}
    </svg>
  );
}

/** --inv del contenedor al día con el zoom: rótulos y bordes fijos en pantalla. */
function useInvCss(store, cajaRef) {
  useEffect(() => {
    const aplicar = (zoom) => cajaRef.current?.style.setProperty('--inv', String(1 / zoom));
    aplicar(store.getState().transform[2]);
    return store.subscribe((s, prev) => { if (s.transform[2] !== prev.transform[2]) aplicar(s.transform[2]); });
  }, [store, cajaRef]);
}

/** Tamaño del lienzo en px (el encuadre y la forma de la planta dependen de él). */
function useTamano(ref) {
  const [tam, setTam] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setTam((t) => (t && Math.abs(t.W - width) < 1 && Math.abs(t.H - height) < 1 ? t : { W: width, H: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return tam;
}

function Boton({ texto, onClick, children }) {
  return (
    <Hint texto={texto} side="right">
      <button type="button" onClick={onClick} aria-label={texto}
        className="grid size-7 place-items-center text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5">
        {children}
      </button>
    </Hint>
  );
}

/**
 * Planta de habitaciones. `salas`: [{ key, nombre, detalle, color, peso, vacia?,
 * actual?, contenido?(fondo) → { salas } | { puntos } }]. `puertas`: [{ a, b, n }]
 * (relaciones entre lo que contienen): se abren al pasar el mouse por una habitación.
 * `minimo`: la porción más chica que puede ocupar una habitación (una vacía también
 * tiene que poder verse y abrirse).
 */
export function Planta({ salas, puertas = [], onEntrar, navegacion, resumen, aviso, minimo = 0.06 }) {
  const rf = useReactFlow();
  const store = useStoreApi();
  const cajaRef = useRef(null);
  const tam = useTamano(cajaRef);
  const [hoverKey, setHoverKey] = useState(null);
  const [tip, setTip] = useState(null);
  useInvCss(store, cajaRef);

  // La planta toma la forma del lienzo; sólo se recalcula si cambia lo que hay o la forma.
  const aspecto = tam ? Math.round(Math.min(Math.max((tam.W - 80) / Math.max(tam.H - 110, 1), 0.9), 2.4) * 10) / 10 : 1.6;
  const firma = salas.map((s) => `${s.key}:${s.peso}`).join('|');
  const rects = useMemo(
    () => planta(salas.map((s) => ({ key: s.key, peso: s.peso })), { ancho: 1000 * aspecto, alto: 1000, minimo }),
    [firma, aspecto, minimo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const base = useMemo(() => salas.map((s) => {
    const r = rects.get(s.key);
    const f = fondoDe(r.w, r.h);
    return { s, r, contenido: s.contenido ? s.contenido(f) : null };
  }), [salas, rects]);

  const vecinas = useMemo(() => {
    if (!hoverKey) return null;
    const m = new Map();
    for (const p of puertas) {
      if (p.a === hoverKey) m.set(p.b, p.n);
      if (p.b === hoverKey) m.set(p.a, p.n);
    }
    return m;
  }, [hoverKey, puertas]);

  const rfNodes = useMemo(() => base.map(({ s, r, contenido }) => ({
    id: s.key,
    type: 'sala',
    position: { x: r.x, y: r.y },
    data: {
      w: r.w, h: r.h, color: s.color, nombre: s.nombre, detalle: s.detalle, contenido,
      vacia: s.vacia, actual: s.actual,
      hover: hoverKey === s.key,
      tenue: !!vecinas && hoverKey !== s.key && !vecinas.has(s.key),
    },
    zIndex: hoverKey === s.key ? 10 : 5,
  })), [base, hoverKey, vecinas]);

  // Puertas: sólo las de la habitación bajo el mouse, más gruesas cuantas más relaciones.
  const maxN = puertas.reduce((m, p) => Math.max(m, p.n), 1);
  const rfEdges = useMemo(() => (hoverKey ? puertas
    .filter((p) => p.a === hoverKey || p.b === hoverKey)
    .map((p) => ({
      id: `${p.a}→${p.b}`, source: p.a, target: p.b, type: 'straight', focusable: false,
      style: { stroke: 'var(--color-accent)', strokeWidth: 1.2 + 3 * Math.sqrt(p.n / maxN), strokeOpacity: 0.85 },
      zIndex: 20,
    })) : []), [hoverKey, puertas, maxN]);

  // Encuadre propio: la planta se conoce exacta (no depende de medir los nodos).
  const ancho = 1000 * aspecto;
  const encuadrar = useCallback((duration = 0) => {
    if (!tam) return;
    rf.setViewport(encuadre({ x: 0, y: 0, w: ancho, h: 1000 }, tam.W, tam.H), { duration });
  }, [rf, tam, ancho]);
  useEffect(() => { encuadrar(); }, [encuadrar, firma]);

  const moverHover = useCallback((ev, n) => {
    const r = cajaRef.current?.getBoundingClientRect();
    if (!r) return;
    setHoverKey(n.id);
    setTip({ key: n.id, x: ev.clientX - r.left, y: ev.clientY - r.top, ancho: r.width });
  }, []);
  const soltarHover = useCallback(() => { setHoverKey(null); setTip(null); }, []);

  const salaTip = tip ? salas.find((s) => s.key === tip.key) : null;
  const puertasTip = tip ? puertas
    .filter((p) => p.a === tip.key || p.b === tip.key)
    .map((p) => ({ key: p.a === tip.key ? p.b : p.a, n: p.n }))
    .slice(0, 5) : [];
  const nombreDe = (key) => salas.find((s) => s.key === key)?.nombre || key;

  return (
    <div ref={cajaRef} className="algedi-flow fondo-grafo relative size-full overflow-hidden">
      <FondoTeseracto />
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={tipos}
        onNodeClick={(_, n) => onEntrar(n.id)}
        onNodeMouseEnter={moverHover}
        onNodeMouseMove={moverHover}
        onNodeMouseLeave={soltarHover}
        onMoveStart={() => setTip(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        minZoom={0.05}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      />

      <div className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap items-start gap-2 text-[11px] text-ink-dim">
        {navegacion}
        {resumen && <span data-hud className="whitespace-nowrap rounded-xs border border-hair bg-surface/90 px-1.5 py-0.5">{resumen}</span>}
      </div>
      {aviso && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-xs border border-hair bg-surface/95 px-2.5 py-1 text-[11.5px] text-ink-muted">
          {aviso}
        </p>
      )}

      {salaTip && (
        <div
          className="pointer-events-none absolute z-20 w-[250px] rounded-sm border border-hair-strong bg-surface/95 px-2.5 py-2 text-[11.5px] shadow-lg"
          style={{ left: Math.min(tip.x + 14, tip.ancho - 262), top: tip.y + 14 }}
        >
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <span className="size-2 shrink-0 rounded-[3px] dot-cat" style={{ '--c': salaTip.color }} />
            <span className="truncate">{salaTip.nombre}</span>
          </p>
          <p className="text-ink-dim">{salaTip.detalle}</p>
          {puertasTip.length > 0 && (
            <>
              <p className="mt-1.5 text-ink-muted">Puertas a</p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {puertasTip.map((p) => (
                  <li key={p.key} className="flex items-center justify-between gap-3">
                    <span className="truncate text-ink/90">{nombreDe(p.key)}</span>
                    <span className="shrink-0 tabular-nums text-ink-dim" title="relaciones entre sus documentos">{p.n}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-1.5 text-ink-dim">{salaTip.vacia ? 'Clic para elegirla' : 'Clic para entrar'}</p>
        </div>
      )}

      <div data-hud className={cn('absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface')}>
        <Boton texto="Acercar" onClick={() => rf.zoomIn({ duration: 150 })}><Plus /></Boton>
        <Boton texto="Alejar" onClick={() => rf.zoomOut({ duration: 150 })}><Minus /></Boton>
        <Boton texto="Encuadrar todo" onClick={() => encuadrar(250)}><Maximize /></Boton>
      </div>
    </div>
  );
}
