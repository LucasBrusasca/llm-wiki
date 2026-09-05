import React, { useState, useEffect, useRef, useCallback } from 'react';
import { renderMarkdown } from '../markdown.js';
import { clusterColor, ytId } from '../App.jsx';


const DEFAULT_W = 580;
const MIN_W = 340, MIN_H = 200;

// El panel NO recalcula la similitud ni el solapamiento de conceptos. Antes lo hacía:
// mostraba un coseno propio (sobre embeddings redondeados a 4 decimales) y un
// solapamiento por substring más laxo que la regla de palabra completa del backend.
// Resultado: el bloque "por qué están relacionados" explicaba una relación distinta
// de la que realmente existe en el grafo. Ahora todo sale de la arista guardada.

function simLabel(s) {
  if (s >= 0.75) return { text: 'Muy alta',  color: '#6fcf97' };
  if (s >= 0.58) return { text: 'Alta',       color: '#a8d97a' };
  if (s >= 0.45) return { text: 'Moderada',   color: '#f5a623' };
  return               { text: 'Leve',        color: '#9a8060' };
}

// Las cuatro bases posibles de una relación. El texto dice qué la sostiene y, sobre
// todo, qué NO permite concluir.
const BASES = {
  explicita: {
    titulo: 'RELACIÓN EXPLÍCITA',
    color: '#00ff88',
    que_es: 'Ambos documentos mencionan los mismos conceptos. La evidencia son esas palabras: se pueden leer en las dos fuentes.',
    que_no: 'Compartir vocabulario no implica que digan lo mismo sobre él: pueden estar en desacuerdo.',
  },
  semantica: {
    titulo: 'RELACIÓN SEMÁNTICA',
    color: '#00d4ff',
    que_es: 'No comparten conceptos suficientes. El vínculo existe porque sus vectores quedaron por encima del piso medido sobre este corpus.',
    que_no: 'Proximidad vectorial no es causalidad, influencia ni acuerdo. Es sólo cercanía estadística en el modelo de embeddings.',
  },
  inferida: {
    titulo: 'RELACIÓN INFERIDA',
    color: '#f5a623',
    que_es: 'Superó un piso que todavía no se midió sobre este corpus (valor por defecto de la ingesta). Cumplió un supuesto, no un umbral observado.',
    que_no: 'Es la clase automática más débil. Recalculá las relaciones del grafo para que el piso se mida y esta arista se reclasifique.',
  },
  manual: {
    titulo: 'RELACIÓN MANUAL',
    color: '#c4b5fd',
    que_es: 'La trazó una persona. No proviene de un cálculo.',
    que_no: 'No tiene score ni evidencia numérica: su respaldo es el criterio de quien la creó.',
  },
};

const BASE_DESCONOCIDA = {
  titulo: 'ORIGEN NO REGISTRADO',
  color: '#7a7d8a',
  que_es: 'Esta arista es anterior a la trazabilidad de relaciones: no se guardó con qué método ni con qué piso se calculó.',
  que_no: 'No se puede afirmar que sea explícita, semántica ni manual. Recalculá las relaciones para registrar su procedencia.',
};

const METODOS = {
  knn_incremental: 'Ingesta incremental — vecinos kNN del documento nuevo (pgvector/HNSW), top-K de ese nodo.',
  recalculo_global: 'Recálculo global — todos los pares del corpus, top-K de cualquiera de los dos extremos.',
  manual: 'Creada a mano por una persona.',
};

const REVISION_ESTILO = {
  confirmada: { texto: 'CONFIRMADA POR UNA PERSONA', color: '#00ff88' },
  rechazada:  { texto: 'RECHAZADA POR UNA PERSONA',  color: '#ff6b6b' },
};

function fmtPct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
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

const LABEL_STYLES = {
  COMPLEMENTA_A:            { bg: 'rgba(0,255,136,0.15)',  border: '#00ff88', text: '#00ff88'  },
  PROFUNDIZA_EN:            { bg: 'rgba(0,212,255,0.15)',  border: '#00d4ff', text: '#00d4ff'  },
  RELACIONADO_CON:          { bg: 'rgba(255,149,0,0.15)',  border: '#ff9500', text: '#ff9500'  },
  COMPARTE_CONCEPTOS_CON:   { bg: 'rgba(124,58,237,0.15)', border: '#7c3aed', text: '#c4b5fd' },
  SEMANTICAMENTE_SIMILAR_A: { bg: 'rgba(90,122,154,0.15)', border: '#5a7a9a', text: '#5a7a9a' },
};

