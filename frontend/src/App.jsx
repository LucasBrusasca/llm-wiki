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
import DiscoveriesPanel from './components/DiscoveriesPanel.jsx';
import ProcessPanel from './components/ProcessPanel.jsx';
import { computeDiscoveries } from './discoveries.js';

// Paleta azul marino tecnológica — azules / cianes, sin ámbar.
// Paleta CATEGÓRICA "jewel tones": tonos JOYA profundos y saturados pero elegantes —
// ricos sobre el fondo negro (no pálidos, no neón). Brillo calibrado para que un punto
// chico se vea bien sobre negro. Moderna y profesional. Cada tema conserva su color.
export const CLUSTER_PALETTE = [
  '#2c3e94', // índigo profundo
  '#0b6b4a', // esmeralda profunda
  '#4a2b96', // violeta profundo
  '#8c1d44', // vino / frambuesa
  '#0c6675', // petróleo
  '#6a2580', // púrpura profundo
  '#1f7031', // verde bosque
  '#8a5f12', // oro viejo / bronce
  '#9a3410', // óxido
  '#1a5a8a', // azul acero profundo
];

export function clusterColor(cluster) {
  if (cluster === undefined || cluster === null || cluster < 0) return '#5a7a9a';
  return CLUSTER_PALETTE[cluster % CLUSTER_PALETTE.length];
}

