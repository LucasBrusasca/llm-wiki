import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Terminal, Play, ChevronRight, ShieldCheck, Loader2, CheckCircle2, AlertTriangle, GitBranchPlus, Sparkles, RotateCw,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  fetchScripts, fetchScriptRuns, proposeScripts, runScript, createScriptNode,
} from '@/lib/api';
import { cn, fechaCorta, truncar } from '@/lib/utils';

/** Valores iniciales a partir del JSON Schema de inputs + el contexto actual. */
function valoresIniciales(schema, { seccion, selected }) {
  const props = schema?.properties || {};
  const out = {};
  for (const [k, p] of Object.entries(props)) {
    if (k === 'seccion') out[k] = seccion;
    else if (k === 'node_ids' || (p.type === 'array' && /node/.test(k))) out[k] = selected ? [selected.id] : [];
    else if (p.default !== undefined) out[k] = p.default;
    else if (p.type === 'boolean') out[k] = false;
    else if (p.type === 'array') out[k] = [];
    else out[k] = '';
  }
  return out;
}

function Campo({ nombre, prop, valor, onChange, requerido }) {
  const etiqueta = (
    <span className="mb-1 flex items-baseline gap-1.5 text-[11.5px]">
      <span className="text-ink-muted">{nombre}</span>
      {requerido && <span className="text-accent-soft">*</span>}
      {prop.description && <span className="truncate text-ink-dim">{prop.description}</span>}
    </span>
  );
  if (prop.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        <input type="checkbox" checked={!!valor} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-accent)]" />
        {nombre} {prop.description && <span className="text-ink-dim">· {prop.description}</span>}
      </label>
    );
  }
  if (prop.type === 'array') {
    return (
      <label className="block">
        {etiqueta}
        <Input
          value={(valor || []).join(', ')}
          onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder="valores separados por coma"
        />
      </label>
    );
  }
  if (prop.type === 'object') {
    return (
      <label className="block">
        {etiqueta}
        <textarea
          rows={3}
          value={typeof valor === 'string' ? valor : JSON.stringify(valor ?? {}, null, 2)}
          onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); } }}
          className="w-full rounded-sm border border-hair bg-surface-2 px-2 py-1 text-[12px] text-ink focus:border-accent/60 focus:outline-none"
        />
      </label>
    );
  }
  return (
    <label className="block">
      {etiqueta}
      <Input
        type={prop.type === 'integer' || prop.type === 'number' ? 'number' : 'text'}
        value={valor ?? ''}
        onChange={(e) => onChange(prop.type === 'integer' ? parseInt(e.target.value, 10) || 0
          : prop.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
      />
    </label>
  );
}

function Resultado({ r }) {
  if (!r) return null;
  const ok = r.status === 'completed';
  return (
    <div className="mt-2 overflow-hidden rounded-sm border border-hair">
      <div className="flex items-center gap-1.5 hairline-b bg-surface-2 px-2 py-1 text-[11.5px]">
        {ok ? <CheckCircle2 className="size-3.5 text-accent" /> : <AlertTriangle className="size-3.5 text-danger" />}
        <span className={ok ? 'text-ink-muted' : 'text-danger'}>{ok ? 'Completado' : 'Error'}</span>
        {r.duration_ms != null && <span className="text-ink-dim">· {r.duration_ms} ms</span>}
        {r.run_id != null && <span className="ml-auto text-ink-dim">run #{r.run_id}</span>}
      </div>
      <pre className="max-h-64 overflow-auto p-2 text-[11px] leading-relaxed text-ink-muted">
        {JSON.stringify(r.outputs ?? r.error, null, 2)}
      </pre>
    </div>
  );
}

function ScriptItem({ script, seccion, selected, onChanged, onRan, sugerido }) {
  const [abierto, setAbierto] = useState(!!sugerido);
  const [valores, setValores] = useState(() => valoresIniciales(script.inputs, { seccion, selected }));
  const [fase, setFase] = useState('idle');   // idle | confirmar | corriendo | listo
  const [confirmacion, setConfirmacion] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [nodoMsg, setNodoMsg] = useState(null);

  useEffect(() => { setValores(valoresIniciales(script.inputs, { seccion, selected })); }, [script, seccion, selected]);

  const props = script.inputs?.properties || {};
  const requeridos = new Set(script.inputs?.required || []);
  const ctx = selected ? [selected.id] : [];

  async function pedirConfirmacion() {
    setResultado(null);
    try {
      const r = await runScript({ scriptId: script.id, inputs: valores, confirm: false, contextNodeIds: ctx });
      setConfirmacion(r);
      setFase('confirmar');
    } catch (e) {
      setResultado({ status: 'error', error: e.message });
    }
  }

  async function ejecutar() {
    setFase('corriendo');
    try {
      const r = await runScript({ scriptId: script.id, inputs: valores, confirm: true, contextNodeIds: ctx });
      setResultado(r);
    } catch (e) {
      setResultado({ status: 'error', error: e.message });
    } finally {
      setFase('listo');
      onRan?.();
    }
  }

  async function comoNodo() {
    try {
      const r = await createScriptNode({ scriptId: script.id, seccion, linkTo: ctx });
      setNodoMsg(`Nodo creado${r.edges_created?.length ? ' y vinculado' : ''}: ${r.node_id}`);
      onChanged();
    } catch (e) {
      setNodoMsg(`No se pudo crear: ${e.message}`);
    }
  }

  return (
    <li className="hairline-b last:border-b-0">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left hover:bg-surface-2"
      >
        <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-ink-dim transition-transform', abierto && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-ink">{script.name}</span>
            <span className="text-[11px] text-ink-dim">v{script.version}</span>
            {script.safe && <ShieldCheck className="size-3 text-ink-dim" aria-label="seguro" />}
          </span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-dim">{script.description}</span>
          {sugerido && <span className="mt-1 block text-[11px] text-accent-soft">{sugerido}</span>}
        </span>
      </button>

      {abierto && (
        <div className="px-3.5 pb-3 pl-9">
          <div className="mb-2 flex flex-wrap gap-1">
            <Badge variant="quiet" className="px-0">{script.id}</Badge>
            {(script.tags || []).map((t) => <Badge key={t}>{t}</Badge>)}
          </div>

          {Object.keys(props).length > 0 && (
            <div className="flex flex-col gap-2">
              {Object.entries(props).map(([k, p]) => (
                <Campo
                  key={k}
                  nombre={k}
                  prop={p}
                  valor={valores[k]}
                  requerido={requeridos.has(k)}
                  onChange={(v) => setValores((prev) => ({ ...prev, [k]: v }))}
                />
              ))}
            </div>
          )}

          {fase === 'confirmar' && confirmacion && (
            <div className="mt-3 rounded-sm border border-accent/30 bg-accent/5 p-2.5">
              <p className="text-[12px] text-ink">¿Ejecutar <b>{confirmacion.name || script.name}</b>?</p>
              <pre className="mt-1.5 max-h-28 overflow-auto text-[11px] text-ink-muted">{JSON.stringify(valores, null, 2)}</pre>
              <div className="mt-2 flex gap-1.5">
                <Button variant="default" size="sm" onClick={ejecutar}><Play /> Confirmar y ejecutar</Button>
                <Button variant="ghost" size="sm" onClick={() => setFase('idle')}>Cancelar</Button>
              </div>
            </div>
          )}

          {fase !== 'confirmar' && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={pedirConfirmacion} disabled={fase === 'corriendo'}>
                {fase === 'corriendo' ? <Loader2 className="animate-spin" /> : <Play />} Ejecutar…
              </Button>
              <Button variant="ghost" size="sm" onClick={comoNodo} title="Agregar el script al grafo como nodo">
                <GitBranchPlus /> {selected ? 'Agregar como nodo vinculado' : 'Agregar como nodo'}
              </Button>
            </div>
          )}
          {nodoMsg && <p className="mt-1.5 text-[11px] text-ink-dim">{nodoMsg}</p>}
          <Resultado r={resultado} />
        </div>
      )}
    </li>
  );
}

function Runs({ runs, cargando, onRecargar }) {
  const [abierto, setAbierto] = useState(null);
  if (cargando && !runs.length) return <p className="p-4 text-[12px] text-ink-dim">Cargando…</p>;
  if (!runs.length) return <p className="p-6 text-center text-[12px] text-ink-dim">Todavía no se ejecutó ningún script.</p>;
  return (
    <div>
      <div className="flex justify-end px-3.5 pt-2">
        <Button variant="ghost" size="sm" onClick={onRecargar}><RotateCw /> Actualizar</Button>
      </div>
      <ul>
        {runs.map((r) => (
          <li key={r.id} className="hairline-b">
            <button
              type="button"
              onClick={() => setAbierto((a) => (a === r.id ? null : r.id))}
              className="grid w-full grid-cols-[10px_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3.5 py-2 text-left hover:bg-surface-2"
            >
              <span className={cn('size-1.5 rounded-full', r.status === 'completed' ? 'bg-accent' : 'bg-danger')} />
              <span className="truncate text-[12px] text-ink">{r.script_id} <span className="text-ink-dim">v{r.script_version}</span></span>
              <span className="text-[11px] text-ink-dim">{r.duration_ms != null ? `${r.duration_ms} ms` : ''}</span>
              <span className="text-[11px] text-ink-dim">{fechaCorta(r.created_at)}</span>
            </button>
            {abierto === r.id && (
              <div className="px-3.5 pb-3">
                {r.context_nodes?.length > 0 && (
                  <p className="mb-1 text-[11px] text-ink-dim">Contexto: {r.context_nodes.map((c) => truncar(c, 28)).join(', ')}</p>
                )}
                <pre className="max-h-64 overflow-auto rounded-sm border border-hair bg-surface-2 p-2 text-[11px] text-ink-muted">
                  {JSON.stringify({ inputs: r.inputs, outputs: r.outputs, error: r.error_message }, null, 2)}
                </pre>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ScriptsSheet({ open, onOpenChange, seccion, selected, onChanged }) {
  const [scripts, setScripts] = useState([]);
  const [version, setVersion] = useState(null);
  const [runs, setRuns] = useState([]);
  const [propuestas, setPropuestas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const [s, r] = await Promise.all([fetchScripts(), fetchScriptRuns(30)]);
      setScripts(s.scripts); setVersion(s.version); setRuns(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { if (open) cargar(); }, [open, cargar]);

  useEffect(() => {
    if (!open || !selected) { setPropuestas([]); return; }
    proposeScripts({ query: `${selected.label} ${(selected.conceptos || []).slice(0, 5).join(' ')}`, nodeIds: [selected.id], limit: 2 })
      .then((p) => setPropuestas(p.filter((x) => x.score > 0)))
      .catch(() => setPropuestas([]));
  }, [open, selected]);

  const razon = useMemo(() => new Map(propuestas.map((p) => [p.script_id, p.reason])), [propuestas]);
  const orden = useMemo(
    () => [...scripts].sort((a, b) => (razon.has(b.id) ? 1 : 0) - (razon.has(a.id) ? 1 : 0)),
    [scripts, razon],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-1.5"><Terminal className="size-3.5 text-ink-dim" /> Scripts</SheetTitle>
          <SheetDescription>
            Registry versionado{version ? ` v${version}` : ''} · se ejecutan con confirmación y quedan registrados
            {selected && <> · contexto: <span className="text-ink-muted">{truncar(selected.label, 40)}</span></>}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="registry" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="registry">Registry <span className="text-[11px] text-ink-dim">{scripts.length}</span></TabsTrigger>
            <TabsTrigger value="runs">Ejecuciones <span className="text-[11px] text-ink-dim">{runs.length}</span></TabsTrigger>
          </TabsList>

          <TabsContent value="registry" className="min-h-0 flex-1 overflow-y-auto">
            {error && <p className="p-4 text-[12px] text-danger">No se pudo leer el registry: {error}</p>}
            {propuestas.length > 0 && (
              <p className="flex items-center gap-1.5 hairline-b px-3.5 py-2 text-[11.5px] text-ink-muted">
                <Sparkles className="size-3 text-accent-soft" /> {propuestas.length} sugerido{propuestas.length > 1 ? 's' : ''} para el documento seleccionado
              </p>
            )}
            {cargando && !scripts.length ? (
              <p className="p-4 text-[12px] text-ink-dim">Cargando…</p>
            ) : (
              <ul>
                {orden.map((s) => (
                  <ScriptItem
                    key={s.id}
                    script={s}
                    seccion={seccion}
                    selected={selected}
                    onChanged={() => { onChanged(); fetchScriptRuns(30).then(setRuns).catch(() => {}); }}
                    onRan={() => fetchScriptRuns(30).then(setRuns).catch(() => {})}
                    sugerido={razon.get(s.id)}
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="runs" className="min-h-0 flex-1 overflow-y-auto">
            <Runs runs={runs} cargando={cargando} onRecargar={cargar} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
