import React, { useEffect, useState } from 'react';
import {
  Play, Loader2, ShieldAlert, CheckCircle2, AlertTriangle, History, Timer, Database, Bot, FileOutput,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ejecutarArchivo, fetchEjecuciones } from '@/lib/api';
import { cn } from '@/lib/utils';

/** "27 sep 14:05:31": la hora importa en un log de corridas. */
export function fechaHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const duracion = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Cómo terminó una corrida, en una línea. */
export function EstadoCorrida({ r, className }) {
  const ok = r.status === 'completed' || r.returncode === 0;
  const Icon = r.timeout ? Timer : ok ? CheckCircle2 : AlertTriangle;
  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      <Icon className={cn('size-3.5 shrink-0', ok ? 'text-ok' : r.timeout ? 'text-warn' : 'text-danger')} />
      <span className={ok ? 'text-ink-muted' : r.timeout ? 'text-warn' : 'text-danger'}>
        {r.timeout ? 'Cortada por tiempo' : ok ? 'Terminó bien' : r.returncode != null ? `Salió con código ${r.returncode}` : 'Falló'}
      </span>
    </span>
  );
}

/** Salida de una corrida: estado, versión, stdout/stderr y lo que generó (descartado). */
export function SalidaCorrida({ r, versionActual }) {
  if (!r) return null;
  const vieja = versionActual && r.version && r.version !== versionActual;
  return (
    <div className="overflow-hidden rounded-md border border-hair">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 hairline-b bg-surface-2 px-2 py-1 text-[11.5px]">
        <EstadoCorrida r={r} />
        {r.duration_ms != null && <span className="text-ink-dim">· {duracion(r.duration_ms)}</span>}
        {r.origen === 'agente' && (
          <span className="flex items-center gap-1 text-ink-dim"><Bot className="size-3" /> propuesta por el agente</span>
        )}
        {r.version && (
          <span className={cn('ml-auto font-mono text-[10.5px]', vieja ? 'text-warn' : 'text-ink-dim')}
            title={vieja ? 'Corrió una versión anterior del código' : 'Versión del código que corrió'}>
            {vieja ? 'versión anterior · ' : 'v '}{r.version.slice(0, 7)}
          </span>
        )}
        {(r.run_id ?? r.id) != null && <span className="text-ink-dim">#{r.run_id ?? r.id}</span>}
      </div>
      {r.stdout ? (
        <pre className="max-h-64 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-ink-muted">{r.stdout}</pre>
      ) : (
        <p className="px-2 py-1.5 text-[11px] text-ink-dim">Sin salida estándar.</p>
      )}
      {r.stderr && (
        <pre className="max-h-40 overflow-auto border-t border-hair p-2 font-mono text-[11px] leading-relaxed text-danger">{r.stderr}</pre>
      )}
      {r.generados?.length > 0 && (
        <p className="flex items-start gap-1.5 border-t border-hair px-2 py-1.5 text-[11px] text-ink-dim">
          <FileOutput className="mt-px size-3 shrink-0" />
          <span>
            Generó {r.generados.map((g) => g.archivo).join(', ')} en el sandbox (se descartó al terminar).
          </span>
        </p>
      )}
    </div>
  );
}

/** El plan de una corrida propuesta, con Confirmar / Cancelar. Nada corre sin el clic. */
export function PlanCorrida({ propuesta, onConfirmar, onCancelar, ocupado = false, titulo }) {
  const plan = propuesta?.plan;
  return (
    <div className="rounded-md border border-accent/40 bg-accent/[0.06] p-2.5">
      <p className="flex items-start gap-1.5 text-[12.5px] text-ink">
        <ShieldAlert className="mt-px size-3.5 shrink-0 text-accent" />
        <span>{titulo || <>¿Ejecutar <b>{propuesta.archivo || plan?.archivo}</b>?</>}</span>
      </p>
      {plan?.pasos ? (
        <ol className="mt-1.5 flex list-decimal flex-col gap-0.5 pl-5 text-[11.5px] leading-relaxed text-ink-muted">
          {plan.pasos.map((p) => <li key={p}>{p}</li>)}
        </ol>
      ) : (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{propuesta.message}</p>
      )}
      {plan?.datos?.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-dim">
          <Database className="size-3" /> Datos:
          {plan.datos.map((d) => (
            <span key={d.node_id} className="rounded-xs border border-hair bg-surface-2 px-1 text-ink-muted">{d.archivo}</span>
          ))}
        </p>
      )}
      {plan?.advertencia && <p className="mt-1.5 text-[11px] text-warn">{plan.advertencia}</p>}
      <div className="mt-2 flex gap-1.5">
        <Button variant="default" size="sm" onClick={onConfirmar} disabled={ocupado}>
          {ocupado ? <Loader2 className="animate-spin" /> : <Play />} Confirmar y ejecutar
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancelar} disabled={ocupado}>Cancelar</Button>
      </div>
    </div>
  );
}

/**
 * Correr el script del nodo: proponer (plan) → confirmar → correr la versión propuesta.
 * El backend lo corre en el sandbox (proceso aparte, carpeta temporal con copias de los
 * datos que el script lee, sin claves del servidor, con corte por tiempo) y cada
 * corrida queda en el log.
 */
export default function EjecutarArchivo({ node, onCorrida }) {
  const [fase, setFase] = useState('idle');     // idle | confirmar | corriendo | listo
  const [propuesta, setPropuesta] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [previas, setPrevias] = useState({ versionActual: null, runs: [] });
  const [error, setError] = useState(null);

  const refrescar = () => fetchEjecuciones(node.id, 6).then(setPrevias).catch(() => {});

  useEffect(() => {
    setFase('idle'); setPropuesta(null); setResultado(null); setError(null);
    setPrevias({ versionActual: null, runs: [] });
    refrescar();
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function proponer() {
    setError(null);
    try {
      setPropuesta(await ejecutarArchivo(node.id, false));
      setFase('confirmar');
    } catch (e) { setError(e.message); }
  }

  async function correr() {
    setFase('corriendo'); setError(null);
    try {
      const r = await ejecutarArchivo(node.id, true, { version: propuesta?.version });
      setResultado(r);
      refrescar();
      onCorrida?.(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setFase('listo');
    }
  }

  const anteriores = previas.runs.filter((r) => r.id !== resultado?.run_id);

  return (
    <div className="flex flex-col gap-2.5">
      {fase === 'confirmar' && propuesta ? (
        <PlanCorrida propuesta={propuesta} onConfirmar={correr} onCancelar={() => setFase('idle')} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={proponer} disabled={fase === 'corriendo'}>
            {fase === 'corriendo' ? <Loader2 className="animate-spin" /> : <Play />} Ejecutar…
          </Button>
          <span className="text-[11px] text-ink-dim">primero muestra el plan · sandbox · queda en Corridas</span>
        </div>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}
      {resultado && <SalidaCorrida r={resultado} versionActual={previas.versionActual} />}

      {anteriores.length > 0 && (
        <details>
          <summary className="cursor-pointer list-none text-[11px] text-ink-dim hover:text-ink">
            <History className="mr-1 inline size-3" />Corridas anteriores ({anteriores.length})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {anteriores.map((r) => (
              <li key={r.id}>
                <p className="mb-0.5 text-[11px] text-ink-dim">{fechaHora(r.started_at || r.created_at)}</p>
                <SalidaCorrida r={r} versionActual={previas.versionActual} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
