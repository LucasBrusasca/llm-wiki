import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Loader2, RotateCw, ChevronRight, Terminal, Database, Bot, Search, Archive,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SalidaCorrida, EstadoCorrida, fechaHora } from '@/app/EjecutarArchivo';
import { fetchCorridas, fetchCorrida } from '@/lib/api';
import { iconoDe, fuenteLabel, colorTipo } from '@/lib/nodes';
import { cn } from '@/lib/utils';

/** Una fila del log. Clic → se despliega con la salida completa y el plan confirmado. */
function Corrida({ r, onAbrirNodo }) {
  const [abierta, setAbierta] = useState(false);
  const [completa, setCompleta] = useState(null);

  async function alternar() {
    const siguiente = !abierta;
    setAbierta(siguiente);
    if (siguiente && !completa) fetchCorrida(r.id).then(setCompleta).catch(() => setCompleta(r));
  }

  const detalle = completa || r;
  return (
    <li className="hairline-b">
      <button type="button" onClick={alternar} className="flex w-full items-start gap-2 px-3.5 py-2 text-left hover:bg-surface-2/60">
        <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-ink-dim transition-transform', abierta && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[12.5px]">
            {r.tipo === 'consulta' ? <Search className="size-3.5 shrink-0 text-ink-dim" /> : <Terminal className="size-3.5 shrink-0 text-ink-dim" />}
            <span className="truncate text-ink">{r.label}</span>
            {r.origen === 'agente' && <Bot className="size-3 shrink-0 text-ink-dim" title="Propuesta por el agente" />}
            <span className="ml-auto shrink-0 text-[11px] text-ink-dim">{fechaHora(r.started_at || r.created_at)}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px]">
            <EstadoCorrida r={r} />
            {r.duration_ms != null && <span className="text-ink-dim">{r.duration_ms < 1000 ? `${r.duration_ms} ms` : `${(r.duration_ms / 1000).toFixed(1)} s`}</span>}
            {r.tipo === 'script' && r.version && (
              <span
                className={cn('font-mono text-[10.5px]', r.vigente === false ? 'text-warn' : 'text-ink-dim')}
                title={r.vigente === false ? 'El script cambió desde esta corrida' : 'Versión del código que corrió'}
              >
                {r.vigente === false ? 'versión anterior' : `v ${r.version.slice(0, 7)}`}
              </span>
            )}
            {r.sql && <span className="max-w-[260px] truncate font-mono text-[10.5px] text-ink-dim">{r.sql}</span>}
          </span>
          {!abierta && (r.stdout || r.stderr) && (
            <span className={cn('mt-1 block truncate font-mono text-[10.5px]', r.stderr && r.status !== 'completed' ? 'text-danger/80' : 'text-ink-dim')}>
              {(r.status !== 'completed' && r.stderr ? r.stderr : r.stdout).split('\n').filter(Boolean).slice(-1)[0]}
            </span>
          )}
        </span>
      </button>
      {abierta && (
        <div className="flex flex-col gap-2 px-3.5 pb-3 pl-9">
          {r.node_id && (
            <button type="button" onClick={() => onAbrirNodo(r.node_id)} className="self-start text-[11.5px] text-accent-soft hover:underline">
              Abrir {r.tipo === 'consulta' ? 'los datos' : 'el script'} en el inspector →
            </button>
          )}
          {detalle.datos?.length > 0 && (
            <p className="text-[11px] text-ink-dim">Datos copiados al sandbox: {detalle.datos.map((d) => d.archivo).join(', ')}</p>
          )}
          <SalidaCorrida r={detalle} />
          {detalle.plan?.length > 0 && (
            <details className="text-[11px] text-ink-dim">
              <summary className="cursor-pointer list-none hover:text-ink">Plan que se confirmó ▸</summary>
              <ol className="mt-1 list-decimal pl-5 leading-relaxed">{detalle.plan.map((p) => <li key={p}>{p}</li>)}</ol>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

/** Script o datos en la lista: clic → se abre en el inspector (código / consulta). */
function Pieza({ n, onAbrir }) {
  const Icon = iconoDe(n);
  const resumen = (n.desc || '').split('\n').filter(Boolean).slice(-1)[0];
  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir(n.id)}
        className="flex w-full items-start gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2"
        style={{ '--c': colorTipo(n.type) }}
      >
        <Icon className="mt-0.5 size-3.5 shrink-0 text-cat" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[12.5px]">
            <span className="truncate text-ink">{n.label}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-ink-dim">{n.fuente_label || fuenteLabel(n)}</span>
          </span>
          {resumen && <span className="block truncate text-[11px] text-ink-dim">{resumen}</span>}
        </span>
      </button>
    </li>
  );
}

/**
 * Workbench de la sección: los scripts y datos que viven en el grafo y el log de
 * corridas. Crear un script lo agrega como nodo SCRIPT (archivo propio de la app);
 * correrlo o consultarlo pasa por el inspector, que muestra el plan antes de confirmar.
 */
export default function Workbench({
  open, onOpenChange, seccion, nodes, onAbrirNodo, onCrearScript, corridasKey, onRegistry,
}) {
  const [tab, setTab] = useState('scripts');
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState(null);
  const [corridas, setCorridas] = useState(null);
  const [cargando, setCargando] = useState(false);

  const scripts = useMemo(() => nodes.filter((n) => n.type === 'SCRIPT'), [nodes]);
  const datos = useMemo(() => nodes.filter((n) => n.type === 'DATOS'), [nodes]);

  const cargarCorridas = useCallback(() => {
    setCargando(true);
    fetchCorridas(seccion, 60)
      .then(setCorridas)
      .catch(() => setCorridas([]))
      .finally(() => setCargando(false));
  }, [seccion]);

  useEffect(() => { if (open && tab === 'corridas') cargarCorridas(); }, [open, tab, corridasKey, cargarCorridas]);

  async function crear(e) {
    e?.preventDefault();
    const n = nombre.trim();
    if (!n) return;
    setCreando(true); setError(null);
    try {
      await onCrearScript(n);
      setNombre('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreando(false);
    }
  }

  const abrir = (id) => { onAbrirNodo(id); onOpenChange(false); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(560px,94vw)]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Terminal className="size-3.5 text-accent" /> Workbench</SheetTitle>
          <SheetDescription>
            Scripts y datos de «<span className="capitalize">{seccion}</span>» como nodos del grafo, y el log de lo que se corrió.
          </SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="scripts">Scripts y datos <span className="text-[11px] text-ink-dim">{scripts.length + datos.length}</span></TabsTrigger>
            <TabsTrigger value="corridas">Corridas {corridas && <span className="text-[11px] text-ink-dim">{corridas.length}</span>}</TabsTrigger>
          </TabsList>

          <TabsContent value="scripts" className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-3">
            <form onSubmit={crear} className="flex gap-1.5">
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del script nuevo (ej. Limpieza de ventas)" />
              <Button type="submit" variant="default" size="md" disabled={creando || !nombre.trim()}>
                {creando ? <Loader2 className="animate-spin" /> : <Plus />} Crear
              </Button>
            </form>
            <p className="mt-1.5 text-[11px] text-ink-dim">
              Queda como nodo Script en el grafo, con una plantilla para editar. Un .py ingestado también entra así; un CSV, Excel o SQLite entra como Datos y se une al script que lo lee.
            </p>
            {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}

            <h3 className="mb-1 mt-4 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim">
              <Terminal className="size-3" /> Scripts
            </h3>
            {scripts.length ? (
              <ul className="-mx-2 flex flex-col">{scripts.map((n) => <Pieza key={n.id} n={n} onAbrir={abrir} />)}</ul>
            ) : (
              <p className="text-[12px] text-ink-dim">Todavía no hay scripts en esta sección.</p>
            )}

            <h3 className="mb-1 mt-4 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim">
              <Database className="size-3" /> Datos
            </h3>
            {datos.length ? (
              <ul className="-mx-2 flex flex-col">{datos.map((n) => <Pieza key={n.id} n={n} onAbrir={abrir} />)}</ul>
            ) : (
              <p className="text-[12px] text-ink-dim">Sin datos: ingestá un CSV, un Excel o una base SQLite.</p>
            )}
          </TabsContent>

          <TabsContent value="corridas" className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 hairline-b px-3.5 py-1.5 text-[11px] text-ink-dim">
              Cada corrida guarda la versión del código, quién la propuso, los datos, las horas y la salida.
              <Button variant="ghost" size="sm" className="ml-auto" onClick={cargarCorridas} disabled={cargando}>
                <RotateCw className={cn(cargando && 'animate-spin')} /> Actualizar
              </Button>
            </div>
            {corridas === null ? (
              <p className="flex items-center gap-1.5 px-3.5 py-4 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo el log…</p>
            ) : corridas.length ? (
              <ul>{corridas.map((r) => <Corrida key={r.id} r={r} onAbrirNodo={abrir} />)}</ul>
            ) : (
              <p className="px-3.5 py-6 text-center text-[12px] text-ink-dim">
                Todavía no se corrió nada en esta sección. Abrí un script y usá «Ejecutar…».
              </p>
            )}
          </TabsContent>
        </Tabs>

        <button
          type="button"
          onClick={onRegistry}
          className="flex h-8 shrink-0 items-center gap-1.5 border-t border-hair px-3.5 text-[11.5px] text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
          title="Scripts del registry anterior (corren dentro del servidor, no en el sandbox)"
        >
          <Archive className="size-3" /> Registry legacy de scripts
        </button>
      </SheetContent>
    </Sheet>
  );
}
