import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import Topbar from '@/app/Topbar';
import Rail from '@/app/Rail';
import Library from '@/app/Library';
import Inspector from '@/app/Inspector';
import AgentFab from '@/app/AgentFab';
import IngestDialog from '@/app/IngestDialog';
import ScriptsSheet from '@/app/ScriptsSheet';
import CommandPalette from '@/app/CommandPalette';
import { fetchGraph, fetchSections, searchSemantic, updateNode, createSection, crearNota } from '@/lib/api';
import { AGRUPADORES, MODOS_COLOR, indexarRelaciones } from '@/lib/nodes';
import { construirTemas, temaKey, temaDe } from '@/lib/temas';
import TaxonomiaDialog from '@/app/TaxonomiaDialog';
import Splitter from '@/app/Splitter';
import MoverDialog from '@/app/MoverDialog';
import PestanaInspector from '@/app/PestanaInspector';
import PestanaRail from '@/app/PestanaRail';
import { normalizar } from '@/lib/utils';

// React Flow pesa: sólo se carga cuando el usuario abre Split o Grafo.
const GraphCanvas = lazy(() => import('@/app/GraphCanvas'));
// El 3D (three.js) es el modo "explorar": nunca el home, se carga sólo si se abre.
const Graph3DView = lazy(() => import('@/app/Graph3DView'));

const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
};

const EXTRA_SECCIONES_KEY = 'algedi_secciones_extra';
function leerExtras() {
  try {
    const raw = LS.get(EXTRA_SECCIONES_KEY, '[]');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim()) : [];
  } catch { return []; }
}
function guardarExtras(arr) {
  LS.set(EXTRA_SECCIONES_KEY, JSON.stringify([...new Set(arr.map((x) => x.trim().toLowerCase()).filter(Boolean))]));
}

const VISTAS = ['lista', 'split', 'grafo', '3d'];

// Paneles redimensionables: ancho por defecto y límites (px, o % para el split).
const PANELES = {
  rail: { def: 272, min: 220, max: 420 },
  insp: { def: 420, min: 330, max: 680 },
  split: { def: 46, min: 25, max: 75 },
};
const acotar = (v, { min, max }) => Math.min(max, Math.max(min, v));
function leerAncho(clave) {
  const v = Number(LS.get(`algedi_ancho_${clave}`, NaN));
  return Number.isFinite(v) ? acotar(v, PANELES[clave]) : PANELES[clave].def;
}

function fechaOrden(n) {
  return Date.parse(n.fecha_doc || n.created_at || 0) || 0;
}

