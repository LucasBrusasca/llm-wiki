import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background, Handle, Position, ReactFlowProvider, useReactFlow, useStore,
} from 'reactflow';
import 'reactflow/dist/base.css';
import { Plus, Minus, Maximize, Waypoints, Pin, PinOff, Link2, X } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import ColorPanel, { calcularLeyenda } from '@/app/ColorPanel';
import NodoTooltip from '@/app/NodoTooltip';
import Thumb from '@/app/Thumb';
import { cn, truncar } from '@/lib/utils';

const W = 172;          // ancho de la tarjeta de nodo
const H = 30;           // alto (entra una miniatura de 20×24)
const W_SEL = 250;      // el elegido muestra su título completo (hasta 3 líneas)
const ZOOM_LEJOS = 0.55; // por debajo, las tarjetas pasan a punto (vista de conjunto)
const K_FUERTES = 2;    // aristas por nodo en el modo "fuertes"

/**
 * Layout de fuerzas determinístico (Fruchterman–Reingold simple).
 * Se siembra con las coordenadas del backend (proyección de embeddings) para que
 * los temas arranquen cerca, y las aristas fuertes actúan como resortes. Así el
 * grafo queda compacto y agrupado a la escala de las tarjetas, sin outliers que
 * obliguen a alejar la cámara. Después se separan solapamientos rectangulares.
 */
function layout(nodes, edges) {
  const n = nodes.length;
  if (!n) return new Map();
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const k = 170;                                   // distancia ideal entre nodos
  const R = Math.sqrt(n) * k * 0.6;
  // Semilla: coordenadas del backend normalizadas a un disco de radio R.
  const sx = nodes.map((nd) => nd.x3d ?? 0);
  const sy = nodes.map((nd) => nd.y3d ?? 0);
  const ext = Math.max(...sx.map(Math.abs), ...sy.map(Math.abs), 1e-6);
  const x = sx.map((v) => (v / ext) * R);
  const y = sy.map((v) => (v / ext) * R);

  const resortes = [];
  for (const e of edges) {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a != null && b != null && a !== b) resortes.push([a, b, 0.4 + (e.score || 0)]);
  }

  const iters = n > 800 ? 60 : n > 300 ? 120 : 260;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    const temp = k * 1.5 * (1 - it / iters) + 2;
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = x[i] - x[j];
        let ddy = (y[i] - y[j]) * 2.2;              // tarjetas anchas: repelen más en vertical
        let d2 = ddx * ddx + ddy * ddy;
        if (d2 < 1) { ddx = (i - j) * 0.1; ddy = 0.1; d2 = 1; }
        const f = (k * k) / d2;
        dx[i] += ddx * f; dy[i] += ddy * f;
        dx[j] -= ddx * f; dy[j] -= ddy * f;
      }
    }
    for (const [a, b, w] of resortes) {
      const ddx = x[a] - x[b];
      const ddy = y[a] - y[b];
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const f = (d / k) * w;
      dx[a] -= ddx * f; dy[a] -= ddy * f;
      dx[b] += ddx * f; dy[b] += ddy * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= x[i] * 0.06;                         // gravedad: nada se escapa del conjunto
      dy[i] -= y[i] * 0.06;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const paso = Math.min(d, temp);
      x[i] += (dx[i] / d) * paso;
      y[i] += (dy[i] / d) * paso;
    }
  }

  // Acotar outliers (nodos aislados que la gravedad no alcanzó a traer): si no,
  // un solo punto lejano obliga a alejar la cámara y todo se vuelve ilegible.
  const cx = x.reduce((a, v) => a + v, 0) / n;
  const cy = y.reduce((a, v) => a + v, 0) / n;
  const dist = x.map((v, i) => Math.hypot(v - cx, y[i] - cy));
  const med = [...dist].sort((a, b) => a - b)[Math.floor(n / 2)] || 1;
  const tope = med * 2.2;
  for (let i = 0; i < n; i++) {
    if (dist[i] > tope) {
      x[i] = cx + ((x[i] - cx) / dist[i]) * tope;
      y[i] = cy + ((y[i] - cy) / dist[i]) * tope;
    }
  }

  // Separar solapamientos de las tarjetas (rectángulos W×H con margen).
  const mx = W + 16;
  const my = H + 14;
  for (let it = 0; it < 40; it++) {
    let movio = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ddx = x[j] - x[i];
        const ddy = y[j] - y[i];
        const ox = mx - Math.abs(ddx);
        const oy = my - Math.abs(ddy);
        if (ox > 0 && oy > 0) {
          movio = true;
          if (ox / mx < oy / my) {
            const s = ((ddx >= 0 ? 1 : -1) * ox) / 2;
            x[i] -= s; x[j] += s;
          } else {
            const s = ((ddy >= 0 ? 1 : -1) * oy) / 2;
            y[i] -= s; y[j] += s;
          }
        }
      }
    }
    if (!movio) break;
  }
  return new Map(nodes.map((nd, i) => [nd.id, { x: x[i] - W / 2, y: y[i] - H / 2 }]));
}

