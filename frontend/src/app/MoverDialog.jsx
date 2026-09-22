import React, { useEffect, useState } from 'react';
import { FolderInput, Loader2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { moveNodes } from '@/lib/api';
import { cn, truncar } from '@/lib/utils';

/** Mover uno o varios documentos a otra sección (existente o nueva). */
export default function MoverDialog({ open, onOpenChange, ids = [], nodesById, sections, seccion, onDone }) {
  const [destino, setDestino] = useState('');
  const [nueva, setNueva] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setDestino(''); setNueva(''); setError(null); } }, [open]);

  const otras = sections.filter((s) => s.nombre !== seccion);
  const elegido = nueva.trim() || destino;
  const uno = ids.length === 1 ? nodesById.get(ids[0]) : null;

  async function mover() {
    if (!elegido) return;
    setEnviando(true); setError(null);
    try {
      const r = await moveNodes(ids, elegido);
      onDone(r);
      onOpenChange(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,94vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><FolderInput className="size-3.5 text-ink-dim" /> Mover a sección</DialogTitle>
          <DialogDescription>
            {uno ? `«${truncar(uno.label, 60)}»` : `${ids.length} documentos`} · desde <span className="capitalize">{seccion}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="p-3.5">
          {otras.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1">
              {otras.map((s) => (
                <li key={s.nombre}>
                  <button
                    type="button"
                    onClick={() => { setDestino(s.nombre); setNueva(''); }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-sm border px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                      destino === s.nombre && !nueva.trim() ? 'border-accent/60 bg-accent/10 text-ink' : 'border-hair text-ink-muted hover:border-hair-strong hover:text-ink',
                    )}
                  >
                    <span className="capitalize">{s.nombre}</span>
                    <span className="text-[11px] text-ink-dim">{s.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[11.5px] text-ink-muted"><Plus className="size-3" /> o una sección nueva</span>
            <Input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="p. ej. finanzas" onKeyDown={(e) => e.key === 'Enter' && mover()} />
          </label>
          <p className="mt-3 text-[11.5px] text-ink-dim">
            Los vínculos con documentos que quedan en otra sección se conservan, pero cada sección muestra sólo los suyos.
          </p>
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-hair px-3.5 py-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="default" onClick={mover} disabled={!elegido || enviando}>
            {enviando ? <Loader2 className="animate-spin" /> : <FolderInput />} Mover{elegido ? ` a «${elegido}»` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
