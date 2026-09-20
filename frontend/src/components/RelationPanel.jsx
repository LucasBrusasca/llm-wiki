import React, { useState, useRef, useEffect } from 'react';
import { renderMarkdown } from '../markdown.js';
import { clusterColor, ytId } from '../App.jsx';

// El panel NO recalcula la similitud ni el solapamiento de conceptos. Antes lo hacía:
// mostraba un coseno propio (sobre embeddings redondeados a 4 decimales) y un
// solapamiento por substring más laxo que la regla de palabra completa del backend.
// Resultado: el bloque "por qué están relacionados" explicaba una relación distinta
// de la que realmente existe en el grafo. Ahora todo sale de la arista guardada.

function simLabel(s) {
  if (s >= 0.75) return { text: 'Muy alta',  color: '#7a9a80' };
  if (s >= 0.58) return { text: 'Alta',       color: '#8a9a70' };
  if (s >= 0.45) return { text: 'Moderada',   color: '#9a8a60' };
  return               { text: 'Leve',        color: '#7a7a70' };
}

// Las cuatro bases posibles de una relación - colores apagados
const BASES = {
  explicita: {
    titulo: 'RELACIÓN EXPLÍCITA',
    color: '#7a9a80',
    que_es: 'Ambos documentos mencionan los mismos conceptos. La evidencia son esas palabras: se pueden leer en las dos fuentes.',
    que_no: 'Compartir vocabulario no implica que digan lo mismo sobre él: pueden estar en desacuerdo.',
  },
  semantica: {
    titulo: 'RELACIÓN SEMÁNTICA',
    color: '#7a8a9a',
    que_es: 'No comparten conceptos suficientes. El vínculo existe porque sus vectores quedaron por encima del piso medido sobre este corpus.',
    que_no: 'Proximidad vectorial no es causalidad, influencia ni acuerdo. Es sólo cercanía estadística en el modelo de embeddings.',
  },
  inferida: {
    titulo: 'RELACIÓN INFERIDA',
    color: '#9a8a60',
    que_es: 'Superó un piso que todavía no se midió sobre este corpus (valor por defecto de la ingesta). Cumplió un supuesto, no un umbral observado.',
    que_no: 'Es la clase automática más débil. Recalculá las relaciones del grafo para que el piso se mida y esta arista se reclasifique.',
  },
  manual: {
    titulo: 'RELACIÓN MANUAL',
    color: '#8a7a9a',
    que_es: 'La trazó una persona. No proviene de un cálculo.',
    que_no: 'No tiene score ni evidencia numérica: su respaldo es el criterio de quien la creó.',
  },
};

const BASE_DESCONOCIDA = {
  titulo: 'ORIGEN NO REGISTRADO',
  color: '#6a6d7a',
  que_es: 'Esta arista es anterior a la trazabilidad de relaciones: no se guardó con qué método ni con qué piso se calculó.',
  que_no: 'No se puede afirmar que sea explícita, semántica ni manual. Recalculá las relaciones para registrar su procedencia.',
};

const METODOS = {
  knn_incremental: 'Ingesta incremental — vecinos kNN del documento nuevo (pgvector/HNSW), top-K de ese nodo.',
  recalculo_global: 'Recálculo global — todos los pares del corpus, top-K de cualquiera de los dos extremos.',
  manual: 'Creada a mano por una persona.',
};

const REVISION_ESTILO = {
  confirmada: { texto: 'CONFIRMADA POR UNA PERSONA', color: '#7a9a80' },
  rechazada:  { texto: 'RECHAZADA POR UNA PERSONA',  color: '#9a6a6a' },
};

