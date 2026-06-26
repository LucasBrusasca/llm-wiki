import React, { useRef, useEffect, useState, useCallback } from 'react';
import { clusterColor, ytId } from '../App.jsx';

const CYAN = '#00d4ff';

/* ── Helpers de tipo de medio ── */
function fileExt(node) {
  const s = node.fuente_path || node.fuente_label || node.fuente_url || '';
  const m = String(s).toLowerCase().match(/\.([a-z0-9]+)(?:$|\?|#)/);
  return m ? m[1] : '';
}
function mediaKind(node) {
  if (node.fuente === 'youtube') return 'youtube';
  const e = fileExt(node);
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'].includes(e) || node.fuente === 'video') return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(e) || node.fuente === 'audio') return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(e) || node.fuente === 'image') return 'image';
  if (node.fuente === 'pdf' || node.fuente === 'tesis' || e === 'pdf') return 'pdf';
  if (node.fuente === 'excel' || ['xlsx', 'xls', 'csv'].includes(e)) return 'excel';
  if (node.fuente === 'html' || ['html', 'htm'].includes(e)) return 'html';
  return 'text';
}
function fileUrl(node) {
  return node.fuente_path ? `/files/${encodeURIComponent(node.id)}` : null;
}

function ExcelPreview({ path }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetch(`/excel-preview?p=${encodeURIComponent(path)}`)
      .then(r => r.json()).then(d => setRows(d.rows)).catch(() => setRows([]));
  }, [path]);
  if (rows === null) return <div className="preview-loading">CARGANDO…</div>;
  if (!rows.length)  return <div className="preview-loading">SIN DATOS</div>;
  return (
    <div className="excel-table-wrap">
      <table className="excel-table">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── AUDIO INTERCEPT: onda real (WebAudio) con fallback sintético ── */
function AudioIntercept({ src }) {
  const canvasRef = useRef(null);
  const peaksRef  = useRef(null);

  const draw = useCallback((data) => {
    const cv = canvasRef.current; if (!cv || !data) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    // línea media
    ctx.strokeStyle = 'rgba(0,212,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    const n = data.length, bw = W / n;
    ctx.fillStyle = 'rgba(0,212,255,0.9)';
    for (let i = 0; i < n; i++) {
      const h = Math.max(1, data[i] * H * 0.92);
      ctx.fillRect(i * bw + 0.5, (H - h) / 2, Math.max(1, bw - 1.2), h);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const synth = () => Array.from({ length: 110 }, (_, i) =>
      0.15 + 0.85 * Math.abs(Math.sin(i * 0.42)) * (0.5 + 0.5 * Math.abs(Math.sin(i * 0.13))));
    (async () => {
      try {
        const res = await fetch(src);
        const buf = await res.arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const audioBuf = await ac.decodeAudioData(buf);
        const ch = audioBuf.getChannelData(0);
        const N = 110, block = Math.max(1, Math.floor(ch.length / N));
        const arr = []; let max = 0;
        for (let i = 0; i < N; i++) {
          let peak = 0;
          for (let j = 0; j < block; j++) { const v = Math.abs(ch[i * block + j] || 0); if (v > peak) peak = v; }
          arr.push(peak); if (peak > max) max = peak;
        }
        ac.close();
        const norm = arr.map(v => (max > 0 ? v / max : 0));
        if (!cancelled) { peaksRef.current = norm; draw(norm); }
      } catch {
        if (!cancelled) { const s = synth(); peaksRef.current = s; draw(s); }
      }
    })();
    return () => { cancelled = true; };
  }, [src, draw]);

  return (
    <div className="poi-audio">
      <div className="poi-audio-head">▶ AUDIO INTERCEPT</div>
      <canvas ref={canvasRef} width={540} height={92} className="poi-wave" />
      <audio controls src={src} className="poi-audio-el" />
    </div>
  );
}

function FragmentFallback({ node }) {
  const txt = (node.fragmento || node.desc || 'SIN CONTENIDO ARCHIVADO').toString();
  return (
    <div className="poi-fragment">
      <div className="poi-fragment-head">▟ ARCHIVE FRAGMENT · NO FILE</div>
      <div className="poi-fragment-body">{txt}</div>
    </div>
  );
}

function RichPreviewModal({ node, html, onClose }) {
  const srcUrl = node.fuente_url || (node.fuente_path ? `/files/${encodeURIComponent(node.id)}` : null);
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(3,6,12,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '90vw', maxWidth: 1100, height: '90vh', background: '#f5f1e8',
        borderRadius: 5, border: '1px solid rgba(0,212,255,0.35)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 0 60px rgba(0,212,255,0.12)' }}>
        <div style={{ padding: '10px 16px', background: '#060b16', flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: '1px solid rgba(0,212,255,0.25)' }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10,
            color: '#00d4ff', letterSpacing: 2 }}>
            ✦ APUNTE IA · {node.label.slice(0, 55)}{node.label.length > 55 ? '…' : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {srcUrl && (
              <button onClick={() => window.open(srcUrl, '_blank')}
                style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: 2,
                  padding: '4px 10px', background: 'transparent',
                  border: '1px solid rgba(0,212,255,0.4)', color: '#00d4ff', cursor: 'pointer', borderRadius: 2 }}>
                → FUENTE ORIGINAL
              </button>
            )}
            <button onClick={onClose}
              style={{ fontFamily: "'Courier New', monospace", fontSize: 12, padding: '4px 10px',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
                color: '#ccc', cursor: 'pointer', borderRadius: 2 }}>
              ✕
            </button>
          </div>
        </div>
        <iframe srcDoc={html} title={`Apunte: ${node.label}`}
          sandbox="allow-same-origin allow-scripts"
          style={{ flex: 1, border: 'none', background: '#f5f1e8' }} />
      </div>
    </div>
  );
}

