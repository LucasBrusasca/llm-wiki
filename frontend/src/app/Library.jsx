import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, ChevronRight, ArrowDownUp, Rows3, Link2, Sparkles, Upload, AlertTriangle, Hash,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { AGRUPADORES, iconoDe, fuenteLabel, tipoMeta } from '@/lib/nodes';
import { cn, fechaCorta, normalizar } from '@/lib/utils';

const ORDENES = {
  reciente: 'Más recientes',
  titulo: 'Título A–Z',
  conexiones: 'Más conectados',
};

/** Resalta los términos buscados dentro del título (sin tocar el texto original). */
function Resaltado({ texto, terms }) {
  if (!terms.length || !texto) return texto;
  const norm = normalizar(texto);
  const marcas = [];
  for (const t of terms) {
    let i = norm.indexOf(t);
    while (i !== -1) { marcas.push([i, i + t.length]); i = norm.indexOf(t, i + t.length); }
  }
  if (!marcas.length) return texto;
  marcas.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  marcas.forEach(([a, b], k) => {
    if (a < pos) return;
    if (a > pos) out.push(texto.slice(pos, a));
    out.push(<mark key={k} className="mark-hit">{texto.slice(a, b)}</mark>);
    pos = b;
  });
  out.push(texto.slice(pos));
  return out;
}

