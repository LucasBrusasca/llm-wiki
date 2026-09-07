import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
import ArchitectPanel from './components/ArchitectPanel.jsx';
import VaultBadge from './components/VaultBadge.jsx';
import HomeView from './components/HomeView.jsx';
import MultiverseMap from './components/MultiverseMap.jsx';
import { computeDiscoveries } from './discoveries.js';
import { pedirClave, avisarClaveIncorrecta } from './security.js';

// ── Paleta: TONOS JOYA ───────────────────────────────────────────────────────
// Ni neon ni apagado. Los dos extremos que probamos fallaban por el mismo eje:
// el neon tiene luminosidad muy alta y se lee estridente; el apagado tiene croma
// bajo y se lee sucio. El registro elegante esta en el medio: SATURACION alta con
// LUMINOSIDAD contenida (~50-65%). Es la formula de las piedras preciosas —
// rubi, esmeralda, zafiro, amatista— y por eso lee como algo caro y no como una
// pantalla de videojuego.
//
// Cada uno conserva al menos un canal RGB bajo, que es lo que mantiene la
// identidad del matiz y evita el aspecto lavado.
export const CLUSTER_PALETTE = [
  '#FF5A5F', // rojo coral
  '#3B82F6', // azul
  '#10B981', // verde esmeralda (único verde)
  '#F59E0B', // ámbar/naranja
  '#8B5CF6', // violeta
  '#EC4899', // rosa/magenta
  '#06B6D4', // cian
  '#EF4444', // rojo intenso
  '#6366F1', // índigo
  '#D97706', // naranja oscuro
];

// Reservado: sólo para lo excepcional (issues, alertas). Si aparece, significa algo.
export const ALERT_COLOR = '#FFB44D';