function ContentPreview({ node }) {
  const kind = mediaKind(node);
  const url  = fileUrl(node);
  // url externa (web) o ruta /doc legada como respaldo si no hay /files
  const docUrl = node.fuente_path ? `/doc?p=${encodeURIComponent(node.fuente_path)}` : null;
  const src = url || node.fuente_url || docUrl;

  if (kind === 'youtube' && node.fuente_url) {
    const vid = ytId(node.fuente_url);
    // Miniatura + ▶ que abre en YouTube. Evita el cartel feo de "video no disponible"
    // de los videos con embed bloqueado por el dueño (y para los demás, igual los abre).
    if (vid) return (
      <a className="poi-yt-thumb" href={node.fuente_url} target="_blank" rel="noreferrer"
         title="Abrir en YouTube">
        <img src={`https://img.youtube.com/vi/${vid}/hqdefault.jpg`} alt={node.label}
             onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
        <span className="poi-yt-play" aria-hidden="true">▶</span>
      </a>
    );
  }

  if (kind === 'video' && src) {
    return <video controls src={src} className="poi-media-frame" style={{ background: '#000' }} />;
  }

  if (kind === 'audio' && src) {
    return <AudioIntercept src={src} />;
  }

  if (kind === 'image' && src) {
    return <img src={src} alt={node.label} className="poi-media-img" />;
  }

  if (kind === 'excel' && node.fuente_path) {
    return <ExcelPreview path={node.fuente_path} />;
  }

  if ((kind === 'pdf' || kind === 'html') && src) {
    // #toolbar=0 → oculta la barra gris del visor de PDF (ganamos espacio).
    return (
      <iframe
        src={kind === 'pdf' ? `${src}#toolbar=0&navpanes=0&view=FitH` : src}
        title="Preview"
        className="poi-media-frame"
        style={{ background: '#fff' }}
      />
    );
  }

  return <FragmentFallback node={node} />;
}

const FUENTE_ICONS = {
  youtube: '▶ YOUTUBE', pdf: '⬡ PDF', tesis: '⬡ TESIS',
  excel: '⊞ EXCEL', audio: '♫ AUDIO', html: '◈ WEB',
  word: '⬡ WORD', ppt: '◳ PPT', concepto: '◈ CONCEPTO', video: '▶ VIDEO', image: '▣ IMAGEN',
};

const MIN_W = 320, MIN_H = 220, DEFAULT_W = 600;

