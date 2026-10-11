import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, X, ArrowUp, Plus, Quote, ShieldAlert, FileText, Crosshair, HelpCircle, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { askAgent, ejecutarArchivo } from '@/lib/api';
import { PlanCorrida, SalidaCorrida } from '@/app/EjecutarArchivo';
import { renderMarkdown } from '@/markdown';
import { cn, pct, truncar } from '@/lib/utils';

const claveConv = (seccion) => `algedi_fab_conv_${seccion}`;

function cargar(seccion) {
  try {
    const v = JSON.parse(localStorage.getItem(claveConv(seccion)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/** Pasajes que la respuesta realmente cita (aparece su marcador [Cn] en el texto). */
function citados(m) {
  const txt = m.text || '';
  return (m.citations || []).filter((c) => txt.includes(`[${c.marker}]`));
}

/** Qué respaldo tuvo la respuesta y qué decidió hacer el agente (contrato de conducta). */
function Evidencia({ m }) {
  const n = citados(m).length;
  const conducta = m.conducta || (m.evidenceMode === 'chunks' && n > 0 ? 'responder' : 'abstenerse');

  if (conducta === 'abstenerse' || conducta === 'pedir_aclaracion') {
    const pedir = conducta === 'pedir_aclaracion';
    return (
      <div className="flex gap-1.5 rounded-sm border border-warn/30 bg-warn/[0.08] px-2 py-1.5">
        {pedir ? <HelpCircle className="mt-px size-3.5 shrink-0 text-warn" /> : <ShieldAlert className="mt-px size-3.5 shrink-0 text-warn" />}
        <span className="text-[11.5px] leading-relaxed text-warn">
          <b>{pedir ? 'Necesito que precises' : 'Me abstengo de citar'}</b>
          {m.motivo ? <> · {m.motivo}</> : null}
        </span>
      </div>
    );
  }
  if (n > 0) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-accent-soft">
        <Quote className="size-3" /> Citada · {n} {n === 1 ? 'pasaje' : 'pasajes'} · afinidad máx {pct(m.sim)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-ink-muted">
      <FileText className="size-3" /> {m.motivo || 'Basada en resúmenes, sin cita por pasaje'} · {pct(m.sim)}
    </span>
  );
}

function Pasaje({ c, nodesById, onSelect }) {
  const nodo = nodesById.get(c.node_id);
  return (
    <li>
      <button
        type="button"
        onClick={() => nodo && onSelect(nodo.id)}
        disabled={!nodo}
        className="group flex w-full gap-2 rounded-sm border border-hair bg-surface-2 px-2 py-1.5 text-left hover:border-hair-strong disabled:cursor-default"
        title={nodo ? 'Abrir en el inspector' : 'Documento fuera de esta sección'}
      >
        <span className="shrink-0 text-[11px] font-medium text-accent-soft">{c.marker}</span>
        <span className="min-w-0">
          <span className="block truncate text-[11.5px] text-ink group-hover:underline">
            {c.label}{c.page ? ` · pág. ${c.page}` : ''}
          </span>
          <span className="line-clamp-2 text-[11px] text-ink-dim">{c.excerpt}</span>
        </span>
      </button>
    </li>
  );
}

/** Una barra fina con la probabilidad: el "por qué" de JEV, a la vista. */
function Prob({ etiqueta, p, fuerte }) {
  return (
    <li className="flex items-center gap-2 text-[11px]">
      <span className={cn('min-w-0 flex-1 truncate', fuerte ? 'text-ink' : 'text-ink-dim')}>{etiqueta}</span>
      <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-surface-3">
        <span className={cn('block h-full rounded-full', fuerte ? 'bg-accent' : 'bg-ink-dim/60')} style={{ width: `${Math.round((p || 0) * 100)}%` }} />
      </span>
      <span className="w-8 shrink-0 text-right tabular-nums text-ink-dim">{pct(p)}</span>
    </li>
  );
}

/**
 * Recibo de JEV: por qué esta herramienta (y cuáles más consideró), cómo eligió cada
 * parámetro y qué toca el script además de calcular.
 */
function Recibo({ recibo }) {
  if (!recibo) return null;
  const opciones = recibo.herramienta?.opciones || [];
  const elegida = recibo.herramienta?.eleccion;
  return (
    <details className="rounded-sm border border-hair bg-surface-2/60 px-2 py-1.5" open={false}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-ink-dim hover:text-ink">
        <Wrench className="size-3" /> Por qué esta herramienta ▸
      </summary>
      {opciones.length > 1 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {opciones.map((o) => <Prob key={o.clave} etiqueta={o.etiqueta} p={o.probabilidad} fuerte={o.clave === elegida} />)}
        </ul>
      )}
      {recibo.parametros?.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-ink-muted">
          {recibo.parametros.map((x) => (
            <li key={x.nombre}><span className="text-ink-dim">{x.nombre}</span> = <b className="font-medium text-ink">{String(x.valor)}</b> <span className="text-ink-dim">· {x.por}</span></li>
          ))}
        </ul>
      )}
      {recibo.efectos?.length > 0 && (
        <p className="mt-1.5 text-[11px] text-warn">Además de calcular: {recibo.efectos.join(', ')}.</p>
      )}
    </details>
  );
}

/**
 * Opciones de una pregunta del agente (qué herramienta, qué columna, qué tabla). Se
 * eligen tocando: la respuesta es siempre una de las opciones válidas.
 */
function Opciones({ opciones, onElegir, deshabilitado }) {
  if (!opciones?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map((o, i) => (
        <button
          key={`${o.etiqueta}-${i}`}
          type="button"
          disabled={deshabilitado}
          onClick={() => onElegir(o)}
          className="flex items-center gap-1.5 rounded-sm border border-hair-strong bg-surface-2 px-2 py-1 text-[11.5px] text-ink hover:border-accent/60 hover:bg-accent/[0.08] disabled:opacity-50"
        >
          {o.etiqueta}
          {o.probabilidad != null && <span className="text-[10.5px] tabular-nums text-ink-dim">{pct(o.probabilidad)}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Propuesta de acción del agente ("corré limpieza.py", o una necesidad para la que JEV
 * eligió una herramienta): el agente no ejecuta nada por su cuenta. Muestra el plan y el
 * recibo; la persona confirma o cancela. Lo confirmado corre en el sandbox y queda en
 * Corridas con el pedido y la decisión (la experiencia con la que JEV va a aprender).
 */
function PropuestaAccion({ accion, onCambio, onSelect }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  async function confirmar() {
    setOcupado(true); setError(null);
    try {
      const r = await ejecutarArchivo(accion.node_id, true, {
        version: accion.version,
        origen: 'agente',
        parametros: accion.parametros,
        pedido: accion.pedido,
        decision: accion.recibo ? {
          camino: accion.recibo.camino?.opciones,
          herramienta: accion.recibo.herramienta?.opciones,
          parametros: accion.recibo.parametros,
        } : undefined,
      });
      onCambio({ estado: 'ejecutada', resultado: r });
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (accion.estado === 'cancelada') {
    return <p className="text-[11.5px] text-ink-dim">Cancelada: no se ejecutó nada.</p>;
  }
  if (accion.estado === 'ejecutada') {
    return (
      <div className="flex flex-col gap-1.5">
        <SalidaCorrida r={accion.resultado} />
        <button type="button" onClick={() => onSelect(accion.node_id)} className="self-start text-[11.5px] text-accent-soft hover:underline">
          Abrir el script →
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Recibo recibo={accion.recibo} />
      <PlanCorrida
        propuesta={{ plan: accion.plan, archivo: accion.plan?.archivo }}
        titulo={<>¿Correr <b>{accion.label}</b>?</>}
        onConfirmar={confirmar}
        onCancelar={() => onCambio({ estado: 'cancelada' })}
        ocupado={ocupado}
      />
      {error && <p className="text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}

function Respuesta({ m, nodesById, onSelect, onHighlight, onAccion, onOpcion, busy }) {
  const html = useMemo(() => renderMarkdown(m.text), [m.text]);
  const usados = citados(m);
  const usadosSet = new Set(usados.map((c) => c.marker));
  const resto = (m.citations || []).filter((c) => !usadosSet.has(c.marker));
  return (
    <div className="flex flex-col gap-2">
      {m.evidenceMode && <Evidencia m={m} />}
      <div
        className="agent-md text-[12.5px] leading-relaxed text-ink/90"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {m.accion && <PropuestaAccion accion={m.accion} onCambio={onAccion} onSelect={onSelect} />}
      {!m.elegida && <Opciones opciones={m.opciones} onElegir={onOpcion} deshabilitado={busy} />}
      {usados.length > 0 && (
        <ol className="flex flex-col gap-1">
          {usados.map((c) => <Pasaje key={c.chunk_id || c.marker} c={c} nodesById={nodesById} onSelect={onSelect} />)}
        </ol>
      )}
      {resto.length > 0 && (
        <details className="group/det">
          <summary className="cursor-pointer list-none text-[11px] text-ink-dim hover:text-ink">
            {usados.length ? 'Otros pasajes recuperados' : 'Pasajes recuperados'} ({resto.length}) ▸
          </summary>
          <ol className="mt-1 flex flex-col gap-1">
            {resto.map((c) => <Pasaje key={c.chunk_id || c.marker} c={c} nodesById={nodesById} onSelect={onSelect} />)}
          </ol>
        </details>
      )}
      {m.fundamentos?.length > 0 && (
        <div className="rounded-sm border border-hair bg-surface-2/60 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">Usé estos nodos</span>
            <button
              type="button"
              onClick={() => onHighlight(m.fundamentos.map((f) => f.id))}
              className="ml-auto flex items-center gap-1 text-[11px] text-ink-dim hover:text-ink"
              title="Marcarlos en la biblioteca"
            >
              <Crosshair className="size-3" /> marcar
            </button>
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {m.fundamentos.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => nodesById.has(f.id) && onSelect(f.id)}
                  disabled={!nodesById.has(f.id)}
                  className="flex w-full items-center gap-1.5 text-left text-[11.5px] text-ink-muted hover:text-ink disabled:cursor-default disabled:opacity-60"
                  title={nodesById.has(f.id) ? 'Abrir en el inspector' : 'Está en otra sección'}
                >
                  <span className="w-8 shrink-0 text-right text-[10.5px] text-ink-dim">{pct(f.sim)}</span>
                  <span className="truncate">{f.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AgentFab({
  open, onOpenChange, seccion, context, onClearContext, nodesById, onSelect, onHighlight,
}) {
  const [msgs, setMsgs] = useState(() => cargar(seccion));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const fin = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setMsgs(cargar(seccion)); }, [seccion]);
  useEffect(() => {
    try { localStorage.setItem(claveConv(seccion), JSON.stringify(msgs.slice(-40))); } catch { /* sin storage */ }
  }, [msgs, seccion]);
  useEffect(() => { fin.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open, context]);

  async function enviar(e) {
    e?.preventDefault();
    const texto = input.trim();
    if (!texto || busy) return;
    setInput('');
    await preguntar([...msgs, { role: 'user', text: texto }]);
  }

  /** Tocar una opción de una pregunta del agente: la elección viaja tipada (`jev`). */
  async function elegirOpcion(i, opcion) {
    if (busy) return;
    const marcados = msgs.map((x, j) => (j === i ? { ...x, elegida: opcion.etiqueta } : x));
    await preguntar([...marcados, { role: 'user', text: `→ ${opcion.etiqueta}` }], opcion.jev);
  }

  async function preguntar(historial, jev) {
    setMsgs(historial);
    setBusy(true);

    const system = context
      ? `Sos el agente de Algedi. El usuario está mirando el documento "${context.label}" de la sección "${seccion}".
Descripción: ${context.desc || '(sin descripción)'}
Conceptos: ${(context.conceptos || []).join(', ') || '(ninguno)'}
Respondé en español. Citá los pasajes con su marcador cuando existan. Si la biblioteca no respalda algo, decilo.`
      : `Sos el agente de Algedi para la sección "${seccion}". Respondé en español. Citá los pasajes con su marcador cuando existan. Si la biblioteca no respalda algo, decilo en lugar de inventar.`;

    try {
      const d = await askAgent({
        system,
        messages: historial.map((m) => ({ role: m.role, content: m.text })),
        seccion,
        contextoId: context?.id,
        jev,
      });
      setMsgs((prev) => [...prev, {
        role: 'assistant',
        text: d.reply || 'Sin respuesta.',
        accion: d.accion ? { ...d.accion, estado: 'pendiente' } : null,
        opciones: d.opciones || [],
        citations: d.citations || [],
        fundamentos: d.fundamentos || [],
        evidenceMode: d.evidence_mode || (d.general_knowledge ? 'general' : null),
        conducta: d.conducta,
        motivo: d.motivo,
        sim: d.max_sim,
      }]);
    } catch {
      setMsgs((prev) => [...prev, { role: 'assistant', text: 'No pude conectar con el agente. ¿Está arriba el backend?', error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <Hint texto="Agente · cita o se abstiene" side="left">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            aria-label="Abrir agente"
            className="fixed bottom-4 right-4 z-30 grid size-11 place-items-center rounded-full border border-accent/40 bg-accent text-accent-ink shadow-lg shadow-black/50 transition-transform hover:scale-[1.04]"
          >
            <MessageSquare className="size-[18px]" />
          </button>
        </Hint>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Agente"
          className="fixed bottom-4 right-4 z-30 flex h-[min(620px,calc(100vh-80px))] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border border-hair-strong bg-surface shadow-2xl shadow-black/70"
        >
          <header className="flex h-10 shrink-0 items-center gap-2 hairline-b pl-3 pr-1.5">
            <span className="size-1.5 rounded-full bg-accent" />
            <span className="text-[12.5px] font-semibold">Agente</span>
            <span className="text-[11.5px] capitalize text-ink-dim">· {seccion}</span>
            <span className="text-[10.5px] text-ink-dim">cita o se abstiene</span>
            <div className="ml-auto flex items-center">
              <Hint texto="Nueva conversación">
                <Button variant="ghost" size="icon-sm" onClick={() => { setMsgs([]); onHighlight([]); }} aria-label="Nueva conversación"><Plus /></Button>
              </Hint>
              <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="Cerrar agente"><X /></Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {msgs.length === 0 && (
              <div className="px-1 pt-6 text-center">
                <p className="text-[13px] font-medium">Preguntale a tu biblioteca</p>
                <p className="mx-auto mt-1 max-w-[300px] text-[12px] text-ink-dim">
                  Responde citando pasajes de tus documentos. Si no hay evidencia suficiente, lo dice en vez de inventar.
                </p>
                <p className="mx-auto mt-2 max-w-[300px] text-[12px] text-ink-dim">
                  Con un dato seleccionado, pedile un análisis («¿qué explica el abandono?»): elige la herramienta y te la propone antes de correrla.
                </p>
              </div>
            )}
            <div className="flex flex-col gap-4">
              {msgs.map((m, i) => (m.role === 'user' ? (
                <div key={i} className="self-end rounded-md bg-surface-3 px-2.5 py-1.5 text-[12.5px] text-ink">{m.text}</div>
              ) : (
                <div key={i} className={cn(m.error && 'text-danger')}>
                  <Respuesta
                    m={m}
                    nodesById={nodesById}
                    onSelect={onSelect}
                    onHighlight={onHighlight}
                    onAccion={(cambios) => setMsgs((prev) => prev.map((x, j) => (j === i ? { ...x, accion: { ...x.accion, ...cambios } } : x)))}
                    onOpcion={(o) => elegirOpcion(i, o)}
                    busy={busy}
                  />
                </div>
              )))}
              {busy && (
                <div className="flex items-center gap-2 text-[12px] text-ink-dim">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Buscando evidencia…
                </div>
              )}
            </div>
            <div ref={fin} />
          </div>

          <form onSubmit={enviar} className="shrink-0 border-t border-hair p-2">
            {context && (
              <div className="mb-1.5 flex items-center gap-1.5 rounded-xs bg-surface-2 px-2 py-1 text-[11px] text-ink-muted">
                <FileText className="size-3 text-ink-dim" />
                <span className="truncate">Sobre: {truncar(context.label, 48)}</span>
                <button type="button" onClick={onClearContext} className="ml-auto text-ink-dim hover:text-ink" aria-label="Quitar contexto">
                  <X className="size-3" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) enviar(e); }}
                placeholder={context ? 'Preguntá sobre este documento…' : 'Preguntá algo a la sección…'}
                className="max-h-28 min-h-[30px] flex-1 resize-none rounded-sm border border-hair bg-surface-2 px-2 py-1.5 text-[12.5px] text-ink placeholder:text-ink-dim focus:border-accent/60 focus:outline-none"
                disabled={busy}
              />
              <Button type="submit" variant="default" size="icon" disabled={busy || !input.trim()} aria-label="Enviar">
                <ArrowUp />
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
