import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background, Handle, Position, ReactFlowProvider, useReactFlow, useStore,
} from 'reactflow';
import 'reactflow/dist/base.css';
import { Plus, Minus, Maximize, Waypoints } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { iconoDe } from '@/lib/nodes';
import { cn, truncar } from '@/lib/utils';

const W = 172;          // ancho de la tarjeta de nodo
const H = 26;           // alto
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
  const k = 150;                                   // distancia ideal entre nodos
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
  const Icon = iconoDe(data.node);
  const { estado, marcado } = data; // estado: 'sel' | 'vecino' | 'tenue' | 'normal'

  if (lejos) {
    // Vista de conjunto: punto de tamaño constante en pantalla. Sólo el nodo
    // elegido, sus vecinos y lo marcado por el agente llevan etiqueta.
    const inv = 1 / zoom;
    const { etiqueta } = data;
    return (
      <div title={data.node.label} className="relative" style={{ width: W, height: H }}>
        <Handle type="target" position={Position.Top} style={centro} isConnectable={false} />
        <Handle type="source" position={Position.Bottom} style={centro} isConnectable={false} />
        <span
          className={cn(
            'absolute left-1/2 top-1/2 block rounded-full transition-opacity',
            estado === 'sel' ? 'bg-accent' : marcado ? 'bg-accent-soft' : estado === 'vecino' ? 'bg-ink' : 'bg-ink-dim',
            estado === 'tenue' && 'opacity-30',
          )}
          style={{ width: 7 * inv, height: 7 * inv, transform: 'translate(-50%,-50%)' }}
        />
        {etiqueta && (
          <span
            className={cn(
              'absolute left-1/2 top-1/2 whitespace-nowrap rounded-xs border px-1 text-[11px]',
              estado === 'sel' ? 'border-accent/50 bg-surface-3 text-ink' : 'border-hair-strong bg-surface text-ink-muted',
            )}
            style={{ transform: `translate(${6 * inv}px,-50%) scale(${inv})`, transformOrigin: 'left center' }}
          >
            {truncar(data.node.label, 36)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div title={data.node.label} style={{ width: W }}>
      <Handle type="target" position={Position.Top} style={centro} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={centro} isConnectable={false} />
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-sm border bg-surface px-2 text-[11.5px] transition-[opacity,border-color,background-color]',
          estado === 'sel' && 'border-accent bg-surface-3 text-ink',
          estado === 'vecino' && 'border-hair-strong text-ink',
          estado === 'normal' && 'border-hair text-ink-muted hover:border-hair-strong hover:text-ink',
          estado === 'tenue' && 'border-hair text-ink-dim opacity-30',
        )}
        style={{ height: H }}
      >
        <Icon className={cn('size-3 shrink-0', estado === 'sel' ? 'text-accent' : 'text-ink-dim')} />
        <span className="truncate">{truncar(data.node.label, 30)}</span>
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

function Lienzo({ nodes, edges, visibleIds, selectedId, highlightIds, onSelect, relIndex }) {
  const rf = useReactFlow();
  const [todas, setTodas] = useState(false);
  const posiciones = useMemo(() => layout(nodes, podar(edges, 3)), [nodes, edges]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const vecinos = useMemo(() => {
    if (!selectedId) return null;
    return new Set((relIndex.get(selectedId) || []).map((r) => r.otherId));
  }, [selectedId, relIndex]);

  const visiblesEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [edges, visibleIds],
  );
  const base = useMemo(() => (todas ? visiblesEdges : podar(visiblesEdges, K_FUERTES)), [visiblesEdges, todas]);

  // Vista de conjunto: qué puntos llevan etiqueta. Prioridad: el elegido, lo que
  // marcó el agente, sus vecinos más fuertes y, sin selección, los más conectados.
  // Colocación greedy: una etiqueta que pisaría a otra ya puesta no se dibuja.
  const zoom = useStore(zoomSel) || 1;
  const etiquetados = useMemo(() => {
    const out = new Set();
    if (zoom >= ZOOM_LEJOS) return out;
    const orden = [];
    if (selectedId) orden.push(selectedId);
    highlightIds.forEach((id) => orden.push(id));
    if (selectedId) {
      (relIndex.get(selectedId) || []).forEach((r) => orden.push(r.otherId));   // ya vienen por score
    } else {
      [...relIndex.entries()]
        .sort((x, y) => y[1].length - x[1].length)
        .slice(0, 16)
        .forEach(([id]) => orden.push(id));
    }
    const rects = [];
    const limite = selectedId ? 14 : 7;
    for (const id of orden) {
      if (out.has(id) || !visibleIds.has(id)) continue;
      const p = posiciones.get(id);
      if (!p) continue;
      const label = truncar(nodesById.get(id)?.label || '', 36);
      const x0 = p.x + W / 2 + 6 / zoom;
      const y0 = p.y + H / 2 - 10 / zoom;
      const r = [x0, y0, x0 + (label.length * 6.4 + 14) / zoom, y0 + 20 / zoom];
      if (id !== selectedId && rects.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      rects.push(r);
      out.add(id);
      if (out.size >= limite) break;
    }
    return out;
  }, [zoom, selectedId, highlightIds, relIndex, visibleIds, posiciones, nodesById]);

  const rfNodes = useMemo(() => nodes
    .filter((n) => visibleIds.has(n.id))
    .map((n) => {
      let estado = 'normal';
      if (selectedId) {
        if (n.id === selectedId) estado = 'sel';
        else if (vecinos?.has(n.id)) estado = 'vecino';
        else estado = 'tenue';
      }
      return {
        id: n.id,
        type: 'doc',
        position: posiciones.get(n.id) || { x: 0, y: 0 },
        data: { node: n, estado, marcado: highlightIds.has(n.id), etiqueta: etiquetados.has(n.id) },
        zIndex: estado === 'sel' ? 3 : estado === 'vecino' ? 2 : 1,
      };
    }), [nodes, visibleIds, posiciones, selectedId, vecinos, highlightIds, etiquetados]);

  const rfEdges = useMemo(() => {
    // Con selección: siempre todas las aristas del nodo elegido, aunque la poda las haya sacado.
    const set = new Set(base);
    if (selectedId) {
      visiblesEdges.forEach((e) => { if (e.source === selectedId || e.target === selectedId) set.add(e); });
    }
    return [...set].map((e) => {
      const propia = selectedId && (e.source === selectedId || e.target === selectedId);
      return {
        id: `${e.source}→${e.target}→${e.label}`,
        source: e.source,
        target: e.target,
        type: 'straight',
        focusable: false,
        style: {
          stroke: propia ? 'var(--color-accent)' : '#4b5059',
          strokeWidth: 1,
          opacity: selectedId ? (propia ? 0.55 : 0.15) : 0.85,
        },
        zIndex: propia ? 1 : 0,
      };
    });
  }, [base, visiblesEdges, selectedId]);

  // Encuadrar cuando cambia el conjunto visible (sección / filtros).
  const firma = useMemo(() => `${visibleIds.size}:${nodes.length}`, [visibleIds, nodes.length]);
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 30);
    return () => clearTimeout(t);
  }, [firma, rf]);

  // Al elegir un nodo: encuadrar el nodo y sus vecinos (no sólo centrarlo), así
  // se ve con quién se conecta sin tener que salir a buscarlos.
  const ultimo = useRef(null);
  useEffect(() => {
    if (!selectedId || selectedId === ultimo.current) return;
    ultimo.current = selectedId;
    if (!visibleIds.has(selectedId)) return;
    const ids = [selectedId, ...[...(vecinos || [])].filter((id) => visibleIds.has(id))];
    const t = setTimeout(() => {
      rf.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.25, duration: 350, maxZoom: 1.1 });
    }, 20);
    return () => clearTimeout(t);
  }, [selectedId, vecinos, rf, visibleIds]);

  const onNodeClick = useCallback((_, n) => onSelect(n.id), [onSelect]);

  return (
    <div className="algedi-flow relative size-full bg-canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#16181b" />
      </ReactFlow>

      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 text-[11px] text-ink-dim">
        <span className="rounded-xs border border-hair bg-surface/90 px-1.5 py-0.5">
          {rfNodes.length} nodos · {rfEdges.length} aristas{todas ? '' : ' fuertes'}
        </span>
      </div>

      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
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
