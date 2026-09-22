import React, { useEffect, useState } from 'react';
import { Play, Loader2, ShieldAlert, CheckCircle2, AlertTriangle, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ejecutarArchivo, fetchEjecuciones } from '@/lib/api';
import { fechaCorta } from '@/lib/utils';

function Salida({ r }) {
  if (!r) return null;
  const ok = r.status === 'completed' || r.returncode === 0;
  const out = r.outputs || r;
  return (
    <div className="overflow-hidden rounded-md border border-hair">
      <div className="flex items-center gap-1.5 hairline-b bg-surface-2 px-2 py-1 text-[11.5px]">
        {ok ? <CheckCircle2 className="size-3.5 text-ok" /> : <AlertTriangle className="size-3.5 text-danger" />}
        <span className={ok ? 'text-ink-muted' : 'text-danger'}>
          {out.timeout ? 'Cortado por tiempo' : ok ? 'Terminó bien' : `Salió con código ${out.returncode}`}
        </span>
        {r.duration_ms != null && <span className="text-ink-dim">· {r.duration_ms} ms</span>}
        {r.run_id != null && <span className="ml-auto text-ink-dim">run #{r.run_id}</span>}
      </div>
      {out.stdout ? (
        <pre className="max-h-64 overflow-auto p-2 text-[11px] leading-relaxed text-ink-muted">{out.stdout}</pre>
      ) : (
        <p className="px-2 py-1.5 text-[11px] text-ink-dim">Sin salida estándar.</p>
      )}
      {out.stderr && (
        <pre className="max-h-40 overflow-auto border-t border-hair p-2 text-[11px] leading-relaxed text-danger">{out.stderr}</pre>
      )}
    </div>
  );
}

/**
 * Ejecuta el archivo .py del nodo: proponer → confirmar → correr.
 * El backend lo corre en un proceso aparte, sin las variables de entorno del
 * servidor y con corte por tiempo. Cada corrida queda registrada.
 */
export default function EjecutarArchivo({ node }) {
  const [fase, setFase] = useState('idle');     // idle | confirmar | corriendo | listo
  const [propuesta, setPropuesta] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [previas, setPrevias] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    setFase('idle'); setPropuesta(null); setResultado(null); setError(null);
    fetchEjecuciones(node.id, 5).then(setPrevias).catch(() => setPrevias([]));
  }, [node.id]);

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
      const r = await ejecutarArchivo(node.id, true);
      setResultado(r);
      fetchEjecuciones(node.id, 5).then(setPrevias).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setFase('listo');
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {fase === 'confirmar' && propuesta ? (
        <div className="rounded-md border border-accent/40 bg-accent/[0.06] p-2.5">
          <p className="flex items-start gap-1.5 text-[12.5px] text-ink">
            <ShieldAlert className="mt-px size-3.5 shrink-0 text-accent" />
            ¿Ejecutar <b>{propuesta.archivo}</b>?
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{propuesta.message}</p>
          <div className="mt-2 flex gap-1.5">
            <Button variant="default" size="sm" onClick={correr}><Play /> Confirmar y ejecutar</Button>
            <Button variant="ghost" size="sm" onClick={() => setFase('idle')}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={proponer} disabled={fase === 'corriendo'}>
            {fase === 'corriendo' ? <Loader2 className="animate-spin" /> : <Play />} Ejecutar archivo…
          </Button>
          <span className="text-[11px] text-ink-dim">proceso aparte · sin claves del servidor · con límite de tiempo</span>
        </div>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}
      {resultado && <Salida r={resultado} />}

      {previas.length > 0 && (
        <details>
          <summary className="cursor-pointer list-none text-[11px] text-ink-dim hover:text-ink">
            <History className="mr-1 inline size-3" />Ejecuciones anteriores ({previas.length})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {previas.map((r) => (
              <li key={r.id}>
                <p className="mb-0.5 text-[11px] text-ink-dim">{fechaCorta(r.created_at)} · {r.archivo}</p>
                <Salida r={r} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