/** Top-K por nodo (unión): el grafo queda conectado sin telaraña. */
function podar(edges, k) {
  const por = new Map();
  for (const e of edges) {
    for (const id of [e.source, e.target]) {
      if (!por.has(id)) por.set(id, []);
      por.get(id).push(e);
    }
  }
  const keep = new Set();
  for (const arr of por.values()) {
    arr.sort((a, b) => (b.score || 0) - (a.score || 0));
    arr.slice(0, k).forEach((e) => keep.add(e));
  }
  return edges.filter((e) => keep.has(e));
}

// Zoom redondeado: los nodos sólo se re-renderizan cuando cambia de a 5%.
const zoomSel = (s) => Math.round(s.transform[2] * 20) / 20;
const centro = { left: '50%', top: '50%', opacity: 0, pointerEvents: 'none', width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

const DocNode = memo(({ data }) => {
  const zoom = useStore(zoomSel) || 1;
  const lejos = zoom < ZOOM_LEJOS;
  const { estado, marcado, color } = data; // 'sel' | 'pin' | 'origen' | 'vecino' | 'tenue' | 'normal'
  const fuerte = estado === 'sel' || estado === 'pin';
  const origen = estado === 'origen';

  if (lejos) {
    // Vista de conjunto: punto de tamaño constante en pantalla, del color de su
    // tema/tipo/origen. Sin miniaturas acá (serían cientos de imágenes diminutas).
    const inv = 1 / zoom;
    const { etiqueta } = data;
    const d = (fuerte ? 10 : 7) * inv;
    return (
      <div className="relative" style={{ width: W, height: H, '--c': color }}>
        <Handle type="target" position={Position.Top} style={centro} isConnectable={false} />
        <Handle type="source" position={Position.Bottom} style={centro} isConnectable={false} />
        <span
          className={cn('absolute left-1/2 top-1/2 block rounded-full dot-cat transition-opacity', estado === 'tenue' && 'opacity-30')}
          style={{
            width: d,
            height: d,
            transform: 'translate(-50%,-50%)',
            boxShadow: fuerte || origen
              ? `0 0 0 ${2 * inv}px var(--color-canvas), 0 0 0 ${3.5 * inv}px ${origen ? 'var(--color-accent-soft)' : 'var(--color-accent)'}`
              : marcado ? `0 0 0 ${2 * inv}px var(--color-accent-soft)` : undefined,
          }}
        />
        {etiqueta && (
          <span
            className={cn(
              'absolute left-1/2 top-1/2 whitespace-nowrap rounded-xs border px-1 text-[11px]',
              fuerte ? 'border-accent/60 bg-surface-3 text-ink' : 'border-hair-strong bg-surface/95 text-ink-muted',
            )}
            style={{ transform: `translate(${8 * inv}px,-50%) scale(${inv})`, transformOrigin: 'left center' }}
          >
            {truncar(data.node.label, estado === 'sel' ? 90 : 36)}
          </span>
        )}
      </div>
    );
  }

  // Cerca: tarjeta con miniatura real del documento (o ícono teñido si no hay).
  return (
    <div style={{ width: estado === 'sel' ? W_SEL : W, '--c': color }}>
      <Handle type="target" position={Position.Top} style={centro} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={centro} isConnectable={false} />
      <div
        className={cn(
          'flex items-center gap-2 overflow-hidden rounded-sm border bg-surface pl-1 pr-2 text-[11.5px] bar-cat transition-[opacity,border-color,background-color,box-shadow]',
          fuerte && 'border-accent bg-surface-3 text-ink glow-sel',
          origen && 'border-accent-soft/60 border-dashed text-ink',
          estado === 'vecino' && 'border-hair-strong text-ink',
          estado === 'normal' && 'border-hair text-ink-muted hover:border-hair-strong hover:text-ink',
          estado === 'tenue' && 'border-hair text-ink-dim opacity-30',
        )}
        style={estado === 'sel' ? { minHeight: H, paddingTop: 3, paddingBottom: 3 } : { height: H }}
      >
        <Thumb node={data.node} color={color} className="ml-[3px] h-[24px] w-[20px]" iconClass="size-3" />
        {estado === 'sel'
          ? <span className="line-clamp-3 leading-snug">{data.node.label}</span>
          : <span className="truncate">{truncar(data.node.label, 30)}</span>}
        {marcado && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" />}
      </div>
    </div>
  );
});
DocNode.displayName = 'DocNode';

const nodeTypes = { doc: DocNode };

function BotonCanvas({ texto, onClick, children, activo }) {
  return (
    <Hint texto={texto} side="right">
      <button
        type="button"
        onClick={onClick}
        aria-label={texto}
        className={cn(
          'grid size-7 place-items-center text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5',
          activo && 'text-accent',
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

const esPin = (e, pin) => !!pin && e.source === pin.source && e.target === pin.target && e.label === pin.label;

function Lienzo({
  nodes, edges, visibleIds, selectedId, highlightIds, onSelect, relIndex,
  pinnedEdge, onClearPin, colorMode, onColorMode, colorDe, temas, compacto, ego, onFijar,
}) {
  const rf = useReactFlow();
  const [todas, setTodas] = useState(false);
  const cajaRef = useRef(null);
  const [hover, setHover] = useState(null);   // { node, x, y }
  const posiciones = useMemo(() => layout(nodes, podar(edges, 3)), [nodes, edges]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // El pin sólo cuenta si toca al documento elegido y sus dos puntas están a la vista.
  const pin = pinnedEdge && selectedId
    && (pinnedEdge.source === selectedId || pinnedEdge.target === selectedId)
    && visibleIds.has(pinnedEdge.source) && visibleIds.has(pinnedEdge.target)
    ? pinnedEdge : null;
  const pinOtro = pin ? (pin.source === selectedId ? pin.target : pin.source) : null;

  const vecinos = useMemo(() => {
    if (ego) return ego.ids;
    if (!selectedId) return null;
    return new Set((relIndex.get(selectedId) || []).map((r) => r.otherId));
  }, [selectedId, relIndex, ego]);

  const visiblesEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [edges, visibleIds],
  );
  const base = useMemo(() => (todas ? visiblesEdges : podar(visiblesEdges, K_FUERTES)), [visiblesEdges, todas]);

  // Vista de conjunto: qué puntos llevan etiqueta. Prioridad: el elegido, el
  // extremo fijado, lo que marcó el agente, sus vecinos y, sin selección, los
  // más conectados. Greedy: una etiqueta que pisaría a otra no se dibuja.
  const zoom = useStore(zoomSel) || 1;
  const etiquetados = useMemo(() => {
    const out = new Set();
    if (zoom >= ZOOM_LEJOS) return out;
    const orden = [];
    if (selectedId) orden.push(selectedId);
    if (pinOtro) orden.push(pinOtro);
    if (ego) { orden.push(ego.origen); ego.ids.forEach((id) => orden.push(id)); }
    highlightIds.forEach((id) => orden.push(id));
    if (ego) { /* ya están */ } else if (selectedId && !pinOtro) {
      (relIndex.get(selectedId) || []).forEach((r) => orden.push(r.otherId));   // ya vienen por score
    } else if (!selectedId) {
      [...relIndex.entries()]
        .sort((x, y) => y[1].length - x[1].length)
        .slice(0, 16)
        .forEach(([id]) => orden.push(id));
    }
    const rects = [];
    const limite = ego ? 18 : selectedId ? 14 : 7;
    for (const id of orden) {
      if (out.has(id) || !visibleIds.has(id)) continue;
      const p = posiciones.get(id);
      if (!p) continue;
      const label = truncar(nodesById.get(id)?.label || '', 36);
      const x0 = p.x + W / 2 + 8 / zoom;
      const y0 = p.y + H / 2 - 10 / zoom;
      const r = [x0, y0, x0 + (label.length * 6.4 + 14) / zoom, y0 + 20 / zoom];
      const obligatoria = id === selectedId || id === pinOtro || (ego && id === ego.origen);
      if (!obligatoria && rects.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      rects.push(r);
      out.add(id);
      if (out.size >= limite) break;
    }
    return out;
  }, [zoom, selectedId, pinOtro, ego, highlightIds, relIndex, visibleIds, posiciones, nodesById]);

  const rfNodes = useMemo(() => nodes
    .filter((n) => visibleIds.has(n.id))
    .map((n) => {
      let estado = 'normal';
      if (ego) {
        // Vecindario fijo: el conjunto no cambia al mirar otro de sus nodos.
        if (n.id === selectedId) estado = 'sel';
        else if (n.id === pinOtro) estado = 'pin';
        else if (n.id === ego.origen) estado = 'origen';
        else estado = ego.ids.has(n.id) ? 'vecino' : 'tenue';
      } else if (selectedId) {
        if (n.id === selectedId) estado = 'sel';
        else if (pinOtro) estado = n.id === pinOtro ? 'pin' : 'tenue';
        else if (vecinos?.has(n.id)) estado = 'vecino';
        else estado = 'tenue';
      }
      return {
        id: n.id,
        type: 'doc',
        position: posiciones.get(n.id) || { x: 0, y: 0 },
        data: {
          node: n,
          estado,
          color: colorDe(n),
          marcado: highlightIds.has(n.id),
          etiqueta: etiquetados.has(n.id),
        },
        zIndex: estado === 'sel' || estado === 'pin' ? 4 : estado === 'origen' ? 3 : estado === 'vecino' ? 2 : 1,
      };
    }), [nodes, visibleIds, posiciones, selectedId, pinOtro, vecinos, ego, highlightIds, etiquetados, colorDe]);

  const rfEdges = useMemo(() => {
    // Con selección: siempre todas las aristas del nodo elegido, aunque la poda las haya sacado.
    const set = new Set(base);
    const enEgo = (e) => ego && ego.ids.has(e.source) && ego.ids.has(e.target);
    visiblesEdges.forEach((e) => {
      if (selectedId && (e.source === selectedId || e.target === selectedId)) set.add(e);
      if (enEgo(e)) set.add(e);                    // con vecindario fijo: todas las aristas entre sus nodos
    });
    return [...set].map((e) => {
      const propia = selectedId && (e.source === selectedId || e.target === selectedId);
      const fijada = esPin(e, pin);
      let opacity = 0.8;
      if (ego) opacity = fijada ? 1 : enEgo(e) ? (propia ? 0.8 : 0.5) : 0.06;
      else if (pin) opacity = fijada ? 1 : propia ? 0.14 : 0.06;
      else if (selectedId) opacity = propia ? 0.6 : 0.12;
      return {
        id: `${e.source}→${e.target}→${e.label}`,
        source: e.source,
        target: e.target,
        type: 'straight',
        focusable: false,
        style: {
          stroke: fijada || (propia && !pin && (!ego || enEgo(e))) ? 'var(--color-accent)' : 'var(--edge)',
          strokeWidth: fijada ? 2 : 1,
          opacity,
        },
        zIndex: fijada ? 2 : propia ? 1 : 0,
      };
    });
  }, [base, visiblesEdges, selectedId, pin, ego]);

  const leyenda = useMemo(() => calcularLeyenda(nodes, visibleIds, colorMode, temas), [nodes, visibleIds, colorMode, temas]);

  // Encuadrar cuando cambia el conjunto visible (sección / filtros).
  const firma = useMemo(() => `${visibleIds.size}:${nodes.length}`, [visibleIds, nodes.length]);
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 30);
    return () => clearTimeout(t);
  }, [firma, rf]);

  // Al elegir un nodo: encuadrar el nodo y sus vecinos. Al fijar una relación:
  // encuadrar sólo esas dos puntas.
  const ultimo = useRef(null);
  // Con vecindario fijo el encuadre no se mueve al mirar otro nodo del conjunto.
  const claveEncuadre = ego ? `ego:${ego.origen}` : pin ? `pin:${pin.source}:${pin.target}:${pin.label}` : selectedId ? `sel:${selectedId}` : null;
  useEffect(() => {
    if (!claveEncuadre || claveEncuadre === ultimo.current) return undefined;
    ultimo.current = claveEncuadre;
    if (!ego && !visibleIds.has(selectedId)) return undefined;
    const ids = ego
      ? [...ego.ids].filter((id) => visibleIds.has(id))
      : pin
      ? [pin.source, pin.target]
      : [selectedId, ...[...(vecinos || [])].filter((id) => visibleIds.has(id))];
    const t = setTimeout(() => {
      rf.fitView({ nodes: ids.map((id) => ({ id })), padding: pin && !ego ? 0.6 : 0.25, duration: 350, maxZoom: 1.2 });
    }, 20);
    return () => clearTimeout(t);
  }, [claveEncuadre, pin, ego, selectedId, vecinos, rf, visibleIds]);

  const onNodeClick = useCallback((_, n) => onSelect(n.id), [onSelect]);
  const moverHover = useCallback((ev, n) => {
    const r = cajaRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover({ node: n.data.node, x: ev.clientX - r.left, y: ev.clientY - r.top, ancho: r.width, alto: r.height });
  }, []);

  return (
    <div ref={cajaRef} className="algedi-flow relative size-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={moverHover}
        onNodeMouseMove={moverHover}
        onNodeMouseLeave={() => setHover(null)}
        onMoveStart={() => setHover(null)}
        onPaneClick={() => pinnedEdge && onClearPin?.()}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        onlyRenderVisibleElements
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#141a2d" />
      </ReactFlow>

      <div className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap items-start gap-2 text-[11px] text-ink-dim">
        <span className="whitespace-nowrap rounded-xs border border-hair bg-surface/90 px-1.5 py-0.5">
          {rfNodes.length} nodos · {rfEdges.length} aristas{todas ? '' : ' fuertes'}
        </span>
        {pin && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Link2 className="size-3 text-accent" />
            <span className="max-w-[220px] truncate">{nodesById.get(pinOtro)?.label}</span>
            <button type="button" onClick={onClearPin} className="text-ink-dim hover:text-ink" aria-label="Soltar vínculo"><X className="size-3" /></button>
          </span>
        )}
        {ego && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Pin className="size-3 text-accent" />
            <span className="max-w-[220px] truncate">Vecindario de {nodesById.get(ego.origen)?.label}</span>
            <span className="text-ink-dim">{ego.ids.size}</span>
            <button type="button" onClick={onFijar} className="text-ink-dim hover:text-ink" aria-label="Desfijar vecindario"><X className="size-3" /></button>
          </span>
        )}
        <ColorPanel modo={colorMode} onModo={onColorMode} leyenda={leyenda} compacto={compacto} />
      </div>

      {hover && <NodoTooltip node={hover.node} x={hover.x} y={hover.y} ancho={hover.ancho} alto={hover.alto} temas={temas} />}

      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
        {(selectedId || ego) && (
          <>
            <BotonCanvas texto={ego ? 'Desfijar vecindario · Esc' : 'Fijar relaciones del elegido'} onClick={onFijar} activo={!!ego}>
              {ego ? <PinOff /> : <Pin />}
            </BotonCanvas>
            <div className="h-px bg-hair" />
          </>
        )}
        <BotonCanvas texto="Acercar" onClick={() => rf.zoomIn({ duration: 150 })}><Plus /></BotonCanvas>
        <BotonCanvas texto="Alejar" onClick={() => rf.zoomOut({ duration: 150 })}><Minus /></BotonCanvas>
        <BotonCanvas texto="Encuadrar todo" onClick={() => rf.fitView({ padding: 0.12, duration: 250 })}><Maximize /></BotonCanvas>
        <div className="h-px bg-hair" />
        <BotonCanvas
          texto={todas ? 'Mostrar sólo aristas fuertes' : 'Mostrar todas las aristas'}
          onClick={() => setTodas((t) => !t)}
          activo={todas}
        >
          <Waypoints />
        </BotonCanvas>
      </div>
    </div>
  );
}

export default function GraphCanvas(props) {
  if (!props.nodes.length) {
    return <div className="grid size-full place-items-center text-[12px] text-ink-dim">Sin nodos para graficar.</div>;
  }
  return (
    <ReactFlowProvider>
      <Lienzo {...props} />
    </ReactFlowProvider>
  );
}