function fmtPct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function NodeThumb({ node }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#12141a'; ctx.fillRect(0, 0, 160, 90);
    ctx.fillStyle = '#7a8090';
    ctx.font = "bold 28px 'Courier New', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ini = node.label.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
    ctx.fillText(ini, 80, 45);
  }, [node]);

  if (node.fuente === 'youtube' && node.fuente_url) {
    const vid = ytId(node.fuente_url);
    if (vid) return <img src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`} alt=""
      style={{ width: '100%', height: 70, objectFit: 'cover', display: 'block' }} />;
  }
  if ((node.fuente === 'pdf' || node.fuente === 'tesis') && node.fuente_path) {
    return <img src={`/thumbnail?p=${encodeURIComponent(node.fuente_path)}`} alt=""
      style={{ width: '100%', height: 70, objectFit: 'cover', display: 'block' }}
      onError={e => { e.target.style.display = 'none'; }} />;
  }
  return <canvas ref={canvasRef} width={160} height={90}
    style={{ width: '100%', height: 70, display: 'block' }} />;
}

function NodeCard({ node, onOpen, onFocus }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(90,95,105,0.3)' }}>
        <NodeThumb node={node} />
      </div>
      <span style={{
        fontSize: 9, letterSpacing: 1.5, color: '#8090a0',
        border: '1px solid rgba(90,100,115,0.3)', padding: '2px 6px',
        borderRadius: 2, alignSelf: 'flex-start', fontFamily: 'monospace',
      }}>
        {(node.fuente || 'concepto').toUpperCase()}
      </span>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#c0c8d0', lineHeight: 1.3 }}>
        {node.label.length > 40 ? node.label.slice(0, 39) + '…' : node.label}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          onClick={() => onOpen?.(node)}
          style={{
            flex: 1, padding: '5px 8px', fontSize: 9, fontWeight: 600,
            background: 'rgba(90,100,115,0.15)', border: '1px solid rgba(90,100,115,0.35)',
            borderRadius: 3, color: '#a0aab5', cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.target.style.background = 'rgba(100,115,135,0.25)'; e.target.style.color = '#c8d0da'; }}
          onMouseLeave={e => { e.target.style.background = 'rgba(90,100,115,0.15)'; e.target.style.color = '#a0aab5'; }}
        >
          Abrir
        </button>
        <button
          onClick={() => onFocus?.(node)}
          style={{
            flex: 1, padding: '5px 8px', fontSize: 9, fontWeight: 600,
            background: 'transparent', border: '1px solid rgba(90,100,115,0.35)',
            borderRadius: 3, color: '#8090a0', cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.target.style.background = 'rgba(90,100,115,0.12)'; e.target.style.color = '#a0aab5'; }}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#8090a0'; }}
        >
          Enfocar
        </button>
      </div>
    </div>
  );
}

const LABEL_STYLES = {
  COMPLEMENTA_A:            { bg: 'rgba(100,130,110,0.12)',  border: '#6a8a70', text: '#8aaa90'  },
  PROFUNDIZA_EN:            { bg: 'rgba(100,120,140,0.12)',  border: '#6a8a9a', text: '#8aaab0'  },
  RELACIONADO_CON:          { bg: 'rgba(140,120,90,0.12)',   border: '#9a8a60', text: '#b0a080'  },
  COMPARTE_CONCEPTOS_CON:   { bg: 'rgba(110,100,130,0.12)',  border: '#7a6a9a', text: '#9a8ab0' },
  SEMANTICAMENTE_SIMILAR_A: { bg: 'rgba(90,100,120,0.12)',   border: '#5a6a7a', text: '#7a8a9a' },
};

export default function RelationPanel({
  nodeA, nodeB, linkMeta, onClose, onOpenSynthesis, onReviewed, onOpenNode, onFocusNode
}) {
  const [synth, setSynth]   = useState('');
  const [busy,  setBusy]    = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revBusy, setRevBusy] = useState(false);
  const [revError, setRevError] = useState('');
  const [comentario, setComentario] = useState('');

  // Todo lo que se muestra sale de la arista tal como quedó guardada.
  const ev       = linkMeta?.evidencia || null;
  const sim      = linkMeta?.score ?? ev?.similitud_coseno ?? null;
  const simPct   = sim != null ? Math.round(sim * 100) : null;
  const simInfo  = sim != null ? simLabel(sim) : null;
  const overlap  = linkMeta?.shared_concepts || [];
  const esManual = !!linkMeta?.is_manual || linkMeta?.metodo === 'manual';
  const claveBase = esManual ? 'manual' : linkMeta?.base_relacion;
  const base     = BASES[claveBase] || BASE_DESCONOCIDA;
  const revision = linkMeta?.revision || null;
  const revEstilo = revision ? REVISION_ESTILO[revision.estado] : null;

  async function revisar(estado) {
    if (revBusy) return;
    setRevBusy(true); setRevError('');
    try {
      const res = await fetch('/api/relation/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: nodeA.id, target: nodeB.id, estado,
                               comentario: comentario || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setComentario('');
      onReviewed?.(nodeA.id, nodeB.id, data.revision);
    } catch {
      setRevError('No se pudo guardar la revisión.');
    } finally { setRevBusy(false); }
  }

  async function analyzeDeep() {
    if (busy) return;
    setBusy(true); setExpanded(true); setSynth('');
    const system = `Sos el agente de Algedi. Analizá la relación entre dos nodos del grafo de conocimiento. Explicá qué conceptos comparten, qué insights emergen y cómo se complementan. Respondé en español, markdown, conciso (2-3 párrafos).`;
    const userMsg = `Nodo A: "${nodeA.label}" — ${nodeA.desc || ''}
Nodo B: "${nodeB.label}" — ${nodeB.desc || ''}
Similitud coseno registrada: ${simPct ?? 'no registrada'}%. Conceptos compartidos según el grafo: ${overlap.join(', ') || 'ninguno (el vínculo es sólo por proximidad vectorial)'}.
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

  return (
    <aside className="node-tooltip">
      {/* Header */}
      <div className="tooltip-header" style={{ borderColor: 'rgba(90,100,115,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="tooltip-badge" style={{ color: '#8a95a5', borderColor: 'rgba(90,100,115,0.4)' }}>
            RELACIÓN
          </span>
          {simInfo && (
            <span style={{ fontSize: 10, color: simInfo.color, fontFamily: 'monospace' }}>
              {simPct}% · {simInfo.text}
            </span>
          )}
        </div>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      <div className="tooltip-body" style={{ gap: 14 }}>

        {/* ── NODOS CONECTADOS ── */}
        <div style={{
          background: 'rgba(20,22,28,0.6)', border: '1px solid rgba(70,75,85,0.35)',
          borderRadius: 4, padding: '12px'
        }}>
          <div className="panel-section-label" style={{ marginBottom: 10 }}>NODOS CONECTADOS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px 1fr', gap: 10, alignItems: 'start' }}>
            <NodeCard node={nodeA} onOpen={onOpenNode} onFocus={onFocusNode} />
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              paddingTop: 30, color: '#4a5060', fontSize: 14
            }}>⟷</div>
            <NodeCard node={nodeB} onOpen={onOpenNode} onFocus={onFocusNode} />
          </div>
        </div>

        {/* ── POR QUÉ ESTÁN RELACIONADOS ── */}
        <div style={{
          background: 'rgba(20,22,28,0.4)', border: `1px solid ${base.color}30`,
          borderRadius: 4, padding: '12px'
        }}>
          <div className="panel-section-label" style={{ marginBottom: 8 }}>POR QUÉ ESTÁN RELACIONADOS</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{
              background: `${base.color}18`, border: `1px solid ${base.color}60`,
              color: base.color, padding: '3px 10px', borderRadius: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: 1, fontFamily: 'monospace',
            }}>
              {base.titulo}
            </span>
          </div>

          {simPct != null && (
            <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${simPct}%`, borderRadius: 2, background: simInfo.color, opacity: 0.7 }} />
            </div>
          )}

          <p style={{ fontSize: 11, color: '#9095a0', lineHeight: 1.6, margin: '0 0 6px' }}>{base.que_es}</p>
          <p style={{ fontSize: 10, color: '#8a7a60', lineHeight: 1.5, margin: 0 }}>
            <strong style={{ color: '#a09070' }}>Qué NO significa:</strong> {base.que_no}
          </p>

          {overlap.length > 0 && (
            <>
              <div className="panel-section-label" style={{ marginTop: 12, marginBottom: 6 }}>
                CONCEPTOS COMPARTIDOS ({overlap.length})
              </div>
              <div className="panel-tags">
                {overlap.slice(0, 8).map(c => (
                  <span key={c} className="panel-tag" style={{
                    borderColor: 'rgba(90,100,115,0.35)', color: '#8a95a5', fontSize: 9
                  }}>{c}</span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── CÓMO SE CALCULÓ ── */}
        <div style={{
          background: 'rgba(20,22,28,0.3)', border: '1px solid rgba(70,75,85,0.25)',
          borderRadius: 4, padding: '12px'
        }}>
          <div className="panel-section-label" style={{ marginBottom: 6 }}>CÓMO SE CALCULÓ</div>
          <p style={{ fontSize: 10, color: '#8090a0', lineHeight: 1.6, margin: '0 0 8px' }}>
            {METODOS[linkMeta?.metodo] || 'Método no registrado para esta arista.'}
          </p>
          {ev ? (
            <table style={{ width: '100%', fontSize: 10, fontFamily: 'monospace', color: '#7a8595', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Similitud coseno', fmtPct(ev.similitud_coseno)],
                  ['Piso aplicado', ev.piso_usado == null ? '—' : `${fmtPct(ev.piso_usado)} ${ev.piso_medido ? '(medido)' : '(por defecto)'}`],
                  ['¿Supera el piso?', ev.supera_piso ? 'sí' : 'no'],
                  ['Conceptos compartidos', `${ev.n_conceptos_compartidos} ${ev.comparte_conceptos_suficientes ? '(suficientes)' : '(insuficientes)'}`],
                  ['Vínculos por nodo (K)', ev.k_vecinos ?? '—'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: '2px 8px 2px 0', color: '#606878', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                    <td style={{ padding: '2px 0', color: '#95a0b0' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 10, color: '#606878', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>
              Sin evidencia numérica registrada.
            </p>
          )}

          {linkMeta?.label && (() => {
            const style = LABEL_STYLES[linkMeta.label] || LABEL_STYLES.SEMANTICAMENTE_SIMILAR_A;
            return (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(70,75,85,0.2)' }}>
                <span style={{
                  background: style.bg, border: `1px solid ${style.border}60`,
                  color: style.text, padding: '3px 10px', borderRadius: 4,
                  fontSize: 9, fontWeight: 600, letterSpacing: 1, fontFamily: 'monospace',
                }}>
                  {linkMeta.label.replace(/_/g, ' ')}
                </span>
              </div>
            );
          })()}
        </div>

        {/* ── REVISIÓN HUMANA ── */}
        <div style={{
          background: 'rgba(20,22,28,0.3)',
          border: `1px solid ${revEstilo ? revEstilo.color + '40' : 'rgba(70,75,85,0.25)'}`,
          borderRadius: 4, padding: '12px'
        }}>
          <div className="panel-section-label" style={{ marginBottom: 6 }}>REVISIÓN HUMANA</div>
          {revEstilo ? (
            <>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: revEstilo.color, fontWeight: 700, letterSpacing: 1 }}>
                {revEstilo.texto}
              </div>
              {revision.comentario && (
                <p style={{ fontSize: 10, color: '#8090a0', lineHeight: 1.5, margin: '6px 0 0' }}>
                  "{revision.comentario}"
                </p>
              )}
              <button className="btn-secondary" style={{ fontSize: 10, marginTop: 8 }}
                disabled={revBusy} onClick={() => revisar('sin_revisar')}>
                ↺ Quitar revisión
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 10, color: '#707888', lineHeight: 1.5, margin: '0 0 8px' }}>
                Relación generada automáticamente. Ninguna persona la revisó todavía.
              </p>
              <input
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentario (opcional)"
                style={{
                  width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '6px 10px',
                  fontSize: 10, background: 'rgba(0,0,0,0.2)', color: '#b0b8c5',
                  border: '1px solid rgba(70,80,95,0.35)', borderRadius: 3,
                }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ flex: 1, fontSize: 10, borderColor: 'rgba(100,130,110,0.4)', color: '#7a9a80' }}
                  disabled={revBusy} onClick={() => revisar('confirmada')}>
                  ✓ Confirmar
                </button>
                <button className="btn-secondary" style={{ flex: 1, fontSize: 10, borderColor: 'rgba(130,100,100,0.4)', color: '#9a7a7a' }}
                  disabled={revBusy} onClick={() => revisar('rechazada')}>
                  ✕ Rechazar
                </button>
              </div>
            </>
          )}
          {revError && (
            <p style={{ fontSize: 10, color: '#9a6a6a', margin: '6px 0 0' }}>{revError}</p>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" style={{
            borderColor: 'rgba(90,100,115,0.5)', color: '#95a0b0', flex: 1, fontSize: 11
          }} onClick={analyzeDeep} disabled={busy}>
            {busy ? '⬡ Analizando…' : expanded ? '↺ Re-analizar' : '⬡ Análisis con IA'}
          </button>
          {onOpenSynthesis && (
            <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }}
              title="Síntesis multi-nodo con estos dos nodos"
              onClick={() => onOpenSynthesis([nodeA.id, nodeB.id])}>
              ◈ Síntesis
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
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(synth) }} />
              </div>
            )}
          </section>
        )}

      </div>
    </aside>
  );
}
