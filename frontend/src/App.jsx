import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import Topbar from '@/app/Topbar';
import Rail from '@/app/Rail';
import Library from '@/app/Library';
import Inspector from '@/app/Inspector';
import AgentFab from '@/app/AgentFab';
import IngestDialog from '@/app/IngestDialog';
import Corridas from '@/app/Corridas';
import { alPedirExplorar } from '@/lib/eventos';
import CommandPalette from '@/app/CommandPalette';
import DuplicadosDialog from '@/app/DuplicadosDialog';
import JobsPanel, { useJobs, JobsBadge } from '@/app/JobsPanel';
import FuentesPanel, { useFuentesVivas, FuentesBadge } from '@/app/FuentesPanel';
import {
  fetchGraph, fetchSections, searchSemantic, updateNode, createSection, crearNota, crearScript, agregarConexion, normalizeGraph,
  reagruparTemas, recalcularRelaciones, instalarHerramientas, crearReporte, crearPregunta,
  fetchPapelera, fetchDuplicados,
} from '@/lib/api';
import { AGRUPADORES, MODOS_COLOR, TIPOS, TODAS, nombreSeccion, indexarRelaciones } from '@/lib/nodes';
import { construirTemas, temaKey, temaDe } from '@/lib/temas';
import TaxonomiaDialog from '@/app/TaxonomiaDialog';
import Splitter from '@/app/Splitter';
import MoverDialog from '@/app/MoverDialog';
import PapeleraDialog from '@/app/PapeleraDialog';
import TemaDialog from '@/app/TemaDialog';
import Papelera from '@/app/Papelera';
import { PanelPlegado } from '@/app/PanelLateral';
import { normalizar } from '@/lib/utils';

// React Flow pesa: sólo se carga cuando el usuario abre Split o Grafo.
const GraphCanvas = lazy(() => import('@/app/GraphCanvas'));
// El 3D (three.js) es el modo "explorar": nunca el home, se carga sólo si se abre.
const Graph3DView = lazy(() => import('@/app/Graph3DView'));
// 4D: el espacio de las secciones (teseractos con su grafo adentro). También a demanda.
const Vista4D = lazy(() => import('@/app/Vista4D'));
// El explorador de datos trae ECharts: también se baja recién cuando se abre.
const ExploradorDatos = lazy(() => import('@/app/ExploradorDatos'));

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

