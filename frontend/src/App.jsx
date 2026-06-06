import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import Graph3D from './components/Graph3D.jsx';
import NodePanel from './components/NodePanel.jsx';
import AgentPanel from './components/AgentPanel.jsx';
import ReportPanel from './components/ReportPanel.jsx';
import RelationPanel from './components/RelationPanel.jsx';
import LibraryPanel from './components/LibraryPanel.jsx';
import SynthesisPanel from './components/SynthesisPanel.jsx';
import IssuePanel from './components/IssuePanel.jsx';
import Footer from './components/Footer.jsx';

// Paleta azul marino tecnológica — azules / cianes, sin ámbar.
export const CLUSTER_PALETTE = [
  '#4a90d9','#00d4ff','#5fa8e8','#2f6fb0','#7ec8f0',
  '#3b82c4','#26b6e6','#8fd4f5','#1f5f9e','#5cc4e0',
  '#6aa7e0','#13a0d8','#a0d8f0','#2a78bd','#48b4e2',
];

export function clusterColor(cluster) {
  if (cluster === undefined || cluster === null || cluster < 0) return '#5a7a9a';
  return CLUSTER_PALETTE[cluster % CLUSTER_PALETTE.length];
}

export function ytId(url) {
  const m = url?.match(/(?:youtu\.be\/|v=|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function buildGraphData(data) {
  const SCALE = 250;
  const nodes = (data.nodos || []).map(n => {
    const base = { ...n };
    if (n.x3d !== undefined) {
      base.x = n.x3d * SCALE;
      base.y = n.y3d * SCALE;
      base.z = n.z3d * SCALE;
      // Only pin nodes that have real UMAP coordinates (embedding field present)
      if (n.embedding) {
        base.fx = n.x3d * SCALE;
        base.fy = n.y3d * SCALE;
        base.fz = n.z3d * SCALE;
      }
    }
    return base;
  });
  const links = (data.relaciones || []).map(l => ({
    source: l.source,
    target: l.target,
    score: l.score,
    label: l.label,
    shared_concepts: l.shared_concepts,
    description: l.description,
  }));
  return { nodes, links };
}

const isTouchDevice = () =>
  window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;

export default function App() {
  const [graphData, setGraphData]       = useState({ nodes: [], links: [] });
  const [fixedNode,  setFixedNode]      = useState(null);
  const [hoverNode,  setHoverNode]      = useState(null);
  const [tooltipPos, setTooltipPos]     = useState({ x: 60, y: 80 });
  const [agentOpen,  setAgentOpen]      = useState(false);
  const [highlighted, setHighlighted]   = useState(new Set());
  const [searchQ, setSearchQ]           = useState('');
  const [semanticIds, setSemanticIds]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [fetchError, setFetchError]     = useState(false);
  // Synthesis mode
  const [synthMode, setSynthMode]       = useState(false);
  const [synthOpen, setSynthOpen]       = useState(false);
  const [synthSelected, setSynthSelected] = useState(new Set());
  const [reportOpen, setReportOpen]     = useState(false);
  const [globalAgent, setGlobalAgent]   = useState(false);
  const [selectedLink, setSelectedLink] = useState(null);
  const [libraryOpen, setLibraryOpen]   = useState(false);
  const [issueOpen, setIssueOpen]       = useState(false);
  const [layoutMode, setLayoutMode]     = useState('components');

  const hoverTimer = useRef(null);
  const searchTimer = useRef(null);
  const projectRef = useRef(null);   // proyección 3D→pantalla (la setea Graph3D)
  const panelElRef = useRef(null);   // elemento del NodePanel (para el conector)

  const handleSearchChange = useCallback(e => {
    const q = e.target.value;
    setSearchQ(q.toLowerCase());
    clearTimeout(searchTimer.current);
    if (q.trim().length >= 3) {
      searchTimer.current = setTimeout(async () => {
        try {
          const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
          const d = await r.json();
          setSemanticIds(d.ids?.length ? new Set(d.ids) : null);
        } catch { setSemanticIds(null); }
      }, 350);
    } else {
      setSemanticIds(null);
    }
  }, []);

  const loadGraph = useCallback(() => {
    setLoading(true);
    setFetchError(false);
    fetch('/api/graph')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setGraphData(buildGraphData(data)); setLoading(false); })
      .catch(() => { setFetchError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // activeNode: solo click (para mostrar el panel)
  // highlightNode: click O hover (para resaltar en el grafo)
  const activeNode    = fixedNode;
  const highlightNode = fixedNode || hoverNode;
  const isFixed       = Boolean(fixedNode);

  useEffect(() => {
    if (synthMode) {
      setHighlighted(new Set(synthSelected));
      return;
    }
    if (selectedLink) {
      setHighlighted(new Set([selectedLink.nodeA.id, selectedLink.nodeB.id]));
      return;
    }
    if (!highlightNode) { setHighlighted(new Set()); return; }
    const connected = new Set([highlightNode.id]);
    graphData.links.forEach(l => {
      const s = l.source?.id ?? l.source, t = l.target?.id ?? l.target;
      if (s === highlightNode.id) connected.add(t);
      if (t === highlightNode.id) connected.add(s);
    });
    setHighlighted(connected);
  }, [highlightNode, graphData.links, synthMode, synthSelected, selectedLink]);

  const handleLinkClick = useCallback((link, event) => {
    if (synthMode) return;
    const src = link.source?.id ?? link.source;
    const tgt = link.target?.id ?? link.target;
    const nodeA = graphData.nodes.find(n => n.id === src);
    const nodeB = graphData.nodes.find(n => n.id === tgt);
    if (!nodeA || !nodeB) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = 560, H = 520;
    const cx = event?.clientX ?? vw / 2;
    const cy = event?.clientY ?? vh / 2;
    setTooltipPos({
      x: Math.min(Math.max(cx - W / 2, 8), vw - W - 8),
      y: Math.min(Math.max(cy - 60, 56), vh - H - 40),
    });
    setSelectedLink({
      nodeA, nodeB,
      linkMeta: {
        score: link.score,
        label: link.label,
        shared_concepts: link.shared_concepts,
        description: link.description,
      },
    });
    setFixedNode(null);
    setHoverNode(null);
    setAgentOpen(false);
    setReportOpen(false);
    setGlobalAgent(false);
  }, [synthMode, graphData.nodes]);

  const handleNodeClick = useCallback((node, event) => {
    setSelectedLink(null);
    if (synthMode) {
      setSynthSelected(prev => {
        const next = new Set(prev);
        next.has(node.id) ? next.delete(node.id) : next.add(node.id);
        return next;
      });
      return;
    }
    // Posición consistente y siempre visible (zona derecha, debajo del header).
    // En desktop el panel es two-col (~850px); uso ese ancho real para que entre completo.
    const vw = window.innerWidth;
    const W = vw >= 900 ? 850 : Math.min(vw - 24, 360);
    setTooltipPos({
      x: Math.max(16, vw - W - 24),
      y: 84,
    });
    setFixedNode(node);
    setHoverNode(null);
    setAgentOpen(false);
  }, [synthMode]);

  const handleNodeHover = useCallback(node => {
    if (synthMode || isTouchDevice()) return;
    clearTimeout(hoverTimer.current);
    if (!node) {
      hoverTimer.current = setTimeout(() => setHoverNode(null), 120);
    } else {
      if (!fixedNode || fixedNode.id !== node.id) setHoverNode(node);
    }
  }, [fixedNode, synthMode]);

  const handleClosePanel = useCallback(() => {
    setFixedNode(null); setHoverNode(null);
    setAgentOpen(false); setReportOpen(false); setHighlighted(new Set()); setSelectedLink(null);
  }, []);

  const handleOpenAgent = useCallback(node => {
    setFixedNode(node); setAgentOpen(true); setReportOpen(false); setGlobalAgent(false);
  }, []);

  const handleOpenReport = useCallback(node => {
    setFixedNode(node); setReportOpen(true); setAgentOpen(false); setGlobalAgent(false);
  }, []);

  const handleHighlight = useCallback(ids => setHighlighted(new Set(ids)), []);

  const handleDeleteNode = useCallback(async (nodeId) => {
    await fetch(`/api/node/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
    setFixedNode(null); setHoverNode(null); setAgentOpen(false);
    loadGraph();
  }, [loadGraph]);

  const handleReset = useCallback(async () => {
    if (!window.confirm('¿Resetear el grafo? Esto elimina todos los nodos y relaciones.')) return;
    await fetch('/api/reset', { method: 'POST' });
    setFixedNode(null); setHoverNode(null);
    setAgentOpen(false); setSynthSelected(new Set()); setSelectedLink(null);
    loadGraph();
  }, [loadGraph]);

  const toggleSynth = useCallback(() => {
    setSynthMode(m => {
      const next = !m;
      if (next) { setSynthOpen(true); setFixedNode(null); setAgentOpen(false); setReportOpen(false); setGlobalAgent(false); setSelectedLink(null); }
      else      { setSynthOpen(false); }
      return next;
    });
  }, []);

  const handleOpenSynthesisFromRelation = useCallback((nodeIds) => {
    setSynthSelected(new Set(nodeIds));
    setSynthMode(true);
    setSynthOpen(true);
    setSelectedLink(null);
    setFixedNode(null);
    setAgentOpen(false);
    setReportOpen(false);
    setGlobalAgent(false);
  }, []);

  const toggleGlobalAgent = useCallback(() => {
    setGlobalAgent(g => {
      if (!g) { setAgentOpen(false); setReportOpen(false); setSynthMode(false); setSynthOpen(false); }
      return !g;
    });
  }, []);

  // Merge keyword filter with semantic results — useMemo avoids recomputing on unrelated re-renders
  const filteredIds = useMemo(() => {
    if (!searchQ) return null;
    const keyword = new Set(graphData.nodes
      .filter(n =>
        n.label.toLowerCase().includes(searchQ) ||
        (n.desc || '').toLowerCase().includes(searchQ) ||
        (n.fragmento || '').toLowerCase().includes(searchQ) ||
        (n.conceptos || []).some(c => c.toLowerCase().includes(searchQ))
      )
      .map(n => n.id));
    if (!semanticIds) return keyword;
    const merged = new Set([...keyword, ...semanticIds]);
    return merged.size ? merged : keyword;
  }, [searchQ, semanticIds, graphData.nodes]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="header-brand-icon">◈</span>
          <span>PRAGMAFORGE</span>
        </div>
        <input
          className="search-input"
          placeholder={semanticIds ? `⬡ ${semanticIds.size} resultados` : 'Buscar con IA…'}
          value={searchQ}
          onChange={handleSearchChange}
        />
        <div className="header-actions">
          <button
            className={`btn-synth${libraryOpen ? ' active' : ''}`}
            onClick={() => setLibraryOpen(o => !o)}
            title="Biblioteca de nodos"
          >
            ⊞ Biblioteca
          </button>
          <button
            className={`btn-synth btn-issue${issueOpen ? ' active' : ''}`}
            onClick={() => setIssueOpen(o => !o)}
            title="Módulo de issues"
          >
            ⚠ Issue
          </button>
          <button
            className={`btn-synth${globalAgent ? ' active' : ''}`}
            onClick={toggleGlobalAgent}
            title="Agente global"
          >
            ⬡ Agente
          </button>
          <button
            className={`btn-synth${synthMode ? ' active' : ''}`}
            onClick={toggleSynth}
            title="Modo síntesis"
          >
            ◈ Síntesis
          </button>
          <button className="btn-reload" onClick={loadGraph} title="Recargar">↺</button>
          <button className="btn-reload" title="Recalcular relaciones"
            onClick={async () => { await fetch('/api/recompute-relations', { method: 'POST' }); loadGraph(); }}>
            ⟳
          </button>
          <button className="btn-reset" onClick={handleReset} title="Resetear grafo">⌫</button>
          {fetchError
            ? <span className="header-stat header-stat--error">Backend no conectado</span>
            : <span className="header-stat">{graphData.nodes.length} nodos · {graphData.links.length} relaciones</span>
          }
        </div>
      </header>

      {loading && (
        <div className="loading-overlay">
          <div className="loading-text">Cargando grafo...</div>
        </div>
      )}

      {synthMode && (
        <div className="synth-banner">
          ◈ Modo síntesis activo — clickeá nodos para seleccionarlos
        </div>
      )}

      <Graph3D
        graphData={graphData}
        selectedNode={highlightNode}
        highlighted={highlighted}
        filteredIds={filteredIds}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkClick={handleLinkClick}
        synthMode={synthMode}
        layoutMode={layoutMode}
        projectRef={projectRef}
      />

      {/* Layout Mode Selector */}
      <div className="layout-controls">
        {[
          { id: 'density',    icon: '⊞', label: 'Densidad',   tip: 'Agrupa nodos por cluster semántico. Cada grupo compacto comparte temas similares.' },
          { id: 'components', icon: '⬡', label: 'UMAP',       tip: 'Reducción dimensional del espacio de embeddings. La distancia entre nodos refleja similitud semántica real.' },
          { id: 'centroid',   icon: '⊙', label: 'Centroides', tip: 'Disposición radial: los nodos más similares al centroide global van al centro; los más distantes, a la periferia.' },
          { id: 'pca',        icon: '⊕', label: 'PCA',        tip: 'Proyección por componentes principales. Muestra la máxima varianza semántica del grafo.' },
        ].map(({ id, icon, label, tip }) => (
          <div key={id} className="layout-btn-wrap">
            <button
              className={`layout-btn${layoutMode === id ? ' active' : ''}`}
              onClick={() => setLayoutMode(id)}
            >
              <span className="layout-btn-icon">{icon}</span>
              <span className="layout-btn-label">{label}</span>
            </button>
            <div className="layout-btn-tooltip">{tip}</div>
          </div>
        ))}
      </div>

      {activeNode && !agentOpen && !reportOpen && !synthMode && !globalAgent && (
        <>
          <NodePanel
            key={activeNode.id}
            node={activeNode}
            allNodes={graphData.nodes}
            allLinks={graphData.links}
            onClose={handleClosePanel}
            onOpenAgent={handleOpenAgent}
            onOpenReport={handleOpenReport}
            onNavigate={node => { setFixedNode(node); setHoverNode(null); setReportOpen(false); }}
            onDelete={handleDeleteNode}
            initialPos={tooltipPos}
            containerRef={panelElRef}
            fixed={isFixed}
          />
        </>
      )}

      {fixedNode && agentOpen && !synthMode && (
        <AgentPanel
          node={fixedNode}
          onClose={() => { setAgentOpen(false); setHighlighted(new Set()); }}
          onHighlight={handleHighlight}
        />
      )}

      {fixedNode && reportOpen && !synthMode && (
        <ReportPanel
          node={fixedNode}
          onClose={() => setReportOpen(false)}
        />
      )}

      {globalAgent && (
        <AgentPanel
          node={null}
          allNodes={graphData.nodes}
          onClose={() => setGlobalAgent(false)}
          onHighlight={handleHighlight}
        />
      )}

      {selectedLink && !synthMode && (
        <RelationPanel
          nodeA={selectedLink.nodeA}
          nodeB={selectedLink.nodeB}
          linkMeta={selectedLink.linkMeta}
          onClose={() => { setSelectedLink(null); setHighlighted(new Set()); }}
          initialPos={tooltipPos}
          onOpenSynthesis={handleOpenSynthesisFromRelation}
        />
      )}

      {synthOpen && (
        <SynthesisPanel
          allNodes={graphData.nodes}
          selectedIds={synthSelected}
          onClose={() => { setSynthOpen(false); setSynthMode(false); setSynthSelected(new Set()); }}
          onClearSelection={() => setSynthSelected(new Set())}
        />
      )}

      {issueOpen && (
        <IssuePanel
          allNodes={graphData.nodes}
          onClose={() => setIssueOpen(false)}
          onRefresh={loadGraph}
          onNavigate={node => { setFixedNode(node); setHoverNode(null); }}
        />
      )}

      {libraryOpen && (
        <LibraryPanel
          allNodes={graphData.nodes}
          allLinks={graphData.links}
          onClose={() => setLibraryOpen(false)}
          onNavigate={node => { setFixedNode(node); setHoverNode(null); }}
          onDelete={handleDeleteNode}
          onRename={loadGraph}
          onRefresh={loadGraph}
        />
      )}

      <Footer />
    </div>
  );
}
