import React, { useEffect, useState } from 'react';
import { Tag, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { temaNodos } from '@/lib/api';
import { cn } from '@/lib/utils';

/** El mismo tema para varios documentos: uno de los que ya hay o uno nuevo. */
export default function TemaDialog({ open, onOpenChange, ids = [], temas, onDone }) {
  const [tema, setTema] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setTema(''); setError(null); } }, [open]);

  const existentes = [...(temas?.values() || [])].filter((t) => t.key !== 'sin-tema');

  async function aplicar(valor) {
    setEnviando(true); setError(null);
    try {
      const r = await temaNodos(ids, valor);
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
          <DialogTitle className="flex items-center gap-1.5"><Tag className="size-3.5 text-ink-dim" /> Cambiar tema</DialogTitle>
          <DialogDescription>{ids.length} {ids.length === 1 ? 'documento' : 'documentos'}</DialogDescription>
        </DialogHeader>
        <div className="p-3.5">
          {existentes.length > 0 && (
            <div className="mb-3 flex max-h-[180px] flex-wrap gap-1.5 overflow-y-auto">
              {existentes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTema(t.nombre)}
                  className={cn(
                    'flex h-6 items-center gap-1.5 rounded-xs border px-2 text-[12px] transition-colors',
                    tema === t.nombre ? 'border-accent/60 bg-accent/10 text-ink' : 'border-hair text-ink-muted hover:border-hair-strong hover:text-ink',
                  )}
                >
                  <span className="size-2 rounded-full dot-cat" style={{ '--c': t.color }} />
                  {t.nombre}
                </button>
              ))}
            </div>
          )}
          <Input
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            placeholder="o escribí uno nuevo"
            onKeyDown={(e) => e.key === 'Enter' && tema.trim() && aplicar(tema)}
            aria-label="Tema"
          />
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-hair px-3.5 py-2.5">
          <Button variant="ghost" onClick={() => aplicar('')} disabled={enviando} title="Vuelven a agruparse solos (por cluster)">
            Quitar el tema
          </Button>
          <span className="ml-auto" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="default" onClick={() => aplicar(tema)} disabled={enviando || !tema.trim()}>
            {enviando ? <Loader2 className="animate-spin" /> : <Tag />} Aplicar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
