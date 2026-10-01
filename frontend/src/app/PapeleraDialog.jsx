import React, { useEffect, useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { previaPapelera, moverAPapelera } from '@/lib/api';
import { truncar } from '@/lib/utils';

const cantidad = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const enumerar = (partes) => (partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : partes[0]);

/**
 * Confirmar antes de mandar a la papelera: qué documentos son y qué se va con ellos
 * (lo cuenta el backend sin tocar nada). Es reversible: no pide clave.
 */
export default function PapeleraDialog({ open, onOpenChange, ids = [], nodesById, onDone }) {
  const [previa, setPrevia] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !ids.length) return undefined;
    let vivo = true;
    setPrevia(null); setError(null);
    previaPapelera(ids).then((p) => vivo && setPrevia(p)).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [open, ids]);

  const nombres = ids.map((id) => nodesById.get(id)?.label || id);

  async function confirmar() {
    setEnviando(true); setError(null);
    try {
      const r = await moverAPapelera(ids);
      onDone(r);
      onOpenChange(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const conEllos = previa ? [
    previa.aristas > 0 && cantidad(previa.aristas, 'relación', 'relaciones'),
    previa.notas > 0 && cantidad(previa.notas, 'nota tuya', 'notas tuyas'),
    previa.pasajes > 0 && cantidad(previa.pasajes, 'pasaje citable', 'pasajes citables'),
  ].filter(Boolean) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(460px,94vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Trash2 className="size-3.5 text-ink-dim" /> Mover a la papelera</DialogTitle>
          <DialogDescription>
            {ids.length === 1 ? `«${truncar(nombres[0], 70)}»` : cantidad(ids.length, 'documento', 'documentos')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2.5 p-3.5 text-[12.5px] leading-relaxed">
          {ids.length > 1 && (
            <ul className="flex flex-col gap-0.5 rounded-sm border border-hair bg-surface-2/50 px-2.5 py-1.5 text-[12px] text-ink-muted">
              {nombres.slice(0, 5).map((n, i) => <li key={ids[i]} className="truncate">{n}</li>)}
              {nombres.length > 5 && <li className="text-ink-dim">y {nombres.length - 5} más</li>}
            </ul>
          )}
          {previa === null && !error ? (
            <p className="flex items-center gap-1.5 text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Viendo qué se va con {ids.length === 1 ? 'él' : 'ellos'}…</p>
          ) : previa && (
            <p className="text-ink">
              {ids.length === 1 ? 'Sale' : 'Salen'} de la biblioteca, del grafo, de la búsqueda y del agente
              {conEllos.length ? <>, junto con {enumerar(conEllos)}</> : null}.
            </p>
          )}
          {previa?.corridas > 0 && (
            <p className="text-[11.5px] text-ink-dim">
              {cantidad(previa.corridas, 'corrida queda', 'corridas quedan')} en el log, sin el vínculo hasta que lo restaures.
            </p>
          )}
          <p className="text-[11.5px] text-ink-dim">
            Se puede restaurar tal cual desde la Papelera. Nada se borra hasta que lo elimines definitivamente.
          </p>
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-hair px-3.5 py-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="danger" onClick={confirmar} disabled={enviando || (!previa && !error)}>
            {enviando ? <Loader2 className="animate-spin" /> : <Trash2 />} Mover a la papelera
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