export default function NodePanel({
  node, allNodes, allLinks, onClose, onOpenAgent, onOpenReport, onNavigate, onDelete,
  onFocus, initialPos, containerRef,
}) {
  const color    = CYAN;
  const isMobile = window.innerWidth < 900;

  const isDragging = useRef(false);
  const resizing   = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const internalRef = useRef(null);
  const panelRef   = containerRef || internalRef; // compartido con el conector

  const [pos,  setPos]  = useState(initialPos || { x: 60, y: 80 });
  const [size, setSize] = useState({ w: null, h: null });

  // Apunte IA (rich-preview)
  const [richHtml, setRichHtml]       = useState(null);
  const [loadingRich, setLoadingRich] = useState(false);
  const [showRich, setShowRich]       = useState(false);
  const kind = mediaKind(node);
  const canRich = (kind === 'pdf' || kind === 'html');
  const loadRich = useCallback(async () => {
    if (richHtml) { setShowRich(true); return; }
    setLoadingRich(true);
    try {
      const r = await fetch(`/api/node/${node.id}/rich-preview`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      setRichHtml(html); setShowRich(true);
    } catch (e) { console.error('Rich preview error:', e); }
    finally { setLoadingRich(false); }
  }, [node.id, richHtml]);

  const onMouseDownDrag = useCallback(e => {
    if (isMobile) return;
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos, isMobile]);

  const onResizeStart = useCallback((e, edge) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = panelRef.current.getBoundingClientRect();
    resizing.current = { edge, startX: e.clientX, startY: e.clientY,
      startW: rect.width, startH: rect.height, startLeft: rect.left };
  }, [panelRef]);

  useEffect(() => {
    const onMove = e => {
      if (isDragging.current) {
        const vw = window.innerWidth, vh = window.innerHeight;
        const pw = panelRef.current?.offsetWidth  || DEFAULT_W;
        const ph = panelRef.current?.offsetHeight || 400;
        setPos({
          x: Math.min(Math.max(e.clientX - dragOffset.current.x, 0), vw - pw),
          y: Math.min(Math.max(e.clientY - dragOffset.current.y, 0), vh - ph),
        });
        return;
      }
      if (resizing.current) {
        const { edge, startX, startY, startW, startH, startLeft } = resizing.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (edge === 'right') {
          setSize(s => ({ ...s, w: Math.max(MIN_W, startW + dx) }));
        } else if (edge === 'left') {
          const newW = Math.max(MIN_W, startW - dx);
          setPos(p => ({ ...p, x: startLeft + (startW - newW) }));
          setSize(s => ({ ...s, w: newW }));
        } else if (edge === 'bottom') {
          setSize(s => ({ ...s, h: Math.max(MIN_H, startH + dy) }));
        }
      }
    };
    const onUp = () => { isDragging.current = false; resizing.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',  onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [panelRef]);

  const connected = allLinks
    .filter(l => {
      const s = l.source?.id ?? l.source, t = l.target?.id ?? l.target;
      return s === node.id || t === node.id;
    })
    .map(l => {
      const s = l.source?.id ?? l.source;
      const otherId = s === node.id ? (l.target?.id ?? l.target) : s;
      return allNodes.find(n => n.id === otherId);
    }).filter(Boolean);

  const currentW = size.w || (isMobile ? window.innerWidth : DEFAULT_W);
  const isTwoCol = !isMobile && currentW >= 500;

  const panelStyle = isMobile ? {} : {
    left: pos.x, top: pos.y,
    ...(size.w ? { width: size.w } : {}),
    ...(size.h ? { height: size.h, maxHeight: 'none' } : {}),
  };

  const url = fileUrl(node);
  const openLarge = () => {
    const target = url || node.fuente_url || (node.fuente_path ? `/doc?p=${encodeURIComponent(node.fuente_path)}` : null);
    if (target) window.open(target, '_blank');
  };
  const hasFile = Boolean(url || node.fuente_url);

  return (
    <aside
      ref={panelRef}
      className={`node-tooltip poi-panel${isMobile ? ' mobile' : ''}${isTwoCol ? ' two-col' : ''}`}
      style={panelStyle}
    >
      {/* Resize handles */}
      {!isMobile && <>
        <div className="rh rh--left"   onMouseDown={e => onResizeStart(e, 'left')} />
        <div className="rh rh--right"  onMouseDown={e => onResizeStart(e, 'right')} />
        <div className="rh rh--bottom" onMouseDown={e => onResizeStart(e, 'bottom')} />
      </>}

      {/* Header técnico mono (estilo etiqueta clasificada) */}
      <div className="tooltip-header poi-header" onMouseDown={onMouseDownDrag}
        style={{ cursor: isMobile ? 'default' : 'grab' }}>
        <div className="poi-header-l">
          <span className="poi-tag">{(FUENTE_ICONS[node.fuente] || '◈ CONCEPTO')}</span>
          <span className="poi-title">{node.label}</span>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="poi-stripes" />
      <div className="poi-status">
        <span className="poi-status-blink">●</span> SEARCHING ARCHIVES · NODE {String(node.id).slice(0, 20)}
      </div>

      {/* Body */}
      <div className={`tooltip-body${isTwoCol ? ' tooltip-body-grid' : ''}`}>

        <div className="tooltip-col-left">
          {/* Preview redimensionable: arrastrá la esquina inferior-derecha. */}
          <div className="poi-preview">
            <ContentPreview node={node} />
            {hasFile && (
              <button className="poi-expand" title="Abrir en grande" onClick={openLarge}>⤢</button>
            )}
          </div>
          {showRich && richHtml && (
            <RichPreviewModal node={node} html={richHtml} onClose={() => setShowRich(false)} />
          )}
          {canRich && (
            <button className="btn-secondary poi-btn" onClick={loadRich} disabled={loadingRich}>
              {loadingRich ? '⟳ GENERANDO APUNTE…' : '✦ APUNTE IA'}
            </button>
          )}
          {onFocus && (
            <button className="btn-secondary poi-btn" onClick={onFocus} title="Acercar la cámara a este nodo y destacarlo">
              ⌖ ENFOCAR EN EL GRAFO
            </button>
          )}
        </div>

        <div className="tooltip-col-right">
          {node.autor && (
            <p className="panel-autor">
              {node.fuente === 'youtube' ? '▶ Canal: ' : '✎ Autor: '}{node.autor}
            </p>
          )}
          {node.desc && <p className="panel-desc">{node.desc}</p>}

          {node.fragmento && (
            <blockquote className="panel-quote">
              "{node.fragmento.replace(/^["""''\s]+|["""''\s]+$/g, '')}"
            </blockquote>
          )}

          {node.conceptos?.length > 0 && (
            <section>
              <div className="panel-section-label">CONCEPTOS</div>
              <div className="panel-tags">
                {node.conceptos.map(c => (
                  <span key={c} className="panel-tag"
                    style={{ borderColor: color + '44', color: color + 'cc' }}>{c}</span>
                ))}
              </div>
            </section>
          )}

          {connected.length > 0 && (
            <section>
              <div className="panel-section-label">CONEXIONES</div>
              <div className="panel-tags">
                {connected.map(n => (
                  <span key={n.id} className="panel-tag panel-tag--link"
                    style={{ borderColor: color + '33', color: color + '99', cursor: 'pointer' }}
                    onClick={() => onNavigate?.(n)}>
                    {n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}
                  </span>
                ))}
              </div>
            </section>
          )}

          <div className="panel-actions" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 }}>
            <button className="btn-primary" style={{ borderColor: color, color }}
              onClick={() => onOpenAgent(node)}>
              ⬡ PREGUNTAR AL AGENTE
            </button>
            {onOpenReport && (
              <button className="btn-secondary poi-btn" onClick={() => onOpenReport(node)}>
                ▤ INFORME
              </button>
            )}
            <div style={{ borderTop: '1px solid rgba(90,110,160,0.12)', marginTop: 2 }} />
            <button className="btn-secondary" style={{ borderColor: '#ff606033', color: '#ff6060aa', fontSize: 10, minHeight: 34, opacity: 0.75 }}
              onClick={() => {
                if (window.confirm(`¿Eliminar "${node.label}" del grafo?`)) onDelete?.(node.id);
              }}>
              ✕ ELIMINAR NODO
            </button>
          </div>
        </div>

      </div>
    </aside>
  );
}
