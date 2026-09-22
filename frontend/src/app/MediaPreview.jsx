import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileQuestion, Loader2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Thumb from '@/app/Thumb';
import { cn } from '@/lib/utils';

/** Qué se puede reproducir/mostrar del nodo, mirando fuente y extensión del archivo. */
export function tipoMedia(node) {
  if (!node) return 'nada';
  const ext = (node.fuente_path || '').split('.').pop()?.toLowerCase() || '';
  const f = (node.fuente || '').toLowerCase();
  if (node.type === 'NOTA') return 'nota';
  if (ytId(node.fuente_url)) return 'youtube';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext) || f === 'audio') return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext) || f === 'imagen') return 'imagen';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'tabla';
  if (ext === 'pdf' || f === 'pdf') return 'pdf';
  if (['html', 'htm'].includes(ext) || f === 'html') return 'html';
  if (['py', 'ipynb', 'txt', 'md', 'json'].includes(ext)) return 'codigo';
  return node.fuente_path || node.fuente_url ? 'archivo' : 'nada';
}

export function ytId(url) {
  const m = (url || '').match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const archivo = (node) => `/files/${encodeURIComponent(node.id)}`;

/** Imagen con zoom (rueda o botones) y arrastre. Doble clic vuelve al encuadre. */
function VisorImagen({ node }) {
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const arrastre = useRef(null);
  const reset = () => { setZ(1); setPos({ x: 0, y: 0 }); };

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-[320px] overflow-hidden rounded-md border border-hair bg-surface-2"
        onWheel={(e) => { e.preventDefault(); setZ((v) => Math.min(6, Math.max(1, v * (e.deltaY < 0 ? 1.15 : 0.87)))); }}
        onDoubleClick={reset}
        onPointerDown={(e) => { arrastre.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (arrastre.current) setPos({ x: e.clientX - arrastre.current.x, y: e.clientY - arrastre.current.y }); }}
        onPointerUp={() => { arrastre.current = null; }}
        style={{ cursor: z > 1 ? 'grab' : 'default' }}
      >
        <img
          src={archivo(node)}
          alt={node.label}
          draggable={false}
          className="size-full object-contain transition-transform duration-75"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${z})` }}
        />
        <div className="absolute bottom-2 right-2 flex overflow-hidden rounded-sm border border-hair bg-surface/90">
          <button type="button" aria-label="Alejar" onClick={() => setZ((v) => Math.max(1, v / 1.3))} className="grid size-6 place-items-center text-ink-muted hover:text-ink"><ZoomOut className="size-3.5" /></button>
          <button type="button" aria-label="Acercar" onClick={() => setZ((v) => Math.min(6, v * 1.3))} className="grid size-6 place-items-center text-ink-muted hover:text-ink"><ZoomIn className="size-3.5" /></button>
          <button type="button" aria-label="Encuadrar" onClick={reset} className="grid size-6 place-items-center text-ink-muted hover:text-ink"><Maximize className="size-3.5" /></button>
        </div>
      </div>
      <p className="text-[11px] text-ink-dim">Rueda para acercar · arrastrá para mover · doble clic para encuadrar {z > 1 && `· ×${z.toFixed(1)}`}</p>
    </div>
  );
}

/** Código fuente del archivo (primeras líneas), para .py / .md / .json. */
function VistaCodigo({ node, max = 400 }) {
  const [texto, setTexto] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let vivo = true;
    setTexto(null); setError(null);
    fetch(archivo(node))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => vivo && setTexto(t))
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="text-[12px] text-ink-dim">No se pudo leer el archivo: {error}</p>;
  if (texto == null) return <p className="flex items-center gap-1.5 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo archivo…</p>;
  const lineas = texto.split('\n');
  return (
    <div className="overflow-hidden rounded-md border border-hair bg-surface-2">
      <pre className="max-h-[360px] overflow-auto p-2.5 text-[11.5px] leading-relaxed text-ink-muted">
        {lineas.slice(0, max).join('\n')}
      </pre>
      {lineas.length > max && (
        <p className="hairline-b border-t px-2.5 py-1 text-[11px] text-ink-dim">
          … {lineas.length - max} líneas más · abrí el original para verlas
        </p>
      )}
    </div>
  );
}

/**
 * Vista previa reproducible del documento. Cada tipo con su reproductor; si no hay
 * nada que mostrar, lo dice y ofrece abrir el original (no finge un visor).
 */
export default function MediaPreview({ node, onAbrirOriginal }) {
  const tipo = tipoMedia(node);
  const url = node.fuente_url || (node.fuente_path ? archivo(node) : null);

  const original = url && (
    <Button variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer"><ExternalLink /> Abrir original</a>
    </Button>
  );

  if (tipo === 'youtube') {
    return (
      <div className="flex flex-col gap-2">
        <div className="aspect-video overflow-hidden rounded-md border border-hair bg-black">
          <iframe
            title={node.label}
            className="size-full"
            src={`https://www.youtube-nocookie.com/embed/${ytId(node.fuente_url)}`}
            allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
        {node.desc && <p className="text-[12.5px] leading-relaxed text-ink-muted">{node.desc}</p>}
      </div>
    );
  }
  if (tipo === 'video') {
    return <video className="w-full rounded-md border border-hair bg-black" controls preload="metadata" src={archivo(node)} />;
  }
  if (tipo === 'audio') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-md border border-hair bg-surface-2 p-3">
          <Thumb node={node} className="h-[52px] w-[44px]" iconClass="size-5" />
          <audio className="w-full" controls preload="metadata" src={archivo(node)} />
        </div>
        {node.fragmento && <blockquote className="border-l-2 border-accent/60 pl-3 text-[12.5px] leading-relaxed text-ink-muted">{node.fragmento}</blockquote>}
      </div>
    );
  }
  if (tipo === 'imagen') return <VisorImagen node={node} />;
  if (tipo === 'pdf') {
    return (
      <div className="flex h-full min-h-[460px] flex-col">
        <iframe
          title={`Vista previa de ${node.label}`}
          src={`${archivo(node)}#view=FitH&toolbar=0`}
          className="min-h-0 flex-1 rounded-md border border-hair bg-white"
          loading="lazy"
        />
      </div>
    );
  }
  if (tipo === 'html') {
    return (
      <div className="flex h-full min-h-[420px] flex-col gap-2">
        {/* sandbox sin allow-scripts: es HTML de terceros ya ingerido. */}
        <iframe
          title={node.label}
          src={archivo(node)}
          sandbox=""
          className="min-h-[380px] flex-1 rounded-md border border-hair bg-white"
          loading="lazy"
        />
        <div className="flex gap-1.5">{original}</div>
      </div>
    );
  }
  if (tipo === 'codigo') {
    return (
      <div className="flex flex-col gap-2">
        <VistaCodigo node={node} />
        <div className="flex gap-1.5">{original}</div>
      </div>
    );
  }

  // Sin visor propio: miniatura si existe y camino claro al original.
  return (
    <div className="flex flex-col gap-3">
      <div className={cn('overflow-hidden rounded-md border', node.fuente_path ? 'border-hair' : 'border-dashed border-hair-strong')}>
        {node.fuente_path
          ? <Thumb node={node} eager className="aspect-[4/3] w-full" iconClass="size-8" rounded="rounded-none" />
          : (
            <p className="flex flex-col items-center gap-2 py-10 text-[12px] text-ink-dim">
              <FileQuestion className="size-5" /> Sin vista previa para este origen
            </p>
          )}
      </div>
      <div className="flex gap-1.5">
        {original || <span className="text-[11.5px] text-ink-dim">Este nodo no tiene archivo ni enlace original.</span>}
      </div>
      {node.fragmento && (
        <blockquote className="border-l-2 border-accent/60 pl-3 text-[12.5px] leading-relaxed text-ink-muted">{node.fragmento}</blockquote>
      )}
    </div>
  );
}
