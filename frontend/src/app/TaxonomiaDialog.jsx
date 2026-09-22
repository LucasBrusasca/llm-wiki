import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { proponerTaxonomia, aplicarTaxonomia } from '@/lib/api';
import { pedirClave, avisarClaveIncorrecta } from '@/security.js';

/**
 * Nombres humanos para los temas, vía la taxonomía por LLM que ya tiene el backend.
 * Dos pasos a propósito: primero PROPONER (no escribe nada), después APLICAR con
 * confirmación. Aplicar reescribe `tema` en todos los documentos de todas las secciones.
 */
export default function TaxonomiaDialog({ open, onOpenChange, temas, onDone }) {
  const [fase, setFase] = useState('inicio');   // inicio | proponiendo | propuesta | aplicando | listo | error
  const [propuesta, setPropuesta] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) return;
    if (fase !== 'proponiendo' && fase !== 'aplicando') { setFase('inicio'); setPropuesta(null); setError(null); }
  }, [open, fase]);

  const automaticos = [...(temas?.values() || [])].filter((t) => t.auto);

  async function proponer() {
    setFase('proponiendo'); setError(null);
    try {
      const d = await proponerTaxonomia();
      if (!d.ok) throw new Error(d.error || 'El LLM no devolvió una taxonomía válida.');
      setPropuesta(d);
      setFase('propuesta');
    } catch (e) {
      setError(e.message); setFase('error');
    }
  }

  async function aplicar() {
    if (!window.confirm('Esto reescribe el tema de TODOS los documentos, en todas las secciones. ¿Aplicar?')) return;
    const clave = await pedirClave('aplicar la taxonomía de temas');
    if (!clave) return;
    setFase('aplicando');
    try {
      const r = await aplicarTaxonomia(clave.password);
      if (r.status === 403) { avisarClaveIncorrecta(); setFase('propuesta'); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFase('listo');
      onDone();
    } catch (e) {
      setError(e.message); setFase('error');
    }
  }

  const conteo = propuesta ? Object.entries(propuesta.conteo || {}).sort((a, b) => b[1] - a[1]) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,94vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-accent" /> Nombrar temas con IA</DialogTitle>
          <DialogDescription>El LLM propone una taxonomía legible; nada se guarda hasta que la apliques.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3.5 text-[12.5px]">
          {(fase === 'inicio' || fase === 'proponiendo') && (
            <>
              <p className="text-ink-muted">
                Hoy {automaticos.length === 1 ? 'hay 1 tema' : `hay ${automaticos.length} temas`} con nombre automático
                (sacado de los conceptos más distintivos de cada cluster):
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {automaticos.map((t) => (
                  <li key={t.key} className="flex items-center gap-2" style={{ '--c': t.color }}>
                    <span className="size-2 rounded-full dot-cat" />
                    <span className="truncate text-ink">{t.nombre}</span>
                    <span className="ml-auto text-ink-dim">{t.count}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] text-ink-dim">
                Con el modelo local puede tardar varios minutos, y mientras tanto el backend responde más lento.
              </p>
            </>
          )}

          {fase === 'propuesta' && (
            <>
              <p className="text-ink-muted">Propuesta del LLM ({conteo.length} temas):</p>
              <ul className="mt-2 flex flex-col gap-1">
                {conteo.map(([t, n]) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="truncate text-ink">{t}</span>
                    <span className="ml-auto text-ink-dim">{n}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex gap-1.5 rounded-sm border border-warn/30 bg-warn/10 p-2 text-[11.5px] text-warn">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                Aplicar reescribe el tema de todos los documentos de todas las secciones.
              </p>
            </>
          )}

          {fase === 'listo' && (
            <p className="flex items-center gap-1.5 text-ok"><CheckCircle2 className="size-4" /> Temas aplicados. La biblioteca se recarga con los nombres nuevos.</p>
          )}
          {fase === 'error' && <p className="text-danger">No se pudo: {error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hair px-3.5 py-2.5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{fase === 'listo' ? 'Cerrar' : 'Cancelar'}</Button>
          {(fase === 'inicio' || fase === 'error' || fase === 'proponiendo') && (
            <Button variant="default" onClick={proponer} disabled={fase === 'proponiendo'}>
              {fase === 'proponiendo' ? <><Loader2 className="animate-spin" /> Pensando…</> : <><Sparkles /> Proponer nombres</>}
            </Button>
          )}
          {(fase === 'propuesta' || fase === 'aplicando') && (
            <Button variant="default" onClick={aplicar} disabled={fase === 'aplicando'}>
              {fase === 'aplicando' ? <><Loader2 className="animate-spin" /> Aplicando…</> : 'Aplicar a toda la biblioteca'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
