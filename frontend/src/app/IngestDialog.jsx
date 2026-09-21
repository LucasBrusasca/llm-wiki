import React, { useEffect, useRef, useState } from 'react';
import { Upload, Link as LinkIcon, CheckCircle2, AlertTriangle, Loader2, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ingestFile, ingestUrls, ingestStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

const ACEPTA = '.pdf,.docx,.pptx,.pptm,.xlsx,.xls,.txt,.md,.html,.htm';
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a que la ingesta en curso termine. Devuelve el último estado. */
async function esperarFin(onTick, cancelado) {
  for (;;) {
    if (cancelado()) return { state: 'cancelado' };
    await espera(900);
    let st;
    try { st = await ingestStatus(); } catch { continue; }
    onTick(st);
    if (st.state !== 'processing') return st;
  }
}

export default function IngestDialog({ open, onOpenChange, seccion, onDone }) {
  const [archivos, setArchivos] = useState([]);    // [{ file, estado, msg }]
  const [urls, setUrls] = useState('');
  const [drag, setDrag] = useState(false);
  const [corriendo, setCorriendo] = useState(false);
  const [actual, setActual] = useState(null);        // estado del backend
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (open) { cancelRef.current = false; return; }
    if (!corriendo) { setArchivos([]); setUrls(''); setActual(null); setError(null); }
  }, [open, corriendo]);

  const agregar = (lista) => {
    const nuevos = [...lista].map((file) => ({ file, estado: 'pendiente', msg: '' }));
    setArchivos((prev) => [...prev, ...nuevos]);
  };

  const patch = (i, p) => setArchivos((prev) => prev.map((a, k) => (k === i ? { ...a, ...p } : a)));

  async function subirUno(fn) {
    // Si hay otra ingesta corriendo (409), esperar y reintentar.
    for (let intento = 0; intento < 60; intento++) {
      try { return await fn(); } catch (e) {
        if (!String(e.message).includes('409')) throw e;
        await esperarFin(setActual, () => cancelRef.current);
      }
    }
    throw new Error('La cola del backend no se liberó');
  }

  async function empezar() {
    setError(null);
    setCorriendo(true);
    let hubo = false;
    try {
      const pendientes = archivos.map((a, i) => ({ ...a, i })).filter((a) => a.estado === 'pendiente');
      for (let k = 0; k < pendientes.length; k++) {
        if (cancelRef.current) break;
        const { file, i } = pendientes[k];
        const ultimo = k === pendientes.length - 1 && !urls.trim();
        patch(i, { estado: 'procesando', msg: 'Subiendo…' });
        try {
          // El layout global (UMAP) se recalcula sólo al final del lote.
          await subirUno(() => ingestFile(file, seccion, { skipUmap: !ultimo }));
          const st = await esperarFin((s) => { setActual(s); patch(i, { msg: s.message }); }, () => cancelRef.current);
          patch(i, { estado: st.state === 'done' ? 'ok' : 'error', msg: st.message || '' });
          if (st.state === 'done') hubo = true;
        } catch (e) {
          patch(i, { estado: 'error', msg: e.message });
        }
      }
      if (urls.trim() && !cancelRef.current) {
        await subirUno(() => ingestUrls(urls.trim(), seccion));
        const st = await esperarFin(setActual, () => cancelRef.current);
        if (st.state === 'done') { hubo = true; setUrls(''); } else setError(st.message || 'Falló la ingesta de URLs');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCorriendo(false);
      if (hubo) onDone();
    }
  }

  const pendientes = archivos.filter((a) => a.estado === 'pendiente').length + (urls.trim() ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(600px,94vw)]">
        <DialogHeader>
          <DialogTitle>Ingestar en <span className="capitalize">{seccion}</span></DialogTitle>
          <DialogDescription>Se extrae el texto, se generan embeddings y se vincula con lo que ya está en la sección.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); agregar(e.dataTransfer.files); }}
            className={cn(
              'flex w-full flex-col items-center gap-1.5 rounded-sm border border-dashed px-4 py-7 text-center transition-colors',
              drag ? 'border-accent bg-accent/5' : 'border-hair-strong hover:border-ink-dim',
            )}
          >
            <Upload className="size-4 text-ink-dim" />
            <span className="text-[12.5px] text-ink">Soltá archivos o hacé clic para elegir</span>
            <span className="text-[11.5px] text-ink-dim">PDF · Word · PowerPoint · Excel · texto · HTML</span>
          </button>
          <input ref={inputRef} type="file" multiple accept={ACEPTA} className="hidden" onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />

          {archivos.length > 0 && (
            <ul className="mt-3 overflow-hidden rounded-sm border border-hair">
              {archivos.map((a, i) => (
                <li key={`${a.file.name}-${i}`} className="flex items-center gap-2 hairline-b px-2.5 py-1.5 last:border-b-0">
                  {a.estado === 'ok' && <CheckCircle2 className="size-3.5 shrink-0 text-accent" />}
                  {a.estado === 'error' && <AlertTriangle className="size-3.5 shrink-0 text-danger" />}
                  {a.estado === 'procesando' && <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-muted" />}
                  {a.estado === 'pendiente' && <FileText className="size-3.5 shrink-0 text-ink-dim" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink">{a.file.name}</span>
                    {a.msg && <span className="block truncate text-[11px] text-ink-dim">{a.msg}</span>}
                  </span>
                  <span className="text-[11px] text-ink-dim">{(a.file.size / 1024 / 1024).toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-4 block">
            <span className="mb-1 flex items-center gap-1.5 text-[11.5px] text-ink-muted"><LinkIcon className="size-3" /> URLs (web o YouTube), una por línea</span>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={3}
              placeholder="https://…"
              disabled={corriendo}
              className="w-full resize-y rounded-sm border border-hair bg-surface-2 px-2 py-1.5 text-[12.5px] text-ink placeholder:text-ink-dim focus:border-accent/60 focus:outline-none"
            />
          </label>

          {corriendo && actual && (
            <div className="mt-3">
              <div className="flex justify-between text-[11.5px] text-ink-muted">
                <span className="truncate">{actual.message || 'Procesando…'}</span>
                <span className="text-ink-dim">{actual.progress ?? 0}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${actual.progress ?? 5}%` }} />
              </div>
            </div>
          )}
          {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hair px-3.5 py-2.5">
          {corriendo ? (
            <Button variant="ghost" onClick={() => { cancelRef.current = true; }}>Detener después del actual</Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cerrar</Button>
          )}
          <Button variant="default" onClick={empezar} disabled={corriendo || pendientes === 0}>
            {corriendo ? <><Loader2 className="animate-spin" /> Procesando</> : <>Ingestar {pendientes > 0 ? pendientes : ''}</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