function Fila({ node, selected, highlighted, grado, terms, onSelect, compact, semantic }) {
  const Icon = iconoDe(node);
  const ref = useRef(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const fecha = fechaCorta(node.fecha_doc);
  const vigencia = node.vigencia?.estado;
  const noVigente = vigencia && vigencia !== 'vigente';

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(node.id)}
      aria-current={selected || undefined}
      className={cn(
        'group relative grid h-[34px] w-full items-center gap-3 px-4 text-left transition-colors',
        compact ? 'grid-cols-[16px_minmax(0,1fr)_auto]' : 'grid-cols-[16px_minmax(0,1fr)_150px_88px_52px]',
        selected ? 'bg-surface-3' : 'hover:bg-surface-2',
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
      <Icon className={cn('size-3.5', selected ? 'text-accent' : 'text-ink-dim')} />

      <span className="flex min-w-0 items-center gap-2">
        <span className={cn('truncate text-[12.5px]', selected ? 'text-ink' : 'text-ink/90')}>
          <Resaltado texto={node.label} terms={terms} />
        </span>
        {highlighted && <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Marcado por el agente" />}
        {semantic && <Sparkles className="size-3 shrink-0 text-accent-soft" />}
        {noVigente && <Badge variant="warn">{vigencia}</Badge>}
        {node.type && node.type !== 'DOCUMENTO' && <Badge>{tipoMeta(node.type).label}</Badge>}
      </span>

      {compact ? (
        <span className="text-[11px] text-ink-dim">{fecha || ''}</span>
      ) : (
        <>
          <span className="truncate text-[11.5px] text-ink-dim" title={node.autor || ''}>
            {node.autor || ''}
          </span>
          <span className="text-[11.5px] text-ink-dim">{fecha || ''}</span>
          <span className="flex items-center justify-end gap-1 text-[11.5px] text-ink-dim" title={`${grado} relaciones`}>
            {grado > 0 && <Link2 className="size-3" />}
            {grado || ''}
          </span>
        </>
      )}
    </button>
  );
}

function Encabezado({ grupo, abierto, onToggle, compact }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sticky top-0 z-10 flex h-8 w-full items-center gap-1.5 hairline-b bg-canvas/95 px-4 text-left backdrop-blur-sm"
    >
      <ChevronRight className={cn('size-3 text-ink-dim transition-transform', abierto && 'rotate-90')} />
      {grupo.semantic && <Sparkles className="size-3 text-accent-soft" />}
      <span className="text-[12px] font-medium text-ink">{grupo.title}</span>
      <span className="text-[11.5px] text-ink-dim">{grupo.items.length}</span>
      {grupo.semantic && (
        <span className="ml-1 text-[11px] text-ink-dim">no contienen el texto, pero el motor semántico los asocia</span>
      )}
      {!compact && !grupo.semantic && grupo.first && (
        <span className="ml-auto grid grid-cols-[150px_88px_52px] gap-3 text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">
          <span>Autor</span><span>Fecha</span><span className="text-right">Rel.</span>
        </span>
      )}
    </button>
  );
}

function Estado({ icon: Icon, titulo, texto, children }) {
  return (
    <div className="grid flex-1 place-items-center p-10">
      <div className="max-w-sm text-center">
        <Icon className="mx-auto mb-3 size-5 text-ink-dim" />
        <p className="text-[13px] font-medium text-ink">{titulo}</p>
        {texto && <p className="mt-1 text-[12px] text-ink-dim">{texto}</p>}
        {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-px pt-8" aria-busy>
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="flex h-[34px] items-center gap-3 px-4">
          <div className="size-3.5 rounded-xs bg-surface-2" />
          <div className="h-2.5 rounded-xs bg-surface-2" style={{ width: `${30 + ((i * 37) % 45)}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function Library({
  status, seccion, seccionCount, totalNodes, grupos, visibleCount,
  query, onQuery, searchRef, groupBy, onGroupBy, sortBy, onSortBy,
  selectedId, onSelect, highlightIds, onClearHighlight, relIndex,
  filtros, onToggleTipo, onToggleFuente, onToggleConcepto, onLimpiar,
  onRetry, onIngest, compact,
}) {
  const [cerrados, setCerrados] = useState(() => new Set());
  const terms = useMemo(() => normalizar(query.trim()).split(/\s+/).filter(Boolean), [query]);
  const conceptoLabel = useMemo(
    () => new Map(filtros.topConceptos.map((c) => [c.key, c.label])),
    [filtros.topConceptos],
  );

  const chips = [
    ...[...filtros.tipos].map((t) => ({ k: `t:${t}`, label: tipoMeta(t).plural, off: () => onToggleTipo(t) })),
    ...[...filtros.fuentes].map((f) => ({ k: `f:${f}`, label: fuenteLabel({ fuente: f }) || f, off: () => onToggleFuente(f) })),
    ...[...filtros.conceptos].map((c) => ({ k: `c:${c}`, label: conceptoLabel.get(c) || c, icon: Hash, off: () => onToggleConcepto(c) })),
  ];
  const hayFiltros = chips.length > 0 || query.trim().length > 0;
  const semCount = grupos.find((g) => g.semantic)?.items.length || 0;

  let cuerpo;
  if (status === 'loading' && totalNodes === 0) {
    cuerpo = <Esqueleto />;
  } else if (status === 'error') {
    cuerpo = (
      <Estado icon={AlertTriangle} titulo="No se pudo cargar la sección" texto="El backend no respondió. Revisá que Docker esté arriba (API en :8000).">
        <Button variant="outline" onClick={onRetry}>Reintentar</Button>
      </Estado>
    );
  } else if (totalNodes === 0 && seccionCount > 0) {
    // Nunca una lista vacía "bonita": si la API dice que hay docs y no llegaron, es un error.
    cuerpo = (
      <Estado icon={AlertTriangle} titulo={`La sección tiene ${seccionCount} nodos pero no llegaron`} texto="Probá recargar; si persiste, es un error de la API de grafo.">
        <Button variant="outline" onClick={onRetry}>Recargar</Button>
      </Estado>
    );
  } else if (totalNodes === 0) {
    cuerpo = (
      <Estado icon={Upload} titulo={`«${seccion}» está vacía`} texto="Subí PDFs, presentaciones, Word o links. Se procesan, se vinculan y quedan citables.">
        <Button variant="default" onClick={onIngest}><Upload /> Ingestar documentos</Button>
      </Estado>
    );
  } else if (visibleCount === 0 && semCount === 0) {
    cuerpo = (
      <Estado icon={Search} titulo="Nada coincide" texto={`${totalNodes} nodos en la sección, ninguno pasa los filtros actuales.`}>
        <Button variant="outline" onClick={onLimpiar}>Limpiar filtros</Button>
      </Estado>
    );
  } else {
    cuerpo = (
      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {grupos.map((g, gi) => {
          const abierto = !cerrados.has(g.key);
          return (
            <div key={g.key || 'todos'}>
              {(g.title || g.semantic) && (
                <Encabezado
                  grupo={{ ...g, first: gi === 0 }}
                  abierto={abierto}
                  compact={compact}
                  onToggle={() => setCerrados((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                    return next;
                  })}
                />
              )}
              {abierto && g.items.map((n) => (
                <Fila
                  key={n.id}
                  node={n}
                  selected={n.id === selectedId}
                  highlighted={highlightIds.has(n.id)}
                  grado={relIndex.get(n.id)?.length || 0}
                  terms={g.semantic ? [] : terms}
                  semantic={g.semantic}
                  compact={compact}
                  onSelect={onSelect}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Barra de la biblioteca: título, búsqueda local, agrupar, ordenar */}
      <div className="flex h-11 shrink-0 items-center gap-2 hairline-b px-4">
        <h1 className="text-[13px] font-semibold tracking-[-0.01em]">Biblioteca</h1>
        <span className="text-[11.5px] text-ink-dim">
          {hayFiltros ? `${visibleCount} de ${totalNodes}` : totalNodes || ''}
        </span>

        <div className={cn('relative min-w-[120px] flex-1', compact ? 'ml-1' : 'ml-3 max-w-[340px]')}>
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-dim" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Filtrar por título, autor, concepto…"
            className="pl-7 pr-7"
            aria-label="Buscar en la biblioteca"
          />
          {query ? (
            <button type="button" onClick={() => onQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-dim hover:text-ink" aria-label="Limpiar búsqueda">
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xs border border-hair-strong px-1 text-[10px] text-ink-dim">/</kbd>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size={compact ? 'icon' : 'md'} aria-label="Agrupar" title={`Agrupar por ${AGRUPADORES[groupBy]?.label || ''}`}>
                <Rows3 />{!compact && (AGRUPADORES[groupBy]?.label || 'Agrupar')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Agrupar por</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={groupBy} onValueChange={onGroupBy}>
                {Object.entries(AGRUPADORES).map(([k, a]) => (
                  <DropdownMenuRadioItem key={k} value={k}>{a.label}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size={compact ? 'icon' : 'md'} aria-label="Ordenar" title={ORDENES[sortBy]}>
                <ArrowDownUp />{!compact && ORDENES[sortBy]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Ordenar</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sortBy} onValueChange={onSortBy}>
                {Object.entries(ORDENES).map(([k, l]) => (
                  <DropdownMenuRadioItem key={k} value={k}>{l}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {(chips.length > 0 || highlightIds.size > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 hairline-b px-4 py-1.5">
          {chips.map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={c.off}
              className="flex h-5 items-center gap-1 rounded-xs border border-hair-strong bg-surface-2 pl-1.5 pr-1 text-[11.5px] text-ink-muted hover:text-ink"
            >
              {c.icon && <c.icon className="size-3 text-ink-dim" />}
              {c.label}
              <X className="size-3 text-ink-dim" />
            </button>
          ))}
          {highlightIds.size > 0 && (
            <button
              type="button"
              onClick={onClearHighlight}
              className="flex h-5 items-center gap-1 rounded-xs border border-accent/30 bg-accent/10 pl-1.5 pr-1 text-[11.5px] text-accent-soft"
            >
              <span className="size-1.5 rounded-full bg-accent" />
              {highlightIds.size} marcados por el agente
              <X className="size-3" />
            </button>
          )}
          {chips.length > 0 && (
            <button type="button" onClick={onLimpiar} className="ml-1 text-[11.5px] text-ink-dim hover:text-ink">Limpiar</button>
          )}
        </div>
      )}

      {cuerpo}
    </div>
  );
}
