import React, { useEffect, useState } from 'react';
import { Loader2, Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { fetchDuplicados, resolverDuplicados, noSonDuplicados } from '@/lib/api';
import { fuenteLabel, iconoDe } from '@/lib/nodes';
import { cn } from '@/lib/utils';

const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Grupo({ g, onHecho, onAbrir }) {
  const [elegido, setElegido] = useState(g.sugerido);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);
  const descartar = g.nodos.filter((n) => n.id !== elegido).map((n) => n.id);
  const hacer = async (fn) => {
    setOcupado(true); setError(null);
    try { await fn(); onHecho(); } catch (e) { setError(e.message); setOcupado(false); }
  };
  return (
    <section className="rounded-md border border-hair p-3">
      <p className="mb-2 flex items-center gap-2 text-[12px]">
        <span className={cn('rounded-xs px-1.5 py-0.5 text-[10.5px] font-medium',
          g.fuerza === 'seguro' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn')}>
          {g.fuerza === 'seguro' ? 'Es la misma fuente' : 'Parecen el mismo'}
        </span>
        <span className="text-ink-muted">{g.motivo}</span>
      </p>
      <ul className="flex flex-col gap-1">
        {g.nodos.map((n) => {
          const Icon = iconoDe(n);
          return (
            <li key={n.id}>
              <label className={cn('flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1.5 text-[12px]',
                elegido === n.id ? 'border-accent/60 bg-accent/[0.06]' : 'border-transparent hover:bg-surface-2')}>
                <input type="radio" name={g.clave} checked={elegido === n.id} onChange={() => setElegido(n.id)} className="accent-[var(--color-accent)]" />
                <Icon className="size-3.5 shrink-0 text-ink-dim" />
                <span className="min-w-0 flex-1">
                  <button type="button" onClick={(e) => { e.preventDefault(); onAbrir?.(n.id, n.dominio); }}
                    className="block truncate text-left text-ink hover:text-accent-soft" title="Abrir">{n.label}</button>
                  <span className="text-[11px] text-ink-dim">
                    <span className="capitalize">{n.dominio}</span> · {fuenteLabel(n) || n.type} · entró el {fecha(n.created_at)} · {n.relaciones} relaciones
                  </span>
                </span>
                {elegido === n.id && <span className="shrink-0 text-[11px] text-accent-soft">se conserva</span>}
                {g.sugerido === n.id && elegido !== n.id && <span className="shrink-0 text-[11px] text-ink-dim">sugerido</span>}
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={ocupado}
          onClick={() => hacer(() => resolverDuplicados({ conservar: elegido, descartar }))}>
          {ocupado ? <Loader2 className="animate-spin" /> : <Check />} Conservar el elegido y mandar {descartar.length === 1 ? 'el otro' : `los otros ${descartar.length}`} a la papelera
        </Button>
        <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => hacer(() => noSonDuplicados(g.clave))}>
          No son duplicados
        </Button>
      </div>
    </section>
  );
}

/**
 * Revisar posibles duplicados: cada grupo con sus documentos, uno sugerido para
 * conservar (el más nuevo). Nada se borra solo: los descartados van a la papelera y sus
 * relaciones marcadas a mano pasan al que queda. «No son duplicados» no los vuelve a
 * proponer.
 */
export default function DuplicadosDialog({ open, onOpenChange, onCambio, onAbrir }) {
  const [grupos, setGrupos] = useState(null);
  const [error, setError] = useState(null);
  const cargar = () => {
    setError(null);
    fetchDuplicados().then(setGrupos).catch((e) => setError(e.message));
  };
  useEffect(() => { if (open) { setGrupos(null); cargar(); } }, [open]);
  const hecho = () => { cargar(); onCambio?.(); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] w-[min(760px,94vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Copy className="size-3.5 text-accent" /> Posibles duplicados</DialogTitle>
          <DialogDescription>
            Elegí cuál se conserva en cada grupo. Los otros van a la papelera (se pueden restaurar) y sus relaciones marcadas a mano pasan al que queda.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {!grupos && !error && <p className="flex items-center gap-1.5 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Buscando…</p>}
          {grupos && !grupos.length && <p className="py-6 text-center text-[12.5px] text-ink-dim">No hay posibles duplicados.</p>}
          {grupos && grupos.length > 0 && (
            <div className="flex flex-col gap-3">
              {grupos.map((g) => <Grupo key={g.clave} g={g} onHecho={hecho} onAbrir={(id, dom) => { onOpenChange(false); onAbrir?.(id, dom); }} />)}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
