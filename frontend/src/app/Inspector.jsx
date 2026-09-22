import React, { useEffect, useMemo, useState } from 'react';
import {
  X, ExternalLink, MessageSquare, Share2, ArrowUpRight, ArrowDownLeft, ArrowRight, Copy, Check,
  Hash, Link2, CornerDownRight, Pin, PinOff, Unlink, Undo2, ChevronRight, Pencil, FolderInput, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  iconoDe, tipoMeta, fuenteLabel, relacionLabel, procedenciaLabel, RELACIONES,
  colorTipo, colorFuente,
} from '@/lib/nodes';
import { temaDe } from '@/lib/temas';
import Thumb, { tieneThumb } from '@/app/Thumb';
import { cn, fechaCorta, pct, normalizar } from '@/lib/utils';

function urlFuente(node) {
  if (node.fuente_url) return node.fuente_url;
  if (node.fuente_path) return `/files/${encodeURIComponent(node.id)}`;
  return null;
}

function ytId(url) {
  const m = (url || '').match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function Meta({ k, children }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <>
      <dt className="text-ink-dim">{k}</dt>
      <dd className="min-w-0 break-words text-ink-muted">{children}</dd>
    </>
  );
}

function Seccion({ titulo, extra, children }) {
  return (
    <section className="px-4 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim">{titulo}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Barra({ valor }) {
  return (
    <span className="relative h-1 w-10 overflow-hidden rounded-full bg-surface-3">
      <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${Math.round((valor || 0) * 100)}%` }} />
    </span>
  );
}

const mismaArista = (e, pin) => !!pin && e.source === pin.source && e.target === pin.target && e.label === pin.label;

/**
 * Una relación: qué vínculo, con quién, por qué y de dónde salió.
 * Clic en la tarjeta = fijar el vínculo en el grafo (el inspector NO cambia de
 * documento). Para ir al otro documento hay un "Abrir" explícito.
 */
function Relacion({ item, other, onAbrir, onConcepto, fijada, onPin }) {
  const { edge, dir } = item;
  const ev = edge.evidencia || {};
  const procedencia = [
    procedenciaLabel(edge),
    ev.similitud_coseno != null && `coseno ${Number(ev.similitud_coseno).toFixed(2)}`,
    ev.piso_usado != null && `piso ${Number(ev.piso_usado).toFixed(2)}`,
    ev.k_vecinos != null && `k=${ev.k_vecinos}`,
    ev.modelo_embeddings && ev.modelo_embeddings.split('-').slice(0, 2).join('-'),
  ].filter(Boolean);

  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={fijada}
      onClick={() => onPin(edge)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPin(edge); } }}
      className={cn(
        'group relative -mx-2 my-1 cursor-pointer rounded-md border px-2 py-2.5 transition-colors',
        fijada ? 'border-accent/50 bg-accent/[0.06] glow-sel' : 'border-transparent hover:border-hair hover:bg-surface-2/60',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-dim">
        {fijada
          ? <Link2 className="size-3 text-accent" />
          : dir === 'out' ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
        <span>
          {dir === 'out'
            ? <>este documento <span className="text-ink-muted">{relacionLabel(edge.label)}</span></>
            : <><span className="text-ink-muted">{relacionLabel(edge.label)}</span> este documento</>}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-ink-muted">
          <Barra valor={edge.score} />
          {pct(edge.score)}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-2">
        {other ? <Thumb node={other} className="h-[30px] w-[26px]" /> : null}
        <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-ink">
          {other?.label || item.otherId}
        </span>
        {other && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAbrir(other.id, edge); }}
            className="flex shrink-0 items-center gap-1 rounded-xs border border-hair px-1.5 py-0.5 text-[11px] text-ink-muted opacity-70 transition hover:border-hair-strong hover:text-ink group-hover:opacity-100"
            title="Ir a este documento siguiendo el vínculo (queda en el camino para volver)"
          >
            Abrir <ArrowRight className="size-3" />
          </button>
        )}
      </div>

      {edge.description && (
        <p className="mt-1.5 flex gap-1.5 text-[12px] leading-relaxed text-ink-muted">
          <CornerDownRight className="mt-[3px] size-3 shrink-0 text-ink-dim" />
          <span>{edge.description}</span>
        </p>
      )}

      {edge.shared_concepts?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 pl-[18px]">
          {edge.shared_concepts.slice(0, 8).map((c) => (
            <button
              key={c}
              type="button"
              onClick={(e) => { e.stopPropagation(); onConcepto(normalizar(c)); }}
              className="rounded-xs border border-hair bg-surface-2 px-1.5 text-[11px] leading-[18px] text-ink-muted hover:border-hair-strong hover:text-ink"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 pl-[18px] text-[10.5px] tracking-[0.01em] text-ink-dim">
        {procedencia.join(' · ')}
        {edge.revision?.estado && <> · revisión: {edge.revision.estado}</>}
      </p>
    </li>
  );
}

function Relaciones({ node, rels, nodesById, onAbrir, onConcepto, pinnedEdge, onPin, onClearPin }) {
  const [filtro, setFiltro] = useState('todas');
  const [limite, setLimite] = useState(10);
  useEffect(() => { setFiltro('todas'); setLimite(10); }, [node.id]);

  const porTipo = useMemo(() => {
    const m = new Map();
    rels.forEach((r) => m.set(r.edge.label, (m.get(r.edge.label) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rels]);

  if (!rels.length) {
    return (
      <div className="px-4 py-10 text-center text-[12px] text-ink-dim">
        Sin relaciones. Ningún otro documento de la sección supera el piso de similitud o comparte conceptos suficientes.
      </div>
    );
  }

  const lista = filtro === 'todas' ? rels : rels.filter((r) => r.edge.label === filtro);
  const fijadaOtro = pinnedEdge && nodesById.get(pinnedEdge.source === node.id ? pinnedEdge.target : pinnedEdge.source);

  return (
    <div className="px-4 pt-3">
      {pinnedEdge ? (
        <div className="mb-2 flex items-center gap-2 rounded-sm border border-accent/40 bg-accent/[0.07] px-2 py-1.5 text-[11.5px]">
          <Link2 className="size-3 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-ink-muted">
            Fijada: <span className="text-ink">{fijadaOtro?.label || '—'}</span>
          </span>
          <button type="button" onClick={onClearPin} className="flex shrink-0 items-center gap-1 text-ink-dim hover:text-ink">
            <Unlink className="size-3" /> Soltar vínculo
          </button>
        </div>
      ) : (
        <p className="mb-2 text-[11px] text-ink-dim">Clic en una relación para resaltar ese vínculo en el grafo · «Abrir» para ir al documento.</p>
      )}
      <div className="flex flex-wrap gap-1">
        {[['todas', rels.length], ...porTipo].map(([k, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setFiltro(k); setLimite(10); }}
            className={cn(
              'h-5 rounded-xs border px-1.5 text-[11px] transition-colors',
              filtro === k ? 'border-accent/40 bg-accent/10 text-accent-soft' : 'border-hair text-ink-dim hover:text-ink',
            )}
          >
            {k === 'todas' ? 'Todas' : (RELACIONES[k] || relacionLabel(k))} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>
      <ul className="mt-1.5">
        {lista.slice(0, limite).map((r) => (
          <Relacion
            key={`${r.edge.source}-${r.edge.target}-${r.edge.label}`}
            item={r}
            other={nodesById.get(r.otherId)}
            onAbrir={onAbrir}
            onConcepto={onConcepto}
            fijada={mismaArista(r.edge, pinnedEdge)}
            onPin={onPin}
          />
        ))}
      </ul>
      {lista.length > limite && (
        <Button variant="ghost" size="sm" className="mb-2 w-full" onClick={() => setLimite((l) => l + 20)}>
          Ver {Math.min(20, lista.length - limite)} más de {lista.length - limite}
        </Button>
      )}
    </div>
  );
}

/** ¿Hay algo que previsualizar? Si no, el inspector abre directo en Resumen. */
function tienePreview(node) {
  if (!node) return false;
  if (ytId(node.fuente_url)) return true;
  if ((node.fuente || '').toLowerCase() === 'pdf' && node.fuente_path) return true;
  return tieneThumb(node);
}

function Preview({ node }) {
  const f = (node.fuente || '').toLowerCase();
  const yt = ytId(node.fuente_url);

  if (yt) {
    return (
      <div className="p-4">
        <div className="aspect-video overflow-hidden rounded-md border border-hair">
          <iframe title="Video" className="size-full" src={`https://www.youtube-nocookie.com/embed/${yt}`} allowFullScreen />
        </div>
        {node.desc && <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">{node.desc}</p>}
      </div>
    );
  }
  if (f === 'pdf' && node.fuente_path) {
    return (
      <div className="flex h-full min-h-[480px] flex-col p-3">
        <iframe
          title={`Vista previa de ${node.label}`}
          src={`/files/${encodeURIComponent(node.id)}#view=FitH&toolbar=0`}
          className="min-h-0 flex-1 rounded-md border border-hair bg-white"
        />
      </div>
    );
  }
  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-md border border-hair">
        <Thumb node={node} eager className="aspect-[4/3] w-full" iconClass="size-8" rounded="rounded-none" />
      </div>
      {node.fragmento && (
        <blockquote className="mt-4 border-l-2 border-accent/60 pl-3 text-[12.5px] leading-relaxed text-ink-muted">
          {node.fragmento}
        </blockquote>
      )}
      {node.desc && node.desc !== node.fragmento && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink/85">{node.desc}</p>
      )}
    </div>
  );
}

