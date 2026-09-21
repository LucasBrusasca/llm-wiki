import React, { useEffect, useMemo, useState } from 'react';
import {
  X, ExternalLink, MessageSquare, Share2, ArrowUpRight, ArrowDownLeft, Copy, Check,
  Hash, FileQuestion, Link2, CornerDownRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  iconoDe, tipoMeta, fuenteLabel, relacionLabel, procedenciaLabel, RELACIONES,
} from '@/lib/nodes';
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

/** Una relación: qué vínculo, con quién, por qué y de dónde salió. */
function Relacion({ item, node, other, onSelect, onConcepto }) {
  const { edge, dir } = item;
  const OtherIcon = iconoDe(other);
  const ev = edge.evidencia || {};
  const procedencia = [
    procedenciaLabel(edge),
    ev.similitud_coseno != null && `coseno ${Number(ev.similitud_coseno).toFixed(2)}`,
    ev.piso_usado != null && `piso ${Number(ev.piso_usado).toFixed(2)}`,
    ev.k_vecinos != null && `k=${ev.k_vecinos}`,
    ev.modelo_embeddings && ev.modelo_embeddings.split('-').slice(0, 2).join('-'),
  ].filter(Boolean);

  return (
    <li className="group hairline-b py-3 last:border-b-0">
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-dim">
        {dir === 'out'
          ? <ArrowUpRight className="size-3 text-ink-dim" />
          : <ArrowDownLeft className="size-3 text-ink-dim" />}
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

      <button
        type="button"
        onClick={() => other && onSelect(other.id)}
        disabled={!other}
        className="mt-1.5 flex w-full items-start gap-2 rounded-sm text-left disabled:opacity-60"
      >
        <OtherIcon className="mt-0.5 size-3.5 shrink-0 text-ink-dim group-hover:text-accent" />
        <span className="text-[12.5px] font-medium leading-snug text-ink underline-offset-2 group-hover:underline">
          {other?.label || item.otherId}
        </span>
      </button>

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
              onClick={() => onConcepto(normalizar(c))}
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

function Relaciones({ node, rels, nodesById, onSelect, onConcepto }) {
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

  return (
    <div className="px-4 pt-3">
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
      <ul className="mt-1">
        {lista.slice(0, limite).map((r) => (
          <Relacion
            key={`${r.edge.source}-${r.edge.target}-${r.edge.label}`}
            item={r}
            node={node}
            other={nodesById.get(r.otherId)}
            onSelect={onSelect}
            onConcepto={onConcepto}
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

function Preview({ node }) {
  const [thumbOk, setThumbOk] = useState(true);
  useEffect(() => setThumbOk(true), [node.id]);
  const f = (node.fuente || '').toLowerCase();
  const yt = ytId(node.fuente_url);

  if (yt) {
    return (
      <div className="p-4">
        <div className="aspect-video overflow-hidden rounded-sm border border-hair">
          <iframe title="Video" className="size-full" src={`https://www.youtube-nocookie.com/embed/${yt}`} allowFullScreen />
        </div>
      </div>
    );
  }
  if (f === 'pdf' && node.fuente_path) {
    return (
      <div className="flex h-full min-h-[480px] flex-col p-3">
        <iframe
          title={`Vista previa de ${node.label}`}
          src={`/files/${encodeURIComponent(node.id)}#view=FitH&toolbar=0`}
          className="min-h-0 flex-1 rounded-sm border border-hair bg-white"
        />
      </div>
    );
  }
  return (
    <div className="p-4">
      {node.fuente_path && thumbOk ? (
        <img
          src={`/thumb/${encodeURIComponent(node.id)}`}
          alt=""
          onError={() => setThumbOk(false)}
          className="w-full rounded-sm border border-hair bg-surface-2"
        />
      ) : (
        <div className="grid place-items-center rounded-sm border border-dashed border-hair-strong py-10 text-center text-[12px] text-ink-dim">
          <FileQuestion className="mb-2 size-5" />
          Sin vista previa embebible para este origen.
        </div>
      )}
      {node.fragmento && (
        <blockquote className="mt-4 border-l-2 border-hair-strong pl-3 text-[12.5px] leading-relaxed text-ink-muted">
          {node.fragmento}
        </blockquote>
      )}
    </div>
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

      {topConceptos.length > 0 && (
        <Seccion titulo="Conceptos recurrentes">
          <div className="flex flex-wrap gap-1">
            {topConceptos.slice(0, 12).map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onConcepto(c.key)}
                className="rounded-xs border border-hair bg-surface-2 px-1.5 text-[11.5px] leading-[20px] text-ink-muted hover:border-hair-strong hover:text-ink"
              >
                {c.label} <span className="text-ink-dim">{c.count}</span>
              </button>
            ))}
          </div>
        </Seccion>
      )}

      <Seccion titulo="Atajos">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          {[
            ['↑ ↓', 'moverse por la lista'],
            ['/', 'filtrar la biblioteca'],
            ['Ctrl K', 'buscar en todo'],
            ['1 2 3', 'Lista · Split · Grafo'],
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
  onSelect, onClose, onAsk, onConcepto, onVerEnGrafo, vista,
}) {
  const [tab, setTab] = useState('resumen');
  const [copiado, setCopiado] = useState(false);
  const rels = useMemo(() => (node ? relIndex.get(node.id) || [] : []), [node, relIndex]);

  useEffect(() => { setCopiado(false); }, [node?.id]);

  const shell = 'flex w-[360px] shrink-0 flex-col hairline-l bg-surface xl:w-[410px]';

  if (!node) {
    return (
      <aside className={shell} aria-label="Detalle">
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
    <aside className={shell} aria-label="Detalle del documento">
      <header className="shrink-0 px-4 pb-3 pt-3">
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-dim">
          <Icon className="size-3.5" />
          <span>{tipoMeta(node.type).label}</span>
          {fuenteLabel(node) && <><span>·</span><span>{fuenteLabel(node)}</span></>}
          <div className="ml-auto flex items-center">
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
        <h2 className="mt-1.5 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">{node.label}</h2>

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
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="relaciones">
            Relaciones <span className="text-[11px] text-ink-dim">{rels.length}</span>
          </TabsTrigger>
          <TabsTrigger value="preview">Vista previa</TabsTrigger>
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
                  const OI = iconoDe(o);
                  return (
                    <li key={`${r.edge.source}-${r.edge.target}`}>
                      <button
                        type="button"
                        onClick={() => o && onSelect(o.id)}
                        className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-surface-2"
                      >
                        <OI className="size-3.5 shrink-0 text-ink-dim" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{o?.label || r.otherId}</span>
                          <span className="block truncate text-[11px] text-ink-dim">{relacionLabel(r.edge.label)} · {pct(r.edge.score)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Seccion>
          )}
        </TabsContent>

        <TabsContent value="relaciones" className="min-h-0 flex-1 overflow-y-auto pb-24">
          <Relaciones node={node} rels={rels} nodesById={nodesById} onSelect={onSelect} onConcepto={onConcepto} />
        </TabsContent>

        <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto">
          <Preview node={node} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