const VISTAS = ['lista', 'split', 'grafo', '3d', '4d'];

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
  const [corridasOpen, setCorridasOpen] = useState(false);
  const [explorar, setExplorar] = useState(null);   // { nodo, tabla } del explorador de datos
  useEffect(() => alPedirExplorar(setExplorar), []);
  const [corridasKey, setCorridasKey] = useState(0);           // sube con cada corrida: refresca el log
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [fuentesOpen, setFuentesOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentContext, setAgentContext] = useState(null);
  const [taxonomiaOpen, setTaxonomiaOpen] = useState(false);
  const [moverIds, setMoverIds] = useState(null);          // ids a mover de sección (diálogo)
  const [papeleraIds, setPapeleraIds] = useState(null);    // ids a mandar a la papelera (confirmación)
  const [temaIds, setTemaIds] = useState(null);            // ids a los que cambiarles el tema
  const [papeleraOpen, setPapeleraOpen] = useState(false);
  const [papeleraCount, setPapeleraCount] = useState(0);
  const [duplicadosOpen, setDuplicadosOpen] = useState(false);
  const [duplicadosCount, setDuplicadosCount] = useState(0);
  const [pedidoEditar, setPedidoEditar] = useState(null);  // id que el inspector abre ya en edición
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
    if (seccion && seccion !== TODAS && !merged.some((s) => s.nombre === seccion)) {
      merged.push({ nombre: seccion, count: 0 });
    }
    return merged;
  }, [sections, extrasSecciones, seccion]);

  // Crear o ingestar necesita una sección concreta: en «Todas las secciones», va a la
  // última que se eligió (y el diálogo lo dice).
  const seccionReal = seccion === TODAS
    ? (LS.get('algedi_ultima_seccion', '') || [...sections].sort((a, b) => b.count - a.count)[0]?.nombre || 'personal')
    : seccion;
  const etiquetaSeccion = nombreSeccion(seccion);

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
    if (!sections.length || seccion === TODAS) return;
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

  // «Reagrupar» temas y recalcular relaciones: trabajos largos que se piden a mano.
  const [reagrupando, setReagrupando] = useState(false);
  const reagrupar = useCallback(async () => {
    setReagrupando(true);
    try { await reagruparTemas(); recargar(); }
    catch (e) { window.alert(`No se pudieron reagrupar los temas: ${e.message}`); }
    finally { setReagrupando(false); }
  }, [recargar]);
  const recalcular = useCallback(async () => {
    try { await recalcularRelaciones(); recargar(); }
    catch (e) { window.alert(`No se pudieron recalcular las relaciones: ${e.message}`); }
  }, [recargar]);
  // La navaja suiza de JEV: scripts de data science con ficha, en la sección «herramientas».
  const instalarNavaja = useCallback(async () => {
    try {
      const r = await instalarHerramientas();
      await loadSections();
      recargar();
      window.alert(`Navaja lista: ${r.herramientas.length} herramientas en «${r.seccion}»`
        + (r.datos ? ` y la tabla de prueba ${r.datos.label}.` : '.')
        + ' Seleccioná un nodo de datos y pedile al agente lo que necesitás.');
    } catch (e) { window.alert(`No se pudo instalar la navaja: ${e.message}`); }
  }, [recargar, loadSections]);

  // ── Jobs en background ─────────────────────────────────────────────
  const onJobDone = useCallback((job) => {
    if (seccion === TODAS || job?.seccion === seccion || job?.node_id) {
      recargar();
    }
  }, [seccion, recargar]);
  const { active: activeJobs, recent: recentJobs, refresh: refreshJobs } = useJobs(onJobDone);

  // ── Fuentes vivas ─────────────────────────────────────────────────
  const { sources: fuentesSources, pendingCount: fuentesPending, refresh: refreshFuentes } = useFuentesVivas(seccion === TODAS ? null : seccion);

  const cambiarSeccion = useCallback((nombre) => {
    setSeccion(nombre);
    LS.set('algedi_seccion', nombre);
    if (nombre !== TODAS) LS.set('algedi_ultima_seccion', nombre);
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
  // Documentos de otras secciones con los que ésta está relacionada (sólo para el panel).
  const externosById = useMemo(() => new Map((graph.externos || []).map((n) => [n.id, n])), [graph.externos]);
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

  // El mismo filtro, como función sobre CUALQUIER nodo: la 4D muestra todas las
  // secciones y el filtro tiene que valer para todas (null = no se filtra nada).
  const filtroNodo = useMemo(() => {
    const terms = normalizar(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length && !tipos.size && !fuentes.size && !conceptos.size && !temasSel.size) return null;
    return (n) => {
      if (!pasaFacetas(n)) return false;
      if (!terms.length) return true;
      const h = haystack.get(n.id) ?? normalizar([
        n.label, n.desc, n.autor, n.fuente_label, n.tema, ...(n.conceptos || []), ...(n.tags || []),
      ].join('  '));
      return terms.every((t) => h.includes(t)) || Boolean(semanticIds?.has(n.id));
    };
  }, [query, tipos, fuentes, conceptos, temasSel, pasaFacetas, haystack, semanticIds]);

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
    const grado = (n) => relIndex.get(n.id)?.length || 0;
    const agr = groupBy === 'tema'
      ? { keyOf: temaKey, titleOf: (k) => temas.get(k)?.nombre || 'Sin tema', colorOf: (k) => temas.get(k)?.color }
      : groupBy === 'conexiones'
        ? { ...base, keyOf: (n) => { const d = grado(n); return d === 0 ? '0' : d <= 3 ? '1' : d <= 9 ? '2' : '3'; } }
        : base;
    const map = new Map();
    for (const n of visibles) {
      const k = agr.keyOf(n);
      if (!map.has(k)) map.set(k, { key: k, title: agr.titleOf(k), color: agr.colorOf?.(k), auto: groupBy === 'tema' && temas.get(k)?.auto, items: [] });
      map.get(k).items.push(n);
    }
    // Más poblados primero; "Sin tema" / "Sin origen" siempre al final.
    const ultimo = (g) => (['sin-tema', 'sin-origen', 'Sin fecha'].includes(g.key) ? 1 : 0);
    // Las fechas van en orden de tiempo (lo más nuevo arriba); el resto, por tamaño.
    const arr = [...map.values()].sort((a, b) => ultimo(a) - ultimo(b)
      || (base.ordenar ? base.ordenar(a.key, b.key) : b.items.length - a.items.length));
    if (semanticos.length) {
      arr.push({ key: '__semantico', title: 'Por significado', semantic: true, items: semanticos });
    }
    return arr;
  }, [visibles, semanticos, groupBy, temas, relIndex]);

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

  // Escribir «script» en el buscador busca la PALABRA (y trae documentos que hablan de
  // scripts). Si lo escrito es el nombre de un tipo, se ofrece filtrar por el tipo.
  const tipoSugerido = useMemo(() => {
    const q = normalizar(query.trim());
    if (!q) return null;
    const hit = Object.entries(TIPOS).find(([t, m]) => !tipos.has(t)
      && [m.label, m.plural].some((x) => normalizar(x) === q));
    return hit ? { tipo: hit[0], plural: hit[1].plural, n: facetas.tipo.get(hit[0]) || 0 } : null;
  }, [query, tipos, facetas]);

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

  // Un documento de otra sección (desde la 4D o desde una relación que cruza): primero se
  // abre su sección y se elige apenas llega el grafo.
  const pendiente4D = useRef(null);
  // Seguir un vínculo: el documento actual pasa al camino y la arista usada queda fijada.
  const abrirVinculo = useCallback((id, edge) => {
    if (!id || id === selectedId) return;
    const externo = externosById.get(id);
    if (externo) {
      setInspectorAbierto(true);
      pendiente4D.current = id;
      cambiarSeccion(externo.dominio);
      return;
    }
    if (ego) {
      if (ego.ids.has(id)) { setSelectedId(id); return; }
      setEgo(null);
    }
    if (selectedId) setCamino((c) => [...c, selectedId]);
    pinAlLlegar.current = edge ? { source: edge.source, target: edge.target, label: edge.label } : null;
    setSelectedId(id);
  }, [selectedId, ego, externosById, cambiarSeccion]);

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

  // En la 4D se ven todas las secciones: un documento de otra sección primero la abre
  // y lo elige cuando llega su grafo. En la misma sección, igual que en el grafo.
  const elegirEn4D = useCallback((id, dominio) => {
    setInspectorAbierto(true);
    if (dominio && seccion !== TODAS && dominio !== seccion) {
      pendiente4D.current = id;
      cambiarSeccion(dominio);
      return;
    }
    elegirEnGrafo(id);
  }, [seccion, cambiarSeccion, elegirEnGrafo]);
  useEffect(() => {
    const id = pendiente4D.current;
    if (status !== 'ok' || !id || !graph.nodes.some((n) => n.id === id)) return;
    pendiente4D.current = null;
    seleccionar(id);
  }, [status, graph.nodes, seleccionar]);

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

  const cargarPapeleraCount = useCallback(() => {
    fetchPapelera().then((items) => setPapeleraCount(items.length)).catch(() => {});
  }, []);
  useEffect(() => { cargarPapeleraCount(); }, [cargarPapeleraCount]);
  const cargarDuplicados = useCallback(() => {
    fetchDuplicados().then((g) => setDuplicadosCount(g.length)).catch(() => {});
  }, []);
  useEffect(() => { cargarDuplicados(); }, [cargarDuplicados, sections]);

  // Lo mandado a la papelera deja de existir para la UI: fuera de la selección, del
  // camino, del vecindario y de la relación fijada.
  const tras_papelera = useCallback(() => {
    const fuera = new Set(papeleraIds || []);
    setMarcados(new Set());
    if (selectedId && fuera.has(selectedId)) setSelectedId(null);
    setCamino((c) => (c.some((id) => fuera.has(id)) ? [] : c));
    setEgo((e) => (e && [...fuera].some((id) => e.ids.has(id) || e.origen === id) ? null : e));
    setPinnedEdge((p) => (p && (fuera.has(p.source) || fuera.has(p.target)) ? null : p));
    setPapeleraIds(null);
    recargar();
    cargarPapeleraCount();
  }, [papeleraIds, selectedId, recargar, cargarPapeleraCount]);

  const tras_tema = useCallback((r) => {
    const ids = new Set(temaIds || []);
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (ids.has(n.id) ? { ...n, tema: r.tema } : n)) }));
    setMarcados(new Set());
    setTemaIds(null);
  }, [temaIds]);

  // «Editar» en una fila: elige el documento y el inspector lo abre ya en edición.
  const editarDesdeLista = useCallback((id) => {
    seleccionar(id);
    setInspectorAbierto(true);
    setPedidoEditar(id);
  }, [seleccionar]);

  // Nota nueva: entra al grafo como nodo NOTA y queda abierta para escribir.
  const nuevaNota = useCallback(async () => {
    const titulo = (window.prompt('Título de la nota:') || '').trim();
    if (!titulo) return;
    try {
      const nd = await crearNota({ label: titulo, seccion: seccionReal });
      setGraph((g) => ({ ...g, nodes: [{ ...nd, x: 0, y: 0, z: 0 }, ...g.nodes] }));
      setSelectedId(nd.id);
      loadSections();
    } catch (e) {
      window.alert(`No se pudo crear la nota: ${e.message}`);
    }
  }, [seccionReal, loadSections]);

  // Nodo recién creado en el backend (script o base): entra al grafo ya, queda elegido
  // y el inspector se abre en él; el recargo trae sus aristas.
  const mostrarNodoNuevo = useCallback((raw) => {
    const nd = normalizeGraph({ nodos: [raw], relaciones: [] }).nodes[0];
    setGraph((g) => ({ ...g, nodes: [nd, ...g.nodes.filter((n) => n.id !== nd.id)] }));
    setCamino([]);
    setEgo(null);
    setSelectedId(nd.id);
    setInspectorAbierto(true);
    loadSections();
    setReloadKey((k) => k + 1);
    return nd;
  }, [loadSections]);

  // Script nuevo: archivo + nodo SCRIPT; el inspector se abre en su código.
  const nuevoScript = useCallback(async (nombre) => {
    const titulo = (nombre ?? window.prompt('Nombre del script:') ?? '').trim();
    if (!titulo) return null;
    const r = await crearScript({ nombre: titulo, seccion: seccionReal });
    return mostrarNodoNuevo(r.node);
  }, [seccionReal, mostrarNodoNuevo]);

  // Base Postgres configurada → nodo de datos de la sección; el inspector se abre en
  // su consulta.
  const agregarBase = useCallback(async (nombre) => {
    const r = await agregarConexion(nombre, seccionReal);
    return mostrarNodoNuevo(r.node);
  }, [seccionReal, mostrarNodoNuevo]);

  // Tabla dinámica del explorador → nodo «Reporte» unido a su fuente; el inspector
  // se abre en él. Sin nombre, el backend lo describe («Suma de importe por mes»).
  const guardarReporte = useCallback(async ({ spec, vista, tipo }) => {
    const titulo = window.prompt('Nombre del reporte (vacío: se describe solo):', '');
    if (titulo === null || !explorar) return;
    const r = await crearReporte({ datos: explorar.nodo.id, titulo: titulo.trim(), spec, vista, tipo });
    setExplorar(null);
    mostrarNodoNuevo(r.node);
  }, [explorar, mostrarNodoNuevo]);

  // Pregunta a la biblioteca como nodo: busca en la sección actual (o en todas, si se
  // está viendo todo) y queda abierta en el inspector con su evidencia.
  const nuevaPregunta = useCallback(async () => {
    const texto = (window.prompt('¿Qué querés preguntarle a tu biblioteca?') || '').trim();
    if (!texto) return;
    try {
      const r = await crearPregunta({ pregunta: texto, alcance: seccion === TODAS ? '*' : seccion, dominio: seccionReal });
      mostrarNodoNuevo(r.node);
    } catch (e) {
      window.alert(`No se pudo crear la pregunta: ${e.message}`);
    }
  }, [seccion, seccionReal, mostrarNodoNuevo]);

  const preguntarSobre = useCallback((node) => {
    setAgentContext(node || null);
    setAgentOpen(true);
  }, []);

  // Soltar el foco: de a una capa (Esc, click en el vacío) o todo junto («Ver todo»).
  const soltarUno = useCallback(() => {
    if (marcados.size) setMarcados(new Set());
    else if (pinnedEdge) setPinnedEdge(null);
    else if (ego) setEgo(null);
    else setSelectedId(null);
  }, [marcados, pinnedEdge, ego]);
  const verTodo = useCallback(() => {
    setMarcados(new Set()); setPinnedEdge(null); setEgo(null); setSelectedId(null);
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
        soltarUno();
        return;
      }
      // Supr: a la papelera lo marcado (o el documento abierto). Sólo abre la
      // confirmación; nada sale de la biblioteca sin ese segundo paso.
      if (e.key === 'Delete') {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        const ids = marcados.size ? [...marcados] : selectedId ? [selectedId] : [];
        if (ids.length) { e.preventDefault(); setPapeleraIds(ids); }
        return;
      }
      if (e.key === '1') setVista('lista');
      if (e.key === '2') setVista('split');
      if (e.key === '3') setVista('grafo');
      if (e.key === '4') setVista('3d');
      if (e.key === '5') setVista('4d');
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
  }, [orden, selectedId, seleccionar, marcados, soltarUno]);

  const selected = selectedId ? nodesById.get(selectedId) : null;
  const seccionInfo = sections.find((s) => s.nombre === seccion);
  const hayFoco = Boolean(selectedId || ego || pinnedEdge || marcados.size);
  const visibleIds = useMemo(() => new Set(orden), [orden]);

  // El 3D y la 4D comparten el color (las dos son espaciales); el 2D tiene el suyo.
  const espacial = vista === '3d' || vista === '4d';
  const modoColor = espacial ? colorMode3d : colorMode;
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
    onVacio: soltarUno,
    onSelect: elegirEnGrafo,
    relIndex,
    colorMode: modoColor,
    onColorMode: espacial ? setColorMode3d : setColorMode,
  };
  const grafo = (
    <div className="relative h-full">
      <Suspense fallback={<div className="grid h-full place-items-center text-[12px] text-ink-dim">Cargando grafo…</div>}>
        {vista === '3d' ? <Graph3DView {...propsGrafo} />
          : vista === '4d' ? (
            <Vista4D
              selectedId={selectedId} onElegir={elegirEn4D} seccion={seccion} filtro={filtroNodo}
              pinnedEdge={pinnedEdge} onClearPin={propsGrafo.onClearPin} ego={ego} onFijar={fijarVecindario}
              highlightIds={highlightIds} colorMode={modoColor} onColorMode={setColorMode3d} colorDe={colorDe} temas={temas}
              onAbrirSeccion={(nombre, v) => { cambiarSeccion(nombre); setVista(v); }}
              onVacio={soltarUno}
              version={sections.map((x) => `${x.nombre}:${x.count}`).join('|')}
            />
          )
          : <GraphCanvas {...propsGrafo} />}
      </Suspense>
      {/* Con un nodo elegido el resto se atenúa: la salida tiene que estar a la vista,
          no sólo en el Esc. */}
      {hayFoco && (
        <button
          type="button"
          onClick={verTodo}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-hair-strong bg-surface/90 px-3 py-1.5 text-[12px] text-ink shadow-lg shadow-black/40 backdrop-blur hover:border-accent/60"
        >
          Ver todo <kbd className="rounded-xs border border-hair px-1 text-[10.5px] text-ink-dim">Esc</kbd>
        </button>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={350}>
      <div className="grid h-screen grid-rows-[56px_minmax(0,1fr)]">
        <Topbar
          seccion={etiquetaSeccion}
          total={graph.nodes.length}
          vista={vista}
          onVista={setVista}
          onOpenPalette={() => setPaletteOpen(true)}
          onReload={recargar}
          loading={status === 'loading'}
          jobsBadge={<JobsBadge active={activeJobs} onClick={() => setJobsOpen(true)} />}
          fuentesBadge={<FuentesBadge pendingCount={fuentesPending} onClick={() => setFuentesOpen(true)} />}
        />

        <div className="flex min-h-0">
          {railAbierto ? (
          <>
          <Rail
            sections={sectionsVista}
            seccion={seccion}
            onAbrirNodo={elegirEn4D}
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
            onReagrupar={reagrupar}
            reagrupando={reagrupando}
            onIngest={() => setIngestOpen(true)}
            onCorridas={() => setCorridasOpen(true)}
            onPapelera={() => setPapeleraOpen(true)}
            papeleraCount={papeleraCount}
            onDuplicados={() => setDuplicadosOpen(true)}
            duplicadosCount={duplicadosCount}
            onNuevaNota={nuevaNota}
            onNuevoScript={() => nuevoScript().catch((e) => window.alert(`No se pudo crear el script: ${e.message}`))}
            onNuevaPregunta={nuevaPregunta}
            onSeccionesCambiadas={(activa) => { cambiarSeccion(activa); recargar(); }}
            onSeccionEliminada={olvidarSeccion}
            ancho={anchoRail}
            onCollapse={() => setRailAbierto(false)}
          />
          <Splitter
            etiqueta="Ancho del panel izquierdo"
            onStart={() => anchoRail}
            onDrag={(dx, base) => setAnchoRail(acotar(base + dx, PANELES.rail))}
            onReset={() => setAnchoRail(PANELES.rail.def)}
          />
          </>
          ) : (
            <PanelPlegado lado="izquierda" texto="Mostrar barra lateral" atajo="[" onAbrir={() => setRailAbierto(true)} />
          )}

          <main ref={mainRef} className="flex min-w-0 flex-1">
            {(vista === 'lista' || vista === 'split') && (
              <section
                className={vista === 'split' ? 'flex min-w-[320px] shrink-0 flex-col hairline-r' : 'flex min-w-0 flex-1 flex-col'}
                style={vista === 'split' ? { width: `${splitPct}%` } : undefined}
              >
                <Library
                  status={status}
                  seccion={etiquetaSeccion}
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
                  onTemaMarcados={() => setTemaIds([...marcados])}
                  onPapeleraMarcados={() => setPapeleraIds([...marcados])}
                  onEditar={editarDesdeLista}
                  onMover={(ids) => setMoverIds(ids)}
                  onPapelera={(ids) => setPapeleraIds(ids)}
                  onToggleTipo={toggleIn(setTipos)}
                  tipoSugerido={tipoSugerido}
                  onUsarTipo={(t) => { setQuery(''); setTipos(new Set([t])); }}
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
              externos={externosById}
              relIndex={relIndex}
              seccion={etiquetaSeccion}
              seccionCount={graph.nodes.length}
              edgesCount={graph.edges.length}
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
              onPapelera={(ids) => setPapeleraIds(ids)}
              pedidoEditar={pedidoEditar}
              onPedidoAtendido={() => setPedidoEditar(null)}
              temas={temas}
              onTema={(k) => toggleIn(setTemasSel)(k)}
              onCollapse={() => setInspectorAbierto(false)}
              onScriptGuardado={recargar}
              onCorrida={() => setCorridasKey((k) => k + 1)}
            />
            </>
          ) : (
            <PanelPlegado
              lado="derecha"
              texto={selected ? `Mostrar detalle de «${selected.label}»` : 'Mostrar detalle'}
              atajo="]"
              marca={!!selected}
              onAbrir={() => setInspectorAbierto(true)}
            />
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

        <IngestDialog
          open={ingestOpen}
          onOpenChange={setIngestOpen}
          seccion={seccionReal}
          onDone={recargar}
          onAgregarBase={agregarBase}
          onAbrirNodo={(id) => { seleccionar(id); setInspectorAbierto(true); }}
        />
        <MoverDialog
          open={!!moverIds}
          onOpenChange={(o) => !o && setMoverIds(null)}
          ids={moverIds || []}
          nodesById={nodesById}
          sections={sectionsVista}
          seccion={etiquetaSeccion}
          onDone={tras_mover}
        />
        <PapeleraDialog
          open={!!papeleraIds}
          onOpenChange={(o) => !o && setPapeleraIds(null)}
          ids={papeleraIds || []}
          nodesById={nodesById}
          onDone={tras_papelera}
        />
        <TemaDialog
          open={!!temaIds}
          onOpenChange={(o) => !o && setTemaIds(null)}
          ids={temaIds || []}
          temas={temas}
          onDone={tras_tema}
        />
        <DuplicadosDialog
          open={duplicadosOpen}
          onOpenChange={setDuplicadosOpen}
          onCambio={() => { recargar(); cargarPapeleraCount(); cargarDuplicados(); }}
          onAbrir={(id, dom) => elegirEn4D(id, dom)}
        />
        <Papelera
          open={papeleraOpen}
          onOpenChange={setPapeleraOpen}
          seccion={seccion}
          onCambio={() => { recargar(); cargarPapeleraCount(); }}
        />
        <TaxonomiaDialog open={taxonomiaOpen} onOpenChange={setTaxonomiaOpen} temas={temas} onDone={recargar} />
        <JobsPanel
          open={jobsOpen}
          onOpenChange={setJobsOpen}
          active={activeJobs}
          recent={recentJobs}
          onRefresh={refreshJobs}
          onSelectNode={(id) => { seleccionar(id); setJobsOpen(false); }}
        />
        <FuentesPanel
          open={fuentesOpen}
          onOpenChange={setFuentesOpen}
          seccion={seccion === TODAS ? 'personal' : seccion}
          sources={fuentesSources}
          onRefresh={refreshFuentes}
        />
        {explorar && (
          <Suspense fallback={null}>
            <ExploradorDatos
              open
              onOpenChange={(o) => { if (!o) setExplorar(null); }}
              nodo={explorar.nodo}
              tablaInicial={explorar.tabla}
              specInicial={explorar.inicial}
              onGuardarReporte={guardarReporte}
            />
          </Suspense>
        )}
        <Corridas
          open={corridasOpen}
          onOpenChange={setCorridasOpen}
          seccion={seccion === TODAS ? '' : seccion}
          onAbrirNodo={(id) => { seleccionar(id); setInspectorAbierto(true); }}
          corridasKey={corridasKey}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          nodes={graph.nodes}
          haystack={haystack}
          sections={sections}
          seccion={etiquetaSeccion}
          inspectorAbierto={inspectorAbierto}
          railAbierto={railAbierto}
          autoAbrir={autoAbrir}
          onSelect={(id) => { seleccionar(id); setPaletteOpen(false); }}
          onSeccion={(s) => { cambiarSeccion(s); setPaletteOpen(false); }}
          onFiltrar={(texto) => { setQuery(texto); setPaletteOpen(false); }}
          onAction={(a) => {
            setPaletteOpen(false);
            if (a === 'ingest') setIngestOpen(true);
            if (a === 'corridas') setCorridasOpen(true);
            if (a === 'nuevo-script') nuevoScript().catch((e) => window.alert(`No se pudo crear el script: ${e.message}`));
            if (a === 'agent') preguntarSobre(null);
            if (a === 'papelera') setPapeleraOpen(true);
            if (a === 'inspector') setInspectorAbierto((v) => !v);
            if (a === 'auto-inspector') setAutoAbrir((v) => !v);
            if (a === 'rail') setRailAbierto((v) => !v);
            if (a === 'reagrupar') reagrupar();
            if (a === 'recalcular-relaciones') recalcular();
            if (a === 'navaja') instalarNavaja();
            if (VISTAS.includes(a)) setVista(a);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