export function clusterColor(cluster) {
  // Sin grupo: gris frío y apagado, para que el ruido retroceda en vez de competir.
  if (cluster === undefined || cluster === null || cluster < 0) return '#565A78';
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
      // Se fija el nodo si tiene coordenadas reales. `pin` lo declara de forma
      // explicita: los fragmentos se posicionan alrededor de su documento y no
      // viajan con embedding (4.397 x 384 floats seria un payload absurdo).
      if (n.embedding || n.pin) {
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
    metodo: l.metodo,
    base_relacion: l.base_relacion,
    evidencia: l.evidencia,
    revision: l.revision,
    is_manual: l.is_manual,
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
  const [architectOpen, setArchitectOpen] = useState(false);
  const [relayouting, setRelayouting]   = useState(false);
  const [verificando, setVerificando]   = useState(false);
  const [vigenciaResumen, setVigenciaResumen] = useState(null);
  const [toolsOpen, setToolsOpen]       = useState(false);
  // Secciones = grafos de conocimiento independientes (por `dominio`).
  const [seccion, setSeccionState]      = useState(() => localStorage.getItem('algedi_seccion') || 'personal');
  const [sections, setSections]         = useState([{ nombre: 'personal', count: 0 }]);
  const [seccionOpen, setSeccionOpen]   = useState(false);
  const [seccionMenuPos, setSeccionMenuPos] = useState({ top: 0, left: 0 }); // FIX: posición del portal
  const seccionBtnRef = useRef(null); // FIX: ref para posicionar el menú
  const [securityEnabled, setSecurityEnabled] = useState(false);
  const [layoutMode, setLayoutMode]     = useState('components');
  // Vista de FRAGMENTOS: cada documento se abre en la estrella de sus pasajes.
  const [verFragmentos, setVerFragmentos] = useState(false);
  // Modo RAG Debug: visualiza los nodos recuperados para una query
  const [ragDebugMode, setRagDebugMode] = useState(false);
  const [ragDebugQuery, setRagDebugQuery] = useState('');
  const [ragDebugResults, setRagDebugResults] = useState([]);
  // FIX: escala de etiquetas del grafo (compacto 0.7 | normal 1.0 | amplio 1.4)
  const [labelScale, setLabelScale] = useState(1.0);
  const [focusTrigger, setFocusTrigger] = useState(0);  // botón "enfocar" del panel
  const [fitTrigger, setFitTrigger]     = useState(0);  // botón "ver todo" (desenfocar)
  // Home Architect-first: por defecto muestra el home con CTA a Architect
  const [showHome, setShowHome]         = useState(true);
  // Multiverse: mapa de secciones/dimensiones
  const [showMultiverse, setShowMultiverse] = useState(false);

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
    const ruta = verFragmentos ? '/api/graph/chunks' : '/api/graph';
    fetch(`${ruta}?seccion=${encodeURIComponent(seccion)}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setGraphData(buildGraphData(data)); setLoading(false); })
      .catch(() => {
        // Sin backend (ej. GitHub Pages): cargar el snapshot estático de demo.
        fetch(`${import.meta.env.BASE_URL}demo-graph.json`)
          .then(r => { if (!r.ok) throw new Error('no demo'); return r.json(); })
          .then(data => { setGraphData(buildGraphData(data)); setLoading(false); })
          .catch(() => { setFetchError(true); setLoading(false); });
      });
  }, [seccion, verFragmentos]);

  // RAG Debug: buscar top-k chunks para una query
  const runRagDebug = useCallback(async (query) => {
    if (!query?.trim()) {
      setRagDebugResults([]);
      return;
    }
    try {
      const r = await fetch(`/api/rag-debug?q=${encodeURIComponent(query)}&top_k=8`);
      const data = await r.json();
      setRagDebugResults(data.results || []);
    } catch {
      setRagDebugResults([]);
    }
  }, []);

  const renombrarSeccion = useCallback(async (nombre) => {
    setSeccionOpen(false);
    const nuevo = (window.prompt(`Nuevo nombre para «${nombre}»:`, nombre) || '').trim();
    if (!nuevo || nuevo === nombre) return;
    const clave = await pedirClave(`renombrar «${nombre}»`);
    if (!clave) return;
    try {
      const r = await fetch('/api/sections/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: nombre, to: nuevo, ...clave }),
      });
      if (r.status === 403) { avisarClaveIncorrecta(); return; }
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
        // Procedencia: el panel muestra lo que el backend calculó, no una
        // reconstrucción propia. `undefined` = arista sin procedencia registrada.
        metodo: link.metodo,
        base_relacion: link.base_relacion,
        evidencia: link.evidencia,
        revision: link.revision,
        is_manual: link.is_manual,
      },
    });
    setFixedNode(null);
    setHoverNode(null);
    setAgentOpen(false);
    setReportOpen(false);
    setGlobalAgent(false);
  }, [synthMode, graphData.nodes]);

  // La revisión vuelve del backend ya persistida; acá sólo se refleja en el grafo en
  // memoria para que reabrir la arista no muestre el estado viejo.
  const handleRelationReviewed = useCallback((source, target, revision) => {
    setGraphData(prev => ({
      ...prev,
      links: prev.links.map(l => {
        const s = l.source?.id ?? l.source, t = l.target?.id ?? l.target;
        const mismo = (s === source && t === target) || (s === target && t === source);
        return mismo ? { ...l, revision } : l;
      }),
    }));
    setSelectedLink(prev => prev && ({
      ...prev, linkMeta: { ...prev.linkMeta, revision },
    }));
  }, []);

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
    const clave = await pedirClave('eliminar este documento');
    if (!clave) return;
    const r = await fetch(`/api/node/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clave),
    });
    if (r.status === 403) { avisarClaveIncorrecta(); return; }
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

  // Callbacks para el HomeView
  const handleStartArchitect = useCallback(() => {
    setShowHome(false);
    setArchitectOpen(true);
  }, []);

  const handleOpenGraphFromHome = useCallback(() => {
    setShowHome(false);
  }, []);

  const handleOpenLibraryFromHome = useCallback(() => {
    setShowHome(false);
    setLibraryOpen(true);
  }, []);

  const handleOpenAgentFromHome = useCallback(() => {
    setShowHome(false);
    setGlobalAgent(true);
  }, []);

  const handleOpenIssueFromHome = useCallback((exp) => {
    setShowHome(false);
    setIssueOpen(true);
    if (exp) {
      const n = graphData.nodes.find(x => x.id === exp.id);
      if (n) { setFixedNode(n); setHoverNode(null); }
    }
  }, [graphData.nodes]);

  const handleChangeSectionFromHome = useCallback(() => {
    loadSections();
    if (seccionBtnRef.current) {
      const rect = seccionBtnRef.current.getBoundingClientRect();
      setSeccionMenuPos({ top: rect.top, left: rect.right + 8 });
    }
    setSeccionOpen(true);
  }, [loadSections]);

  // Multiverse: abrir mapa de secciones
  const handleOpenMultiverse = useCallback(() => {
    loadSections();
    setShowHome(false);
    setShowMultiverse(true);
  }, [loadSections]);

  // Multiverse: seleccionar una sección y entrar
  const handleSelectSectionFromMultiverse = useCallback((nombre) => {
    cambiarSeccion(nombre);
    setShowMultiverse(false);
  }, [cambiarSeccion]);

  // Multiverse: cerrar y volver al Home
  const handleCloseMultiverse = useCallback(() => {
    setShowMultiverse(false);
    setShowHome(true);
  }, []);

  return (
    <div className="app">
      {/* Home Architect-first: CTA principal a decidir con evidencia */}
      {showHome && (
        <HomeView
          seccion={seccion}
          onStartArchitect={handleStartArchitect}
          onOpenGraph={handleOpenGraphFromHome}
          onOpenLibrary={handleOpenLibraryFromHome}
          onOpenAgent={handleOpenAgentFromHome}
          onOpenIssue={handleOpenIssueFromHome}
          onChangeSection={handleChangeSectionFromHome}
          onOpenMultiverse={handleOpenMultiverse}
        />
      )}

      {/* Multiverse: mapa de secciones/dimensiones */}
      {showMultiverse && (
        <MultiverseMap
          sections={sections}
          currentSection={seccion}
          onSelectSection={handleSelectSectionFromMultiverse}
          onClose={handleCloseMultiverse}
        />
      )}

      <VaultBadge onGraphChanged={loadGraph} />
      <header className="header">
        <div className="header-brand">
          <span className="header-brand-icon">◈</span>
          <span>ALGEDI</span>
        </div>

        {/* Selector de SECCIÓN (grafo de conocimiento activo) */}
        <div className="hdr-menu-wrap">
          <button 
            ref={seccionBtnRef}
            className="seccion-btn"
            onClick={() => { 
              // FIX: calcular posición del menú antes de abrir
              if (seccionBtnRef.current) {
                const rect = seccionBtnRef.current.getBoundingClientRect();
                setSeccionMenuPos({ top: rect.top, left: rect.right + 8 });
              }
              setSeccionOpen(o => !o); 
              loadSections(); 
            }}
            title="Sección activa — cada sección es un grafo de conocimiento aparte">
            <span className="seccion-dot" /> {seccion} <span className="seccion-caret">▾</span>
          </button>
          {/* FIX: Portal a document.body para evitar clipping del sidebar */}
          {seccionOpen && createPortal(
            <>
              <div className="hdr-menu-backdrop" onClick={() => setSeccionOpen(false)} />
              <div 
                className="hdr-menu hdr-menu--portal" 
                style={{ 
                  position: 'fixed',
                  top: seccionMenuPos.top, 
                  left: seccionMenuPos.left,
                  minWidth: 280,
                }}
              >
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
            </>,
            document.body
          )}
        </div>

        <input
          className="search-input"
          placeholder={semanticIds ? `⬡ ${semanticIds.size} resultados` : 'Buscar con IA…'}
          value={searchQ}
          onChange={handleSearchChange}
        />
        <div className="header-actions">
          {/* ── Botón de Inicio (volver al Home Architect-first) ── */}
          <button
            className={`btn-synth${showHome ? ' active' : ''}`}
            onClick={() => { setShowHome(true); setShowMultiverse(false); }}
            title="Inicio — volver al home de Algedi"
          >
            ◇ Inicio
          </button>

          {/* ── Multiverso: mapa de secciones/dimensiones ── */}
          <button
            className={`btn-synth${showMultiverse ? ' active' : ''}`}
            onClick={() => { loadSections(); setShowHome(false); setShowMultiverse(true); }}
            title="Multiverso — mapa de todas las secciones"
          >
            ◈ Multiverso
          </button>

          <span className="hdr-sep" />

          {/* ── Etapa Principal · Decidir con Architect ──
                 Architect es el camino principal: decidir qué construir antes de
                 elegir la tecnología. CTA prominente.
                 Los Expedientes viven DENTRO de Architect (pestaña), no como
                 módulo separado. Issue ya no aparece en la nav principal. */}
          <span className="hdr-stage">Decidir</span>
          <button
            className={`btn-synth btn-architect${architectOpen ? ' active' : ''}`}
            onClick={() => { setShowHome(false); setArchitectOpen(o => !o); }}
            title="Architect — decidí qué construir, fundado en tu corpus (incluye expedientes)"
          >
            ⬢ Architect
          </button>

          <span className="hdr-sep" />

          {/* ── Etapa Secundaria · Contexto: lo que el sistema sabe ── */}
          <span className="hdr-stage">Contexto</span>
          <button
            className={`btn-synth${libraryOpen ? ' active' : ''}`}
            onClick={() => { setShowHome(false); setLibraryOpen(o => !o); }}
            title="Biblioteca — cargá y gestioná tus documentos"
          >
            ⊞ Biblioteca
          </button>

          <span className="hdr-sep" />

          {/* ── Etapa Secundaria · Explorar: qué hay en el corpus y cómo se relaciona ── */}
          <span className="hdr-stage">Explorar</span>
          <button
            className={`btn-synth${globalAgent ? ' active' : ''}`}
            onClick={() => { setShowHome(false); toggleGlobalAgent(); }}
            title="Agente — preguntá sobre tu conocimiento (fundado en el grafo, con citas)"
          >
            ⬡ Agente
          </button>
          <button
            className={`btn-synth${discoveriesOpen ? ' active' : ''}`}
            onClick={() => { setShowHome(false); setDiscoveriesOpen(o => !o); }}
            title="Descubrir — puentes, silos y nodos aislados (sin IA, sobre tus datos)"
          >
            ◎ Descubrir
          </button>
          <button
            className={`btn-synth${synthMode ? ' active' : ''}`}
            onClick={() => { setShowHome(false); toggleSynth(); }}
            title="Síntesis — combiná varios nodos en un documento"
          >
            ◈ Síntesis
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
                    // Reagrupar reescribe el tema de TODOS los documentos.
                    const clave = await pedirClave('reagrupar el grafo con IA');
                    if (!clave) { setToolsOpen(false); return; }
                    setRelayouting(true);
                    try {
                      const r = await fetch('/api/taxonomy?apply=true', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(clave),
                      });
                      if (r.status === 403) { avisarClaveIncorrecta(); return; }
                      await loadGraph();
                    }
                    finally { setRelayouting(false); setToolsOpen(false); }
                  }}>
                  <span className="hdr-menu-ico">✦</span> {relayouting ? 'Reagrupando con IA…' : 'Reagrupar con IA (temas)'}
                </button>
                <div className="hdr-menu-sep" />
                <div className="hdr-menu-label">Fuentes</div>
                <button className="hdr-menu-item" disabled={verificando}
                  title="Compara cada archivo local contra la huella que se guardó al incorporarlo. Offline, sin IA. No usa la fecha de carga."
                  onClick={async () => {
                    setVerificando(true);
                    try {
                      const r = await fetch('/api/vigencia/verificar', { method: 'POST' });
                      const data = await r.json();
                      setVigenciaResumen(data);
                      await loadGraph();
                    } catch { setVigenciaResumen({ error: true }); }
                    finally { setVerificando(false); setToolsOpen(false); }
                  }}>
                  <span className="hdr-menu-ico">⎔</span> {verificando ? 'Verificando fuentes…' : 'Verificar vigencia de fuentes'}
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

      {vigenciaResumen && (
        <div className="vigencia-toast">
          <button className="panel-close" onClick={() => setVigenciaResumen(null)}>✕</button>
          {vigenciaResumen.error ? (
            <div className="vigencia-toast__title">No se pudo verificar</div>
          ) : (<>
            <div className="vigencia-toast__title">
              Vigencia · {vigenciaResumen.revisadas} fuentes revisadas
            </div>
            <ul className="vigencia-toast__list">
              {Object.entries(vigenciaResumen.por_motivo || {}).map(([motivo, n]) => (
                <li key={motivo}>
                  <b>{n}</b> {(vigenciaResumen.lectura || {})[motivo] || motivo.replace(/_/g, ' ')}
                </li>
              ))}
              {vigenciaResumen.grupos_duplicados > 0 && (
                <li><b>{vigenciaResumen.grupos_duplicados}</b> grupos de fuentes con contenido idéntico</li>
              )}
            </ul>
            <p className="vigencia-toast__note">{vigenciaResumen.advertencia}</p>
          </>)}
        </div>
      )}

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
        ragDebugMode={ragDebugMode}
        ragDebugResults={ragDebugResults}
        labelScale={labelScale}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          TOOLBAR UNIFICADO DEL GRAFO — ocultar en Home y Multiverse
          ═══════════════════════════════════════════════════════════════════ */}
      {!showHome && !showMultiverse && (
        <div className="graph-toolbar">
          {/* Vista: Densidad | UMAP | Relacional */}
          <div className="gtb-group">
            <span className="gtb-label">Vista</span>
            <div className="gtb-segment">
              {[
                { id: 'density',    label: 'Densidad' },
                { id: 'components', label: 'UMAP' },
                { id: 'force',      label: 'Relacional' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  className={`gtb-seg-btn${layoutMode === id ? ' active' : ''}`}
                  onClick={() => { setLayoutMode(id); setFitTrigger(f => f + 1); }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Separador */}
          <div className="gtb-divider" />

          {/* RAG Debug */}
          <div className="gtb-group">
            <button
              className={`gtb-toggle${ragDebugMode ? ' active' : ''}`}
              onClick={() => { 
                setRagDebugMode(!ragDebugMode);
                if (!ragDebugMode) setRagDebugQuery('');
                setRagDebugResults([]);
              }}
              title="Explorar recuperación RAG"
            >
              <span className="gtb-toggle-dot" />
              RAG
            </button>
            {ragDebugMode && (
              <div className="gtb-rag-input">
                <input
                  type="text"
                  placeholder="Query..."
                  value={ragDebugQuery}
                  onChange={e => setRagDebugQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runRagDebug(ragDebugQuery)}
                />
                <button onClick={() => runRagDebug(ragDebugQuery)} disabled={!ragDebugQuery.trim()}>⏎</button>
                {ragDebugResults.length > 0 && <span className="gtb-rag-count">{ragDebugResults.length}</span>}
              </div>
            )}
          </div>

          {/* Separador */}
          <div className="gtb-divider" />

          {/* Etiquetas: S | M | L */}
          <div className="gtb-group">
            <span className="gtb-label">Etiquetas</span>
            <div className="gtb-segment gtb-segment--sm">
              {[
                { value: 0.7, label: 'S' },
                { value: 1.0, label: 'M' },
                { value: 1.4, label: 'L' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  className={`gtb-seg-btn${labelScale === value ? ' active' : ''}`}
                  onClick={() => setLabelScale(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Separador */}
          <div className="gtb-divider" />

          {/* Zoom */}
          <div className="gtb-group gtb-zoom">
            <button className="gtb-zoom-btn" onClick={() => setFitTrigger(f => f + 1)} title="Encuadrar">⊡</button>
          </div>
        </div>
      )}

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

      {architectOpen && (
        <ArchitectPanel
          seccion={seccion}
          allNodes={graphData.nodes}
          /* Entrega del caso a Issue: Architect decidió la clase de intervención,
             Issue la desarrolla. Es el paso 2 del mismo recorrido. */
          onDesarrollar={() => { setArchitectOpen(false); setIssueOpen(true); }}
          /* Los expedientes se siguen trabajando en el módulo Issue. Architect es
             la puerta única; Issue sigue existiendo detrás, no desapareció. */
          onAbrirExpediente={() => { setArchitectOpen(false); setIssueOpen(true); }}
          onClose={() => setArchitectOpen(false)}
          onNavigate={nodeId => {
            const n = graphData.nodes.find(x => x.id === nodeId);
            if (!n) return;
            setArchitectOpen(false);
            setFixedNode(n);
            setHoverNode(null);
          }}
        />
      )}

      {selectedLink && !synthMode && (
        <RelationPanel
          nodeA={selectedLink.nodeA}
          nodeB={selectedLink.nodeB}
          linkMeta={selectedLink.linkMeta}
          onReviewed={handleRelationReviewed}
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
