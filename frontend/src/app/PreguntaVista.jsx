import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCw, Sparkles, FileText, Globe2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchPregunta, actualizarPregunta, redactarPregunta } from '@/lib/api';
import { cn } from '@/lib/utils';

const SEMAFORO = {
  verde: { label: 'La evidencia alcanza', punto: 'bg-ok', borde: 'border-ok/40' },
  amarillo: { label: 'Evidencia parcial', punto: 'bg-warn', borde: 'border-warn/40' },
  rojo: { label: 'Sin evidencia suficiente', punto: 'bg-danger', borde: 'border-danger/40' },
};
const hora = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** La respuesta con sus [n] convertidos en marcas que llevan al fragmento citado. */
function TextoConCitas({ texto, onCita }) {
  const partes = texto.split(/(\[\d{1,2}\])/g);
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
      {partes.map((p, i) => {
        const m = /^\[(\d{1,2})\]$/.exec(p);
        return m ? (
          <button key={i} type="button" onClick={() => onCita(Number(m[1]))}
            className="mx-0.5 rounded-xs bg-accent/15 px-1 align-baseline text-[11px] font-medium text-accent-soft hover:bg-accent/25">
            {m[1]}
          </button>
        ) : <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </p>
  );
}

function Pasaje({ p, n, citado, umbral, onAbrir }) {
  const [abierto, setAbierto] = useState(false);
  const responde = p.sim >= umbral;
  const largo = p.texto.length > 320;
  return (
    <li id={`pasaje-${p.chunk_id}`} className={cn('rounded-md border bg-surface-2/50 p-2.5', citado ? 'border-accent/50' : 'border-hair')}>
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px]">
        {n != null && <span className="grid size-4 shrink-0 place-items-center rounded-xs bg-accent/15 text-[10.5px] font-medium text-accent-soft">{n}</span>}
        <button type="button" onClick={() => onAbrir?.(p.node_id)} className="flex min-w-0 items-center gap-1 text-ink hover:text-accent-soft" title="Abrir el documento">
          <FileText className="size-3 shrink-0 text-ink-dim" />
          <span className="truncate">{p.label}</span>
        </button>
        {p.page ? <span className="shrink-0 text-ink-dim">· pág. {p.page}</span> : null}
        <span className={cn('ml-auto shrink-0 rounded-xs px-1.5 text-[10.5px]', responde ? 'bg-ok/15 text-ok' : 'bg-surface-3 text-ink-dim')}
          title="Qué tan directamente responde este fragmento a la pregunta">
          {responde ? 'responde' : 'relacionado'}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-muted">
        {abierto || !largo ? p.texto : `${p.texto.slice(0, 320)}…`}
      </p>
      {largo && (
        <button type="button" onClick={() => setAbierto((a) => !a)} className="mt-0.5 text-[11px] text-ink-dim hover:text-ink">
          {abierto ? 'ver menos' : 'ver más'}
        </button>
      )}
    </li>
  );
}

/**
 * Un nodo «Pregunta» en el inspector: la evidencia que la responde (fragmentos de tus
 * documentos con su página), el semáforo de suficiencia y, sólo si se pide, la
 * respuesta redactada por el LLM con citas que llevan a cada fragmento.
 */
export default function PreguntaVista({ node, onAbrir }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);   // 'actualizando' | 'redactando'

  const cargar = useCallback(() => {
    setError(null);
    fetchPregunta(node.id).then(setD).catch((e) => setError(e.message));
  }, [node.id]);
  useEffect(() => { setD(null); cargar(); }, [cargar]);

  const accion = async (cual, fn) => {
    setOcupado(cual); setError(null);
    try { setD(await fn()); } catch (e) { setError(e.message); } finally { setOcupado(null); }
  };

  if (error && !d) return <p className="m-4 text-[12px] text-danger">{error}</p>;
  if (!d) return <p className="flex items-center gap-1.5 p-4 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo la pregunta…</p>;

  const q = d.pregunta;
  const sem = SEMAFORO[q.semaforo?.color] || SEMAFORO.rojo;
  const todas = q.alcance === '*';
  const resp = q.respuesta;
  const fuentes = resp?.fuentes || [];
  const numero = (chunkId) => { const i = fuentes.indexOf(chunkId); return i >= 0 ? i + 1 : null; };
  const irACita = (n) => document.getElementById(`pasaje-${fuentes[n - 1]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div className="flex flex-col gap-3 p-4 pb-6">
      <div className={cn('rounded-md border bg-surface-2/40 p-2.5', sem.borde)}>
        <p className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          <span className={cn('size-2.5 rounded-full', sem.punto)} /> {sem.label}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-muted">{q.semaforo?.motivo}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-dim">
          <span className="flex items-center gap-1"><Globe2 className="size-3" /> Busca {todas ? 'en todas las secciones' : <>en <b className="font-medium capitalize text-ink-muted">{q.alcance}</b></>}</span>
          <button type="button" disabled={!!ocupado}
            onClick={() => accion('actualizando', () => actualizarPregunta(node.id, todas ? (node.dominio || 'personal') : '*'))}
            className="rounded-xs border border-hair-strong px-1.5 py-0.5 hover:border-accent/60 hover:text-ink disabled:opacity-50">
            {todas ? `Sólo en ${node.dominio || 'su sección'}` : 'Buscar en todas'}
          </button>
          <span className="ml-auto">actualizada {hora(q.corrida)}</span>
        </div>
      </div>

      {d.documentos_nuevos > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/[0.06] px-2.5 py-1.5 text-[12px] text-ink">
          <AlertTriangle className="size-3.5 shrink-0 text-warn" />
          Entraron {d.documentos_nuevos} {d.documentos_nuevos === 1 ? 'documento nuevo' : 'documentos nuevos'} desde la última vez.
          <Button variant="outline" size="sm" className="ml-auto" disabled={!!ocupado}
            onClick={() => accion('actualizando', () => actualizarPregunta(node.id))}>
            <RotateCw /> Actualizar
          </Button>
        </div>
      )}

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim">Respuesta</h3>
          {resp && !ocupado && (
            <button type="button" onClick={() => accion('redactando', () => redactarPregunta(node.id))}
              className="text-[11px] text-ink-dim hover:text-ink">volver a redactar</button>
          )}
        </div>
        {ocupado === 'redactando' ? (
          <p className="flex items-center gap-1.5 rounded-md border border-hair p-3 text-[12px] text-ink-muted">
            <Loader2 className="size-3.5 animate-spin" /> Redactando con el LLM local… tarda unos minutos. Podés seguir usando Algedi.
          </p>
        ) : resp ? (
          <div className="rounded-md border border-hair p-3">
            {resp.desactualizada && (
              <p className="mb-2 text-[11.5px] text-warn">La evidencia cambió desde que se redactó: conviene volver a redactarla.</p>
            )}
            <TextoConCitas texto={resp.texto} onCita={irACita} />
            <p className="mt-2 text-[10.5px] text-ink-dim">Redactada {hora(resp.fecha)}{resp.segundos ? ` · ${resp.segundos} s` : ''}{resp.modelo ? ` · ${resp.modelo}` : ''} · sólo con los fragmentos de abajo</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-hair-strong p-3">
            <Button variant="outline" size="sm" disabled={!q.pasajes?.length || !!ocupado}
              onClick={() => accion('redactando', () => redactarPregunta(node.id))}>
              <Sparkles /> Redactar respuesta
            </Button>
            <span className="text-[11.5px] text-ink-dim">Usa el LLM local con la evidencia de abajo: tarda unos minutos.</span>
          </div>
        )}
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim">Evidencia · {q.pasajes?.length || 0} fragmentos</h3>
          <button type="button" disabled={!!ocupado} onClick={() => accion('actualizando', () => actualizarPregunta(node.id))}
            className="flex items-center gap-1 text-[11px] text-ink-dim hover:text-ink disabled:opacity-50">
            {ocupado === 'actualizando' ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />} Actualizar
          </button>
        </div>
        {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}
        {q.pasajes?.length ? (
          <ul className="flex flex-col gap-2">
            {q.pasajes.map((p) => (
              <Pasaje key={p.chunk_id} p={p} n={numero(p.chunk_id)} citado={numero(p.chunk_id) != null}
                umbral={d.umbral_cita} onAbrir={onAbrir} />
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-hair-strong p-3">
            <p className="text-[12px] text-ink">No encontré una fuente que respalde esto.</p>
            <p className="mt-1 text-[11px] text-ink-dim">Eso no prueba que no exista. Probá «Buscar en todas» o agregá más documentos a tu biblioteca.</p>
          </div>
        )}
      </section>
    </div>
  );
}
