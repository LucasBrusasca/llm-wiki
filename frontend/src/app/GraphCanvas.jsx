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
const ZOOM_LEJOS = 0.5; // por debajo, las tarjetas pasan a punto (vista de conjunto)
const K_FUERTES = 2;    // aristas por nodo en el modo "fuertes"

/**
 * Layout: parte de las coordenadas del backend (proyección de embeddings, así
 * los temas quedan cerca) y separa solapamientos con un relajado simple. Es
 * determinístico: la misma sección siempre queda igual.
 */
function layout(nodes) {
  const n = nodes.length;
  const escala = Math.max(900, Math.sqrt(n) * 150);
  const pos = nodes.map((nd) => ({
    id: nd.id,
    x: (nd.x3d ?? 0) * escala,
    y: (nd.y3d ?? 0) * escala * 0.72,
  }));
  const iter = n > 600 ? 8 : n > 250 ? 20 : 60;
  const mx = W + 14;
  const my = H + 14;
  for (let it = 0; it < iter; it++) {
    let movio = false;
    for (let i = 0; i < n; i++) {
      const a = pos[i];
      for (let j = i + 1; j < n; j++) {
        const b = pos[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = mx - Math.abs(dx);
        const oy = my - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          movio = true;
          if (ox / mx < oy / my) {
            const s = (dx >= 0 ? 1 : -1) * ox / 2;
            a.x -= s; b.x += s;
          } else {
            const s = (dy >= 0 ? 1 : -1) * oy / 2;
            a.y -= s; b.y += s;
          }
        }
      }
    }
    if (!movio) break;
  }
  return new Map(pos.map((p) => [p.id, { x: p.x, y: p.y }]));
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

const lejosSel = (s) => s.transform[2] < ZOOM_LEJOS;
const centro = { left: '50%', top: '50%', opacity: 0, pointerEvents: 'none', width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

const DocNode = memo(({ data }) => {
  const lejos = useStore(lejosSel);
  const Icon = iconoDe(data.node);
  const { estado } = data; // 'sel' | 'vecino' | 'tenue' | 'normal'
  return (
    <div title={data.node.label} style={{ width: lejos ? 'auto' : W }}>
      <Handle type="target" position={Position.Top} style={centro} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={centro} isConnectable={false} />
      {lejos ? (
        <span
          className={cn(
            'block size-2.5 rounded-full border transition-opacity',
            estado === 'sel' ? 'border-accent bg-accent' : 'border-hair-strong bg-surface-3',
            estado === 'tenue' && 'opacity-25',
            data.marcado && estado !== 'sel' && 'border-accent',
          )}
        />
      ) : (
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
          {data.marcado && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-accent" />}
        </div>
      )}
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
  const posiciones = useMemo(() => layout(nodes), [nodes]);

  const vecinos = useMemo(() => {
    if (!selectedId) return null;
    return new Set((relIndex.get(selectedId) || []).map((r) => r.otherId));
  }, [selectedId, relIndex]);

  const visiblesEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [edges, visibleIds],
  );
  const base = useMemo(() => (todas ? visiblesEdges : podar(visiblesEdges, K_FUERTES)), [visiblesEdges, todas]);

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
        data: { node: n, estado, marcado: highlightIds.has(n.id) },
        zIndex: estado === 'sel' ? 3 : estado === 'vecino' ? 2 : 1,
      };
    }), [nodes, visibleIds, posiciones, selectedId, vecinos, highlightIds]);

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
          stroke: propia ? 'var(--color-accent)' : 'var(--color-hair-strong)',
          strokeWidth: propia ? 1.25 : 1,
          opacity: selectedId ? (propia ? 0.9 : 0.12) : 0.7,
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

  // Centrar la selección que viene de la lista (sin cambiar el zoom si ya está cerca).
  const ultimo = useRef(null);
  useEffect(() => {
    if (!selectedId || selectedId === ultimo.current) return;
    ultimo.current = selectedId;
    const p = posiciones.get(selectedId);
    if (!p || !visibleIds.has(selectedId)) return;
    const zoom = Math.max(rf.getZoom(), 0.9);
    rf.setCenter(p.x + W / 2, p.y + H / 2, { zoom, duration: 350 });
  }, [selectedId, posiciones, rf, visibleIds]);

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
          {rfNodes.length} nodos · {rfEdges.length} aristas{todas ? '' : ' (las más fuertes)'}
        </span>
        {!selectedId && <span className="hidden xl:inline">Clic en un nodo para ver por qué se conecta</span>}
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
