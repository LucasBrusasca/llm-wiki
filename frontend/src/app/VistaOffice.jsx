import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const medio = (node, parte) => `/api/node/${encodeURIComponent(node.id)}/office/medio?parte=${encodeURIComponent(parte)}`;

function Runs({ runs }) {
  return runs.map((r, i) => {
    let el = r.texto;
    if (r.mono) el = <code className="rounded-xs bg-neutral-100 px-1 font-mono text-[0.92em]">{el}</code>;
    if (r.i) el = <em>{el}</em>;
    if (r.b) el = <strong className="font-semibold">{el}</strong>;
    return <React.Fragment key={i}>{el}</React.Fragment>;
  });
}

function Tabla({ filas }) {
  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className={cn(i === 0 && 'bg-neutral-100 font-medium')}>
              {f.map((c, j) => <td key={j} className="whitespace-pre-wrap border border-neutral-300 px-2 py-1 align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TITULO = { 1: 'text-[19px] mt-4', 2: 'text-[16px] mt-3.5', 3: 'text-[14.5px] mt-3', 4: 'text-[13.5px] mt-2.5' };

function Bloque({ b, node }) {
  if (b.t === 'h') return <p className={cn('mb-1 font-semibold leading-snug text-neutral-900', TITULO[b.nivel])}><Runs runs={b.runs} /></p>;
  if (b.t === 'li') {
    return (
      <p className="my-0.5 flex gap-2 leading-relaxed" style={{ paddingLeft: `${b.nivel * 18}px` }}>
        <span className="select-none text-neutral-400">•</span><span className="min-w-0"><Runs runs={b.runs} /></span>
      </p>
    );
  }
  if (b.t === 'code') return <pre className="my-0 whitespace-pre-wrap bg-neutral-50 px-2 py-0.5 font-mono text-[11.5px] leading-relaxed text-neutral-800">{b.texto}</pre>;
  if (b.t === 'tabla') return <Tabla filas={b.filas} />;
  if (b.t === 'img') return <img src={medio(node, b.src)} alt="" loading="lazy" className="my-2 max-h-[420px] max-w-full rounded-sm object-contain" />;
  if (b.t === 'aviso') return <p className="mt-3 text-[11.5px] italic text-neutral-500">{b.texto}</p>;
  return <p className="my-1.5 whitespace-pre-wrap leading-relaxed"><Runs runs={b.runs} /></p>;
}

/**
 * Word y PowerPoint legibles en el inspector: el contenido con su estructura (no una
 * miniatura estirada). Word como una hoja; PowerPoint diapositiva por diapositiva.
 */
export default function VistaOffice({ node }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    setD(null); setError(null);
    fetch(`/api/node/${encodeURIComponent(node.id)}/office`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`); return r.json(); })
      .then((x) => vivo && setD(x))
      .catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, [node.id]);

  if (error) return <p className="text-[12px] text-ink-dim">No se pudo leer el documento: {error}</p>;
  if (!d) return <p className="flex items-center gap-1.5 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo el documento…</p>;

  if (d.tipo === 'word') {
    return (
      <article className="max-h-[70vh] overflow-y-auto rounded-md bg-white px-6 py-5 text-[13px] text-neutral-800 shadow-sm">
        {d.bloques.length ? d.bloques.map((b, i) => <Bloque key={i} b={b} node={node} />)
          : <p className="text-neutral-500">El documento no tiene texto.</p>}
      </article>
    );
  }
  return (
    <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
      <p className="text-[11px] text-ink-dim">{d.total} diapositivas{d.total > d.diapositivas.length ? ` (se muestran ${d.diapositivas.length})` : ''}</p>
      {d.diapositivas.map((s) => (
        <section key={s.n} className="rounded-md bg-white px-5 py-4 text-[12.5px] text-neutral-800 shadow-sm">
          <p className="mb-1 text-[10.5px] uppercase tracking-[0.08em] text-neutral-400">Diapositiva {s.n}</p>
          {s.titulo && <p className="mb-2 text-[15px] font-semibold leading-snug text-neutral-900">{s.titulo}</p>}
          {s.bloques.filter((b) => b.t !== 'img').map((b, i) => <Bloque key={i} b={b} node={node} />)}
          {s.bloques.some((b) => b.t === 'img') && (
            <div className="mt-2 flex flex-wrap gap-2">
              {s.bloques.filter((b) => b.t === 'img').map((b, i) => (
                <img key={i} src={medio(node, b.src)} alt="" loading="lazy" className="max-h-56 max-w-full rounded-sm object-contain" />
              ))}
            </div>
          )}
          {!s.titulo && !s.bloques.length && <p className="text-neutral-400">Sin texto (sólo diseño).</p>}
        </section>
      ))}
    </div>
  );
}
