import React, { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background, Controls, Handle, Position, ConnectionMode, MarkerType, useNodesState,
} from 'reactflow';
import 'reactflow/dist/base.css';
import { Hash, Calendar, Type, ToggleLeft, KeyRound, Table2, Eye } from 'lucide-react';

const ICONO_CLASE = { numerica: Hash, fecha: Calendar, texto: Type, booleano: ToggleLeft };
const ANCHO = 210;
const FILA = 20;
const CABEZA = 28;
const POR_COLUMNA = 5;

const alto = (t) => CABEZA + t.campos.length * FILA + 6;
const handle = { width: 7, height: 7, background: 'var(--color-hair-strong)', border: 'none' };

/** Una tabla como en la vista de modelo de Power BI: cada campo tiene un punto a cada
 *  lado para arrastrar una relación hasta otro campo. */
function TablaNodo({ data }) {
  const { tabla, unidos } = data;
  return (
    <div className="rounded-md border border-hair-strong bg-surface shadow-lg" style={{ width: ANCHO }}>
      <div className="flex items-center gap-1.5 rounded-t-md border-b border-hair bg-surface-2 px-2" style={{ height: CABEZA }}>
        {tabla.vista ? <Eye className="size-3.5 shrink-0 text-ink-dim" /> : <Table2 className="size-3.5 shrink-0 text-accent" />}
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{tabla.clave}</span>
      </div>
      {tabla.campos.map((c) => {
        const Icon = ICONO_CLASE[c.clase] || Type;
        const unido = unidos.has(c.nombre);
        return (
          <div key={c.nombre} className="relative flex items-center gap-1.5 px-2 text-[11px]" style={{ height: FILA }}
            title={[c.tipo, c.pk && 'clave primaria'].filter(Boolean).join(' · ')}>
            <Handle type="source" position={Position.Left} id={`${c.nombre}:i`} style={{ ...handle, ...(unido && { background: 'var(--color-accent)' }) }} />
            <Icon className="size-3 shrink-0 text-ink-dim" />
            <span className={unido ? 'min-w-0 flex-1 truncate text-ink' : 'min-w-0 flex-1 truncate text-ink-muted'}>{c.nombre}</span>
            {c.pk && <KeyRound className="size-3 shrink-0 text-warn/80" />}
            <Handle type="source" position={Position.Right} id={`${c.nombre}:d`} style={{ ...handle, ...(unido && { background: 'var(--color-accent)' }) }} />
          </div>
        );
      })}
    </div>
  );
}

const nodeTypes = { tabla: TablaNodo };

/** Ubicación inicial: la tabla con más relaciones a la izquierda y las demás en columnas
 *  según a cuántos saltos están (un esquema estrella se lee de izquierda a derecha). */
function ubicar(tablas, relaciones) {
  const vecinos = new Map(tablas.map((t) => [t.clave, new Set()]));
  for (const r of relaciones) {
    vecinos.get(r.desde.tabla)?.add(r.hacia.tabla);
    vecinos.get(r.hacia.tabla)?.add(r.desde.tabla);
  }
  const orden = [...tablas].sort((a, b) => vecinos.get(b.clave).size - vecinos.get(a.clave).size || a.clave.localeCompare(b.clave));
  const nivel = new Map();
  for (const raiz of orden) {
    if (nivel.has(raiz.clave) || !vecinos.get(raiz.clave).size) continue;
    const cola = [raiz.clave];
    nivel.set(raiz.clave, 0);
    while (cola.length) {
      const t = cola.shift();
      for (const v of vecinos.get(t)) if (!nivel.has(v)) { nivel.set(v, nivel.get(t) + 1); cola.push(v); }
    }
  }
  const sueltas = Math.max(-1, ...nivel.values()) + 1;
  const columnas = new Map();
  for (const t of orden) {
    const n = nivel.has(t.clave) ? nivel.get(t.clave) : sueltas;
    if (!columnas.has(n)) columnas.set(n, []);
    columnas.get(n).push(t);
  }
  const pos = new Map();
  let x = 0;
  for (const n of [...columnas.keys()].sort((a, b) => a - b)) {
    const lista = columnas.get(n);
    for (let i = 0; i < lista.length; i += POR_COLUMNA) {
      let y = 0;
      for (const t of lista.slice(i, i + POR_COLUMNA)) { pos.set(t.clave, { x, y }); y += alto(t) + 36; }
      x += ANCHO + 110;
    }
  }
  return pos;
}

const mismo = (a, b) => a.desde.tabla === b.desde.tabla && a.desde.columna === b.desde.columna
  && a.hacia.tabla === b.hacia.tabla && a.hacia.columna === b.hacia.columna;

