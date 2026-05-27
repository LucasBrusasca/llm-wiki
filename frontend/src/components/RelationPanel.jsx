import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import { clusterColor, ytId } from '../App.jsx';

marked.setOptions({ breaks: true, gfm: true });

const DEFAULT_W = 580;
const MIN_W = 340, MIN_H = 200;

function cosineSim(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function simLabel(s) {
  if (s >= 0.75) return { text: 'Muy alta',  color: '#6fcf97' };
  if (s >= 0.58) return { text: 'Alta',       color: '#a8d97a' };
  if (s >= 0.45) return { text: 'Moderada',   color: '#f5a623' };
  return               { text: 'Leve',        color: '#9a8060' };
}

function findOverlap(ca, cb) {
  const sa = ca.map(c => c.toLowerCase());
  const sb = cb.map(c => c.toLowerCase());
  const exact = ca.filter((c, i) => sb.includes(sa[i]));
  const usedA = new Set(exact.map(c => c.toLowerCase()));
  const usedB = new Set(exact.map(c => c.toLowerCase()));
  const fuzzy = [];
  for (let i = 0; i < sa.length; i++) {
    if (usedA.has(sa[i]) || sa[i].length < 4) continue;
    for (let j = 0; j < sb.length; j++) {
      if (usedB.has(sb[j]) || sb[j].length < 4) continue;
      if (sa[i].includes(sb[j]) || sb[j].includes(sa[i])) {
        fuzzy.push(ca[i]); usedA.add(sa[i]); usedB.add(sb[j]); break;
      }
    }
  }
  return [...exact, ...fuzzy];
}

// Auto-explanation generated from data, no LLM
function autoExplain(nodeA, nodeB, overlap, simPct, simInfo) {
  const parts = [];
  if (simPct != null) {
    parts.push(`Similitud semántica ${simInfo.text.toLowerCase()} (${simPct}%) en el espacio de embeddings.`);
  }
  if (overlap.length >= 2) {
    parts.push(`Comparten temáticas de ${overlap.slice(0, 4).join(', ')}.`);
  } else if (overlap.length === 1) {
    parts.push(`Tienen en común: ${overlap[0]}.`);
  }
  const topA = (nodeA.conceptos || []).slice(0, 2).join(' y ');
  const topB = (nodeB.conceptos || []).slice(0, 2).join(' y ');
  if (topA && topB && overlap.length === 0) {
    parts.push(`"${nodeA.label.slice(0, 28)}…" aborda ${topA}; "${nodeB.label.slice(0, 28)}…" aborda ${topB}.`);
  }
  return parts.join(' ') || 'Vinculados por similitud vectorial en el espacio de embeddings.';
}

function NodeThumb({ node }) {
  const canvasRef = useRef(null);
  const col = clusterColor(node.cluster);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, 160, 90);
    ctx.fillStyle = col;
    ctx.font = "bold 28px 'Courier New', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ini = node.label.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
    ctx.fillText(ini, 80, 45);
  }, [node, col]);

  if (node.fuente === 'youtube' && node.fuente_url) {
    const vid = ytId(node.fuente_url);
    if (vid) return <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt=""
      style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />;
  }
  if ((node.fuente === 'pdf' || node.fuente === 'tesis') && node.fuente_path) {
    return <img src={`/thumbnail?p=${encodeURIComponent(node.fuente_path)}`} alt=""
      style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
      onError={e => { e.target.style.display = 'none'; }} />;
  }
  return <canvas ref={canvasRef} width={160} height={90}
    style={{ width: '100%', height: 90, display: 'block' }} />;
}

function NodeCard({ node }) {
  const col = clusterColor(node.cluster);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ borderRadius: 3, overflow: 'hidden', border: `1px solid ${col}22` }}>
        <NodeThumb node={node} />
      </div>
      <span style={{ fontSize: 9, letterSpacing: 2, color: col, border: `1px solid ${col}44`, padding: '2px 6px', borderRadius: 2, alignSelf: 'flex-start' }}>
        {(node.fuente || 'concepto').toUpperCase()}
      </span>
      <div style={{ fontSize: 11, fontWeight: 700, color: col, lineHeight: 1.3 }}>
        {node.label.length > 50 ? node.label.slice(0, 49) + '…' : node.label}
      </div>
      {node.desc && (
        <div style={{ fontSize: 10, color: '#7a7d8a', lineHeight: 1.6 }}>
          {node.desc}
        </div>
      )}
    </div>
  );
}