/** Edición manual de título, autor y tema (se guarda en la API). */
function EditarNodo({ node, temas, onGuardar, onCancelar }) {
  const [label, setLabel] = useState(node.label || '');
  const [autor, setAutor] = useState(node.autor || '');
  const [tema, setTema] = useState(node.tema && node.tema !== 'Sin clasificar' ? node.tema : '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const sugerencias = [...(temas?.values() || [])].filter((t) => t.key !== 'sin-tema').map((t) => t.nombre);

  async function guardar(e) {
    e?.preventDefault();
    const campos = {};
    if (label.trim() !== (node.label || '').trim()) campos.label = label;
    if (autor.trim() !== (node.autor || '').trim()) campos.autor = autor;
    if (tema.trim() !== (node.tema && node.tema !== 'Sin clasificar' ? node.tema : '').trim()) campos.tema = tema;
    if (!Object.keys(campos).length) { onCancelar(); return; }
    setGuardando(true); setError(null);
    try {
      await onGuardar(campos);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  }

  const campo = 'h-8 w-full rounded-sm border border-hair bg-surface-2 px-2 text-[12.5px] text-ink placeholder:text-ink-dim focus:border-accent/60 focus:outline-none';
  return (
    <form onSubmit={guardar} className="mt-2 flex flex-col gap-2" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancelar())}>
      <label className="block">
        <span className="mb-0.5 block text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">Título</span>
        <textarea value={label} onChange={(e) => setLabel(e.target.value)} rows={2} autoFocus className={cn(campo, 'h-auto resize-none py-1.5')} />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">Autor</span>
        <input value={autor} onChange={(e) => setAutor(e.target.value)} placeholder="Sin autor" className={campo} />
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">Tema</span>
        <input value={tema} onChange={(e) => setTema(e.target.value)} list="algedi-temas" placeholder="Sin tema (usa el automático)" className={campo} />
        <datalist id="algedi-temas">{sugerencias.map((t) => <option key={t} value={t} />)}</datalist>
      </label>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex gap-1.5">
        <Button type="submit" variant="default" size="sm" disabled={guardando || !label.trim()}>
          {guardando ? <Loader2 className="animate-spin" /> : <Check />} Guardar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>Cancelar</Button>
      </div>
    </form>
  );
}

