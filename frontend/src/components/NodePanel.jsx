import React, { useRef, useEffect, useState, useCallback } from 'react';
import { clusterColor, ytId } from '../App.jsx';

function ExcelPreview({ path }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetch(`/excel-preview?p=${encodeURIComponent(path)}`)
      .then(r => r.json()).then(d => setRows(d.rows)).catch(() => setRows([]));
  }, [path]);
  if (rows === null) return <div className="preview-loading">Cargando…</div>;
  if (!rows.length)  return <div className="preview-loading">Sin datos</div>;
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

function RichPreviewModal({ node, html, onClose }) {
  const srcUrl = node.fuente_url || (node.fuente_path ? `/doc?p=${encodeURIComponent(node.fuente_path)}` : null);
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(4,6,12,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '90vw', maxWidth: 1100, height: '90vh', background: '#f5f1e8',
        borderRadius: 5, border: '1px solid rgba(245,166,35,0.25)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 16px', background: '#1a1a1a', flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10,
            color: '#f5a623', letterSpacing: 2 }}>
            ✦ APUNTE IA · {node.label.slice(0, 55)}{node.label.length > 55 ? '…' : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {srcUrl && (
              <button onClick={() => window.open(srcUrl, '_blank')}
                style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: 2,
                  padding: '4px 10px', background: 'transparent',
                  border: '1px solid rgba(245,166,35,0.35)', color: '#f5a623', cursor: 'pointer', borderRadius: 2 }}>
                → Fuente original
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
  const f = node.fuente;
  const [richHtml, setRichHtml] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [showRich, setShowRich] = useState(false);

  const loadRichPreview = useCallback(async () => {
    if (richHtml) { setShowRich(true); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/node/${node.id}/rich-preview`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      setRichHtml(html);
      setShowRich(true);
    } catch (e) {
      console.error('Rich preview error:', e);
    } finally {
      setLoading(false);
    }
  }, [node.id, richHtml]);

  // YouTube: unchanged
  if (f === 'youtube' && node.fuente_url) {
    const vid = ytId(node.fuente_url);
    if (vid) return (
      <iframe src={`https://www.youtube.com/embed/${vid}?autoplay=0`} title={node.label}
        allowFullScreen style={{ width: '100%', height: 160, border: 'none', borderRadius: 4 }} />
    );
  }

  // Audio: unchanged
  if (f === 'audio' && node.fuente_path) {
    return <audio controls style={{ width: '100%', marginTop: 4 }}
      src={`/doc?p=${encodeURIComponent(node.fuente_path)}`} />;
  }

  // Excel: unchanged
  if (f === 'excel' && node.fuente_path) {
    return (
      <div>
        <ExcelPreview path={node.fuente_path} />
        <button className="btn-secondary" style={{ marginTop: 6 }}
          onClick={() => window.open(`/doc?p=${encodeURIComponent(node.fuente_path)}`, '_blank')}>
          ↓ Descargar Excel
        </button>
      </div>
    );
  }

  // PDF, HTML, tesis → thumbnail + Rich Preview button
  if ((f === 'pdf' || f === 'tesis' || f === 'html') && (node.fuente_path || node.fuente_url)) {
    return (
      <>
        {showRich && richHtml && (
          <RichPreviewModal node={node} html={richHtml} onClose={() => setShowRich(false)} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {node.fuente_url ? (
            <div style={{ width: '100%', height: 550, overflow: 'hidden', paddingBottom: 12, borderRadius: 4, background: '#fff' }}>
              <iframe src={node.fuente_url} title="Preview" style={{ width: '100%', height: '100%', display: 'block', border: 'none' }} />
            </div>
          ) : (
            <div style={{ width: '100%', height: 550, overflow: 'hidden', paddingBottom: 12, borderRadius: 4, background: '#fff' }}>
              <iframe src={`/doc?p=${encodeURIComponent(node.fuente_path)}#toolbar=0&navpanes=0&scrollbar=0`} title="Preview" style={{ width: '100%', height: '100%', display: 'block', border: 'none' }} />
            </div>
          )}
          {f !== 'html' && (
            <button onClick={loadRichPreview} disabled={loading} className="btn-secondary" style={{ borderColor: 'rgba(245,166,35,0.45)', color: '#f5a623' }}>
              {loading ? '⟳ Generando apunte…' : '✦ Ver apunte IA'}
            </button>
          )}
        </div>
      </>
    );
  }

  return <InitialsCanvas node={node} />;
}

function InitialsCanvas({ node }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const color = clusterColor(node.cluster);
    ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, 240, 140);
    ctx.fillStyle = color;
    ctx.font = "bold 56px 'Courier New', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ini = node.label.trim().split(/\s+/).slice(0, 2)
      .map(w => w[0]?.toUpperCase() || '').join('') || '?';
    ctx.fillText(ini, 120, 70);
  }, [node]);
  return <canvas ref={ref} width={240} height={140}
    style={{ width: '100%', borderRadius: 4, display: 'block' }} />;
}

