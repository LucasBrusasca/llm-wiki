import React, { useState, useCallback } from 'react';

const TIPO_COLOR = { inicio: '#5fd38d', fin: '#5b9bd5', decision: '#e8c35a', paso: '#7db2eb' };
const SUG_META = {
  mejora:         { color: '#5fd38d', label: 'MEJORA' },
  riesgo:         { color: '#e87a6e', label: 'RIESGO' },
  automatizacion: { color: '#c98bd9', label: 'AUTOMATIZAR' },
};
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''));

// Layout por niveles (BFS desde 'inicio'): cada nivel es una fila; sin librería externa.
function buildLayout(pasos, conexiones) {
  const W = 760, NODE_W = 150, NODE_H = 46, ROW_H = 100, GAP = 26;
  const children = {};
  (conexiones || []).forEach(c => { (children[c.desde] ??= []).push(c.hasta); });
  const targets = new Set((conexiones || []).map(c => c.hasta));
  const start = pasos.find(p => p.tipo === 'inicio') || pasos.find(p => !targets.has(p.id)) || pasos[0];
  const level = {};
  if (start) {
    const q = [[start.id, 0]]; level[start.id] = 0;
    while (q.length) {
      const [id, d] = q.shift();
      (children[id] || []).forEach(h => {
        if (level[h] === undefined) { level[h] = d + 1; q.push([h, d + 1]); }
      });
    }
  }
  let maxL = Math.max(0, ...Object.values(level).filter(Number.isFinite));
  pasos.forEach(p => { if (level[p.id] === undefined) { maxL += 1; level[p.id] = maxL; } });
  const byLevel = {};
  pasos.forEach(p => { (byLevel[level[p.id]] ??= []).push(p); });
  const pos = {};
  Object.entries(byLevel).forEach(([lvl, nodes]) => {
    const totalW = nodes.length * NODE_W + (nodes.length - 1) * GAP;
    const x0 = Math.max(8, (W - totalW) / 2);
    nodes.forEach((p, i) => { pos[p.id] = { x: x0 + i * (NODE_W + GAP), y: Number(lvl) * ROW_H + 12 }; });
  });
  const H = (Math.max(0, ...Object.values(level).filter(Number.isFinite)) + 1) * ROW_H + 12;
  return { pos, W, H, NODE_W, NODE_H };
}

// Brief de implementación en markdown: el "handoff" del proceso diseñado hacia
// Claude Code (u otro agente/persona). Autocontenido: no requiere ver Algedi.
function buildBrief(proc, descripcion, allNodes) {
  const byId = new Map((allNodes || []).map(n => [n.id, n]));
  const lineas = [];
  lineas.push(`# Build brief — ${proc.titulo || 'Proceso'}`);
  lineas.push(`> Generado por Algedi (módulo Procesos) · ${new Date().toLocaleDateString('es-AR')}`);
  lineas.push('', '## Necesidad original', descripcion || '(sin descripción)');
  lineas.push('', '## Proceso propuesto', '');
  (proc.pasos || []).forEach((p, i) => {
    lineas.push(`${i + 1}. **[${(p.tipo || 'paso').toUpperCase()}]** ${p.label}${p.detalle ? ` — ${p.detalle}` : ''}`);
  });
  if (proc.conexiones?.length) {
    lineas.push('', '### Flujo');
    const label = id => (proc.pasos || []).find(p => p.id === id)?.label || id;
    proc.conexiones.forEach(c => {
      lineas.push(`- ${label(c.desde)} → ${label(c.hasta)}${c.condicion ? ` _(si: ${c.condicion})_` : ''}`);
    });
  }
  if (proc.sugerencias?.length) {
    lineas.push('', '## Sugerencias y riesgos (fundados en el grafo de conocimiento)');
    proc.sugerencias.forEach(s => {
      lineas.push(`- **[${(s.tipo || 'mejora').toUpperCase()}]** ${s.texto}${s.fundamento ? `\n  - Fundamento: ${s.fundamento}` : ''}`);
    });
  }
  if (proc.indicadores?.length) {
    lineas.push('', '## Qué medir y por qué');
    proc.indicadores.forEach(ind => {
      lineas.push(`- **${ind.que}** — ${ind.como}. _Por qué: ${ind.porque}_`);
    });
  }
  if (proc.nodos_fundamento?.length) {
    lineas.push('', '## Documentos de fundamento');
    proc.nodos_fundamento.forEach(id => {
      const n = byId.get(id);
      lineas.push(`- ${n ? n.label : id}`);
    });
  }
  lineas.push('', '---',
    'Instrucción: implementá este proceso. Respetá el flujo y los indicadores; ' +
    'las sugerencias marcadas RIESGO son restricciones a mitigar, no opcionales. ' +
    'Si algo del brief es ambiguo, preguntá antes de asumir.');
  return lineas.join('\n');
}