/** Sin selección: panorama de la sección en vez de un hueco vacío. */
function Panorama({ seccion, seccionCount, edgesCount, relIndex, nodesById, topConceptos, onSelect, onConcepto }) {
  const conectados = useMemo(
    () => [...relIndex.entries()]
      .map(([id, arr]) => ({ node: nodesById.get(id), n: arr.length }))
      .filter((x) => x.node)
      .sort((a, b) => b.n - a.n)
      .slice(0, 7),
    [relIndex, nodesById],
  );
  const aislados = seccionCount - [...relIndex.keys()].filter((id) => nodesById.has(id)).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-24">
      <div className="px-4 pt-4">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim">Sección</p>
        <p className="mt-0.5 text-[15px] font-semibold capitalize tracking-[-0.01em]">{seccion}</p>
        <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-hair bg-hair">
          {[
            ['Nodos', seccionCount],
            ['Relaciones', edgesCount],
            ['Sin vínculos', Math.max(0, aislados)],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-2.5 py-2">
              <dt className="text-[10.5px] text-ink-dim">{k}</dt>
              <dd className="text-[15px] font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {conectados.length > 0 && (
        <Seccion titulo="Más conectados">
          <ul className="-mx-1.5">
            {conectados.map(({ node, n }) => {
              const Icon = iconoDe(node);
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(node.id)}
                    className="flex h-7 w-full items-center gap-2 rounded-sm px-1.5 text-left text-[12.5px] text-ink-muted hover:bg-surface-2 hover:text-ink"
                  >
                    <Icon className="size-3.5 shrink-0 text-ink-dim" />
                    <span className="flex-1 truncate">{node.label}</span>
                    <span className="flex items-center gap-1 text-[11px] text-ink-dim"><Link2 className="size-3" />{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Seccion>
      )}

      <Seccion titulo="Atajos">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          {[
            ['↑ ↓', 'moverse por la lista'],
            ['/', 'filtrar la biblioteca'],
            ['Ctrl K', 'buscar en todo'],
            ['1 2 3 4', 'Lista · Split · Grafo · 3D'],
            ['Esc', 'cerrar el detalle'],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <dt><kbd className="rounded-xs border border-hair-strong px-1 text-[10.5px] text-ink-muted">{k}</kbd></dt>
              <dd className="text-ink-dim">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Seccion>
    </div>
  );
}

export default function Inspector({
  node, nodesById, relIndex, seccion, seccionCount, edgesCount, topConceptos,
  onSelect, onClose, onAsk, onConcepto, onVerEnGrafo, vista, pinnedEdge, onPin, onClearPin,
  onAbrir, camino = [], onVolver, temas, onTema, ego, onFijar, ancho = 420, onGuardar, onMover,
}) {
  // Vista previa primero; si el documento no tiene nada que previsualizar, Resumen.
  const [tab, setTab] = useState('preview');
  const [copiado, setCopiado] = useState(false);
  const [editando, setEditando] = useState(false);
  const rels = useMemo(() => (node ? relIndex.get(node.id) || [] : []), [node, relIndex]);

  useEffect(() => {
    setCopiado(false);
    setEditando(false);
    setTab(tienePreview(node) ? 'preview' : 'resumen');
  }, [node?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const shell = 'flex shrink-0 flex-col hairline-l bg-surface';

  if (!node) {
    return (
      <aside className={shell} style={{ width: ancho }} aria-label="Detalle">
        <Panorama
          seccion={seccion}
          seccionCount={seccionCount}
          edgesCount={edgesCount}
          relIndex={relIndex}
          nodesById={nodesById}
          topConceptos={topConceptos}
          onSelect={onSelect}
          onConcepto={onConcepto}
        />
      </aside>
    );
  }

  const Icon = iconoDe(node);
  const fuente = urlFuente(node);
  const vig = node.vigencia;

  const copiarId = () => {
    navigator.clipboard?.writeText(node.id).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1400);
    }).catch(() => {});
  };

  return (
    <aside className={shell} style={{ width: ancho }} aria-label="Detalle del documento">
      {(camino.length > 0 || ego) && (
        <nav aria-label="Camino" className="flex shrink-0 items-center gap-1 hairline-b bg-accent/[0.04] px-3 py-1.5 text-[11px]">
          <span className="flex shrink-0 items-center gap-1 text-ink-dim">
            {ego ? <><Pin className="size-3 text-accent" /> Vecindario</> : 'Camino'}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
            {camino.map((id, i) => (
              <React.Fragment key={`${id}-${i}`}>
                {/* Con camino largo se muestran el origen y los dos últimos pasos. */}
                {(i === 0 || i >= camino.length - 2) ? (
                  <button
                    type="button"
                    onClick={() => onVolver(i)}
                    className="min-w-0 max-w-[110px] truncate rounded-xs px-1 text-ink-muted hover:bg-surface-2 hover:text-ink"
                    title={nodesById.get(id)?.label}
                  >
                    {nodesById.get(id)?.label || id}
                  </button>
                ) : i === 1 ? <span className="px-0.5 text-ink-dim">…</span> : null}
                {(i === 0 || i >= camino.length - 2) && <ChevronRight className="size-3 shrink-0 text-ink-dim" />}
              </React.Fragment>
            ))}
            <span className="min-w-0 truncate px-1 text-ink">{node.label}</span>
          </div>
          <button
            type="button"
            onClick={() => onVolver(0)}
            className="flex shrink-0 items-center gap-1 rounded-xs px-1 text-ink-dim hover:bg-surface-2 hover:text-accent"
            title="Volver al documento de partida"
          >
            <Undo2 className="size-3" /> Origen
          </button>
        </nav>
      )}
      <header className="shrink-0 px-4 pb-3 pt-3">
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-dim">
          <span className="chip-cat flex items-center gap-1 rounded-xs px-1.5 py-px text-[10.5px] font-medium" style={{ '--c': colorTipo(node.type) }}>
            <Icon className="size-3" /> {tipoMeta(node.type).label}
          </span>
          {fuenteLabel(node) && (
            <span className="chip-cat rounded-xs px-1.5 py-px text-[10.5px] font-medium" style={{ '--c': colorFuente(node) }}>
              {fuenteLabel(node)}
            </span>
          )}
          {(() => {
            const t = temas ? temaDe(temas, node) : null;
            if (!t || t.key === 'sin-tema') return null;
            return (
              <button
                type="button"
                onClick={() => onTema?.(t.key)}
                className="flex min-w-0 items-center gap-1 truncate text-[10.5px] text-ink-muted hover:text-ink"
                title={t.auto ? `${t.nombre} — nombre automático. Clic para filtrar por este tema.` : `Filtrar por «${t.nombre}»`}
              >
                <span className="size-1.5 shrink-0 rounded-full dot-cat" style={{ '--c': t.color }} />
                <span className="truncate">{t.nombre}</span>
              </button>
            );
          })()}
          <div className="ml-auto flex items-center">
            <Hint texto="Editar título, autor y tema">
              <Button variant="ghost" size="icon-sm" onClick={() => setEditando((v) => !v)} aria-label="Editar" className={cn(editando && 'text-accent')}>
                <Pencil />
              </Button>
            </Hint>
            <Hint texto="Mover a sección…">
              <Button variant="ghost" size="icon-sm" onClick={() => onMover?.([node.id])} aria-label="Mover a sección">
                <FolderInput />
              </Button>
            </Hint>
            <Hint texto={copiado ? 'Copiado' : 'Copiar ID'}>
              <Button variant="ghost" size="icon-sm" onClick={copiarId} aria-label="Copiar ID">
                {copiado ? <Check className="text-accent" /> : <Copy />}
              </Button>
            </Hint>
            <Hint texto="Cerrar · Esc">
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar detalle"><X /></Button>
            </Hint>
          </div>
        </div>
        {editando ? (
          <EditarNodo
            key={node.id}
            node={node}
            temas={temas}
            onCancelar={() => setEditando(false)}
            onGuardar={async (campos) => { await onGuardar(node.id, campos); setEditando(false); }}
          />
        ) : (
          <h2
            className="mt-1.5 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink"
            onDoubleClick={() => setEditando(true)}
            title="Doble clic para editar"
          >
            {node.label}
          </h2>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {fuente && (
            <Button variant="outline" size="sm" asChild>
              <a href={fuente} target="_blank" rel="noreferrer"><ExternalLink /> Abrir original</a>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onAsk(node)}>
            <MessageSquare /> Preguntar sobre esto
          </Button>
          {vista === 'lista' && (
            <Button variant="ghost" size="sm" onClick={onVerEnGrafo}><Share2 /> Ver en grafo</Button>
          )}
          {ego ? (
            <Button variant="outline" size="sm" onClick={onFijar} className="border-accent/50 text-accent-soft" title="Soltar el vecindario fijado · Esc">
              <PinOff /> Desfijar
            </Button>
          ) : rels.length > 0 && (
            <Button variant="outline" size="sm" onClick={onFijar} title="Fijar este documento y sus vecinos: explorás sin perder el origen">
              <Pin /> Fijar relaciones
            </Button>
          )}
          {pinnedEdge && (
            <Button variant="ghost" size="sm" onClick={onClearPin} title="Soltar el vínculo resaltado"><Unlink /> Soltar vínculo</Button>
          )}
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="preview">Vista previa</TabsTrigger>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="relaciones">
            Relaciones <span className="text-[11px] text-ink-dim">{rels.length}</span>
            {pinnedEdge && <Link2 className="size-3 text-accent" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="min-h-0 flex-1 overflow-y-auto pb-24">
          {node.desc && (
            <p className="px-4 pt-4 text-[12.5px] leading-relaxed text-ink/90">{node.desc}</p>
          )}
          {node.fragmento && node.fragmento !== node.desc && (
            <Seccion titulo="Fragmento clave">
              <blockquote className="border-l-2 border-accent/60 pl-3 text-[12.5px] leading-relaxed text-ink-muted">
                {node.fragmento}
              </blockquote>
            </Seccion>
          )}

          <Seccion titulo="Metadatos">
            <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
              <Meta k="Sección"><span className="capitalize">{node.dominio}</span></Meta>
              <Meta k="Autor">{node.autor}</Meta>
              <Meta k="Fecha">{fechaCorta(node.fecha_doc)}</Meta>
              <Meta k="Incorporado">{fechaCorta(node.created_at)}</Meta>
              <Meta k="Archivo">{node.fuente_label}</Meta>
              <Meta k="Tema">{node.tema}</Meta>
              <Meta k="Vigencia">
                {vig?.estado && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={vig.estado === 'vigente' ? 'accent' : 'warn'}>{vig.estado}</Badge>
                    {vig.version != null && <span className="text-ink-dim">v{vig.version}</span>}
                    {vig.motivo && <span className="text-ink-dim">{vig.motivo.replace(/_/g, ' ')}</span>}
                  </span>
                )}
              </Meta>
              {vig?.duplicado_de && <Meta k="Duplicado de"><span className="text-ink-dim">{vig.duplicado_de}</span></Meta>}
              <Meta k="ID"><span className="text-ink-dim">{node.id}</span></Meta>
            </dl>
          </Seccion>

          {node.conceptos?.length > 0 && (
            <Seccion titulo="Conceptos" extra={<span className="text-[11px] text-ink-dim">clic para filtrar</span>}>
              <div className="flex flex-wrap gap-1">
                {node.conceptos.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onConcepto(normalizar(c))}
                    className="flex items-center gap-0.5 rounded-xs border border-hair bg-surface-2 px-1.5 text-[11.5px] leading-[20px] text-ink-muted hover:border-hair-strong hover:text-ink"
                  >
                    <Hash className="size-2.5 text-ink-dim" />{c}
                  </button>
                ))}
              </div>
            </Seccion>
          )}

          {node.tags?.length > 0 && (
            <Seccion titulo="Tags">
              <div className="flex flex-wrap gap-1">
                {node.tags.map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
            </Seccion>
          )}

          {rels.length > 0 && (
            <Seccion
              titulo="Vínculos más fuertes"
              extra={<button type="button" onClick={() => setTab('relaciones')} className="text-[11px] text-ink-dim hover:text-ink">ver {rels.length}</button>}
            >
              <ul className="-mx-1.5">
                {rels.slice(0, 4).map((r) => {
                  const o = nodesById.get(r.otherId);
                  const fija = mismaArista(r.edge, pinnedEdge);
                  return (
                    <li key={`${r.edge.source}-${r.edge.target}`}>
                      <button
                        type="button"
                        onClick={() => onPin(r.edge)}
                        title="Fijar este vínculo en el grafo"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left',
                          fija ? 'bg-accent/[0.08]' : 'hover:bg-surface-2',
                        )}
                      >
                        {o ? <Thumb node={o} className="h-[26px] w-[22px]" iconClass="size-3" /> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{o?.label || r.otherId}</span>
                          <span className="block truncate text-[11px] text-ink-dim">{relacionLabel(r.edge.label)} · {pct(r.edge.score)}</span>
                        </span>
                        {fija && <Link2 className="size-3 shrink-0 text-accent" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Seccion>
          )}
        </TabsContent>

        <TabsContent value="relaciones" className="min-h-0 flex-1 overflow-y-auto pb-24">
          <Relaciones
            node={node}
            rels={rels}
            nodesById={nodesById}
            onAbrir={onAbrir}
            onConcepto={onConcepto}
            pinnedEdge={pinnedEdge}
            onPin={onPin}
            onClearPin={onClearPin}
          />
        </TabsContent>

        <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto">
          <Preview node={node} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