/**
 * El modelo de una fuente de datos como diagrama: tablas con sus campos y las líneas
 * de cada relación. Las de la base (claves foráneas) son grises; las marcadas a mano,
 * de color (clic para sacarlas); las sugeridas por el nombre, punteadas (clic para
 * aceptarlas). Arrastrar de un campo a otro marca una relación nueva.
 */
export default function ModeloDatos({ modelo, onAgregar, onQuitar }) {
  const relaciones = modelo.relaciones;
  const sugeridas = modelo.sugeridas || [];
  const llave = modelo.tablas.map((t) => t.clave).join('|');

  const iniciales = useMemo(() => {
    const pos = ubicar(modelo.tablas, [...relaciones, ...sugeridas]);
    return modelo.tablas.map((t) => ({ id: t.clave, type: 'tabla', position: pos.get(t.clave), data: { tabla: t, unidos: new Set() } }));
  }, [llave]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState(iniciales);
  useEffect(() => setNodes(iniciales), [iniciales, setNodes]);

  // Los campos que ya participan de alguna relación se marcan.
  useEffect(() => {
    const unidos = new Map(modelo.tablas.map((t) => [t.clave, new Set()]));
    for (const r of relaciones) {
      unidos.get(r.desde.tabla)?.add(r.desde.columna);
      unidos.get(r.hacia.tabla)?.add(r.hacia.columna);
    }
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, tabla: modelo.tablas.find((t) => t.clave === n.id) || n.data.tabla, unidos: unidos.get(n.id) || new Set() } })));
  }, [modelo, relaciones, setNodes]);

  const x = useMemo(() => new Map(nodes.map((n) => [n.id, n.position.x])), [nodes]);
  const edges = useMemo(() => {
    const linea = (r, origen, i) => {
      const izq = (x.get(r.desde.tabla) ?? 0) <= (x.get(r.hacia.tabla) ?? 0);
      const color = origen === 'manual' ? 'var(--color-accent)' : origen === 'sugerida' ? 'var(--color-warn)' : 'var(--color-ink-dim)';
      return {
        id: `${origen}-${i}-${r.desde.tabla}.${r.desde.columna}-${r.hacia.tabla}.${r.hacia.columna}`,
        source: r.desde.tabla, sourceHandle: `${r.desde.columna}:${izq ? 'd' : 'i'}`,
        target: r.hacia.tabla, targetHandle: `${r.hacia.columna}:${izq ? 'i' : 'd'}`,
        type: 'smoothstep',
        style: { stroke: color, strokeWidth: origen === 'sugerida' ? 1.2 : 1.6, strokeDasharray: origen === 'sugerida' ? '5 4' : undefined, cursor: origen === 'fk' ? 'default' : 'pointer' },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        label: origen === 'sugerida' ? '¿unir?' : undefined,
        labelStyle: { fill: 'var(--color-warn)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--color-surface)' },
        data: { r, origen },
      };
    };
    return [
      ...relaciones.map((r, i) => linea(r, r.origen || 'fk', i)),
      ...sugeridas.filter((s) => !relaciones.some((r) => mismo(r, s))).map((r, i) => linea(r, 'sugerida', i)),
    ];
  }, [relaciones, sugeridas, x]);

  const conectar = useCallback(({ source, sourceHandle, target, targetHandle }) => {
    if (!source || !target || source === target) return;
    const a = { tabla: source, columna: sourceHandle.replace(/:[id]$/, '') };
    const b = { tabla: target, columna: targetHandle.replace(/:[id]$/, '') };
    const esPk = (lado) => modelo.tablas.find((t) => t.clave === lado.tabla)?.campos.find((c) => c.nombre === lado.columna)?.pk;
    // La relación va del campo que apunta a la clave: si se arrastró al revés, se da vuelta.
    onAgregar(esPk(a) && !esPk(b) ? { desde: b, hacia: a } : { desde: a, hacia: b });
  }, [modelo, onAgregar]);

  const clicLinea = useCallback((_, edge) => {
    const { r, origen } = edge.data;
    const texto = `${r.desde.tabla}.${r.desde.columna} → ${r.hacia.tabla}.${r.hacia.columna}`;
    if (origen === 'sugerida') onAgregar({ desde: r.desde, hacia: r.hacia });
    else if (origen === 'manual' && window.confirm(`¿Sacar la relación ${texto}?`)) onQuitar(r);
  }, [onAgregar, onQuitar]);

  return (
    <div className="modelo-flow h-full w-full rounded-md border border-hair">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={conectar}
        onEdgeClick={clicLinea}
        connectionMode={ConnectionMode.Loose}
        connectionLineStyle={{ stroke: 'var(--color-accent)', strokeWidth: 1.6 }}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        elementsSelectable={false}
      >
        <Background color="var(--color-hair)" gap={18} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