export default function RelationPanel({ nodeA, nodeB, linkMeta, onClose, initialPos, onOpenSynthesis, onReviewed }) {
  const [synth, setSynth]   = useState('');
  const [busy,  setBusy]    = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revBusy, setRevBusy] = useState(false);
  const [revError, setRevError] = useState('');
  const [comentario, setComentario] = useState('');

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

        {/* -- POR QUE ESTAN RELACIONADOS ------------------------------------
            Procedencia real de la arista: que la sostiene, con que metodo se
            calculo y con que numeros. Nada de esto se recalcula aca. */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${base.color}33`, borderRadius: 4, padding: '10px 12px' }}>
          <div className="panel-section-label" style={{ marginBottom: 8 }}>POR QUÉ ESTÁN RELACIONADOS</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{
              background: `${base.color}1f`, border: `1px solid ${base.color}`,
              color: base.color, padding: '3px 10px', borderRadius: 4,
              fontSize: 10, fontWeight: 700, letterSpacing: 1.2, fontFamily: 'monospace',
            }}>
              {base.titulo}
            </span>
            {simPct != null && (
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#8a9ab0' }}>
                COSENO <span style={{ color: simInfo.color, fontWeight: 700 }}>{simPct}%</span> · {simInfo.text}
              </span>
            )}
          </div>

          {simPct != null && (
            <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${simPct}%`, borderRadius: 2, background: simInfo.color }} />
            </div>
          )}

          <p style={{ fontSize: 11, color: '#9a9db0', lineHeight: 1.65, margin: '0 0 6px' }}>{base.que_es}</p>
          <p style={{ fontSize: 10, color: '#c98b5a', lineHeight: 1.6, margin: 0 }}>
            <strong style={{ color: '#e0a06a' }}>Qué NO significa:</strong> {base.que_no}
          </p>

          {overlap.length > 0 && (
            <>
              <div className="panel-section-label" style={{ marginTop: 10, marginBottom: 4 }}>
                CONCEPTOS COMPARTIDOS ({overlap.length})
              </div>
              <div className="panel-tags">
                {overlap.slice(0, 8).map(c => (
                  <span key={c} className="panel-tag" style={{ borderColor: `${base.color}44`, color: `${base.color}cc`, fontSize: 9 }}>{c}</span>
                ))}
              </div>
              <p style={{ fontSize: 9, color: '#6a6d7a', margin: '5px 0 0', lineHeight: 1.5 }}>
                Coincidencia por palabra completa entre los conceptos extraídos de cada documento.
              </p>
            </>
          )}
        </div>

        {/* -- COMO SE CALCULO ----------------------------------------------- */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(90,110,160,0.15)', borderRadius: 4, padding: '10px 12px' }}>
          <div className="panel-section-label" style={{ marginBottom: 6 }}>CÓMO SE CALCULÓ</div>
          <p style={{ fontSize: 10, color: '#9a9db0', lineHeight: 1.6, margin: '0 0 8px' }}>
            {METODOS[linkMeta?.metodo] || 'Método no registrado para esta arista.'}
          </p>
          {ev ? (
            <table style={{ width: '100%', fontSize: 10, fontFamily: 'monospace', color: '#8a9ab0', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Similitud coseno', fmtPct(ev.similitud_coseno)],
                  ['Piso aplicado', ev.piso_usado == null ? '—' : `${fmtPct(ev.piso_usado)} ${ev.piso_medido ? '(medido sobre este corpus)' : '(valor por defecto, no medido)'}`],
                  ['¿Supera el piso?', ev.supera_piso ? 'sí' : 'no'],
                  ['Conceptos compartidos', `${ev.n_conceptos_compartidos} ${ev.comparte_conceptos_suficientes ? '(suficientes)' : '(insuficientes para relación explícita)'}`],
                  ['Vínculos por nodo (K)', ev.k_vecinos ?? '—'],
                  ['Modelo de embeddings', ev.modelo_embeddings || '—'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: '2px 8px 2px 0', color: '#6a6d7a', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                    <td style={{ padding: '2px 0', color: '#a8b4c4' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 10, color: '#7a7d8a', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
              Sin evidencia numérica registrada. Es una arista anterior a la trazabilidad de
              relaciones: recalculá las relaciones del grafo para registrarla.
            </p>
          )}

          {linkMeta?.label && (() => {
            const style = LABEL_STYLES[linkMeta.label] || LABEL_STYLES.SEMANTICAMENTE_SIMILAR_A;
            return (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(90,110,160,0.12)' }}>
                <div className="panel-section-label" style={{ marginBottom: 6 }}>
                  ETIQUETA DERIVADA · NO ES UNA MEDICIÓN
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    background: style.bg, border: `1px solid ${style.border}`,
                    color: style.text, padding: '3px 10px', borderRadius: 4,
                    fontSize: 10, fontWeight: 700, letterSpacing: 1.2, fontFamily: 'monospace',
                  }}>
                    {linkMeta.label.replace(/_/g, ' ')}
                  </span>
                </div>
                {linkMeta.description && (
                  <p style={{ fontSize: 10, color: '#7a7d8a', lineHeight: 1.6, margin: '6px 0 0', fontStyle: 'italic' }}>
                    {linkMeta.description}
                  </p>
                )}
                <p style={{ fontSize: 9, color: '#6a6d7a', margin: '5px 0 0', lineHeight: 1.5 }}>
                  Nombre asignado por umbrales sobre los números de arriba. Describe la fuerza del
                  vínculo, no una afirmación sobre el contenido de los documentos.
                </p>
              </div>
            );
          })()}
        </div>

        {/* -- REVISION HUMANA ----------------------------------------------- */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${revEstilo ? revEstilo.color + '44' : 'rgba(90,110,160,0.15)'}`, borderRadius: 4, padding: '10px 12px' }}>
          <div className="panel-section-label" style={{ marginBottom: 6 }}>REVISIÓN HUMANA</div>
          {revEstilo ? (
            <>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: revEstilo.color, fontWeight: 700, letterSpacing: 1 }}>
                {revEstilo.texto}
              </div>
              {revision.comentario && (
                <p style={{ fontSize: 10, color: '#9a9db0', lineHeight: 1.6, margin: '6px 0 0' }}>
                  “{revision.comentario}”
                </p>
              )}
              {revision.fecha && (
                <p style={{ fontSize: 9, color: '#6a6d7a', margin: '4px 0 0' }}>
                  {new Date(revision.fecha).toLocaleString()}
                </p>
              )}
              <button className="btn-secondary" style={{ fontSize: 10, marginTop: 8 }}
                disabled={revBusy} onClick={() => revisar('sin_revisar')}>
                ↺ Quitar revisión
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 10, color: '#7a7d8a', lineHeight: 1.6, margin: '0 0 8px' }}>
                Relación generada automáticamente. Ninguna persona la revisó todavía.
              </p>
              <input
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                placeholder="Comentario (opcional)"
                style={{
                  width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '5px 8px',
                  fontSize: 10, background: 'rgba(0,0,0,0.25)', color: '#c8cbd8',
                  border: '1px solid rgba(90,110,160,0.25)', borderRadius: 3,
                }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ flex: 1, fontSize: 10, borderColor: '#00ff8855', color: '#00ff88' }}
                  disabled={revBusy} onClick={() => revisar('confirmada')}>
                  ✓ Confirmar relación
                </button>
                <button className="btn-secondary" style={{ flex: 1, fontSize: 10, borderColor: '#ff6b6b55', color: '#ff6b6b' }}
                  disabled={revBusy} onClick={() => revisar('rechazada')}>
                  ✕ No corresponde
                </button>
              </div>
              <p style={{ fontSize: 9, color: '#6a6d7a', margin: '6px 0 0', lineHeight: 1.5 }}>
                Rechazar no borra la arista: la marca. Se conserva para poder auditar en qué se
                equivocó el cálculo.
              </p>
            </>
          )}
          {revError && (
            <p style={{ fontSize: 10, color: '#ff6b6b', margin: '6px 0 0' }}>{revError}</p>
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
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(synth) }} />
              </div>
            )}
          </section>
        )}

      </div>
    </aside>
  );
}