export function ytId(url) {
  const m = url?.match(/(?:youtu\.be\/|v=|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Secciones conocidas localmente (incluye las VACÍAS recién creadas, que el backend aún
// no lista porque no tienen documentos). Se mergean con las del backend.
const SEC_KEY = 'algedi_secciones_known';
const getKnownSecciones = () => {
  try { const a = JSON.parse(localStorage.getItem(SEC_KEY) || '["personal"]'); return Array.isArray(a) && a.length ? a : ['personal']; }
  catch { return ['personal']; }
};
const setKnownSecciones = (arr) => {
  try { localStorage.setItem(SEC_KEY, JSON.stringify([...new Set(arr)])); } catch {}
};

// Poda de relaciones: con umbral bajo casi todo se conecta (telaraña). Conservamos
// por nodo sus K relaciones MÁS FUERTES (por score = similitud coseno). Una arista
// sobrevive si está en el top-K de CUALQUIERA de sus dos extremos (unión) → el grafo
// queda conectado pero limpio, mostrando solo las conexiones que valen.
const LINKS_POR_NODO = 3;
function pruneLinks(links, K = LINKS_POR_NODO) {
  const byNode = new Map();
  links.forEach(l => {
    const s = l.score ?? 0;
    for (const id of [l.source, l.target]) {
      if (!byNode.has(id)) byNode.set(id, []);
      byNode.get(id).push({ l, s });
    }
  });
  const keep = new Set();
  byNode.forEach(arr => {
    arr.sort((a, b) => b.s - a.s);
    arr.slice(0, K).forEach(({ l }) => keep.add(l));
  });
  return links.filter(l => keep.has(l));
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
  return { nodes, links: pruneLinks(links) };
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
  const [discoveriesOpen, setDiscoveriesOpen] = useState(false);
  const [processOpen, setProcessOpen]   = useState(false);
  const [relayouting, setRelayouting]   = useState(false);
  const [toolsOpen, setToolsOpen]       = useState(false);
  // Secciones = grafos de conocimiento independientes (por `dominio`).
  const [seccion, setSeccionState]      = useState(() => localStorage.getItem('algedi_seccion') || 'personal');
  const [sections, setSections]         = useState([{ nombre: 'personal', count: 0 }]);
  const [seccionOpen, setSeccionOpen]   = useState(false);
  const [securityEnabled, setSecurityEnabled] = useState(false);
  const [layoutMode, setLayoutMode]     = useState('components');
  const [focusTrigger, setFocusTrigger] = useState(0);  // botón "enfocar" del panel
  const [fitTrigger, setFitTrigger]     = useState(0);  // botón "ver todo" (desenfocar)

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

  const loadSections = useCallback(() => {
    fetch('/api/sections')
      .then(r => r.json())
      .then(d => {
        const backend = Array.isArray(d.secciones) ? d.secciones : [];
        const map = new Map(backend.map(s => [s.nombre, s]));
        // Mergear con las conocidas localmente (incluye vacías). La activa ya está en
        // "conocidas" (la agrega cambiarSeccion) → no la re-agregamos acá con un nombre
        // que podría ser el viejo tras un rename.
        [...getKnownSecciones(), 'personal'].forEach(n => {
          if (n && !map.has(n)) map.set(n, { nombre: n, count: 0 });
        });
        const list = [...map.values()].sort(
          (a, b) => (a.nombre !== 'personal') - (b.nombre !== 'personal') || a.nombre.localeCompare(b.nombre)
        );
        setSections(list);
        setKnownSecciones(list.map(s => s.nombre));
      })
      .catch(() => {});
  }, []);

  const cambiarSeccion = useCallback((nombre) => {
    setSeccionState(nombre);
    try { localStorage.setItem('algedi_seccion', nombre); } catch {}
    setKnownSecciones([...getKnownSecciones(), nombre]);  // la activa siempre en conocidas
    setSeccionOpen(false);
  }, []);

  const nuevaSeccion = useCallback(() => {
    const n = window.prompt('Nombre de la nueva sección (un grafo aparte):');
    const nombre = (n || '').trim();
    if (!nombre) return;
    setKnownSecciones([...getKnownSecciones(), nombre]);
    setSections(prev => prev.some(s => s.nombre === nombre) ? prev : [...prev, { nombre, count: 0 }]);
    cambiarSeccion(nombre);
  }, [cambiarSeccion]);

  const loadGraph = useCallback(() => {
    setLoading(true);
    setFetchError(false);
    fetch(`/api/graph?seccion=${encodeURIComponent(seccion)}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setGraphData(buildGraphData(data)); setLoading(false); })
      .catch(() => {
        // Sin backend (ej. GitHub Pages): cargar el snapshot estático de demo.
        fetch(`${import.meta.env.BASE_URL}demo-graph.json`)
          .then(r => { if (!r.ok) throw new Error('no demo'); return r.json(); })
          .then(data => { setGraphData(buildGraphData(data)); setLoading(false); })
          .catch(() => { setFetchError(true); setLoading(false); });
      });
  }, [seccion]);

  const renombrarSeccion = useCallback(async (nombre) => {
    setSeccionOpen(false);
    const nuevo = (window.prompt(`Nuevo nombre para «${nombre}»:`, nombre) || '').trim();
    if (!nuevo || nuevo === nombre) return;
    try {
      const r = await fetch('/api/sections/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: nombre, to: nuevo }),
      });
      if (!r.ok) { window.alert('No se pudo renombrar.'); return; }
      setKnownSecciones(getKnownSecciones().map(x => x === nombre ? nuevo : x));
      if (seccion === nombre) cambiarSeccion(nuevo);
      loadGraph(); loadSections();
    } catch { window.alert('Error de conexión.'); }
  }, [seccion, cambiarSeccion, loadGraph, loadSections]);

  const eliminarSeccion = useCallback(async (nombre) => {
    setSeccionOpen(false);
    if (!window.confirm(`¿Eliminar la sección «${nombre}» y TODOS sus documentos? No se puede deshacer.`)) return;
    let password = null;
    if (securityEnabled) {
      password = window.prompt(`Clave de seguridad para eliminar «${nombre}»:`);
      if (password == null) return;
    }
    try {
      const r = await fetch('/api/sections/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, password }),
      });
      if (r.status === 403) { window.alert('Clave de seguridad incorrecta. La sección está intacta.'); return; }
      if (!r.ok) { window.alert('No se pudo eliminar.'); return; }
      setKnownSecciones(getKnownSecciones().filter(x => x !== nombre));
      if (seccion === nombre) cambiarSeccion('personal');
      loadGraph(); loadSections();
    } catch { window.alert('Error de conexión.'); }
  }, [seccion, securityEnabled, cambiarSeccion, loadGraph, loadSections]);

  useEffect(() => { loadGraph(); }, [loadGraph]);
  useEffect(() => { loadSections(); }, [loadSections]);
  useEffect(() => {
    fetch('/api/security').then(r => r.json()).then(d => setSecurityEnabled(!!d.enabled)).catch(() => {});
  }, []);

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

  const descargarBackup = useCallback(async () => {
    const resp = await fetch('/api/export');
    if (!resp.ok) throw new Error('export falló');
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `algedi-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const handleReset = useCallback(async () => {
    // Con clave configurada → se pide la clave. Sin clave → hay que escribir "BORRAR".
    let password = null;
    if (securityEnabled) {
      password = window.prompt('⚠️ Esto BORRA TODO de forma permanente y NO se puede deshacer.\n\nIngresá la CLAVE DE SEGURIDAD para confirmar:');
      if (password == null) return;
    } else {
      const r = window.prompt('⚠️ ESTO BORRA TODO de forma permanente (documentos, relaciones, temas, issues) y NO se puede deshacer.\n\nEscribí BORRAR (en mayúsculas) para confirmar:');
      if (r == null) return;
      if (r.trim() !== 'BORRAR') { window.alert('Cancelado — no escribiste "BORRAR" exacto. El grafo está intacto.'); return; }
    }
    // Red de seguridad: descargar un backup ANTES de borrar. Si falla, preguntar.
    try {
      await descargarBackup();
    } catch {
      if (!window.confirm('No se pudo generar el backup automático. ¿Resetear IGUAL, sin respaldo?')) return;
    }
    const resp = await fetch('/api/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (resp.status === 403) { window.alert('Clave de seguridad incorrecta. El grafo está intacto.'); return; }
    if (!resp.ok) { window.alert('No se pudo resetear.'); return; }
    setFixedNode(null); setHoverNode(null);
    setAgentOpen(false); setSynthSelected(new Set()); setSelectedLink(null);
    loadGraph(); loadSections();
  }, [loadGraph, loadSections, securityEnabled, descargarBackup]);

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
        (n.autor || '').toLowerCase().includes(searchQ) ||
        (n.desc || '').toLowerCase().includes(searchQ) ||
        (n.fragmento || '').toLowerCase().includes(searchQ) ||
        (n.conceptos || []).some(c => c.toLowerCase().includes(searchQ))
      )
      .map(n => n.id));
    if (!semanticIds) return keyword;
    const merged = new Set([...keyword, ...semanticIds]);
    return merged.size ? merged : keyword;
  }, [searchQ, semanticIds, graphData.nodes]);

  // Descubrimientos: se calcula sólo cuando el panel está abierto (O(n²) coseno; barato).
  const discoveries = useMemo(
    () => (discoveriesOpen ? computeDiscoveries(graphData.nodes, graphData.links) : []),
    [discoveriesOpen, graphData],
  );

  // El grafo 3D muestra SOLO conocimiento (documentos): los issues/procesos viven en su
  // módulo y se fundamentan contra el grafo, no dentro de él. graphData completo sigue
  // yendo a IssuePanel y demás paneles.
  const graphView = useMemo(() => {
    const issueIds = new Set(graphData.nodes.filter(n => n.is_issue).map(n => n.id));
    if (!issueIds.size) return graphData;
    const endId = e => (typeof e === 'object' && e !== null) ? e.id : e;
    return {
      nodes: graphData.nodes.filter(n => !n.is_issue),
      links: graphData.links.filter(l => !issueIds.has(endId(l.source)) && !issueIds.has(endId(l.target))),
    };
  }, [graphData]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <span className="header-brand-icon">◈</span>
          <span>ALGEDI</span>
        </div>

        {/* Selector de SECCIÓN (grafo de conocimiento activo) */}
        <div className="hdr-menu-wrap">
          <button className="seccion-btn"
            onClick={() => { setSeccionOpen(o => !o); loadSections(); }}
            title="Sección activa — cada sección es un grafo de conocimiento aparte">
            <span className="seccion-dot" /> {seccion} <span className="seccion-caret">▾</span>
          </button>
          {seccionOpen && (<>
            <div className="hdr-menu-backdrop" onClick={() => setSeccionOpen(false)} />
            <div className="hdr-menu" style={{ left: 0, right: 'auto', minWidth: 290 }}>
              <div className="hdr-menu-label">Secciones (grafos aparte)</div>
              {sections.map(s => (
                <div key={s.nombre} className={`seccion-row${s.nombre === seccion ? ' active' : ''}`}>
                  <button className="seccion-row-main" onClick={() => cambiarSeccion(s.nombre)} title="Cambiar a esta sección">
                    <span className="hdr-menu-ico">{s.nombre === seccion ? '●' : '○'}</span>
                    <span className="seccion-row-name">{s.nombre}</span>
                    <span className="seccion-row-count">{s.count}</span>
                  </button>
                  <button className="seccion-row-act" title={`Renombrar «${s.nombre}»`}
                    onClick={() => renombrarSeccion(s.nombre)}>✎</button>
                  <button className="seccion-row-act seccion-row-act--danger" title={`Eliminar «${s.nombre}»`}
                    onClick={() => eliminarSeccion(s.nombre)}>🗑</button>
                </div>
              ))}
              <div className="hdr-menu-sep" />
              <button className="hdr-menu-item" onClick={nuevaSeccion}>
                <span className="hdr-menu-ico">＋</span> Nueva sección…
              </button>
            </div>
          </>)}
        </div>

        <input
          className="search-input"
          placeholder={semanticIds ? `⬡ ${semanticIds.size} resultados` : 'Buscar con IA…'}
          value={searchQ}
          onChange={handleSearchChange}
        />
        <div className="header-actions">
          {/* ── Contenido ── */}
          <button
            className={`btn-synth${libraryOpen ? ' active' : ''}`}
            onClick={() => setLibraryOpen(o => !o)}
            title="Biblioteca — cargá y gestioná tus documentos"
          >
            ⊞ Biblioteca
          </button>

          <span className="hdr-sep" />

          {/* ── Explorar el conocimiento ── */}
          <button
            className={`btn-synth${globalAgent ? ' active' : ''}`}
            onClick={toggleGlobalAgent}
            title="Agente — preguntá sobre tu conocimiento (fundado en el grafo)"
          >
            ⬡ Agente
          </button>
          <button
            className={`btn-synth${discoveriesOpen ? ' active' : ''}`}
            onClick={() => setDiscoveriesOpen(o => !o)}
            title="Descubrir — puentes, silos y nodos aislados (sin IA, sobre tus datos)"
          >
            ◎ Descubrir
          </button>
          <button
            className={`btn-synth${synthMode ? ' active' : ''}`}
            onClick={toggleSynth}
            title="Síntesis — combiná varios nodos en un documento"
          >
            ◈ Síntesis
          </button>

          <span className="hdr-sep" />

          {/* ── Issue: módulo unificado (diagnosticar problema · diseñar proceso) ── */}
          <button
            className={`btn-synth btn-issue${issueOpen || processOpen ? ' active' : ''}`}
            onClick={() => setIssueOpen(o => !o)}
            title="Issue — diagnosticá un problema o diseñá un proceso, fundado en tu grafo"
          >
            ⚠ Issue
          </button>

          <span className="hdr-sep" />

          {/* ── Herramientas del grafo (fuera de la navegación, para no hacer ruido) ── */}
          <div className="hdr-menu-wrap">
            <button className={`btn-reload${toolsOpen ? ' active' : ''}`}
              onClick={() => setToolsOpen(o => !o)} title="Herramientas del grafo">⋯</button>
            {toolsOpen && (<>
              <div className="hdr-menu-backdrop" onClick={() => setToolsOpen(false)} />
              <div className="hdr-menu">
                <div className="hdr-menu-label">Vista</div>
                <button className="hdr-menu-item" onClick={() => { setFitTrigger(t => t + 1); setToolsOpen(false); }}>
                  <span className="hdr-menu-ico">⊡</span> Ver todo (encuadrar)
                </button>
                <button className="hdr-menu-item" onClick={() => { loadGraph(); setToolsOpen(false); }}>
                  <span className="hdr-menu-ico">↺</span> Recargar grafo
                </button>
                <div className="hdr-menu-sep" />
                <div className="hdr-menu-label">Recalcular</div>
                <button className="hdr-menu-item"
                  onClick={async () => { setToolsOpen(false); await fetch('/api/recompute-relations', { method: 'POST' }); loadGraph(); }}>
                  <span className="hdr-menu-ico">⟳</span> Recalcular relaciones
                </button>
                <button className="hdr-menu-item" disabled={relayouting}
                  onClick={async () => {
                    setRelayouting(true);
                    try { await fetch('/api/taxonomy?apply=true', { method: 'POST' }); await loadGraph(); }
                    finally { setRelayouting(false); setToolsOpen(false); }
                  }}>
                  <span className="hdr-menu-ico">✦</span> {relayouting ? 'Reagrupando con IA…' : 'Reagrupar con IA (temas)'}
                </button>
              </div>
            </>)}
          </div>

          {fetchError
            ? <span className="header-stat header-stat--error">Backend no conectado</span>
            : <span className="header-stat">{graphView.nodes.length} nodos · {graphView.links.length} relaciones</span>
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
        graphData={graphView}
        selectedNode={highlightNode}
        highlighted={highlighted}
        filteredIds={filteredIds}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkClick={handleLinkClick}
        synthMode={synthMode}
        layoutMode={layoutMode}
        projectRef={projectRef}
        focusTrigger={focusTrigger}
        fitTrigger={fitTrigger}
      />

      {/* Layout Mode Selector */}
      <div className="layout-controls">
        {[
          { id: 'density',    icon: '⊞', label: 'Densidad',   tip: 'Dónde se concentra tu atención: agrupa los documentos por tema, revelando los focos del corpus (los atractores del espacio latente).' },
          { id: 'components', icon: '⬡', label: 'UMAP',       tip: 'La forma real del conocimiento: proyecta los embeddings preservando la vecindad semántica. La distancia entre nodos refleja qué tan relacionados están.' },
          { id: 'force',      icon: '⧉', label: 'Relacional', tip: 'La estructura de vínculos: las relaciones tiran de los nodos. Lo conectado se junta, lo suelto se aleja — quedan a la vista los hubs, los puentes y los aislados.' },
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

      {/* Botón flotante del Agente (estilo chatbot). Abajo a la DERECHA: el inferior
          izquierdo lo ocupa el selector de layout. Se oculta si el agente ya está abierto. */}
      {!globalAgent && !synthMode && !agentOpen && !discoveriesOpen && !processOpen && (
        <button className="agent-fab" onClick={toggleGlobalAgent}
          aria-label="Abrir el Agente IA"
          title="Agente IA — preguntá sobre tu conocimiento">
          <span className="agent-fab-icon">⬡</span>
          <span className="agent-fab-text">Agente</span>
        </button>
      )}

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
            onFocus={() => setFocusTrigger(t => t + 1)}
            initialPos={tooltipPos}
            containerRef={panelElRef}
            fixed={isFixed}
          />
        </>
      )}

      {fixedNode && agentOpen && !synthMode && (
        <AgentPanel
          node={fixedNode}
          allNodes={graphData.nodes}
          onClose={() => { setAgentOpen(false); setHighlighted(new Set()); }}
          onHighlight={handleHighlight}
          onNavigate={node => { setFixedNode(node); setHoverNode(null); }}
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
          onNavigate={node => { setFixedNode(node); setHoverNode(null); }}
        />
      )}

      {discoveriesOpen && (
        <DiscoveriesPanel
          discoveries={discoveries}
          onHighlight={handleHighlight}
          onClose={() => setDiscoveriesOpen(false)}
        />
      )}

      {processOpen && (
        <ProcessPanel
          allNodes={graphData.nodes}
          onHighlight={handleHighlight}
          onClose={() => { setProcessOpen(false); setIssueOpen(true); }}
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
          onOpenProcess={() => { setIssueOpen(false); setProcessOpen(true); }}
        />
      )}

      {/* Siempre montada (oculta con display:none): así una carga por lotes sigue
          viva en segundo plano aunque cierres la Biblioteca. El progreso se ve en
          un toast flotante que no bloquea la app. */}
      <div style={{ display: libraryOpen ? 'contents' : 'none' }}>
        <LibraryPanel
          allNodes={graphData.nodes}
          allLinks={graphData.links}
          onClose={() => setLibraryOpen(false)}
          onNavigate={node => { setFixedNode(node); setHoverNode(null); }}
          onDelete={handleDeleteNode}
          onRename={loadGraph}
          onRefresh={() => { loadGraph(); loadSections(); }}
          onReset={handleReset}
          onExport={descargarBackup}
          seccion={seccion}
        />
      </div>

      <Footer />
    </div>
  );
}
