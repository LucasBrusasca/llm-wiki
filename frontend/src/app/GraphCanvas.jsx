import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Handle, Position, ReactFlowProvider, useReactFlow, useStoreApi,
} from 'reactflow';
import 'reactflow/dist/base.css';
import { Plus, Minus, Maximize, Waypoints, Pin, PinOff, Link2, X } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import ColorPanel, { calcularLeyenda } from '@/app/ColorPanel';
import NodoTooltip from '@/app/NodoTooltip';
import { Tarjeta, Chip } from '@/app/PiezasNodo';
import {
  TARJETA, estadoNodo, vecinosDe, claseDetalle, calcularHitos, colocarPiezas, radioPantalla, medirHud,
} from '@/lib/detalle';
import { podar, aristasVisibles, estiloArista } from '@/lib/aristas';
import { cn } from '@/lib/utils';

/**
 * Grafo 2D: el mismo universo que el 3D, en el plano.
 *
 * - Cada nodo es un punto con brillo del color del modo (Tema/Tipo/Origen), de tamaño
 *   fijo en pantalla. De cerca, el nodo ES su tarjeta (miniatura + título); a media
 *   distancia lleva un chip con el título. Qué nodo gana qué, los topes y el
 *   anti-choque son los del 3D (lib/detalle); las piezas son las mismas (PiezasNodo).
 * - Aristas con el mismo criterio y peso que el 3D (lib/aristas): sin selección sólo
 *   las fuertes; el elegido enciende las suyas y apaga el resto; el hover hace lo
 *   mismo mientras dura.
 * - Las piezas viven dentro del nodo de React Flow: hover, clic, arrastre y rueda
 *   funcionan igual encima de una tarjeta.
 */

const CAJA = 22;   // caja del nodo en unidades del flujo: el punto va centrado; chip y tarjeta sobresalen
// El layout 2D es ~7 veces más grande que la escena 3D (la vista de conjunto queda en
// zoom ~0.1 contra ~0.65 px por unidad en el 3D): con esta equivalencia, la misma
// tabla de detalle decide igual en las dos vistas.
const ZOOM_POR_UNIDAD = 0.14;
const escalaDe = (zoom) => zoom / ZOOM_POR_UNIDAD;
const SEP_MIN = 110;  // distancia mínima entre centros después del layout (unidades del flujo)
// Orden de apilado: aristas (0–2) < puntos < chips < tarjetas < lo que tiene el mouse.
const Z_PUNTO = { tenue: 3, normal: 4, vecino: 5, origen: 6, pin: 7, sel: 8 };

/**
 * Layout de fuerzas determinístico (Fruchterman–Reingold simple).
 * Se siembra con la proyección del backend (la misma que ubica el 3D, con la y hacia
 * arriba como en su vista de frente) para que los temas arranquen cerca, y las
 * aristas fuertes actúan como resortes. Después se separan los puntos encimados.
 * Devuelve el CENTRO de cada nodo.
 */
function layout(nodes, edges) {
  const n = nodes.length;
  if (!n) return new Map();
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const k = 170;                                   // distancia ideal entre nodos
  const R = Math.sqrt(n) * k * 0.6;
  // Semilla: coordenadas del backend normalizadas a un disco de radio R.
  const sx = nodes.map((nd) => nd.x3d ?? 0);
  const sy = nodes.map((nd) => -(nd.y3d ?? 0));
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
        let ddy = y[i] - y[j];
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

  // Separar puntos encimados (los nodos son puntos: tarjetas y chips los reparte el
  // anti-choque en pantalla, no el layout).
  for (let it = 0; it < 40; it++) {
    let movio = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = x[j] - x[i];
        let ddy = y[j] - y[i];
        let d = Math.hypot(ddx, ddy);
        if (d >= SEP_MIN) continue;
        movio = true;
        if (d < 1e-6) { ddx = ((i * 7 + j) % 3) - 1 || 0.5; ddy = 0.3; d = Math.hypot(ddx, ddy); }
        const s = (SEP_MIN - d) / 2 / d;
        x[i] -= ddx * s; y[i] -= ddy * s;
        x[j] += ddx * s; y[j] += ddy * s;
      }
    }
    if (!movio) break;
  }
  return new Map(nodes.map((nd, i) => [nd.id, { x: x[i], y: y[i] }]));
}