const HIST_KEY = 'algedi_procesos';
const loadHist = () => {
  try { const h = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); return Array.isArray(h) ? h : []; }
  catch { return []; }
};

export default function ProcessPanel({ onClose, onHighlight, allNodes }) {
  const [descripcion, setDescripcion] = useState('');
  const [busy, setBusy] = useState(false);
  const [proc, setProc] = useState(null);
  const [error, setError] = useState('');
  const [hist, setHist] = useState(loadHist);
  const [copiado, setCopiado] = useState(false);

  const saveHist = useCallback((next) => {
    setHist(next);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const generar = useCallback(async () => {
    const d = descripcion.trim();
    if (!d || busy) return;
    setBusy(true); setError(''); setProc(null);
    try {
      const r = await fetch('/api/process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: d }),
      });
      if (!r.ok) { setError('No se pudo generar el proceso.'); return; }
      const p = await r.json();
      setProc(p);
      // Persistir en el historial local (los procesos dejan de ser efímeros).
      saveHist([{ id: `p_${Date.now()}`, ts: Date.now(), titulo: p.titulo || d.slice(0, 40), descripcion: d, proc: p },
                ...hist].slice(0, 12));
    } catch { setError('Error al conectar con el backend.'); }
    finally { setBusy(false); }
  }, [descripcion, busy, hist, saveHist]);

  const copiarBrief = useCallback(async () => {
    if (!proc) return;
    const md = buildBrief(proc, descripcion, allNodes);
    try {
      await navigator.clipboard.writeText(md);
      setCopiado(true); setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Fallback: descargar como .md si el clipboard está bloqueado.
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `brief-${(proc.titulo || 'proceso').toLowerCase().replace(/\s+/g, '-').slice(0, 40)}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }, [proc, descripcion, allNodes]);

  const L = proc ? buildLayout(proc.pasos || [], proc.conexiones || []) : null;

  return (
    <div className="proc-overlay">
      <div className="proc-panel">
        <div className="proc-header">
          <span className="proc-title">⚙ DISEÑAR PROCESO · fundado en tu grafo</span>
          <button className="panel-close" onClick={onClose} title="Volver a Issue">←</button>
        </div>

        <div className="proc-input-row">
          <textarea
            className="proc-textarea"
            placeholder="Describí un proceso o necesidad… (ej: cómo evaluar un sistema RAG antes de producción)"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            disabled={busy}
          />
          <button className="proc-gen-btn" onClick={generar} disabled={busy || !descripcion.trim()}>
            {busy ? '⟳ Generando…' : '→ Generar'}
          </button>
        </div>

        {hist.length > 0 && !busy && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '2px 0 6px' }}>
            <span style={{ fontSize: 11, color: '#7a8699', alignSelf: 'center' }}>Anteriores:</span>
            {hist.map(h => (
              <span key={h.id}
                onClick={() => { setProc(h.proc); setDescripcion(h.descripcion); setError(''); }}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 12, cursor: 'pointer',
                  border: '1px solid rgba(120,150,190,0.35)', color: '#aebdd2',
                  background: 'rgba(255,255,255,0.04)', display: 'inline-flex', gap: 6, alignItems: 'center',
                }}>
                {trunc(h.titulo, 34)}
                <span
                  onClick={e => { e.stopPropagation(); saveHist(hist.filter(x => x.id !== h.id)); }}
                  style={{ color: '#7a8699', cursor: 'pointer' }} title="Borrar del historial">✕</span>
              </span>
            ))}
          </div>
        )}

        {error && <div className="proc-error">{error}</div>}
        {busy && <div className="proc-hint">Estructurando el proceso y fundándolo en tu conocimiento…</div>}

        {proc && L && (
          <div className="proc-result">
            <div className="proc-result-title">{proc.titulo}</div>

            <div className="proc-flow">
              <svg viewBox={`0 0 ${L.W} ${L.H}`} width="100%" preserveAspectRatio="xMidYMin meet">
                <defs>
                  <marker id="proc-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
                    <path d="M0,0 L9,4.5 L0,9 z" fill="rgba(150,170,200,0.75)" />
                  </marker>
                </defs>
                {(proc.conexiones || []).map((c, i) => {
                  const a = L.pos[c.desde], b = L.pos[c.hasta];
                  if (!a || !b) return null;
                  const x1 = a.x + L.NODE_W / 2, y1 = a.y + L.NODE_H;
                  const x2 = b.x + L.NODE_W / 2, y2 = b.y;
                  return (
                    <g key={i}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(150,170,200,0.45)" strokeWidth="1.5" markerEnd="url(#proc-arrow)" />
                      {c.condicion && (
                        <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2} fill="#e8c35a" fontSize="10" textAnchor="start">{c.condicion}</text>
                      )}
                    </g>
                  );
                })}
                {(proc.pasos || []).map(p => {
                  const pos = L.pos[p.id]; if (!pos) return null;
                  const col = TIPO_COLOR[p.tipo] || TIPO_COLOR.paso;
                  return (
                    <g key={p.id}>
                      <rect x={pos.x} y={pos.y} width={L.NODE_W} height={L.NODE_H} rx="7"
                        fill="rgba(10,16,24,0.96)" stroke={col} strokeWidth="1.6" />
                      <text x={pos.x + L.NODE_W / 2} y={pos.y + L.NODE_H / 2} fill="#e6eef8" fontSize="11"
                        textAnchor="middle" dominantBaseline="middle">
                        <title>{p.label}</title>{trunc(p.label, 22)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {proc.sugerencias?.length > 0 && (
              <div className="proc-section">
                <div className="proc-section-title">SUGERENCIAS Y RIESGOS · fundados en tu grafo</div>
                {proc.sugerencias.map((s, i) => {
                  const m = SUG_META[s.tipo] || SUG_META.mejora;
                  return (
                    <div key={i} className="proc-sug" style={{ borderLeftColor: m.color }}>
                      <span className="proc-sug-badge" style={{ color: m.color, borderColor: m.color }}>{m.label}</span>
                      <span className="proc-sug-text">{s.texto}</span>
                      {s.fundamento && <div className="proc-sug-fund">⤷ {s.fundamento}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {proc.indicadores?.length > 0 && (
              <div className="proc-section">
                <div className="proc-section-title">QUÉ MEDIR Y POR QUÉ</div>
                {proc.indicadores.map((ind, i) => (
                  <div key={i} className="proc-ind">
                    <div className="proc-ind-que">{ind.que}</div>
                    <div className="proc-ind-detail">{ind.como} — <em>{ind.porque}</em></div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {proc.nodos_fundamento?.length > 0 && (
                <button className="proc-fund-btn" onClick={() => onHighlight?.(proc.nodos_fundamento)}>
                  ⊙ Ver en el grafo los {proc.nodos_fundamento.length} documentos que fundamentan esto
                  {typeof proc.afinidad_max === 'number' && ` · afinidad máx ${Math.round(proc.afinidad_max * 100)}%`}
                </button>
              )}
              <button className="proc-fund-btn" onClick={copiarBrief}
                title="Copia un brief markdown autocontenido para pegar en Claude Code (o donde sea)">
                {copiado ? '✓ Brief copiado — pegalo en Claude Code' : '⧉ Brief para Claude Code'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
