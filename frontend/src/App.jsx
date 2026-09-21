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
import { fetchGraph, fetchSections, searchSemantic } from '@/lib/api';
import { AGRUPADORES, indexarRelaciones } from '@/lib/nodes';
import { normalizar } from '@/lib/utils';

// React Flow pesa: sólo se carga cuando el usuario abre Split o Grafo.
const GraphCanvas = lazy(() => import('@/app/GraphCanvas'));

const LS = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
};

const VISTAS = ['lista', 'split', 'grafo'];

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

  // ── Filtros ────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [tipos, setTipos] = useState(() => new Set());
  const [fuentes, setFuentes] = useState(() => new Set());
  const [conceptos, setConceptos] = useState(() => new Set());
  const [groupBy, setGroupBy] = useState(() => LS.get('algedi_agrupar', 'fuente'));
  const [sortBy, setSortBy] = useState(() => LS.get('algedi_orden', 'reciente'));
  const [semanticIds, setSemanticIds] = useState(null);

  // ── Diálogos ───────────────────────────────────────────────────────
  const [ingestOpen, setIngestOpen] = useState(false);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentContext, setAgentContext] = useState(null);

  const searchRef = useRef(null);

  useEffect(() => LS.set('algedi_vista', vista), [vista]);
  useEffect(() => LS.set('algedi_agrupar', groupBy), [groupBy]);
  useEffect(() => LS.set('algedi_orden', sortBy), [sortBy]);

  const loadSections = useCallback(() => {
    fetchSections().then(setSections).catch(() => setSections([]));
  }, []);
  useEffect(() => { loadSections(); }, [loadSections]);

  // Si la sección guardada no existe en el backend, caer a la más poblada.
  useEffect(() => {
    if (!sections.length) return;
    if (!sections.some((s) => s.nombre === seccion)) {
      const mayor = [...sections].sort((a, b) => b.count - a.count)[0];
      if (mayor) setSeccion(mayor.nombre);
    }
  }, [sections, seccion]);

  useEffect(() => {
    const ctrl = new AbortController();
    setStatus('loading');
    fetchGraph(seccion, { signal: ctrl.signal })
      .then((g) => { setGraph(g); setStatus('ok'); })
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
    setHighlightIds(new Set());
    setTipos(new Set()); setFuentes(new Set()); setConceptos(new Set());
    setQuery('');
  }, []);

  // ── Índices derivados ──────────────────────────────────────────────
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const relIndex = useMemo(() => indexarRelaciones(graph.edges), [graph.edges]);

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
    if (tipos.size && !tipos.has(n.type)) return false;
    if (fuentes.size && !fuentes.has((n.fuente || 'sin-origen').toLowerCase())) return false;
    if (conceptos.size) {
      const propios = new Set((n.conceptos || []).map(normalizar));
      for (const c of conceptos) if (!propios.has(c)) return false;   // AND: cada concepto acota
    }
    return true;
  }, [tipos, fuentes, conceptos]);

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
    const agr = AGRUPADORES[groupBy] || AGRUPADORES.fuente;
    const map = new Map();
    for (const n of visibles) {
      const k = agr.keyOf(n);
      if (!map.has(k)) map.set(k, { key: k, title: agr.titleOf(k), items: [] });
      map.get(k).items.push(n);
    }
    const arr = [...map.values()].sort((a, b) => b.items.length - a.items.length);
    if (semanticos.length) {
      arr.push({ key: '__semantico', title: 'Por significado', semantic: true, items: semanticos });
    }
    return arr;
  }, [visibles, semanticos, groupBy]);

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

  const seleccionar = useCallback((id) => setSelectedId(id), []);

  const toggleIn = (setter) => (key) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const limpiarFiltros = useCallback(() => {
    setTipos(new Set()); setFuentes(new Set()); setConceptos(new Set()); setQuery('');
  }, []);

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
      if (e.key === 'Escape') { setSelectedId(null); return; }
      if (e.key === '1') setVista('lista');
      if (e.key === '2') setVista('split');
      if (e.key === '3') setVista('grafo');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k') {
        if (!orden.length) return;
        e.preventDefault();
        const i = orden.indexOf(selectedId);
        const dir = (e.key === 'ArrowDown' || e.key === 'j') ? 1 : -1;
        const next = i < 0 ? 0 : Math.min(orden.length - 1, Math.max(0, i + dir));
        setSelectedId(orden[next]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orden, selectedId]);

  const selected = selectedId ? nodesById.get(selectedId) : null;
  const seccionInfo = sections.find((s) => s.nombre === seccion);
  const visibleIds = useMemo(() => new Set(orden), [orden]);

  const grafo = (
    <Suspense fallback={<div className="grid h-full place-items-center text-[12px] text-ink-dim">Cargando grafo…</div>}>
      <GraphCanvas
        nodes={graph.nodes}
        edges={graph.edges}
        visibleIds={visibleIds}
        selectedId={selectedId}
        highlightIds={highlightIds}
        onSelect={seleccionar}
        relIndex={relIndex}
      />
    </Suspense>
  );

  return (
    <TooltipProvider delayDuration={350}>
      <div className="grid h-screen grid-rows-[44px_minmax(0,1fr)] bg-canvas">
        <Topbar
          seccion={seccion}
          total={graph.nodes.length}
          vista={vista}
          onVista={setVista}
          onOpenPalette={() => setPaletteOpen(true)}
          onReload={recargar}
          loading={status === 'loading'}
        />

        <div className="flex min-h-0">
          <Rail
            sections={sections}
            seccion={seccion}
            onSeccion={cambiarSeccion}
            facetas={facetas}
            tipos={tipos}
            onToggleTipo={toggleIn(setTipos)}
            fuentes={fuentes}
            onToggleFuente={toggleIn(setFuentes)}
            topConceptos={topConceptos}
            conceptos={conceptos}
            onToggleConcepto={toggleIn(setConceptos)}
            onIngest={() => setIngestOpen(true)}
            onScripts={() => setScriptsOpen(true)}
          />

          <main className="flex min-w-0 flex-1">
            {vista !== 'grafo' && (
              <section className={vista === 'split' ? 'flex w-[46%] min-w-[380px] flex-col hairline-r' : 'flex min-w-0 flex-1 flex-col'}>
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
                  filtros={{ tipos, fuentes, conceptos, topConceptos }}
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
            {vista !== 'lista' && <section className="relative min-w-0 flex-1">{grafo}</section>}
          </main>

          <Inspector
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
          />
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
          onSelect={(id) => { seleccionar(id); setPaletteOpen(false); }}
          onSeccion={(s) => { cambiarSeccion(s); setPaletteOpen(false); }}
          onAction={(a) => {
            setPaletteOpen(false);
            if (a === 'ingest') setIngestOpen(true);
            if (a === 'scripts') setScriptsOpen(true);
            if (a === 'agent') preguntarSobre(null);
            if (VISTAS.includes(a)) setVista(a);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