const centro = { left: '50%', top: '50%', opacity: 0, pointerEvents: 'none', width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

/** Radio base del punto (antes de la escala), igual que la esfera del 3D. */
const radioBase = (grado, fuerte) => 3 + Math.sqrt(grado) * 1.1 + (fuerte ? 2 : 0);

const DocNode = memo(({ data }) => {
  const { node, estado, color, r, marcado, pieza, hover } = data;
  const fuerte = estado === 'sel' || estado === 'pin';
  return (
    <div className="nodo-2d" style={{ '--c': color }}>
      <Handle type="target" position={Position.Top} style={centro} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={centro} isConnectable={false} />
      {pieza?.modo !== 'tarjeta' && (
        <span className="centro-2d">
          <span
            className="punto-2d"
            data-estado={estado}
            data-marcado={marcado || undefined}
            data-hover={hover || undefined}
            style={{ '--r': r, '--rmax': fuerte ? '13px' : undefined }}
          />
        </span>
      )}
      {pieza?.modo === 'chip' && (
        <div className="derecha-2d" style={{ '--sep': `${pieza.sep}px` }}>
          <Chip node={node} estado={estado} medida={pieza.dim} hover={hover} marcado={marcado} />
        </div>
      )}
      {pieza?.modo === 'tarjeta' && (
        <div className="centro-2d">
          <Tarjeta node={node} estado={estado} color={color} grande={pieza.dim === TARJETA.grande} hover={hover} marcado={marcado} />
        </div>
      )}
    </div>
  );
});
DocNode.displayName = 'DocNode';

const nodeTypes = { doc: DocNode };

/** Mismo contenido que el anterior (para no re-renderizar nodos que no cambiaron). */
function mismoDato(a, b) {
  return !!a && a.node === b.node && a.estado === b.estado && a.color === b.color && a.r === b.r
    && a.marcado === b.marcado && a.hover === b.hover
    && (a.pieza?.modo ?? null) === (b.pieza?.modo ?? null)
    && (a.pieza?.sep ?? null) === (b.pieza?.sep ?? null)
    && (a.pieza?.dim ?? null) === (b.pieza?.dim ?? null);
}

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

function Lienzo({
  nodes, edges, visibleIds, selectedId, highlightIds, onSelect, relIndex,
  pinnedEdge, onClearPin, colorMode, onColorMode, colorDe, temas, compacto, ego, onFijar,
}) {
  const rf = useReactFlow();
  const store = useStoreApi();
  const [todas, setTodas] = useState(false);
  const cajaRef = useRef(null);
  const [hover, setHover] = useState(null);       // { node, x, y } para el tooltip
  const [hoverId, setHoverId] = useState(null);   // nodo bajo el mouse: enciende sus aristas
  const [piezas, setPiezas] = useState(() => new Map());   // id → { modo, dim, sep }
  const firmaRef = useRef('');
  const rafRef = useRef(0);
  const hudRef = useRef({ t: -Infinity, rects: [] });
  const datosRef = useRef(new Map());

  const centros = useMemo(() => layout(nodes, podar(edges, 3)), [nodes, edges]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const grado = useCallback((id) => relIndex.get(id)?.length || 0, [relIndex]);

  // El pin sólo cuenta si toca al documento elegido y sus dos puntas están a la vista.
  const pin = pinnedEdge && selectedId
    && (pinnedEdge.source === selectedId || pinnedEdge.target === selectedId)
    && visibleIds.has(pinnedEdge.source) && visibleIds.has(pinnedEdge.target)
    ? pinnedEdge : null;
  const pinOtro = pin ? (pin.source === selectedId ? pin.target : pin.source) : null;

  const vecinos = useMemo(() => vecinosDe({ selectedId, ego, relIndex }), [selectedId, relIndex, ego]);
  const hitos = useMemo(
    () => calcularHitos({ selectedId, ego, relIndex, visibleIds }),
    [selectedId, ego, relIndex, visibleIds],
  );
  const estados = useMemo(() => {
    const m = new Map();
    for (const n of nodes) {
      if (visibleIds.has(n.id)) m.set(n.id, estadoNodo(n.id, { selectedId, pinOtro, vecinos, ego }));
    }
    return m;
  }, [nodes, visibleIds, selectedId, pinOtro, vecinos, ego]);

  // Paneles del lienzo: ninguna pieza se ubica debajo. Se miden cada tanto.
  const rectsHud = useCallback(() => {
    const h = hudRef.current;
    const ahora = performance.now();
    if (ahora - h.t >= 400) { h.rects = medirHud(cajaRef.current); h.t = ahora; }
    return h.rects;
  }, []);

  // ── Detalle por nodo: punto → chip → tarjeta, con las reglas del 3D ──
  const actualizarDetalle = useCallback(() => {
    const { transform: [tx, ty, zoom], width: W, height: H } = store.getState();
    if (!W || !H) return;
    const escala = escalaDe(zoom);
    const cands = [];
    for (const [id, estado] of estados) {
      const clase = claseDetalle(estado, { destacado: highlightIds.has(id), hito: hitos.has(id) });
      if (!clase) continue;
      const c = centros.get(id);
      if (!c) continue;
      const x = c.x * zoom + tx;
      const y = c.y * zoom + ty;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      const fuerte = estado === 'sel' || estado === 'pin';
      // Entre pares, primero lo que está al centro de la vista y, a igualdad, lo más conectado.
      const alCentro = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2));
      cands.push({
        id, x, y, clase, escala,
        rpx: radioPantalla(radioBase(grado(id), fuerte), escala, fuerte),
        label: nodesById.get(id)?.label,
        orden: alCentro - Math.min(grado(id), 40) * 0.004,
      });
    }
    const res = colocarPiezas(cands, { W, H, ocupadas: rectsHud() });
    const firma =[...res].map(([id, p]) => `${id}:${p.modo}:${p.sep ?? ''}`).sort().join(',');
    if (firma !== firmaRef.current) {
      firmaRef.current = firma;
      setPiezas(res);
    }
  }, [store, estados, highlightIds, hitos, centros, nodesById, grado, rectsHud]);

  // Recalcular como mucho una vez por frame.
  const programar = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      actualizarDetalle();
    });
  }, [actualizarDetalle]);
  // Al desmontar (o en el doble montaje de StrictMode) hay que soltar también la marca:
  // si queda puesta, programar() cree que hay un frame pendiente y no agenda nunca más.
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }, []);
  useEffect(() => { programar(); }, [programar]);

  // Cada movimiento del viewport (arrastre, rueda, fitView animado): el tamaño fijo en
  // pantalla va por CSS al instante y el detalle se recalcula en el próximo frame.
  // Se escucha el store y no `onMove`, que no avisa de los movimientos programáticos.
  useEffect(() => {
    const aplicar = (zoom) => {
      const el = cajaRef.current;
      if (!el) return;
      el.style.setProperty('--inv', String(1 / zoom));
      el.style.setProperty('--escala', String(escalaDe(zoom)));
    };
    aplicar(store.getState().transform[2]);
    return store.subscribe((s, prev) => {
      if (s.transform === prev.transform && s.width === prev.width && s.height === prev.height) return;
      if (s.transform[2] !== prev.transform[2]) aplicar(s.transform[2]);
      programar();
    });
  }, [store, programar]);

  const rfNodes = useMemo(() => {
    const cache = datosRef.current;
    const out = [];
    for (const n of nodes) {
      const estado = estados.get(n.id);
      if (!estado) continue;
      const c = centros.get(n.id) || { x: 0, y: 0 };
      const pieza = piezas.get(n.id) || null;
      const fuerte = estado === 'sel' || estado === 'pin';
      const nuevo = {
        node: n,
        estado,
        color: colorDe(n),
        r: radioBase(grado(n.id), fuerte),
        marcado: highlightIds.has(n.id),
        pieza,
        hover: hoverId === n.id,
      };
      const previo = cache.get(n.id);
      const data = mismoDato(previo, nuevo) ? previo : nuevo;
      cache.set(n.id, data);
      out.push({
        id: n.id,
        type: 'doc',
        position: { x: c.x - CAJA / 2, y: c.y - CAJA / 2 },
        data,
        zIndex: hoverId === n.id ? 50
          : pieza?.modo === 'tarjeta' ? (estado === 'sel' ? 40 : 30)
          : pieza?.modo === 'chip' ? 20
          : Z_PUNTO[estado] || 4,
      });
    }
    return out;
  }, [nodes, estados, centros, piezas, colorDe, grado, highlightIds, hoverId]);

  // Mismas relaciones, mismo corte de fuertes y mismo estilo que el 3D (lib/aristas).
  const aristas = useMemo(() => aristasVisibles(edges, visibleIds), [edges, visibleIds]);
  const rfEdges = useMemo(() => {
    const out = [];
    for (const a of aristas) {
      const e = estiloArista(a, { selectedId, pin, ego, hoverId, todas });
      if (!e.visible) continue;
      out.push({
        id: `${a.source}→${a.target}→${a.label}`,
        source: a.source,
        target: a.target,
        type: 'straight',
        focusable: false,
        style: {
          stroke: e.acento ? 'var(--color-accent)' : 'var(--arista)',
          strokeWidth: e.fijada ? 2.2 : e.grosor * 1.4,
          strokeOpacity: e.alfa,
        },
        zIndex: e.fijada ? 2 : e.acento ? 1 : 0,
      });
    }
    return out;
  }, [aristas, selectedId, pin, ego, hoverId, todas]);
  // Lo que se dibuja sin el hover: el conteo no parpadea al pasar el mouse.
  const nAristas = useMemo(
    () => aristas.filter((a) => estiloArista(a, { selectedId, pin, ego, todas }).visible).length,
    [aristas, selectedId, pin, ego, todas],
  );

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
    setHoverId(n.id);
  }, []);
  const soltarHover = useCallback(() => { setHover(null); setHoverId(null); }, []);

  const pinLabel = pin ? nodesById.get(pinOtro)?.label : null;
  const egoLabel = ego ? nodesById.get(ego.origen)?.label : null;

  return (
    <div ref={cajaRef} className="algedi-flow fondo-grafo relative size-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={moverHover}
        onNodeMouseMove={moverHover}
        onNodeMouseLeave={soltarHover}
        onMoveStart={() => setHover(null)}
        onPaneClick={() => pinnedEdge && onClearPin?.()}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        onlyRenderVisibleElements
        minZoom={0.03}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        proOptions={{ hideAttribution: true }}
      />

      <div className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap items-start gap-2 text-[11px] text-ink-dim">
        <span data-hud className="whitespace-nowrap rounded-xs border border-hair bg-surface/90 px-1.5 py-0.5">
          {rfNodes.length} nodos · {nAristas} aristas{todas ? '' : ' fuertes'}
        </span>
        {pin && (
          <span data-hud className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Link2 className="size-3 text-accent" />
            <span className="max-w-[220px] truncate" title={pinLabel || undefined}>{pinLabel}</span>
            <button type="button" onClick={onClearPin} className="text-ink-dim hover:text-ink" aria-label="Soltar vínculo"><X className="size-3" /></button>
          </span>
        )}
        {ego && (
          <span data-hud className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Pin className="size-3 text-accent" />
            <span className="max-w-[220px] truncate" title={egoLabel ? `Vecindario de ${egoLabel}` : undefined}>Vecindario de {egoLabel}</span>
            <span className="text-ink-dim">{ego.ids.size}</span>
            <button type="button" onClick={onFijar} className="text-ink-dim hover:text-ink" aria-label="Desfijar vecindario"><X className="size-3" /></button>
          </span>
        )}
        <ColorPanel modo={colorMode} onModo={onColorMode} leyenda={leyenda} compacto={compacto} />
      </div>

      {hover && <NodoTooltip node={hover.node} x={hover.x} y={hover.y} ancho={hover.ancho} alto={hover.alto} temas={temas} />}

      <div data-hud className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
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
          texto={todas ? 'Sólo aristas fuertes' : 'Mostrar también las débiles (más tenues)'}
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
    return <div className="fondo-grafo grid size-full place-items-center text-[12px] text-ink-dim">Sin nodos para graficar.</div>;
  }
  return (
    <ReactFlowProvider>
      <Lienzo {...props} />
    </ReactFlowProvider>
  );
}