const MIN_W = 300, MIN_H = 200, DEFAULT_W = 580;

export default function NodePanel({ node, allNodes, allLinks, onClose, onOpenAgent, onNavigate, onDelete, initialPos }) {
  const color    = clusterColor(node.cluster);
  const isMobile = window.innerWidth < 900;

  const isDragging = useRef(false);
  const resizing   = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef   = useRef(null);

  const [pos,  setPos]  = useState(initialPos || { x: 60, y: 80 });
  const [size, setSize] = useState({ w: null, h: null });

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
  }, []);

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
  }, []);

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
  const isTwoCol = !isMobile && currentW >= 480;

  const panelStyle = isMobile ? {} : {
    left: pos.x, top: pos.y,
    ...(size.w ? { width: size.w } : {}),
    ...(size.h ? { height: size.h, maxHeight: 'none' } : {}),
  };

  return (
    <aside
      ref={panelRef}
      className={`node-tooltip${isMobile ? ' mobile' : ''}${isTwoCol ? ' two-col' : ''}`}
      style={panelStyle}
    >
      {/* Resize handles */}
      {!isMobile && <>
        <div className="rh rh--left"   onMouseDown={e => onResizeStart(e, 'left')} />
        <div className="rh rh--right"  onMouseDown={e => onResizeStart(e, 'right')} />
        <div className="rh rh--bottom" onMouseDown={e => onResizeStart(e, 'bottom')} />
      </>}

      {/* Drag header */}
      <div className="tooltip-header" onMouseDown={onMouseDownDrag}
        style={{ borderColor: color + '33', cursor: isMobile ? 'default' : 'grab' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span className="tooltip-badge" style={{ color, borderColor: color + '55', flexShrink: 0 }}>
            {(node.fuente || 'concepto').toUpperCase()}
          </span>
          <span className="panel-title" style={{ color, fontSize: 13 }}>{node.label}</span>
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      {/* Body */}
      <div className={`tooltip-body${isTwoCol ? ' tooltip-body-grid' : ''}`}>

        <div className="tooltip-col-left">
          <div className="panel-thumb"><ContentPreview node={node} /></div>
          {(node.fuente_path || node.fuente_url) && (
            <button className="btn-secondary" style={{ marginTop: 8 }}
              onClick={() => {
                const url = node.fuente_url
                  ? node.fuente_url
                  : `/doc?p=${encodeURIComponent(node.fuente_path)}`;
                window.open(url, '_blank');
              }}>
              → Ver fuente
            </button>
          )}
        </div>

        <div className="tooltip-col-right">
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
              ⬡ Preguntar al agente
            </button>
            <div style={{ borderTop: '1px solid rgba(90,110,160,0.12)', marginTop: 2 }} />
            <button className="btn-secondary" style={{ borderColor: '#ff606033', color: '#ff6060aa', fontSize: 10, minHeight: 34, opacity: 0.75 }}
              onClick={() => {
                if (window.confirm(`¿Eliminar "${node.label}" del grafo?`)) onDelete?.(node.id);
              }}>
              ✕ Eliminar nodo
            </button>
          </div>
        </div>

      </div>
    </aside>
  );
}