export default function App() {
  // ── Sección activa (= silo) ─────────────────────────────────────────
  const [seccion, setSeccion] = useState(() => LS.get('algedi_seccion', 'maestria'));
  const [sections, setSections] = useState([]);

  // ── Datos ───────────────────────────────────────────────────────────
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [status, setStatus] = useState('loading');      // loading | ok | error
  const [reloadKey, setReloadKey] = useState(0);

  // ── Vista / selección ──────────────────────────────────────────────
  const [vista, setVista] = useState(() => {
    const v = LS.get('algedi_vista', 'lista');
    return VISTAS.includes(v) ? v : 'lista';
  });
  const [selectedId, setSelectedId] = useState(null);
  const [highlightIds, setHighlightIds] = useState(() => new Set());   // lo que marca el agente
  // Relación fijada desde el inspector: {source, target, label}. No cambia el
  // documento seleccionado; sólo decide qué vínculo resalta el grafo.
  const [pinnedEdge, setPinnedEdge] = useState(null);
  // Camino de estudio: documentos desde los que llegaste siguiendo vínculos.
  // camino[0] es el origen. Se vacía al elegir algo "desde afuera" (lista, búsqueda).
  const [camino, setCamino] = useState([]);
  const pinAlLlegar = useRef(null);   // arista por la que se llegó: queda fijada en el destino
  // Vecindario fijado (modo estudio): { origen, ids } — origen + sus vecinos quedan
  // estáticos en el grafo; elegir un vecino sólo cambia el inspector.
  const [ego, setEgo] = useState(null);

  // ── Apariencia ─────────────────────────────────────────────────────
  const [colorMode, setColorMode] = useState(() => LS.get('algedi_color', 'cluster'));
  useEffect(() => LS.set('algedi_color', colorMode), [colorMode]);
  // El 3D lleva su propio modo de color y arranca por Origen: ahí "Tipo" es casi
  // mono-clase y "Tema" pinta un bloque enorme, que hace parecer que el layout
  // agrupa por categoría cuando las posiciones salen sólo de los embeddings.
  const [colorMode3d, setColorMode3d] = useState(() => LS.get('algedi_color_3d', 'fuente'));
  useEffect(() => LS.set('algedi_color_3d', colorMode3d), [colorMode3d]);

  // ── Filtros ────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [tipos, setTipos] = useState(() => new Set());
  const [fuentes, setFuentes] = useState(() => new Set());
  const [conceptos, setConceptos] = useState(() => new Set());
  const [temasSel, setTemasSel] = useState(() => new Set());
  const [groupBy, setGroupBy] = useState(() => LS.get('algedi_agrupar', 'tema'));
  const [sortBy, setSortBy] = useState(() => LS.get('algedi_orden', 'reciente'));
  const [semanticIds, setSemanticIds] = useState(null);

  // ── Diálogos ───────────────────────────────────────────────────────
  const [ingestOpen, setIngestOpen] = useState(false);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentContext, setAgentContext] = useState(null);
  const [taxonomiaOpen, setTaxonomiaOpen] = useState(false);
  const [moverIds, setMoverIds] = useState(null);          // ids a mover de sección (diálogo)
  const [marcados, setMarcados] = useState(() => new Set()); // selección múltiple en la lista

  // Panel derecho: se puede ocultar para que el centro use todo el ancho. Por
  // defecto, elegir un documento NO lo abre solo: se respeta lo que el usuario dejó.
  const [railAbierto, setRailAbierto] = useState(() => LS.get('algedi_rail', '1') !== '0');
  useEffect(() => LS.set('algedi_rail', railAbierto ? '1' : '0'), [railAbierto]);
  const [inspectorAbierto, setInspectorAbierto] = useState(() => LS.get('algedi_inspector', '1') !== '0');
  const [autoAbrir, setAutoAbrir] = useState(() => LS.get('algedi_inspector_auto', '0') === '1');
  useEffect(() => LS.set('algedi_inspector', inspectorAbierto ? '1' : '0'), [inspectorAbierto]);
  useEffect(() => LS.set('algedi_inspector_auto', autoAbrir ? '1' : '0'), [autoAbrir]);

  const searchRef = useRef(null);
  const mainRef = useRef(null);

  const [anchoRail, setAnchoRail] = useState(() => leerAncho('rail'));
  const [anchoInsp, setAnchoInsp] = useState(() => leerAncho('insp'));
  const [splitPct, setSplitPct] = useState(() => leerAncho('split'));
  useEffect(() => LS.set('algedi_ancho_rail', String(Math.round(anchoRail))), [anchoRail]);
  useEffect(() => LS.set('algedi_ancho_insp', String(Math.round(anchoInsp))), [anchoInsp]);
  useEffect(() => LS.set('algedi_ancho_split', String(Math.round(splitPct))), [splitPct]);

  useEffect(() => LS.set('algedi_vista', vista), [vista]);
  useEffect(() => LS.set('algedi_agrupar', groupBy), [groupBy]);
  useEffect(() => LS.set('algedi_orden', sortBy), [sortBy]);

  const [extrasSecciones, setExtrasSecciones] = useState(leerExtras);

  const loadSections = useCallback(() => {
    fetchSections().then(setSections).catch(() => setSections([]));
  }, []);
  useEffect(() => { loadSections(); }, [loadSections]);

  // Secciones vacías creadas por el usuario (aún sin nodos en la API).
  const sectionsVista = useMemo(() => {
    const known = new Set(sections.map((s) => s.nombre));
    const merged = [...sections];
    for (const n of extrasSecciones) {
      if (!known.has(n)) merged.push({ nombre: n, count: 0 });
    }
    if (seccion && !merged.some((s) => s.nombre === seccion)) {
      merged.push({ nombre: seccion, count: 0 });
    }
    return merged;
  }, [sections, extrasSecciones, seccion]);

  // Si la API ya tiene la sección, sacar del listado local de vacías.
  useEffect(() => {
    if (!sections.length) return;
    const known = new Set(sections.map((s) => s.nombre));
    setExtrasSecciones((prev) => {
      const next = prev.filter((n) => !known.has(n));
      if (next.length !== prev.length) guardarExtras(next);
      return next;
    });
  }, [sections]);

  // Si la sección guardada no existe ni como vacía local, caer a la más poblada.
  useEffect(() => {
    if (!sections.length) return;
    const existe = sections.some((s) => s.nombre === seccion) || extrasSecciones.includes(seccion);
    if (!existe) {
      const mayor = [...sections].sort((a, b) => b.count - a.count)[0];
      if (mayor) setSeccion(mayor.nombre);
    }
  }, [sections, seccion, extrasSecciones]);

  // Al cambiar de sección se vacía la vista: nunca mostrar los documentos de un
  // silo bajo el nombre de otro mientras llega la respuesta.
  const seccionCargada = useRef(null);
  useEffect(() => {
    const ctrl = new AbortController();
    if (seccionCargada.current !== seccion) setGraph({ nodes: [], edges: [] });
    setStatus('loading');
    fetchGraph(seccion, { signal: ctrl.signal })
      .then((g) => { seccionCargada.current = seccion; setGraph(g); setStatus('ok'); })
      .catch((e) => { if (e.name !== 'AbortError') setStatus('error'); });
    return () => ctrl.abort();
  }, [seccion, reloadKey]);

  const recargar = useCallback(() => {
    setReloadKey((k) => k + 1);
    loadSections();
  }, [loadSections]);

  const cambiarSeccion = useCallback((nombre) => {
    setSeccion(nombre);
    LS.set('algedi_seccion', nombre);
    setSelectedId(null);
    setPinnedEdge(null);
    setCamino([]);
    setEgo(null);
    setMarcados(new Set());
    setHighlightIds(new Set());
    setTemasSel(new Set());
    setTipos(new Set()); setFuentes(new Set()); setConceptos(new Set());
    setQuery('');
  }, []);

  // Crear sección: se persiste en el backend (existe aunque esté vacía). Si la API
  // no responde (p. ej. demo estática), queda guardada localmente como antes.
  const guardarLocal = useCallback((n) => {
    setExtrasSecciones((prev) => {
      const next = prev.includes(n) ? prev : [...prev, n];
      guardarExtras(next);
      return next;
    });
  }, []);
  // Al eliminar una sección hay que olvidarla TAMBIÉN acá: si queda en la lista local
  // de vacías, vuelve a aparecer en el próximo render y la migración la recrea en el
  // backend. Borrarla en un solo lado es la receta para que "vuelva sola".
  const olvidarSeccion = useCallback((nombre) => {
    setExtrasSecciones((prev) => {
      const next = prev.filter((n) => n !== nombre);
      guardarExtras(next);
      return next;
    });
    loadSections();
  }, [loadSections]);

  const crearSeccion = useCallback(async (nombre) => {
    const n = (nombre || '').trim().toLowerCase();
    if (!n) return;
    try {
      const r = await createSection(n);
      loadSections();
      cambiarSeccion(r.nombre);
    } catch {
      guardarLocal(n);
      cambiarSeccion(n);
    }
  }, [cambiarSeccion, loadSections, guardarLocal]);

  // Migración única: las secciones vacías que sólo vivían en este navegador pasan al backend.
  useEffect(() => {
    const pendientes = leerExtras();
    if (!pendientes.length) return;
    Promise.allSettled(pendientes.map((n) => createSection(n))).then(() => loadSections());
  }, [loadSections]);

  // ── Índices derivados ──────────────────────────────────────────────
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const relIndex = useMemo(() => indexarRelaciones(graph.edges), [graph.edges]);
  const temas = useMemo(() => construirTemas(graph.nodes), [graph.nodes]);

  // Texto indexado por nodo (sin acentos) para la búsqueda local.
  const haystack = useMemo(() => {
    const m = new Map();
    for (const n of graph.nodes) {
      m.set(n.id, normalizar([
        n.label, n.desc, n.autor, n.fuente_label, n.tema,
        ...(n.conceptos || []), ...(n.tags || []),
      ].join('  ')));
    }
    return m;
  }, [graph.nodes]);

  // Conceptos más frecuentes de la sección: funcionan como tags navegables.
  const topConceptos = useMemo(() => {
    const cnt = new Map();
    for (const n of graph.nodes) {
      const vistos = new Set();
      for (const c of n.conceptos || []) {
        const k = normalizar(c);
        if (!k || vistos.has(k)) continue;
        vistos.add(k);
        const cur = cnt.get(k) || { key: k, label: c, count: 0 };
        cur.count += 1;
        cnt.set(k, cur);
      }
    }
    return [...cnt.values()].filter((c) => c.count > 1).sort((a, b) => b.count - a.count).slice(0, 14);
  }, [graph.nodes]);

  // Búsqueda semántica (backend) como complemento de la local.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setSemanticIds(null); return undefined; }
    const t = setTimeout(() => {
      searchSemantic(q).then((ids) => setSemanticIds(new Set(ids))).catch(() => setSemanticIds(null));
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // ── Filtrado ───────────────────────────────────────────────────────
  const pasaFacetas = useCallback((n) => {
    if (temasSel.size && !temasSel.has(temaKey(n))) return false;
    if (tipos.size && !tipos.has(n.type)) return false;
    if (fuentes.size && !fuentes.has((n.fuente || 'sin-origen').toLowerCase())) return false;
    if (conceptos.size) {
      const propios = new Set((n.conceptos || []).map(normalizar));
      for (const c of conceptos) if (!propios.has(c)) return false;   // AND: cada concepto acota
    }
    return true;
  }, [temasSel, tipos, fuentes, conceptos]);

  const { visibles, semanticos } = useMemo(() => {
    const q = normalizar(query.trim());
    const terms = q.split(/\s+/).filter(Boolean);
    const vis = [];
    const sem = [];
    for (const n of graph.nodes) {
      if (!pasaFacetas(n)) continue;
      if (!terms.length) { vis.push(n); continue; }
      const h = haystack.get(n.id) || '';
      if (terms.every((t) => h.includes(t))) vis.push(n);
      else if (semanticIds?.has(n.id)) sem.push(n);
    }
    const deg = (n) => relIndex.get(n.id)?.length || 0;
    const cmp = {
      reciente: (a, b) => fechaOrden(b) - fechaOrden(a),
      titulo: (a, b) => (a.label || '').localeCompare(b.label || '', 'es'),
      conexiones: (a, b) => deg(b) - deg(a),
    }[sortBy] || (() => 0);
    vis.sort(cmp);
    return { visibles: vis, semanticos: sem };
  }, [graph.nodes, pasaFacetas, query, haystack, semanticIds, sortBy, relIndex]);

  const grupos = useMemo(() => {
    const base = AGRUPADORES[groupBy] || AGRUPADORES.fuente;
    // "Tema" usa el índice de temas legibles (nombre humano o automático), no el número de cluster.
    const agr = groupBy === 'tema'
      ? { keyOf: temaKey, titleOf: (k) => temas.get(k)?.nombre || 'Sin tema', colorOf: (k) => temas.get(k)?.color }
      : base;
    const map = new Map();
    for (const n of visibles) {
      const k = agr.keyOf(n);
      if (!map.has(k)) map.set(k, { key: k, title: agr.titleOf(k), color: agr.colorOf?.(k), auto: groupBy === 'tema' && temas.get(k)?.auto, items: [] });
      map.get(k).items.push(n);
    }
    // Más poblados primero; "Sin tema" / "Sin origen" siempre al final.
    const ultimo = (g) => (g.key === 'sin-tema' || g.key === 'sin-origen' ? 1 : 0);
    const arr = [...map.values()].sort((a, b) => ultimo(a) - ultimo(b) || b.items.length - a.items.length);
    if (semanticos.length) {
      arr.push({ key: '__semantico', title: 'Por significado', semantic: true, items: semanticos });
    }
    return arr;
  }, [visibles, semanticos, groupBy, temas]);

  const orden = useMemo(() => grupos.flatMap((g) => g.items.map((n) => n.id)), [grupos]);

  // Conteos por faceta (sobre la sección entera, para que los números no bailen).
  const facetas = useMemo(() => {
    const tipo = new Map();
    const fuente = new Map();
    for (const n of graph.nodes) {
      tipo.set(n.type, (tipo.get(n.type) || 0) + 1);
      const f = (n.fuente || 'sin-origen').toLowerCase();
      fuente.set(f, (fuente.get(f) || 0) + 1);
    }
    return { tipo, fuente };
  }, [graph.nodes]);

  // Si el nodo seleccionado desaparece (cambio de sección / borrado), limpiar.
  useEffect(() => {
    if (selectedId && status === 'ok' && !nodesById.has(selectedId)) setSelectedId(null);
  }, [selectedId, nodesById, status]);

  // Elegir "desde afuera" (lista, búsqueda, teclado): empieza un camino nuevo.
  const seleccionar = useCallback((id) => {
    if (autoAbrir) setInspectorAbierto(true);
    setCamino([]);
    setEgo((e) => (e && id && e.ids.has(id) ? e : null));
    setSelectedId(id);
  }, [autoAbrir]);

  // Seguir un vínculo: el documento actual pasa al camino y la arista usada queda fijada.
  const abrirVinculo = useCallback((id, edge) => {
    if (!id || id === selectedId) return;
    if (ego) {
      if (ego.ids.has(id)) { setSelectedId(id); return; }
      setEgo(null);
    }
    if (selectedId) setCamino((c) => [...c, selectedId]);
    pinAlLlegar.current = edge ? { source: edge.source, target: edge.target, label: edge.label } : null;
    setSelectedId(id);
  }, [selectedId, ego]);

  // Volver a un punto del camino (0 = origen). Lo que venía después se descarta.
  const volverA = useCallback((i) => {
    const destino = camino[i];
    if (!destino) return;
    setCamino(camino.slice(0, i));
    setSelectedId(destino);
  }, [camino]);

  // En el grafo, clic en un vecino del elegido = seguir ese vínculo; en otro nodo = empezar de nuevo.
  const elegirEnGrafo = useCallback((id) => {
    if (ego) {
      if (ego.ids.has(id)) { setSelectedId(id); return; }
      setEgo(null);
    }
    const r = selectedId && (relIndex.get(selectedId) || []).find((x) => x.otherId === id);
    if (r) abrirVinculo(id, r.edge); else seleccionar(id);
  }, [selectedId, relIndex, abrirVinculo, seleccionar, ego]);

  const fijarVecindario = useCallback(() => {
    if (ego) { setEgo(null); return; }
    if (!selectedId) return;
    const ids = new Set([selectedId, ...(relIndex.get(selectedId) || []).map((r) => r.otherId)]);
    setCamino([]);
    setEgo({ origen: selectedId, ids });
  }, [ego, selectedId, relIndex]);

  // Cambiar de documento suelta el pin, salvo que se haya llegado por un vínculo.
  useEffect(() => {
    setPinnedEdge(pinAlLlegar.current);
    pinAlLlegar.current = null;
  }, [selectedId]);

  const fijarRelacion = useCallback((edge) => {
    setPinnedEdge((prev) => (
      prev && prev.source === edge.source && prev.target === edge.target && prev.label === edge.label
        ? null
        : { source: edge.source, target: edge.target, label: edge.label }
    ));
  }, []);

  const toggleIn = (setter) => (key) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const limpiarFiltros = useCallback(() => {
    setTemasSel(new Set()); setTipos(new Set()); setFuentes(new Set()); setConceptos(new Set()); setQuery('');
  }, []);

  const guardarNodo = useCallback(async (id, campos) => {
    const nd = await updateNode(id, campos);
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, label: nd.label, autor: nd.autor, tema: nd.tema } : n)),
    }));
  }, []);

  const tras_mover = useCallback((r) => {
    setMarcados(new Set());
    if (selectedId && moverIds?.includes(selectedId) && r?.seccion !== seccion) setSelectedId(null);
    setMoverIds(null);
    recargar();
  }, [selectedId, moverIds, seccion, recargar]);

  // Nota nueva: entra al grafo como nodo NOTA y queda abierta para escribir.
  const nuevaNota = useCallback(async () => {
    const titulo = (window.prompt('Título de la nota:') || '').trim();
    if (!titulo) return;
    try {
      const nd = await crearNota({ label: titulo, seccion });
      setGraph((g) => ({ ...g, nodes: [{ ...nd, x: 0, y: 0, z: 0 }, ...g.nodes] }));
      setSelectedId(nd.id);
      loadSections();
    } catch (e) {
      window.alert(`No se pudo crear la nota: ${e.message}`);
    }
  }, [seccion, loadSections]);

  const preguntarSobre = useCallback((node) => {
    setAgentContext(node || null);
    setAgentOpen(true);
  }, []);

  // ── Atajos de teclado ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const escribiendo = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setPaletteOpen((o) => !o); return;
      }
      if (escribiendo) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'Escape') {
        // Si hay un diálogo Radix abierto, el Esc es para cerrarlo, no para soltar la selección.
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        if (marcados.size) setMarcados(new Set());
        else if (pinnedEdge) setPinnedEdge(null);
        else if (ego) setEgo(null);
        else setSelectedId(null);
        return;
      }
      if (e.key === '1') setVista('lista');
      if (e.key === '2') setVista('split');
      if (e.key === '3') setVista('grafo');
      if (e.key === '4') setVista('3d');
      if (e.key === ']') { e.preventDefault(); setInspectorAbierto((v) => !v); }
      if (e.key === '[') { e.preventDefault(); setRailAbierto((v) => !v); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        if (!orden.length) return;
        e.preventDefault();
        const i = orden.indexOf(selectedId);
        const dir = (e.key === 'ArrowDown' || e.key === 'j') ? 1 : -1;
        const next = i < 0 ? 0 : Math.min(orden.length - 1, Math.max(0, i + dir));
        seleccionar(orden[next]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orden, selectedId, pinnedEdge, ego, seleccionar, marcados]);

  const selected = selectedId ? nodesById.get(selectedId) : null;
  const seccionInfo = sections.find((s) => s.nombre === seccion);
  const visibleIds = useMemo(() => new Set(orden), [orden]);

  const modoColor = vista === '3d' ? colorMode3d : colorMode;
  const colorDe = useCallback(
    (n) => (modoColor === 'cluster' ? temaDe(temas, n).color : (MODOS_COLOR[modoColor] || MODOS_COLOR.cluster).de(n)),
    [modoColor, temas],
  );
  const propsGrafo = {
    nodes: graph.nodes,
    colorDe,
    temas,
    compacto: vista === 'split',
    ego,
    onFijar: fijarVecindario,
    edges: graph.edges,
    visibleIds,
    selectedId,
    highlightIds,
    pinnedEdge,
    onClearPin: () => setPinnedEdge(null),
    onSelect: elegirEnGrafo,
    relIndex,
    colorMode: modoColor,
    onColorMode: vista === '3d' ? setColorMode3d : setColorMode,
  };
  const grafo = (
    <Suspense fallback={<div className="grid h-full place-items-center text-[12px] text-ink-dim">Cargando grafo…</div>}>
      {vista === '3d' ? <Graph3DView {...propsGrafo} /> : <GraphCanvas {...propsGrafo} />}
    </Suspense>
  );

  return (
    <TooltipProvider delayDuration={350}>
      <div className="grid h-screen grid-rows-[48px_minmax(0,1fr)]">
        <Topbar
          seccion={seccion}
          total={graph.nodes.length}
          vista={vista}
          onVista={setVista}
          onOpenPalette={() => setPaletteOpen(true)}
          onReload={recargar}
          loading={status === 'loading'}
          inspectorAbierto={inspectorAbierto}
          onInspector={() => setInspectorAbierto((v) => !v)}
          railAbierto={railAbierto}
          onRail={() => setRailAbierto((v) => !v)}
        />

        <div className="flex min-h-0">
          {railAbierto ? (
          <>
          <Rail
            sections={sectionsVista}
            seccion={seccion}
            onSeccion={cambiarSeccion}
            onNuevaSeccion={crearSeccion}
            facetas={facetas}
            tipos={tipos}
            onToggleTipo={toggleIn(setTipos)}
            fuentes={fuentes}
            onToggleFuente={toggleIn(setFuentes)}
            topConceptos={topConceptos}
            conceptos={conceptos}
            onToggleConcepto={toggleIn(setConceptos)}
            temas={temas}
            temasSel={temasSel}
            onToggleTema={toggleIn(setTemasSel)}
            onNombrarTemas={() => setTaxonomiaOpen(true)}
            onIngest={() => setIngestOpen(true)}
            onScripts={() => setScriptsOpen(true)}
            onNuevaNota={nuevaNota}
            onSeccionesCambiadas={(activa) => { cambiarSeccion(activa); recargar(); }}
            onSeccionEliminada={olvidarSeccion}
            ancho={anchoRail}
          />
          <Splitter
            etiqueta="Ancho del panel izquierdo"
            onStart={() => anchoRail}
            onDrag={(dx, base) => setAnchoRail(acotar(base + dx, PANELES.rail))}
            onReset={() => setAnchoRail(PANELES.rail.def)}
          />
          </>
          ) : (
            <PestanaRail seccion={seccion} onAbrir={() => setRailAbierto(true)} />
          )}

          <main ref={mainRef} className="flex min-w-0 flex-1">
            {(vista === 'lista' || vista === 'split') && (
              <section
                className={vista === 'split' ? 'flex min-w-[320px] shrink-0 flex-col hairline-r' : 'flex min-w-0 flex-1 flex-col'}
                style={vista === 'split' ? { width: `${splitPct}%` } : undefined}
              >
                <Library
                  status={status}
                  seccion={seccion}
                  seccionCount={seccionInfo?.count ?? null}
                  totalNodes={graph.nodes.length}
                  grupos={grupos}
                  visibleCount={visibles.length}
                  query={query}
                  onQuery={setQuery}
                  searchRef={searchRef}
                  groupBy={groupBy}
                  onGroupBy={setGroupBy}
                  sortBy={sortBy}
                  onSortBy={setSortBy}
                  selectedId={selectedId}
                  onSelect={seleccionar}
                  highlightIds={highlightIds}
                  onClearHighlight={() => setHighlightIds(new Set())}
                  relIndex={relIndex}
                  filtros={{ tipos, fuentes, conceptos, topConceptos, temasSel, temas }}
                  onToggleTema={toggleIn(setTemasSel)}
                  onNombrarTemas={() => setTaxonomiaOpen(true)}
                  marcados={marcados}
                  onMarca={toggleIn(setMarcados)}
                  onMarcarVarios={(ids) => setMarcados(new Set(ids))}
                  onLimpiarMarcas={() => setMarcados(new Set())}
                  onMoverMarcados={() => setMoverIds([...marcados])}
                  onToggleTipo={toggleIn(setTipos)}
                  onToggleFuente={toggleIn(setFuentes)}
                  onToggleConcepto={toggleIn(setConceptos)}
                  onLimpiar={limpiarFiltros}
                  onRetry={recargar}
                  onIngest={() => setIngestOpen(true)}
                  compact={vista === 'split'}
                />
              </section>
            )}
            {vista === 'split' && (
              <Splitter
                etiqueta="Reparto lista / grafo"
                onStart={() => splitPct}
                onDrag={(dx, base) => {
                  const w = mainRef.current?.getBoundingClientRect().width || 1;
                  setSplitPct(acotar(base + (dx / w) * 100, PANELES.split));
                }}
                onReset={() => setSplitPct(PANELES.split.def)}
              />
            )}
            {vista !== 'lista' && <section className="relative min-w-0 flex-1 overflow-hidden">{grafo}</section>}
          </main>

          {inspectorAbierto ? (
            <>
            <Splitter
              etiqueta="Ancho del inspector"
              onStart={() => anchoInsp}
              onDrag={(dx, base) => setAnchoInsp(acotar(base - dx, PANELES.insp))}
              onReset={() => setAnchoInsp(PANELES.insp.def)}
            />
            <Inspector
              ancho={anchoInsp}
              node={selected}
              nodesById={nodesById}
              relIndex={relIndex}
              seccion={seccion}
              seccionCount={graph.nodes.length}
              edgesCount={graph.edges.length}
              topConceptos={topConceptos}
              onSelect={seleccionar}
              onClose={() => setSelectedId(null)}
              onAsk={preguntarSobre}
              onConcepto={(k) => toggleIn(setConceptos)(k)}
              onVerEnGrafo={() => setVista((v) => (v === 'lista' ? 'split' : v))}
              vista={vista}
              pinnedEdge={pinnedEdge}
              onPin={fijarRelacion}
              onClearPin={() => setPinnedEdge(null)}
              onAbrir={abrirVinculo}
              camino={ego ? (selectedId && selectedId !== ego.origen ? [ego.origen] : []) : camino}
              onVolver={ego ? () => setSelectedId(ego.origen) : volverA}
              ego={ego}
              onFijar={fijarVecindario}
              onGuardar={guardarNodo}
              onMover={(ids) => setMoverIds(ids)}
              temas={temas}
              onTema={(k) => toggleIn(setTemasSel)(k)}
            />
            </>
          ) : (
            <PestanaInspector node={selected} onAbrir={() => setInspectorAbierto(true)} />
          )}
        </div>

        <AgentFab
          open={agentOpen}
          onOpenChange={setAgentOpen}
          seccion={seccion}
          context={agentContext}
          onClearContext={() => setAgentContext(null)}
          nodesById={nodesById}
          onSelect={seleccionar}
          onHighlight={(ids) => setHighlightIds(new Set(ids))}
        />

        <IngestDialog open={ingestOpen} onOpenChange={setIngestOpen} seccion={seccion} onDone={recargar} />
        <MoverDialog
          open={!!moverIds}
          onOpenChange={(o) => !o && setMoverIds(null)}
          ids={moverIds || []}
          nodesById={nodesById}
          sections={sectionsVista}
          seccion={seccion}
          onDone={tras_mover}
        />
        <TaxonomiaDialog open={taxonomiaOpen} onOpenChange={setTaxonomiaOpen} temas={temas} onDone={recargar} />
        <ScriptsSheet
          open={scriptsOpen}
          onOpenChange={setScriptsOpen}
          seccion={seccion}
          selected={selected}
          nodesById={nodesById}
          onSelect={seleccionar}
          onChanged={recargar}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          nodes={graph.nodes}
          haystack={haystack}
          sections={sections}
          seccion={seccion}
          inspectorAbierto={inspectorAbierto}
          railAbierto={railAbierto}
          autoAbrir={autoAbrir}
          onSelect={(id) => { seleccionar(id); setPaletteOpen(false); }}
          onSeccion={(s) => { cambiarSeccion(s); setPaletteOpen(false); }}
          onAction={(a) => {
            setPaletteOpen(false);
            if (a === 'ingest') setIngestOpen(true);
            if (a === 'scripts') setScriptsOpen(true);
            if (a === 'agent') preguntarSobre(null);
            if (a === 'inspector') setInspectorAbierto((v) => !v);
            if (a === 'auto-inspector') setAutoAbrir((v) => !v);
            if (a === 'rail') setRailAbierto((v) => !v);
            if (VISTAS.includes(a)) setVista(a);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
