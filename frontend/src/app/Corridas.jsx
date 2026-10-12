import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCw, ChevronRight, Terminal, Bot, Search, History } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SalidaCorrida, EstadoCorrida, fechaHora } from '@/app/EjecutarArchivo';
import { fetchCorridas, fetchCorrida } from '@/lib/api';
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

/**
 * El log de la sección: cada script que se corrió y cada consulta a una base, con la
 * versión del código, quién lo propuso (vos o el agente), los datos, las horas y la
 * salida.
 */
export default function Corridas({ open, onOpenChange, seccion, onAbrirNodo, corridasKey }) {
  const [corridas, setCorridas] = useState(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(() => {
    setCargando(true);
    fetchCorridas(seccion, 60)
      .then(setCorridas)
      .catch(() => setCorridas([]))
      .finally(() => setCargando(false));
  }, [seccion]);

  useEffect(() => { if (open) cargar(); }, [open, corridasKey, cargar]);

  const abrir = (id) => { onAbrirNodo(id); onOpenChange(false); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(560px,94vw)]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><History className="size-3.5 text-accent" /> Corridas</SheetTitle>
          <SheetDescription>
            Lo que se corrió y consultó en «<span className="capitalize">{seccion}</span>»: versión del código, quién lo propuso, datos, horas y salida.
          </SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-2 hairline-b px-3.5 py-1.5 text-[11px] text-ink-dim">
          {corridas ? `${corridas.length} corridas` : ''}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={cargar} disabled={cargando}>
            <RotateCw className={cn(cargando && 'animate-spin')} /> Actualizar
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {corridas === null ? (
            <p className="flex items-center gap-1.5 px-3.5 py-4 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo el log…</p>
          ) : corridas.length ? (
            <ul>{corridas.map((r) => <Corrida key={r.id} r={r} onAbrirNodo={abrir} />)}</ul>
          ) : (
            <p className="px-3.5 py-6 text-center text-[12px] text-ink-dim">
              Todavía no se corrió nada en esta sección. Abrí un script y usá «Ejecutar…», o pedile un análisis al agente.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