export default function RelationPanel({ nodeA, nodeB, onClose, initialPos, onOpenSynthesis }) {
  const [synth, setSynth]   = useState('');
  const [busy,  setBusy]    = useState(false);
  const [expanded, setExpanded] = useState(false);

  const colA = clusterColor(nodeA.cluster);
  const isMobile = window.innerWidth < 900;

  const panelRef   = useRef(null);
  const isDragging = useRef(false);
  const resizing   = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [pos,  setPos]  = useState(initialPos || { x: 60, y: 80 });
  const [size, setSize] = useState({ w: null, h: null });

  const onMouseDownDrag = useCallback(e => {
    if (isMobile) return;
    isDragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos, isMobile]);

  const onResizeStart = useCallback((e, edge) => {
    e.preventDefault(); e.stopPropagation();
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
        setPos({ x: Math.min(Math.max(e.clientX - dragOffset.current.x, 0), vw - pw), y: Math.min(Math.max(e.clientY - dragOffset.current.y, 0), vh - ph) });
        return;
      }
      if (resizing.current) {
        const { edge, startX, startY, startW, startH, startLeft } = resizing.current;
        const dx = e.clientX - startX, dy = e.clientY - startY;
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
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const sim     = cosineSim(nodeA.embedding, nodeB.embedding);
  const simPct  = sim != null ? Math.round(sim * 100) : null;
  const simInfo = sim != null ? simLabel(sim) : null;
  const overlap = findOverlap(nodeA.conceptos || [], nodeB.conceptos || []);
  const explanation = autoExplain(nodeA, nodeB, overlap, simPct, simInfo);

  async function analyzeDeep() {
    if (busy) return;
    setBusy(true); setExpanded(true); setSynth('');
    const system = `Sos el agente de PragmaForge. Analizá la relación entre dos nodos del grafo de conocimiento. Explicá qué conceptos comparten, qué insights emergen y cómo se complementan. Respondé en español, markdown, conciso (2-3 párrafos).`;
    const userMsg = `Nodo A: "${nodeA.label}" — ${nodeA.desc || ''}
Nodo B: "${nodeB.label}" — ${nodeB.desc || ''}
Similitud: ${simPct ?? '?'}%. Temas comunes: ${overlap.join(', ') || 'similitud vectorial'}.
¿Qué insight genera su conexión?`;
    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, messages: [{ role: 'user', content: userMsg }] }),
      });
      const data = await res.json();
      setSynth(data.reply || 'Sin respuesta.');
    } catch { setSynth('Error al conectar con el agente.'); }
    finally { setBusy(false); }
  }

  const panelStyle = isMobile ? {} : {
    left: pos.x, top: pos.y,
    ...(size.w ? { width: size.w } : { width: DEFAULT_W }),
    ...(size.h ? { height: size.h, maxHeight: 'none' } : {}),
  };

  return (
    <aside ref={panelRef} className={`node-tooltip${isMobile ? ' mobile' : ''}`} style={panelStyle}>

      {/* Resize handles */}
      {!isMobile && <>
        <div className="rh rh--left"   onMouseDown={e => onResizeStart(e, 'left')} />
        <div className="rh rh--right"  onMouseDown={e => onResizeStart(e, 'right')} />
        <div className="rh rh--bottom" onMouseDown={e => onResizeStart(e, 'bottom')} />
      </>}

      {/* Header */}
      <div className="tooltip-header" onMouseDown={onMouseDownDrag}
        style={{ borderColor: colA + '33', cursor: isMobile ? 'default' : 'grab' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="tooltip-badge" style={{ color: colA, borderColor: colA + '44' }}>RELACIÓN</span>
          {simInfo && (
            <span style={{ fontSize: 10, color: simInfo.color }}>
              {simPct}% similitud · {simInfo.text}
            </span>
          )}
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      <div className="tooltip-body" style={{ gap: 14 }}>

        {/* Node cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr', gap: 8, alignItems: 'start' }}>
          <NodeCard node={nodeA} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 44, color: '#3a3d4a', fontSize: 16 }}>⟷</div>
          <NodeCard node={nodeB} />
        </div>

        {/* Auto-explanation (no LLM) */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(90,110,160,0.15)', borderRadius: 4, padding: '10px 12px' }}>
          <div className="panel-section-label" style={{ marginBottom: 6 }}>POR QUÉ ESTÁN RELACIONADOS</div>
          {simPct != null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ height: '100%', width: `${simPct}%`, borderRadius: 2, background: simInfo.color }} />
              </div>
            </div>
          )}
          <p style={{ fontSize: 11, color: '#9a9db0', lineHeight: 1.65, margin: 0 }}>{explanation}</p>
          {overlap.length > 0 && (
            <div className="panel-tags" style={{ marginTop: 8 }}>
              {overlap.slice(0, 5).map(c => (
                <span key={c} className="panel-tag" style={{ borderColor: colA + '33', color: colA + 'aa', fontSize: 9 }}>{c}</span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" style={{ borderColor: colA, color: colA, flex: 1, fontSize: 11 }}
            onClick={analyzeDeep} disabled={busy}>
            {busy ? '⬡ Analizando…' : expanded ? '↺ Re-analizar con IA' : '⬡ Análisis profundo con IA'}
          </button>
          {onOpenSynthesis && (
            <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }}
              title="Abrí el panel de síntesis multi-nodo con estos dos nodos pre-seleccionados"
              onClick={() => onOpenSynthesis([nodeA.id, nodeB.id])}>
              ◈ Síntesis multi-nodo
            </button>
          )}
        </div>

        {/* Deep LLM analysis */}
        {expanded && (
          <section>
            <div className="panel-section-label">ANÁLISIS PROFUNDO</div>
            {busy && !synth && <p style={{ fontSize: 11, color: '#565a6a', paddingTop: 4 }}><span className="thinking-dots">Analizando</span></p>}
            {synth && (
              <div className="agent-msg assistant" style={{ marginTop: 4 }}>
                <div dangerouslySetInnerHTML={{ __html: marked.parse(synth) }} />
              </div>
            )}
          </section>
        )}

      </div>
    </aside>
  );
}
