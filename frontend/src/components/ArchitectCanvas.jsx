import React, { useState, useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  MarkerType,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

/* ── ArchitectCanvas · Flujograma de decisión ────────────────────────────────
   Canvas editable donde el usuario modela su proceso/decisión y vincula
   evidencia de su corpus. Usa React Flow.
   ────────────────────────────────────────────────────────────────────────── */

const NODE_TYPES_CONFIG = [
  { type: 'paso', label: 'Paso', icon: '▢', color: '#5AC8FA' },
  { type: 'decision', label: 'Decisión', icon: '◇', color: '#FFB44D' },
  { type: 'evidencia', label: 'Evidencia', icon: '◈', color: '#6FE3D4' },
  { type: 'resultado', label: 'Resultado', icon: '●', color: '#9B59B6' },
];

function PasoNode({ data, selected }) {
  return (
    <div className={`arch-flow-node arch-flow-node--paso${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="arch-flow-node-header">
        <span className="arch-flow-node-icon">▢</span>
        <span className="arch-flow-node-type">Paso</span>
      </div>
      <div className="arch-flow-node-content">
        {data.label || 'Paso sin título'}
      </div>
      {data.evidencias?.length > 0 && (
        <div className="arch-flow-node-evidencias">
          {data.evidencias.map((e, i) => (
            <span key={i} className="arch-flow-evid-chip" title={e.label}>
              ◈ {e.label?.slice(0, 20)}…
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function DecisionNode({ data, selected }) {
  return (
    <div className={`arch-flow-node arch-flow-node--decision${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="arch-flow-node-header">
        <span className="arch-flow-node-icon">◇</span>
        <span className="arch-flow-node-type">Decisión</span>
      </div>
      <div className="arch-flow-node-content">
        {data.label || '¿Condición?'}
      </div>
      {data.evidencias?.length > 0 && (
        <div className="arch-flow-node-evidencias">
          {data.evidencias.map((e, i) => (
            <span key={i} className="arch-flow-evid-chip" title={e.label}>
              ◈ {e.label?.slice(0, 20)}…
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="yes" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="no" style={{ left: '70%' }} />
    </div>
  );
}

function EvidenciaNode({ data, selected }) {
  return (
    <div className={`arch-flow-node arch-flow-node--evidencia${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="arch-flow-node-header">
        <span className="arch-flow-node-icon">◈</span>
        <span className="arch-flow-node-type">Evidencia</span>
      </div>
      <div className="arch-flow-node-content">
        {data.label || 'Cita del corpus'}
      </div>
      {data.sourceNode && (
        <div className="arch-flow-node-source">
          → {data.sourceNode.label?.slice(0, 30)}…
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ResultadoNode({ data, selected }) {
  return (
    <div className={`arch-flow-node arch-flow-node--resultado${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="arch-flow-node-header">
        <span className="arch-flow-node-icon">●</span>
        <span className="arch-flow-node-type">Resultado</span>
      </div>
      <div className="arch-flow-node-content">
        {data.label || 'Fin del proceso'}
      </div>
    </div>
  );
}

const nodeTypes = {
  paso: PasoNode,
  decision: DecisionNode,
  evidencia: EvidenciaNode,
  resultado: ResultadoNode,
};

const defaultEdgeOptions = {
  style: { strokeWidth: 2, stroke: '#5AC8FA' },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#5AC8FA' },
  animated: true,
};

export default function ArchitectCanvas({
  seccion,
  allNodes = [],
  onAnalyze,
  onClose,
  caseName = '',
  initialProblem = '',
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [huecos, setHuecos] = useState([]);
  const [analizando, setAnalizando] = useState(false);
  const nodeIdCounter = useRef(1);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, ...defaultEdgeOptions }, eds)),
    [setEdges]
  );

  const addNode = useCallback((type) => {
    const id = `node-${nodeIdCounter.current++}`;
    const config = NODE_TYPES_CONFIG.find(c => c.type === type) || NODE_TYPES_CONFIG[0];
    const newNode = {
      id,
      type,
      position: { x: 250 + Math.random() * 100, y: 100 + nodes.length * 120 },
      data: { label: `${config.label} ${nodeIdCounter.current - 1}`, evidencias: [] },
    };
    setNodes((nds) => [...nds, newNode]);
    setShowNodePicker(false);
  }, [nodes.length, setNodes]);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
    setEditingLabel(node.data.label || '');
  }, []);

  const updateNodeLabel = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, label: editingLabel } }
          : n
      )
    );
  }, [selectedNode, editingLabel, setNodes]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedNode(null);
  }, [selectedNode, setNodes, setEdges]);

  const searchEvidencia = useCallback(async (query) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(query)}&seccion=${encodeURIComponent(seccion)}`);
      const d = await r.json();
      const ids = d.ids || [];
      const results = allNodes.filter(n => ids.includes(n.id)).slice(0, 8);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [seccion, allNodes]);

  const vincularEvidencia = useCallback((graphNode) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNode.id) return n;
        const existingEvidencias = n.data.evidencias || [];
        if (existingEvidencias.some(e => e.id === graphNode.id)) return n;
        return {
          ...n,
          data: {
            ...n.data,
            evidencias: [...existingEvidencias, { id: graphNode.id, label: graphNode.label }],
          },
        };
      })
    );
    setSearchQuery('');
    setSearchResults([]);
  }, [selectedNode, setNodes]);

  const desvincularEvidencia = useCallback((evidId) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNode.id) return n;
        return {
          ...n,
          data: {
            ...n.data,
            evidencias: (n.data.evidencias || []).filter(e => e.id !== evidId),
          },
        };
      })
    );
  }, [selectedNode, setNodes]);

  const analizarHuecos = useCallback(async () => {
    if (nodes.length < 2) {
      setHuecos([{ tipo: 'warning', msg: 'Agregá al menos 2 nodos al flujograma para analizar.' }]);
      return;
    }
    setAnalizando(true);
    setHuecos([]);
    
    const flowData = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.data.label,
        evidencias: (n.data.evidencias || []).map(e => e.id),
      })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
      case_name: caseName,
      problem: initialProblem,
    };

    try {
      const r = await fetch('/api/architect/analyze-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flowData),
      });
      
      if (r.ok) {
        const d = await r.json();
        setHuecos(d.gaps || d.huecos || []);
      } else {
        const localHuecos = [];
        const sinConexion = nodes.filter(n => 
          !edges.some(e => e.source === n.id || e.target === n.id)
        );
        sinConexion.forEach(n => {
          localHuecos.push({ tipo: 'warning', msg: `"${n.data.label}" no tiene conexiones.` });
        });
        
        const sinEvidencia = nodes.filter(n => 
          n.type !== 'evidencia' && n.type !== 'resultado' && 
          (!n.data.evidencias || n.data.evidencias.length === 0)
        );
        sinEvidencia.forEach(n => {
          localHuecos.push({ tipo: 'info', msg: `"${n.data.label}" no tiene evidencia vinculada.` });
        });
        
        if (localHuecos.length === 0) {
          localHuecos.push({ tipo: 'ok', msg: 'No se detectaron huecos evidentes.' });
        }
        setHuecos(localHuecos);
      }
    } catch {
      const localHuecos = [];
      nodes.forEach(n => {
        if (n.type !== 'evidencia' && n.type !== 'resultado' && 
            (!n.data.evidencias || n.data.evidencias.length === 0)) {
          localHuecos.push({ tipo: 'info', msg: `"${n.data.label}" sin evidencia del corpus.` });
        }
      });
      if (localHuecos.length === 0) {
        localHuecos.push({ tipo: 'ok', msg: 'Flujo sin huecos detectados localmente.' });
      }
      setHuecos(localHuecos);
    } finally {
      setAnalizando(false);
    }
  }, [nodes, edges, caseName, initialProblem]);

  const exportarFlujo = useCallback(() => {
    const flowData = {
      case_name: caseName,
      problem: initialProblem,
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.data.label,
        position: n.position,
        evidencias: n.data.evidencias || [],
      })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
      huecos,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(flowData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `algedi-flujo-${(caseName || 'proceso').replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, caseName, initialProblem, huecos]);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode) return null;
    return nodes.find(n => n.id === selectedNode.id);
  }, [selectedNode, nodes]);

  return (
    <div className="arch-canvas-wrap">
      <div className="arch-canvas-toolbar">
        <div className="arch-canvas-toolbar-left">
          <button
            className="arch-canvas-btn"
            onClick={() => setShowNodePicker(p => !p)}
            title="Agregar nodo al flujograma"
          >
            ＋ Agregar nodo
          </button>
          {showNodePicker && (
            <div className="arch-canvas-picker">
              {NODE_TYPES_CONFIG.map(cfg => (
                <button
                  key={cfg.type}
                  className="arch-canvas-picker-item"
                  onClick={() => addNode(cfg.type)}
                  style={{ '--node-color': cfg.color }}
                >
                  <span className="arch-canvas-picker-icon">{cfg.icon}</span>
                  {cfg.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="arch-canvas-toolbar-right">
          <button
            className="arch-canvas-btn arch-canvas-btn--analyze"
            onClick={analizarHuecos}
            disabled={analizando}
          >
            {analizando ? 'Analizando…' : '◎ Detectar huecos'}
          </button>
          <button className="arch-canvas-btn" onClick={exportarFlujo}>
            ↓ Exportar
          </button>
        </div>
      </div>

      <div className="arch-canvas-main">
        <div className="arch-canvas-flow">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView
              snapToGrid
              snapGrid={[15, 15]}
            >
              <Controls />
              <MiniMap
                nodeColor={(n) => {
                  const cfg = NODE_TYPES_CONFIG.find(c => c.type === n.type);
                  return cfg?.color || '#5AC8FA';
                }}
                maskColor="rgba(0,0,0,0.8)"
              />
              <Background variant="dots" gap={20} size={1} color="#333" />
            </ReactFlow>
          </ReactFlowProvider>

          {nodes.length === 0 && (
            <div className="arch-canvas-empty">
              <p>Empezá agregando nodos al flujograma.</p>
              <p>Usá <strong>＋ Agregar nodo</strong> para crear pasos, decisiones o resultados.</p>
              <p>Conectá los nodos arrastrando desde los puntos de conexión.</p>
            </div>
          )}
        </div>

        <div className="arch-canvas-sidebar">
          {selectedNodeData ? (
            <>
              <div className="arch-canvas-sidebar-header">
                <h4>Editar nodo</h4>
                <button className="arch-canvas-btn--small" onClick={() => setSelectedNode(null)}>✕</button>
              </div>

              <label className="arch-canvas-label">Título</label>
              <input
                className="arch-canvas-input"
                value={editingLabel}
                onChange={(e) => setEditingLabel(e.target.value)}
                onBlur={updateNodeLabel}
                onKeyDown={(e) => e.key === 'Enter' && updateNodeLabel()}
              />

              <label className="arch-canvas-label">Evidencia vinculada</label>
              <div className="arch-canvas-evidencias">
                {(selectedNodeData.data.evidencias || []).map((ev) => (
                  <div key={ev.id} className="arch-canvas-evid-item">
                    <span>◈ {ev.label}</span>
                    <button onClick={() => desvincularEvidencia(ev.id)} title="Desvincular">✕</button>
                  </div>
                ))}
                {(!selectedNodeData.data.evidencias || selectedNodeData.data.evidencias.length === 0) && (
                  <p className="arch-canvas-hint">Sin evidencia vinculada</p>
                )}
              </div>

              <label className="arch-canvas-label">Buscar en corpus</label>
              <input
                className="arch-canvas-input"
                placeholder="Buscar documentos…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  searchEvidencia(e.target.value);
                }}
              />
              {searching && <p className="arch-canvas-hint">Buscando…</p>}
              {searchResults.length > 0 && (
                <div className="arch-canvas-search-results">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      className="arch-canvas-search-item"
                      onClick={() => vincularEvidencia(r)}
                    >
                      <span className="arch-canvas-search-icon">◈</span>
                      <span className="arch-canvas-search-label">{r.label}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="arch-canvas-actions">
                <button className="arch-canvas-btn--danger" onClick={deleteSelectedNode}>
                  Eliminar nodo
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="arch-canvas-sidebar-header">
                <h4>Información</h4>
              </div>
              <p className="arch-canvas-hint">
                Seleccioná un nodo para editarlo y vincular evidencia de tu corpus.
              </p>
              <div className="arch-canvas-stats">
                <div><strong>{nodes.length}</strong> nodos</div>
                <div><strong>{edges.length}</strong> conexiones</div>
              </div>
            </>
          )}

          {huecos.length > 0 && (
            <div className="arch-canvas-huecos">
              <h4>Análisis del flujo</h4>
              {huecos.map((h, i) => (
                <div key={i} className={`arch-canvas-hueco arch-canvas-hueco--${h.tipo}`}>
                  {h.msg}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
