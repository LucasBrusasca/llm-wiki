import React, { useEffect, useMemo, useState } from 'react';
import {
  Play, Loader2, ShieldAlert, CheckCircle2, AlertTriangle, History, Timer, Database, Bot, FileOutput, ExternalLink, Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ejecutarArchivo, fetchEjecuciones, fetchParametros } from '@/lib/api';
import { cn } from '@/lib/utils';
import { renderMarkdown } from '@/markdown';

/** "27 sep 14:05:31": la hora importa en un log de corridas. */
export function fechaHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const duracion = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Detecta si el texto contiene tablas markdown (empieza con | y tiene separador). */
function contieneTablasMd(texto) {
  if (!texto) return false;
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length - 1; i++) {
    if (lineas[i].trimStart().startsWith('|') && /^\|[-:|]+\|/.test(lineas[i + 1].trim())) {
      return true;
    }
  }
  return false;
}

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

/**
 * Salida de una corrida: estado, versión, stdout/stderr, artefactos persistidos y lo
 * que generó (descartado si no declaró persistencia).
 */
export function SalidaCorrida({ r, versionActual, onGuardarNodo }) {
  if (!r) return null;
  const vieja = versionActual && r.version && r.version !== versionActual;
  const esMarkdown = useMemo(() => contieneTablasMd(r.stdout), [r.stdout]);
  const htmlSalida = useMemo(() => esMarkdown ? renderMarkdown(r.stdout) : null, [esMarkdown, r.stdout]);
  const artefactoHtml = (r.artifacts || []).find((a) => a.nombre.endsWith('.html'));
  const runId = r.run_id ?? r.id;

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
        {runId != null && <span className="text-ink-dim">#{runId}</span>}
      </div>
      {r.stdout ? (
        esMarkdown ? (
          <div
            className="script-output-md max-h-72 overflow-auto p-2 text-[11.5px] leading-relaxed text-ink-muted"
            dangerouslySetInnerHTML={{ __html: htmlSalida }}
          />
        ) : (
          <pre className="max-h-64 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-ink-muted">{r.stdout}</pre>
        )
      ) : (
        <p className="px-2 py-1.5 text-[11px] text-ink-dim">Sin salida estándar.</p>
      )}
      {r.stderr && (
        <pre className="max-h-40 overflow-auto border-t border-hair p-2 font-mono text-[11px] leading-relaxed text-danger">{r.stderr}</pre>
      )}
      {(r.artifacts?.length > 0 || onGuardarNodo) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-hair px-2 py-1.5 text-[11px]">
          {artefactoHtml && (
            <a
              href={`/api/runs/${runId}/artifact/${encodeURIComponent(artefactoHtml.nombre)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-accent-soft hover:underline"
            >
              <ExternalLink className="size-3" /> Abrir resultado
            </a>
          )}
          {onGuardarNodo && (
            <button
              type="button"
              onClick={() => onGuardarNodo(runId)}
              className="flex items-center gap-1 text-ink-dim hover:text-ink"
            >
              <Save className="size-3" /> Guardar como nodo
            </button>
          )}
        </div>
      )}
      {r.generados?.length > 0 && !r.artifacts?.length && (
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

const CLASE = { numerica: 'numérica', categorica: 'categórica', binaria: 'binaria', fecha: 'fecha' };
const control = 'h-7 w-full rounded-sm border border-hair bg-surface-2 px-1.5 text-[12px] text-ink focus:border-accent/60 focus:outline-none';

function valoresIniciales(params, tablas) {
  const v = {};
  for (const p of params) {
    if (p.tipo === 'tabla') v[p.nombre] = tablas.length === 1 ? tablas[0].node_id : '';
    else if (p.tipo === 'columnas') v[p.nombre] = [];
    else v[p.nombre] = p.defecto ?? '';
  }
  return v;
}

/** Lo que recibe el backend: sin vacíos, y los números como números. */
function limpiar(params, valores) {
  const out = {};
  for (const p of params) {
    const v = valores[p.nombre];
    if (v === '' || v == null || (Array.isArray(v) && !v.length)) continue;
    out[p.nombre] = p.tipo === 'numero' ? Number(v) : v;
  }
  return out;
}

/**
 * Parámetros de una herramienta (su ficha) como listas: sólo se puede elegir lo que vale.
 * Una columna sólo entre las de la tabla elegida, y de la clase que la herramienta pide.
 */
function FormularioParametros({ params, tablas, valores, onCambio }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-hair bg-surface-2/40 p-2">
      <p className="text-[10.5px] uppercase tracking-[0.08em] text-ink-dim">Parámetros</p>
      {params.map((p) => {
        const valor = valores[p.nombre];
        let campo;
        if (p.tipo === 'tabla') {
          campo = tablas.length ? (
            <select className={control} value={valor} onChange={(e) => onCambio(p, e.target.value)}>
              {!valor && <option value="">Elegí una tabla…</option>}
              {tablas.map((t) => <option key={t.node_id} value={t.node_id}>{t.label}</option>)}
            </select>
          ) : <span className="text-[11.5px] text-warn">No hay tablas en la biblioteca: subí un CSV o un Excel.</span>;
        } else if (p.tipo === 'columna' || p.tipo === 'columnas') {
          const tabla = tablas.find((t) => t.node_id === valores[p.de || 'datos']);
          const cols = (tabla?.columnas || []).filter((c) => !p.clase || c.clases.includes(p.clase));
          if (!tabla) campo = <span className="text-[11.5px] text-ink-dim">elegí primero la tabla</span>;
          else if (p.tipo === 'columna') {
            campo = (
              <select className={control} value={valor} onChange={(e) => onCambio(p, e.target.value)}>
                <option value="">{p.opcional ? '— ninguna (usa todas) —' : 'Elegí una columna…'}</option>
                {cols.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
              </select>
            );
          } else {
            campo = (
              <div className="flex flex-wrap gap-1">
                {cols.map((c) => {
                  const on = valor.includes(c.nombre);
                  return (
                    <button key={c.nombre} type="button"
                      onClick={() => onCambio(p, on ? valor.filter((x) => x !== c.nombre) : [...valor, c.nombre])}
                      className={cn('rounded-xs border px-1.5 py-px text-[11px]', on ? 'border-accent/60 bg-accent/[0.12] text-ink' : 'border-hair text-ink-dim hover:text-ink')}>
                      {c.nombre}
                    </button>
                  );
                })}
                {!valor.length && <span className="text-[11px] text-ink-dim">ninguna marcada: usa todas</span>}
              </div>
            );
          }
        } else if (p.tipo === 'opcion') {
          campo = (
            <select className={control} value={valor} onChange={(e) => onCambio(p, e.target.value)}>
              {p.opcional && <option value="">—</option>}
              {(p.opciones || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        } else {
          campo = (
            <input className={control} type={p.tipo === 'numero' ? 'number' : 'text'} value={valor}
              placeholder={p.opcional ? 'opcional' : ''} onChange={(e) => onCambio(p, e.target.value)} />
          );
        }
        const pista = [p.clase && `columna ${CLASE[p.clase] || p.clase}`, p.desc].filter(Boolean).join(' · ');
        return (
          <div key={p.nombre} className="flex items-start gap-2">
            <span className="w-24 shrink-0 pt-1 text-[11.5px] text-ink-muted" title={pista}>
              {p.nombre}{!p.opcional && <span className="text-accent"> *</span>}
            </span>
            <div className="min-w-0 flex-1">
              {campo}
              {pista && <p className="mt-0.5 text-[10.5px] text-ink-dim">{pista}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Correr el script del nodo: proponer (plan) → confirmar → correr la versión propuesta.
 * El backend lo corre en el sandbox (proceso aparte, carpeta temporal con copias de los
 * datos que el script lee, sin claves del servidor, con corte por tiempo) y cada
 * corrida queda en el log. Si es una herramienta con ficha, primero se eligen sus
 * parámetros (tabla, columnas…) de listas con los valores válidos.
 */
export default function EjecutarArchivo({ node, onCorrida }) {
  const [fase, setFase] = useState('idle');     // idle | confirmar | corriendo | listo
  const [propuesta, setPropuesta] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [previas, setPrevias] = useState({ versionActual: null, runs: [] });
  const [error, setError] = useState(null);
  const [params, setParams] = useState([]);
  const [tablas, setTablas] = useState([]);
  const [valores, setValores] = useState({});
  // ¿Sólo calcula y muestra? Entonces corre con un clic, como una consulta. Si escribe,
  // borra, usa la red o ejecuta comandos, primero se ve el plan y se confirma.
  const [analisis, setAnalisis] = useState({ efectos: [], directo: false });

  const refrescar = () => fetchEjecuciones(node.id, 6).then(setPrevias).catch(() => {});

  useEffect(() => {
    setFase('idle'); setPropuesta(null); setResultado(null); setError(null);
    setPrevias({ versionActual: null, runs: [] });
    setParams([]); setTablas([]); setValores({}); setAnalisis({ efectos: [], directo: false });
    refrescar();
    let vivo = true;
    fetchParametros(node.id).then((d) => {
      if (!vivo) return;
      setParams(d.parametros || []);
      setTablas(d.tablas || []);
      setAnalisis({ efectos: d.efectos || [], directo: !!d.directo });
      setValores(valoresIniciales(d.parametros || [], d.tablas || []));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function cambiar(p, valor) {
    setFase('idle'); setPropuesta(null);
    setValores((v) => {
      const nuevo = { ...v, [p.nombre]: valor };
      // Otra tabla: las columnas elegidas de la anterior ya no valen.
      if (p.tipo === 'tabla') {
        for (const q of params) {
          if ((q.tipo === 'columna' || q.tipo === 'columnas') && (q.de || 'datos') === p.nombre) {
            nuevo[q.nombre] = q.tipo === 'columnas' ? [] : '';
          }
        }
      }
      return nuevo;
    });
  }

  const faltan = params.filter((p) => !p.opcional && (valores[p.nombre] === '' || valores[p.nombre] == null));
  const parametros = params.length ? limpiar(params, valores) : undefined;

  async function proponer() {
    setError(null);
    if (analisis.directo) { await correr(); return; }
    try {
      setPropuesta(await ejecutarArchivo(node.id, false, { parametros }));
      setFase('confirmar');
    } catch (e) { setError(e.message); }
  }

  async function correr() {
    setFase('corriendo'); setError(null);
    try {
      const r = await ejecutarArchivo(node.id, true, { version: propuesta?.version, parametros });
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
      {params.length > 0 && (
        <FormularioParametros params={params} tablas={tablas} valores={valores} onCambio={cambiar} />
      )}
      {fase === 'confirmar' && propuesta ? (
        <PlanCorrida propuesta={propuesta} onConfirmar={correr} onCancelar={() => setFase('idle')} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={proponer} disabled={fase === 'corriendo' || faltan.length > 0}>
            {fase === 'corriendo' ? <Loader2 className="animate-spin" /> : <Play />} {analisis.directo ? 'Ejecutar' : 'Ejecutar…'}
          </Button>
          <span className={cn('text-[11px]', !analisis.directo && analisis.efectos.length ? 'text-warn' : 'text-ink-dim')}>
            {faltan.length
              ? `falta elegir: ${faltan.map((p) => p.nombre).join(', ')}`
              : analisis.directo
                ? 'sólo calcula y muestra · sandbox · queda en Corridas'
                : analisis.efectos.length
                  ? `${analisis.efectos.join(', ')}: primero muestra el plan`
                  : 'primero muestra el plan · sandbox · queda en Corridas'}
          </span>
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
