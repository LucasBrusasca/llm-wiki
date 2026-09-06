import React, { useState, useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from 'react';
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

/* ── ArchitectCanvas · Flujograma de decisión (Canvas-First) ─────────────────
   El canvas es la PANTALLA PRINCIPAL de Architect:
   - El usuario modela su proceso/decisión
   - Click en nodo → drawer lateral (no cambiar de vista)
   - Puede generar flujo desde prompt o cargar plantillas
   - Vincula evidencia del corpus a cada nodo
   ────────────────────────────────────────────────────────────────────────── */

const NODE_TYPES_CONFIG = [
  { type: 'paso', label: 'Paso', icon: '▢', color: '#5AC8FA', desc: 'Una acción o tarea' },
  { type: 'decision', label: 'Decisión', icon: '◇', color: '#FFB44D', desc: 'Un punto de bifurcación' },
  { type: 'evidencia', label: 'Evidencia', icon: '◈', color: '#6FE3D4', desc: 'Cita del corpus' },
  { type: 'resultado', label: 'Resultado', icon: '●', color: '#9B59B6', desc: 'Fin del proceso' },
];

const PLANTILLAS = [
  {
    id: 'simple',
    name: 'Decisión simple',
    desc: 'Un problema → una decisión → dos resultados',
    nodes: [
      { id: 'n1', type: 'paso', position: { x: 250, y: 50 }, data: { label: 'Analizar situación', evidencias: [] } },
      { id: 'n2', type: 'decision', position: { x: 250, y: 170 }, data: { label: '¿Proceder?', evidencias: [] } },
      { id: 'n3', type: 'resultado', position: { x: 100, y: 300 }, data: { label: 'Implementar', evidencias: [] } },
      { id: 'n4', type: 'resultado', position: { x: 400, y: 300 }, data: { label: 'No implementar', evidencias: [] } },
    ],
    edges: [
      { id: 'e1-2', source: 'n1', target: 'n2' },
      { id: 'e2-3', source: 'n2', target: 'n3', sourceHandle: 'yes' },
      { id: 'e2-4', source: 'n2', target: 'n4', sourceHandle: 'no' },
    ],
  },
  {
    id: 'verificacion',
    name: 'Proceso con verificación',
    desc: 'Ejecución → verificación → corrección o avance',
    nodes: [
      { id: 'n1', type: 'paso', position: { x: 250, y: 50 }, data: { label: 'Ejecutar acción', evidencias: [] } },
      { id: 'n2', type: 'paso', position: { x: 250, y: 170 }, data: { label: 'Verificar resultado', evidencias: [] } },
      { id: 'n3', type: 'decision', position: { x: 250, y: 290 }, data: { label: '¿Correcto?', evidencias: [] } },
      { id: 'n4', type: 'resultado', position: { x: 400, y: 420 }, data: { label: 'Finalizado', evidencias: [] } },
      { id: 'n5', type: 'paso', position: { x: 100, y: 420 }, data: { label: 'Corregir', evidencias: [] } },
    ],
    edges: [
      { id: 'e1-2', source: 'n1', target: 'n2' },
      { id: 'e2-3', source: 'n2', target: 'n3' },
      { id: 'e3-4', source: 'n3', target: 'n4', sourceHandle: 'yes' },
      { id: 'e3-5', source: 'n3', target: 'n5', sourceHandle: 'no' },
      { id: 'e5-1', source: 'n5', target: 'n1' },
    ],
  },
  {
    id: 'hitl',
    name: 'Human-in-the-loop',
    desc: 'Automatización con revisión humana',
    nodes: [
      { id: 'n1', type: 'paso', position: { x: 250, y: 50 }, data: { label: 'Proceso automático', evidencias: [] } },
      { id: 'n2', type: 'decision', position: { x: 250, y: 170 }, data: { label: '¿Confianza alta?', evidencias: [] } },
      { id: 'n3', type: 'paso', position: { x: 100, y: 300 }, data: { label: 'Revisión humana', evidencias: [] } },
      { id: 'n4', type: 'decision', position: { x: 100, y: 420 }, data: { label: '¿Aprobado?', evidencias: [] } },
      { id: 'n5', type: 'resultado', position: { x: 250, y: 540 }, data: { label: 'Ejecutar', evidencias: [] } },
      { id: 'n6', type: 'resultado', position: { x: -50, y: 540 }, data: { label: 'Rechazar', evidencias: [] } },
    ],
    edges: [
      { id: 'e1-2', source: 'n1', target: 'n2' },
      { id: 'e2-5', source: 'n2', target: 'n5', sourceHandle: 'yes' },
      { id: 'e2-3', source: 'n2', target: 'n3', sourceHandle: 'no' },
      { id: 'e3-4', source: 'n3', target: 'n4' },
      { id: 'e4-5', source: 'n4', target: 'n5', sourceHandle: 'yes' },
      { id: 'e4-6', source: 'n4', target: 'n6', sourceHandle: 'no' },
    ],
  },
];

function PasoNode({ data, selected }) {
  return (
    <div className={`arch-flow-node arch-flow-node--paso${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="arch-flow-node-header">
        <span className="arch-flow-node-icon">▢</span>
        <span className="arch-flow-node-type">Paso</span>
      </div>
      <div className="arch-flow-node-content">{data.label || 'Paso sin título'}</div>
      {data.evidencias?.length > 0 && (
        <div className="arch-flow-node-evidencias">
          <span className="arch-flow-evid-count">◈ {data.evidencias.length}</span>
        </div>
      )}
      {data.notas && <div className="arch-flow-node-nota">📝</div>}
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
      <div className="arch-flow-node-content">{data.label || '¿Condición?'}</div>
      {data.evidencias?.length > 0 && (
        <div className="arch-flow-node-evidencias">
          <span className="arch-flow-evid-count">◈ {data.evidencias.length}</span>
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
      <div className="arch-flow-node-content">{data.label || 'Cita del corpus'}</div>
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
      <div className="arch-flow-node-content">{data.label || 'Fin'}</div>
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

const ArchitectCanvas = forwardRef(function ArchitectCanvas({
  seccion,
  allNodes = [],
  onAnalyze,
  onClose,
  caseName = '',
  initialProblem = '',
  sugerencias,
  analizando,
}, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  // Drawer state (Fase 2)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingNotas, setEditingNotas] = useState('');
  
  // Node picker
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [showPlantillas, setShowPlantillas] = useState(false);
  
  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  
  // Analysis
  const [huecos, setHuecos] = useState([]);
  const [generando, setGenerando] = useState(false);
  
  const nodeIdCounter = useRef(1);

  // Exponer métodos al padre via ref
  useImperativeHandle(ref, () => ({
    onProblemProcessed: (data) => {
      // Cuando el problema se procesa, podemos generar un flujo inicial
      if (nodes.length === 0 && data.brief?.problem) {
        generarFlujoDesdePrompt(data.brief.problem);
      }
    },
    getFlowData: () => ({
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.data.label,
        evidencias: (n.data.evidencias || []).map(e => e.id),
        notas: n.data.notas,
      })),
      edges: edges.map(e => ({ source: e.source, target: e.target })),
    }),
  }));

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
      data: { label: `${config.label} ${nodeIdCounter.current - 1}`, evidencias: [], notas: '' },
    };
    setNodes((nds) => [...nds, newNode]);
    setShowNodePicker(false);
    // Abrir drawer inmediatamente para editar
    setSelectedNode(newNode);
    setEditingLabel(newNode.data.label);
    setEditingNotas('');
    setDrawerOpen(true);
  }, [nodes.length, setNodes]);

  // Click en nodo → abrir drawer (Fase 2)
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
    setEditingLabel(node.data.label || '');
    setEditingNotas(node.data.notas || '');
    setDrawerOpen(true);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedNode(null);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const updateNodeData = useCallback((updates) => {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, ...updates } }
          : n
      )
    );
  }, [selectedNode, setNodes]);

  const saveAndCloseDrawer = useCallback(() => {
    updateNodeData({ label: editingLabel, notas: editingNotas });
    closeDrawer();
  }, [editingLabel, editingNotas, updateNodeData, closeDrawer]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    closeDrawer();
  }, [selectedNode, setNodes, setEdges, closeDrawer]);

  // Búsqueda de evidencia
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

  // Cargar plantilla
  const cargarPlantilla = useCallback((plantilla) => {
    const baseId = nodeIdCounter.current;
    const newNodes = plantilla.nodes.map((n, i) => ({
      ...n,
      id: `node-${baseId + i}`,
      data: { ...n.data },
    }));
    const idMap = {};
    plantilla.nodes.forEach((n, i) => { idMap[n.id] = `node-${baseId + i}`; });
    const newEdges = plantilla.edges.map((e, i) => ({
      ...e,
      id: `edge-${baseId + i}`,
      source: idMap[e.source],
      target: idMap[e.target],
      ...defaultEdgeOptions,
    }));
    nodeIdCounter.current = baseId + plantilla.nodes.length;
    setNodes(newNodes);
    setEdges(newEdges);
    setShowPlantillas(false);
  }, [setNodes, setEdges]);

  // Generar flujo desde prompt (Fase 3)
  const generarFlujoDesdePrompt = useCallback(async (problemText) => {
    const texto = problemText || initialProblem;
    if (!texto.trim()) return;
    
    setGenerando(true);
    try {
      // Intentar con el backend primero
      const r = await fetch('/api/architect/generate-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: texto, case_name: caseName }),
      });
      
      if (r.ok) {
        const data = await r.json();
        if (data.nodes?.length > 0) {
          const baseId = nodeIdCounter.current;
          const newNodes = data.nodes.map((n, i) => ({
            id: `node-${baseId + i}`,
            type: n.type || 'paso',
            position: n.position || { x: 250, y: 50 + i * 120 },
            data: { label: n.label, evidencias: [], notas: '' },
          }));
          const idMap = {};
          data.nodes.forEach((n, i) => { idMap[n.id || i] = `node-${baseId + i}`; });
          const newEdges = (data.edges || []).map((e, i) => ({
            id: `edge-${baseId + i}`,
            source: idMap[e.source] || e.source,
            target: idMap[e.target] || e.target,
            ...defaultEdgeOptions,
          }));
          nodeIdCounter.current = baseId + data.nodes.length;
          setNodes(newNodes);
          setEdges(newEdges);
          return;
        }
      }
    } catch {
      // Fallback a heurística local
    }
    
    // Heurística local: crear un flujo simple basado en el texto
    cargarPlantilla(PLANTILLAS[0]); // Cargar "Decisión simple" como fallback
    // Actualizar el primer nodo con el problema
    setTimeout(() => {
      setNodes(nds => nds.map((n, i) => 
        i === 0 ? { ...n, data: { ...n.data, label: texto.slice(0, 50) + (texto.length > 50 ? '…' : '') } } : n
      ));
    }, 100);
    
    setGenerando(false);
  }, [initialProblem, caseName, cargarPlantilla, setNodes, setEdges]);

  // Analizar huecos
  const analizarHuecos = useCallback(async () => {
    if (nodes.length < 2) {
      setHuecos([{ tipo: 'warning', msg: 'Agregá al menos 2 nodos para analizar.' }]);
      return;
    }
    
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
      localHuecos.push({ tipo: 'info', msg: `"${n.data.label}" sin evidencia.` });
    });
    
    if (localHuecos.length === 0) {
      localHuecos.push({ tipo: 'ok', msg: 'No se detectaron huecos.' });
    }
    setHuecos(localHuecos);
  }, [nodes, edges]);

  // Exportar
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
        notas: n.data.notas,
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
      {/* Toolbar */}
      <div className="arch-canvas-toolbar">
        <div className="arch-canvas-toolbar-left">
          <div className="arch-canvas-btn-group">
            <button
              className="arch-canvas-btn"
              onClick={() => setShowNodePicker(p => !p)}
              title="Agregar nodo"
            >
              ＋ Nodo
            </button>
            <button
              className="arch-canvas-btn"
              onClick={() => setShowPlantillas(p => !p)}
              title="Cargar plantilla"
            >
              ⊞ Plantilla
            </button>
            <button
              className="arch-canvas-btn"
              onClick={() => generarFlujoDesdePrompt()}
              disabled={generando || !initialProblem.trim()}
              title="Generar flujo desde el problema"
            >
              {generando ? '⟳' : '◈'} Generar
            </button>
          </div>
          
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
                  <span>
                    <strong>{cfg.label}</strong>
                    <small>{cfg.desc}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          
          {showPlantillas && (
            <div className="arch-canvas-picker arch-canvas-picker--plantillas">
              {PLANTILLAS.map(p => (
                <button
                  key={p.id}
                  className="arch-canvas-picker-item"
                  onClick={() => cargarPlantilla(p)}
                >
                  <span className="arch-canvas-picker-icon">⊞</span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.desc}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        <div className="arch-canvas-toolbar-right">
          <button
            className="arch-canvas-btn"
            onClick={analizarHuecos}
          >
            ◎ Huecos
          </button>
          {onAnalyze && (
            <button
              className="arch-canvas-btn arch-canvas-btn--secondary"
              onClick={() => onAnalyze({
                nodes: nodes.map(n => ({ id: n.id, type: n.type, label: n.data.label })),
                edges: edges.map(e => ({ source: e.source, target: e.target })),
              })}
              disabled={analizando || nodes.length < 1}
              title="Opcional: obtener sugerencia de ruta basada en tu corpus"
            >
              {analizando ? 'Analizando…' : '⬢ Sugerir ruta (opcional)'}
            </button>
          )}
          <button className="arch-canvas-btn" onClick={exportarFlujo}>
            ↓ Exportar
          </button>
        </div>
      </div>

      {/* Main area: Canvas + Drawer */}
      <div className="arch-canvas-main">
        <div className={`arch-canvas-flow${drawerOpen ? ' with-drawer' : ''}`}>
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
              onPaneClick={() => drawerOpen && closeDrawer()}
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
              <p><strong>Canvas vacío</strong></p>
              <p>Empezá con una <button className="arch-link-btn" onClick={() => setShowPlantillas(true)}>plantilla</button> o agregá nodos manualmente.</p>
              {initialProblem && (
                <button className="arch-canvas-btn arch-canvas-btn--big" onClick={() => generarFlujoDesdePrompt()}>
                  ◈ Generar flujo desde el problema
                </button>
              )}
            </div>
          )}
        </div>

        {/* Drawer (Fase 2): panel lateral sobre el canvas */}
        {drawerOpen && selectedNodeData && (
          <div className="arch-drawer">
            <div className="arch-drawer-header">
              <h4>
                <span className="arch-drawer-icon">
                  {NODE_TYPES_CONFIG.find(c => c.type === selectedNodeData.type)?.icon || '▢'}
                </span>
                Editar {NODE_TYPES_CONFIG.find(c => c.type === selectedNodeData.type)?.label || 'nodo'}
              </h4>
              <button className="arch-drawer-close" onClick={saveAndCloseDrawer}>✕</button>
            </div>

            <div className="arch-drawer-body">
              <label className="arch-drawer-label">Título</label>
              <input
                className="arch-drawer-input"
                value={editingLabel}
                onChange={(e) => setEditingLabel(e.target.value)}
                placeholder="Nombre del nodo"
                autoFocus
              />

              <label className="arch-drawer-label">Notas</label>
              <textarea
                className="arch-drawer-textarea"
                value={editingNotas}
                onChange={(e) => setEditingNotas(e.target.value)}
                placeholder="Notas adicionales…"
                rows={3}
              />

              <label className="arch-drawer-label">Evidencia vinculada</label>
              <div className="arch-drawer-evidencias">
                {(selectedNodeData.data.evidencias || []).map((ev) => (
                  <div key={ev.id} className="arch-drawer-evid-item">
                    <span>◈ {ev.label}</span>
                    <button onClick={() => desvincularEvidencia(ev.id)} title="Desvincular">✕</button>
                  </div>
                ))}
                {(!selectedNodeData.data.evidencias || selectedNodeData.data.evidencias.length === 0) && (
                  <p className="arch-drawer-hint">Sin evidencia vinculada</p>
                )}
              </div>

              <label className="arch-drawer-label">Buscar en corpus</label>
              <input
                className="arch-drawer-input"
                placeholder="Buscar documentos…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  searchEvidencia(e.target.value);
                }}
              />
              {searching && <p className="arch-drawer-hint">Buscando…</p>}
              {searchResults.length > 0 && (
                <div className="arch-drawer-search-results">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      className="arch-drawer-search-item"
                      onClick={() => vincularEvidencia(r)}
                    >
                      ◈ {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="arch-drawer-footer">
              <button className="arch-drawer-btn arch-drawer-btn--save" onClick={saveAndCloseDrawer}>
                Guardar
              </button>
              <button className="arch-drawer-btn arch-drawer-btn--danger" onClick={deleteSelectedNode}>
                Eliminar
              </button>
            </div>
          </div>
        )}

        {/* Huecos (si hay) */}
        {huecos.length > 0 && !drawerOpen && (
          <div className="arch-canvas-huecos-float">
            {huecos.map((h, i) => (
              <div key={i} className={`arch-canvas-hueco arch-canvas-hueco--${h.tipo}`}>
                {h.msg}
              </div>
            ))}
            <button className="arch-canvas-huecos-close" onClick={() => setHuecos([])}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
});

export default ArchitectCanvas;
