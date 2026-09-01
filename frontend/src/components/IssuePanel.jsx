import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import ReactFlow, { Background, Controls, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import { renderMarkdown } from '../markdown.js';
import { pedirClave, avisarClaveIncorrecta } from '../security.js';


// ── Reporte de los 4 agentes ────────────────────────────────────────────────
// Colapsable y renderizado como markdown. Compartido entre el resultado
// post-creación y la pestaña "Reporte" del detalle del issue.
const SYN_SECTIONS = [
  { key: 'proceso',  title: '⚙️ ANÁLISIS DE PROCESO',  color: '#00ff88' },
  { key: 'riesgos',  title: '⚠️ GESTIÓN DE RIESGOS',   color: '#ff9500' },
  { key: 'creativo', title: '💡 PERSPECTIVA CREATIVA',  color: '#00d4ff' },
  { key: 'red_team', title: '🔴 RED TEAM',              color: '#ff3366', dark: true },
];

function SynthesisView({ syn }) {
  const [collapsed, setCollapsed] = useState({});
  const isObject = typeof syn === 'object' && syn !== null;
  const sections = isObject
    ? SYN_SECTIONS.map(s => ({ ...s, content: syn[s.key] })).filter(s => s.content)
    : [{ key: 'synthesis', title: '⬡ SÍNTESIS', color: 'var(--gold)', content: syn }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sections.map(({ key, title, color, content, dark }) => {
        const isCollapsed = collapsed[key];
        return (
          <div key={key} style={{
            borderRadius: 6,
            border: `1px solid ${dark ? 'rgba(255,51,102,0.3)' : `${color}33`}`,
            background: dark ? 'rgba(30,4,12,0.7)' : 'rgba(255,255,255,0.03)',
            overflow: 'hidden',
          }}>
            <button
              onClick={() => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', padding: '10px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                color, fontWeight: 700, fontSize: 11, letterSpacing: 1.2,
                fontFamily: 'monospace', textAlign: 'left',
              }}
            >
              {title}
              <span style={{ fontSize: 12, opacity: 0.7 }}>{isCollapsed ? '▸' : '▾'}</span>
            </button>
            {!isCollapsed && (
              <div
                style={{
                  padding: '10px 14px 14px', fontSize: 13, color: '#c4c8d6', lineHeight: 1.7,
                  borderTop: `1px solid ${dark ? 'rgba(255,51,102,0.15)' : 'rgba(255,255,255,0.06)'}`,
                }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content || '') }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const textValue = value => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
};

function SolveView({ issue, onRefresh }) {
  const [solve, setSolve] = useState(issue.solve || null);
  const [objective, setObjective] = useState(issue.solve?.inputs?.objective || '');
  const [constraints, setConstraints] = useState(issue.solve?.inputs?.constraints || '');
  const [availableData, setAvailableData] = useState(issue.solve?.inputs?.available_data || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSolve(issue.solve || null);
    setObjective(issue.solve?.inputs?.objective || '');
    setConstraints(issue.solve?.inputs?.constraints || '');
    setAvailableData(issue.solve?.inputs?.available_data || '');
    setNote('');
    setError('');
  }, [issue.id, issue.solve]);

  const generate = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(issue.id)}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, constraints, available_data: availableData }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Error ${response.status}`);
      setSolve(data);
      await onRefresh();
    } catch (err) {
      setError(err.message || 'No se pudo generar la solución');
    } finally { setBusy(false); }
  };

  const review = async decision => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(issue.id)}/solve/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || `Error ${response.status}`);
      setSolve(data); setNote('');
      await onRefresh();
    } catch (err) {
      setError(err.message || 'No se pudo guardar la revisión');
    } finally { setBusy(false); }
  };

  const card = { padding: 16, border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,0.025)' };
  const label = { fontSize: 11, color: 'var(--gold)', letterSpacing: 1, fontWeight: 700, marginBottom: 9 };
  const list = values => (values || []).map((value, index) => <li key={index}>{textValue(value)}</li>);
  const status = solve?.human_review?.status || 'pending';
  const statusLabel = status === 'approved' ? 'APROBADA' : status === 'revision_requested' ? 'CORRECCIÓN SOLICITADA' : 'PENDIENTE DE DECISIÓN';
  const statusColor = status === 'approved' ? '#00ff88' : status === 'revision_requested' ? '#ff9500' : '#00d4ff';

  return (
    <div style={{ padding: '20px 24px 36px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <div style={label}>DATOS PARA RESOLVER</div>
        <div style={{ color: 'var(--text-mid)', fontSize: 12.5, marginBottom: 12 }}>
          Completalos si los conocés. Lo que falte quedará señalado como información pendiente.
        </div>
        <input className="agent-input" value={objective} onChange={e => setObjective(e.target.value)}
          placeholder="Objetivo: ¿qué resultado querés conseguir?" disabled={busy}
          style={{ width: '100%', marginBottom: 9 }} />
        <textarea className="issue-textarea" value={availableData} onChange={e => setAvailableData(e.target.value)}
          placeholder="Datos disponibles, recursos o herramientas" disabled={busy}
          style={{ width: '100%', minHeight: 68, marginBottom: 9 }} />
        <textarea className="issue-textarea" value={constraints} onChange={e => setConstraints(e.target.value)}
          placeholder="Restricciones: tiempo, presupuesto, normativa, tecnología, personas..." disabled={busy}
          style={{ width: '100%', minHeight: 68 }} />
        <button className="issue-submit-btn" onClick={generate} disabled={busy}
          style={{ marginTop: 12, width: 'auto', alignSelf: 'flex-start' }}>
          {busy ? '⏳ Planificando y verificando…' : solve ? '↻ Regenerar solución' : '⬡ Generar solución verificable'}
        </button>
        {error && <div className="issue-error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {solve && (<>
        <div style={{ ...card, borderColor: `${statusColor}55`, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ ...label, color: statusColor, marginBottom: 4 }}>{statusLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
              Evidencia: {solve.evidence_mode === 'chunks' ? `${solve.citations?.length || 0} pasajes de la biblioteca` : 'conocimiento general, sin respaldo suficiente en la biblioteca'}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{solve.version}</div>
        </div>

        <div style={card}>
          <div style={label}>COMPRENSIÓN DEL PROBLEMA</div>
          <div style={{ lineHeight: 1.65 }}>{textValue(solve.problem_understanding)}</div>
          {(solve.assumptions || []).length > 0 && <><div style={{ ...label, marginTop: 15 }}>SUPUESTOS A VALIDAR</div><ul>{list(solve.assumptions)}</ul></>}
          {(solve.missing_information || []).length > 0 && <><div style={{ ...label, marginTop: 15, color: '#ff9500' }}>INFORMACIÓN FALTANTE</div><ul>{list(solve.missing_information)}</ul></>}
        </div>

        <div style={card}>
          <div style={label}>ALTERNATIVAS</div>
          {(solve.alternatives || []).map((alternative, index) => (
            <div key={alternative.id || index} style={{ padding: '12px 0', borderTop: index ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontWeight: 700, color: '#00d4ff' }}>{alternative.id || `A${index + 1}`} · {textValue(alternative.title)}</div>
              <div style={{ margin: '7px 0', lineHeight: 1.6 }}>{textValue(alternative.description)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>Fundamento: {textValue(alternative.foundation)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontSize: 12.5 }}>
                <div><b style={{ color: '#00ff88' }}>A favor</b><ul>{list(alternative.pros)}</ul></div>
                <div><b style={{ color: '#ff9500' }}>En contra</b><ul>{list(alternative.cons)}</ul></div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...card, borderColor: 'rgba(255,51,102,0.35)' }}>
          <div style={{ ...label, color: '#ff3366' }}>VERIFICACIÓN CRÍTICA · {textValue(solve.critical_review?.verdict).toUpperCase()}</div>
          {(solve.critical_review?.findings || []).map((finding, index) => (
            <div key={index} style={{ marginBottom: 9, lineHeight: 1.55 }}>
              <b>[{textValue(finding.severity).toUpperCase()}]</b> {textValue(finding.finding)}
              {finding.action && <div style={{ color: 'var(--text-mid)', fontSize: 12.5 }}>Acción: {textValue(finding.action)}</div>}
            </div>
          ))}
          {(solve.critical_review?.required_changes || []).length > 0 && <><div style={{ ...label, marginTop: 14 }}>CAMBIOS REQUERIDOS</div><ul>{list(solve.critical_review.required_changes)}</ul></>}
          {(solve.critical_review?.evidence_gaps || []).length > 0 && <><div style={{ ...label, marginTop: 14 }}>VACÍOS DE EVIDENCIA</div><ul>{list(solve.critical_review.evidence_gaps)}</ul></>}
        </div>

        <div style={{ ...card, borderColor: 'rgba(0,255,136,0.25)' }}>
          <div style={{ ...label, color: '#00ff88' }}>RECOMENDACIÓN · {textValue(solve.recommendation?.alternative_id)}</div>
          <div style={{ lineHeight: 1.65 }}>{textValue(solve.recommendation?.why)}</div>
          {(solve.recommendation?.conditions || []).length > 0 && <ul>{list(solve.recommendation.conditions)}</ul>}
        </div>

        <div style={card}>
          <div style={label}>PROCESO FUTURO</div>
          {(solve.future_process?.steps || []).map((step, index) => (
            <span key={step.id || index} style={{ display: 'inline-block', margin: '3px 5px 3px 0', padding: '6px 9px', borderRadius: 5, background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.25)', fontSize: 12 }}>
              {index + 1}. {textValue(step.label)}
            </span>
          ))}
        </div>

        <div style={card}>
          <div style={label}>ROADMAP</div>
          {(solve.roadmap || []).map((phase, index) => <div key={index} style={{ marginBottom: 12 }}>
            <b>{index + 1}. {textValue(phase.phase)}</b>
            <ul>{list(phase.actions)}</ul>
            {(phase.exit_criteria || []).length > 0 && <div style={{ color: 'var(--text-mid)', fontSize: 12.5 }}>Criterio de salida: {(phase.exit_criteria || []).map(textValue).join(' · ')}</div>}
          </div>)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={card}><div style={label}>RIESGOS</div>{(solve.risks || []).map((risk, i) => <div key={i} style={{ marginBottom: 10, fontSize: 12.5 }}><b>{textValue(risk.risk)}</b><div style={{ color: 'var(--text-mid)' }}>{textValue(risk.probability)} / {textValue(risk.impact)} · {textValue(risk.mitigation)}</div></div>)}</div>
          <div style={card}><div style={label}>KPIs</div>{(solve.kpis || []).map((kpi, i) => <div key={i} style={{ marginBottom: 10, fontSize: 12.5 }}><b>{textValue(kpi.name)}</b><div style={{ color: 'var(--text-mid)' }}>{textValue(kpi.measurement)}</div><div style={{ color: 'var(--text-dim)' }}>{textValue(kpi.target)}</div></div>)}</div>
        </div>

        {(solve.citations || []).length > 0 && <div style={card}>
          <div style={label}>EVIDENCIA UTILIZADA</div>
          {solve.citations.map(citation => <div key={citation.chunk_id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 12.5 }}>
            <b>[{citation.marker}] {citation.label}</b>{citation.page ? ` · página ${citation.page}` : ''}
            <div style={{ color: 'var(--text-mid)', marginTop: 4 }}>{citation.excerpt}</div>
          </div>)}
        </div>}

        <div style={{ ...card, borderColor: 'rgba(245,166,35,0.35)' }}>
          <div style={label}>DECISIÓN HUMANA</div>
          <textarea className="issue-textarea" value={note} onChange={e => setNote(e.target.value)} disabled={busy}
            placeholder="Comentario o correcciones necesarias" style={{ width: '100%', minHeight: 72 }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="issue-new-btn" onClick={() => review('approved')} disabled={busy}>✓ Aprobar solución</button>
            <button className="issue-new-btn" onClick={() => review('revision_requested')} disabled={busy || !note.trim()}>↺ Solicitar corrección</button>
          </div>
          {solve.human_review?.note && <div style={{ marginTop: 10, color: 'var(--text-mid)', fontSize: 12.5 }}>Última decisión: {solve.human_review.note}</div>}
        </div>
      </>)}
    </div>
  );
}

// ── Formulario de nuevo issue ───────────────────────────────────────────────
// Subcomponente para evitar que el re-render afecte la lista lateral al escribir
function NewIssueForm({ onRefresh, setSelectedIssueId, onOpenProcess, setDetailTab }) {
  // Architect en el alta: clasificar la intervención antes de diseñar nada.
  const [modoArchitect, setModoArchitect] = useState(false);
  const [archBusy, setArchBusy]           = useState(false);
  const [archError, setArchError]         = useState('');
  const [desc, setDesc]           = useState('');
  const [refUrl, setRefUrl]       = useState('');
  const [file, setFile]           = useState(null);
  const [dragOver, setDragOver]   = useState(false);
  const [status, setStatus]       = useState({ state: 'idle', message: '', progress: 0, result: null });
  const pollRef                   = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const startPolling = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/issue/status');
        const s = await r.json();
        setStatus(s);
        if (s.state === 'done')  { clearInterval(pollRef.current); onRefresh(); }
        if (s.state === 'error') { clearInterval(pollRef.current); }
      } catch { /* keep polling */ }
    }, 800);
  }, [onRefresh]);

  const submitNewIssue = useCallback(async () => {
    const val = desc.trim();
    if (!val) return;
    setStatus({ state: 'processing', message: 'Enviando…', progress: 5, result: null });
    const form = new FormData();
    form.append('descripcion', val);
    if (refUrl.trim()) form.append('url', refUrl.trim());
    if (file) form.append('file', file);
    try {
      const r = await fetch('/api/issue', { method: 'POST', body: form });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setStatus({ state: 'error', message: d.detail || `Error ${r.status}`, progress: 0, result: null });
        return;
      }
      startPolling();
    } catch {
      setStatus({ state: 'error', message: 'No se pudo conectar con el backend', progress: 0, result: null });
    }
  }, [desc, refUrl, file, startPolling]);

  const resetNewIssue = useCallback(async () => {
    clearInterval(pollRef.current);
    await fetch('/api/issue/reset', { method: 'POST' }).catch(() => {});
    setStatus({ state: 'idle', message: '', progress: 0, result: null });
    setDesc(''); setRefUrl(''); setFile(null);
  }, []);

  const onDragOver  = e => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop      = e => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const isProcessing = status.state === 'processing';
  const isDone       = status.state === 'done';
  const isError      = status.state === 'error';
  const result       = status.result;

  // Ordenados por umbral ascendente: el .find(progress <= at) devuelve el paso correcto.
  const STEPS = [
    { at: 15, label: 'Obteniendo contenido de referencia…' },
    { at: 25, label: 'Analizando el problema…' },
    { at: 40, label: 'Agente 1/4 — Análisis de procesos…' },
    { at: 55, label: 'Agente 2/4 — Gestión de riesgos…' },
    { at: 68, label: 'Agente 3/4 — Perspectiva creativa…' },
    { at: 80, label: 'Agente 4/4 — Red Team epistémico…' },
    { at: 90, label: 'Guardando en el grafo y extrayendo flujograma…' },
    { at: 95, label: 'Finalizando…' },
    { at: 100, label: 'Listo' },
  ];
  const step = STEPS.find(s => (status.progress || 0) <= s.at) || STEPS[STEPS.length - 1];

  return (
    <div className="issue-body" style={{ height: '100%', overflowY: 'auto', padding: '32px 48px' }}>
      <div className="issue-header" style={{ padding: '0 0 24px 0', borderBottom: 'none' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--gold)', letterSpacing: 0.5 }}>Nuevo Proceso o Problema</span>
      </div>

      {!isDone ? (
        <div className="issue-input-section" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Dos intenciones del módulo Issue: diagnosticar (acá) o diseñar un proceso. */}
          {onOpenProcess && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{
                flex: 1, padding: '12px 14px', borderRadius: 8,
                border: '1px solid var(--gold)', background: 'rgba(245,166,35,0.08)',
                color: 'var(--gold)', fontSize: 13, fontWeight: 600,
              }}>
                ⚠ Diagnosticar un problema
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-mid)', marginTop: 3 }}>Estás acá — describilo abajo</div>
              </div>
              <button onClick={onOpenProcess} style={{
                flex: 1, padding: '12px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)',
                color: 'var(--text)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              }}>
                ⚙ Diseñar un proceso nuevo →
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-mid)', marginTop: 3 }}>Flujograma + qué medir + brief</div>
              </button>
              {/* ARCHITECT en el ALTA, no sólo en el detalle: su valor es decidir
                  ANTES de construir. Escondido detrás de "abrí un expediente y mirá
                  una pestaña" llegaba tarde a la pregunta que responde. */}
              <button onClick={() => setModoArchitect(v => !v)} style={{
                flex: 1, padding: '12px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${modoArchitect ? 'var(--accent)' : 'var(--border)'}`,
                background: modoArchitect ? 'var(--accent-glow)' : 'rgba(255,255,255,0.03)',
                color: modoArchitect ? 'var(--accent-hi)' : 'var(--text)',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              }}>
                ⬢ ¿Qué corresponde construir?
                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-mid)', marginTop: 3 }}>
                  Architect · clasifica antes de construir
                </div>
              </button>
            </div>
          )}

          {modoArchitect && (
            <div style={{
              margin: '4px 0 18px', padding: '16px 18px', borderRadius: 8,
              border: '1px solid var(--border-hi)', background: 'rgba(0,0,0,.3)',
            }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 12 }}>
                Contá el problema abajo y Architect decide qué clase de intervención
                corresponde antes de diseñar nada: <b>rediseño de proceso</b>,
                <b> reglas</b>, <b>datos/BI</b>, <b>IA asistiva</b>, <b>agente</b> o
                <b> no implementar</b>. Recupera evidencia de tu grafo, compara las seis
                rutas en una matriz y un verificador independiente objeta el resultado.
              </div>
              <button
                disabled={archBusy || !desc.trim()}
                onClick={async () => {
                  setArchBusy(true); setArchError('');
                  try {
                    const r = await fetch('/api/architect/analyze', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        case_name: desc.trim().slice(0, 70),
                        problem: desc.trim(),
                      }),
                    });
                    const d = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(d.detail || ('Error ' + r.status));
                    onRefresh?.();
                    if (d.expediente_id) setSelectedIssueId(d.expediente_id);
                    setDetailTab('clasificacion');
                    setModoArchitect(false);
                  } catch (e) { setArchError(e.message); }
                  finally { setArchBusy(false); }
                }}
                style={{
                  padding: '11px 18px', borderRadius: 6, border: 0,
                  cursor: archBusy ? 'wait' : 'pointer',
                  background: 'var(--grad)', color: '#05070B',
                  fontWeight: 700, fontSize: 13, opacity: (!desc.trim() ? .45 : 1),
                }}
              >
                {archBusy ? 'Recuperando · comparando · verificando…' : 'Clasificar con Architect'}
              </button>
              {archError && <div className="issue-error" style={{ marginTop: 10 }}>{archError}</div>}
            </div>
          )}

          <div className="issue-hint" style={{ fontSize: 14 }}>
            Describí un problema o un proceso paso a paso. El agente intentará extraer un flujograma interactivo y conectarlo automáticamente con tu base de conocimientos.
          </div>

          <textarea
            className="issue-textarea"
            placeholder="Ej: Tengo un proceso de 3 etapas. Etapa 1: Recepción de documento. Etapa 2: Análisis (Acá es donde falla frecuentemente). Etapa 3: Entrega de reporte final..."
            value={desc}
            onChange={e => setDesc(e.target.value)}
            disabled={isProcessing}
          />

          <div style={{ display: 'flex', gap: 16, width: '100%', alignItems: 'center' }}>
            <input
              className="issue-url-input"
              placeholder="URL de referencia (opcional)…"
              value={refUrl}
              onChange={e => setRefUrl(e.target.value)}
              disabled={isProcessing}
            />

            <label
              className={`issue-file-drop${dragOver ? ' drag-over' : ''}${isProcessing ? ' disabled' : ''}`}
              style={{ width: 280, height: 46, borderRadius: 8, flexShrink: 0, margin: 0 }}
              onDragOver={isProcessing ? undefined : onDragOver}
              onDragLeave={isProcessing ? undefined : onDragLeave}
              onDrop={isProcessing ? undefined : onDrop}
            >
              <input
                type="file"
                accept=".pdf,.html,.htm,.txt,.md,.xlsx,.xls"
                style={{ display: 'none' }}
                disabled={isProcessing}
                onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }}
              />
              <span className="issue-file-label" style={{ fontSize: 13 }}>
                {file ? `📄 ${file.name}` : dragOver ? 'Soltá el archivo' : '+ Adjuntar (PDF, HTML, TXT)'}
              </span>
              {file && !isProcessing && (
                <button className="issue-file-clear" onClick={e => { e.preventDefault(); setFile(null); }}>✕</button>
              )}
            </label>
          </div>

          {isProcessing && (
            <div className="issue-progress-wrap" style={{ marginTop: 10 }}>
              <div className="issue-progress-bar-track">
                <div className="issue-progress-bar-fill" style={{ width: `${status.progress}%` }} />
              </div>
              <div className="issue-progress-step" style={{ fontSize: 12, marginTop: 4 }}>{step.label}</div>
            </div>
          )}

          {isError && (
            <div className="issue-error">
              <span>{status.message}</span>
              <button className="issue-retry-btn" onClick={resetNewIssue}>↺ Reintentar</button>
            </div>
          )}

          <button
            className="issue-submit-btn"
            style={{ marginTop: 16, height: 50, fontSize: 15, borderRadius: 8 }}
            onClick={submitNewIssue}
            disabled={isProcessing || !desc.trim()}
          >
            {isProcessing ? '⏳ Generando proceso y analizando…' : '⬡ Generar Flujograma / Analizar Problema'}
          </button>
        </div>
      ) : (
        <div className="issue-result" style={{ paddingBottom: 32 }}>
          <div className="issue-result-label" style={{ fontSize: 14 }}>PROCESO DETECTADO EXITOSAMENTE</div>
          <div className="issue-result-title" style={{ fontSize: 24, margin: '12px 0' }}>{result?.label}</div>

          {result?.synthesis && (
            <div style={{ marginTop: 20 }}>
              <SynthesisView syn={result.synthesis} />
            </div>
          )}

          <div className="issue-result-actions" style={{ marginTop: 24, display: 'flex', gap: 16 }}>
            <button
              className="issue-new-btn"
              style={{ padding: '12px 24px', fontSize: 14, borderRadius: 8 }}
              onClick={() => { setSelectedIssueId(result?.nodo_id); onRefresh(); }}
            >
              Abrir el issue (reporte + flujograma + chat)
            </button>
            <button
              className="issue-new-btn"
              style={{ padding: '12px 24px', fontSize: 14, borderRadius: 8, background: 'transparent', border: '1px solid var(--gold)' }}
              onClick={resetNewIssue}
            >
              + Crear otro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Panel principal ─────────────────────────────────────────────────────────

/* ── Clasificación · Architect acoplado a Issue ───────────────────────────────
   Architect deja de ser una pantalla aparte y pasa a ser el PRIMER PASO del
   expediente: antes de desarrollar una solución hay que decidir qué clase de
   intervención corresponde. Vive acá porque la pregunta "¿esto amerita construir
   algo?" es parte del issue, no un módulo hermano. */
const ARCH_RUTAS = [
  { key: 'redesign',  label: 'Rediseño',       hint: 'ordenar el proceso',      tone: '#2DD4BF' },
  { key: 'rules',     label: 'Reglas',         hint: 'determinístico',          tone: '#3B82F6' },
  { key: 'data',      label: 'Datos / BI',     hint: 'visibilidad y calidad',   tone: '#06B6D4' },
  { key: 'assistive', label: 'IA asistiva',    hint: 'criterio con control',    tone: '#A855F7' },
  { key: 'agent',     label: 'Agente',         hint: 'acción delegada',         tone: '#EC4899' },
  { key: 'none',      label: 'No implementar', hint: 'la evidencia no alcanza', tone: '#EAB308' },
];

const ARCH_CRIT = [
  ['impact', 'Impacto'], ['data_readiness', 'Datos'], ['complexity', 'Simpleza'],
  ['risk', 'Seguridad'], ['cost', 'Costo'],
];

function ClasificacionView({ issue, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sv = issue?.solve || null;
  const clase = sv?.classification || null;
  const review = sv?.critical_review || {};
  const matriz = Array.isArray(sv?.matrix) ? sv.matrix : [];

  const clasificar = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/architect/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_name: issue.label,
          problem: issue.desc || issue.fragmento || issue.label,
          objective: sv?.inputs?.objective || '',
          current_process: sv?.inputs?.current_process || '',
          available_data: sv?.inputs?.available_data || '',
          constraints: sv?.inputs?.constraints || '',
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || ('Error ' + r.status));
      onRefresh?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [issue, sv, onRefresh]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
      <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)', marginBottom: 14 }}>
        QUÉ CLASE DE INTERVENCIÓN CORRESPONDE
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 22 }}>
        {ARCH_RUTAS.map(r => {
          const on = clase === r.key;
          return (
            <div key={r.key} style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center',
              gap: 11, padding: '11px 13px', borderRadius: 6,
              border: '1px solid ' + (on ? r.tone : 'var(--border)'),
              background: on ? (r.tone + '18') : 'rgba(0,0,0,0.22)',
              boxShadow: on ? ('-3px 0 0 0 ' + r.tone) : 'none',
            }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%',
                             background: r.tone, opacity: on ? 1 : 0.4 }} />
              <span style={{ fontSize: 13, fontWeight: 600,
                             color: on ? 'var(--text)' : 'var(--text-mid)' }}>{r.label}</span>
              <span style={{ fontSize: 10.5, color: 'var(--text-dim)',
                             fontFamily: 'var(--font-mono)' }}>{r.hint}</span>
            </div>
          );
        })}
      </div>

      {!clase && (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 14 }}>
            Este expediente todavía no fue clasificado. Architect recupera evidencia del
            grafo, compara las seis rutas en una matriz común y un verificador
            independiente objeta el resultado antes de que vos decidas.
          </div>
          <button onClick={clasificar} disabled={busy}
            style={{
              padding: '11px 18px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer',
              border: 0, background: 'var(--grad)', color: '#05070B',
              fontWeight: 700, fontSize: 13,
            }}>
            {busy ? 'Recuperando · comparando · verificando…' : 'Clasificar con Architect'}
          </button>
          {error && <div className="issue-error" style={{ marginTop: 12 }}>{error}</div>}
        </>
      )}

      {!!matriz.length && (
        <>
          <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-dim)',
                        fontFamily: 'var(--font-mono)', margin: '8px 0 10px' }}>
            MATRIZ COMPARATIVA
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '7px 8px', color: 'var(--text-dim)',
                               borderBottom: '1px solid var(--border)' }}>Ruta</th>
                  {ARCH_CRIT.map(([k, t]) => (
                    <th key={k} style={{ padding: '7px 8px', color: 'var(--text-dim)',
                                         borderBottom: '1px solid var(--border)' }}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matriz.map((row, i) => {
                  const meta = ARCH_RUTAS.find(r => r.key === row.route);
                  const on = row.route === clase;
                  return (
                    <tr key={i} style={{ background: on ? 'rgba(90,200,250,.07)' : 'transparent' }}>
                      <td style={{ padding: '9px 8px', borderBottom: '1px solid var(--border)',
                                   color: on ? 'var(--text)' : 'var(--text-mid)' }}>
                        {meta?.label || row.route}
                      </td>
                      {ARCH_CRIT.map(([k]) => (
                        <td key={k} style={{ padding: '9px 8px', textAlign: 'center',
                                             borderBottom: '1px solid var(--border)',
                                             color: 'var(--text-mid)' }}>{row[k]}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {review.objection && (
        <div style={{ padding: '13px 14px', borderRadius: 6,
                      background: 'rgba(255,90,120,0.07)',
                      border: '1px solid rgba(255,90,120,0.26)', borderLeftWidth: 3 }}>
          <b style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9.5,
                      letterSpacing: 1, color: '#FF8FA6', marginBottom: 6 }}>
            OBJECIÓN DEL VERIFICADOR
          </b>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: '#FFD5DD' }}>
            {review.objection}
          </p>
        </div>
      )}
    </div>
  );
}

export default function IssuePanel({ allNodes, onClose, onRefresh, onNavigate, onOpenProcess }) {
  const [selectedIssueId, setSelectedIssueId] = useState('new');
  const [search, setSearch] = useState('');

  // Chat por issue — persistido en localStorage para no perder el diagnóstico
  // al cerrar el panel (mismo criterio que AgentPanel).
  const CHATS_KEY = 'algedi_issue_chats';
  // Estructura: { [issueId]: { [etapaId | 'general']: mensajes[] } } — un hilo POR ETAPA.
  // Migra el formato viejo (un solo array por issue) al hilo "general".
  const [chatHistories, setChatHistories] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
      const out = {};
      for (const [iid, v] of Object.entries(raw || {})) {
        if (Array.isArray(v)) out[iid] = { general: v };
        else if (v && typeof v === 'object') out[iid] = v;
      }
      return out;
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(chatHistories)); } catch {}
  }, [chatHistories]);

  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedStage, setSelectedStage] = useState(null);
  const [detailTab, setDetailTab] = useState('analisis');
  const messagesEndRef = useRef(null);

  const issues = useMemo(() => {
    const q = search.toLowerCase();
    return allNodes
      .filter(n => n.is_issue)
      .filter(n => !q || n.label.toLowerCase().includes(q) || (n.desc || '').toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allNodes, search]);

  const selectedIssue = useMemo(() => issues.find(i => i.id === selectedIssueId), [issues, selectedIssueId]);
  const stageKey = selectedStage?.id || 'general';   // hilo de la etapa en foco (o 'general')
  const currentChat = (selectedIssueId !== 'new' && chatHistories[selectedIssueId]?.[stageKey]) || [];

  // Reset al cambiar de issue: foco de etapa y pestaña por defecto (reporte si existe).
  useEffect(() => {
    setSelectedStage(null);
    const iss = issues.find(i => i.id === selectedIssueId);
    setDetailTab(iss?.synthesis ? 'analisis' : (iss?.flujograma?.etapas?.length ? 'flujo' : 'chat'));
  }, [selectedIssueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll chat
  useEffect(() => {
    if (selectedIssueId !== 'new' && detailTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentChat, isTyping, selectedIssueId, detailTab]);

  const clearChat = useCallback(() => {
    if (!selectedIssue) return;
    const key = selectedStage?.id || 'general';
    setChatHistories(prev => {
      const ic = { ...(prev[selectedIssue.id] || {}) };
      delete ic[key];
      return { ...prev, [selectedIssue.id]: ic };
    });
  }, [selectedIssue, selectedStage]);

  const deleteIssue = useCallback(async () => {
    if (!selectedIssue) return;
    if (!window.confirm(`¿Eliminar "${selectedIssue.label}" del grafo? Esta acción no se puede deshacer.`)) return;
    const clave = await pedirClave(`eliminar «${selectedIssue.label}»`);
    if (!clave) return;
    try {
      const r = await fetch(`/api/node/${encodeURIComponent(selectedIssue.id)}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clave),
      });
      if (r.status === 403) { avisarClaveIncorrecta(); return; }
      setChatHistories(prev => { const next = { ...prev }; delete next[selectedIssue.id]; return next; });
      setSelectedIssueId('new');
      onRefresh();
    } catch { /* el refresh mostrará el estado real */ }
  }, [selectedIssue, onRefresh]);

  // ---- Flujograma (React Flow) ----
  const initialElements = useMemo(() => {
    if (!selectedIssue || !selectedIssue.flujograma) return { nodes: [], edges: [] };
    const { etapas = [], conexiones = [] } = selectedIssue.flujograma;

    // Layout por niveles (BFS sobre las conexiones): las ramas se abren en columnas
    // en vez de apilarse todas en una sola línea vertical.
    const children = {};
    conexiones.forEach(c => { (children[c.source] ??= []).push(c.target); });
    const targets = new Set(conexiones.map(c => c.target));
    const raiz = etapas.find(e => !targets.has(e.id)) || etapas[0];
    const nivel = {};
    if (raiz) {
      const q = [[raiz.id, 0]]; nivel[raiz.id] = 0;
      while (q.length) {
        const [id, d] = q.shift();
        (children[id] || []).forEach(h => {
          if (nivel[h] === undefined) { nivel[h] = d + 1; q.push([h, d + 1]); }
        });
      }
    }
    let maxNivel = Math.max(0, ...Object.values(nivel).filter(Number.isFinite));
    etapas.forEach(e => { if (nivel[e.id] === undefined) { maxNivel += 1; nivel[e.id] = maxNivel; } });
    const porNivel = {};
    etapas.forEach(e => { (porNivel[nivel[e.id]] ??= []).push(e); });
    const NODE_W = 250, COL_GAP = 60, ROW_H = 150;
    const posDe = {};
    Object.entries(porNivel).forEach(([lvl, filas]) => {
      const totalW = filas.length * NODE_W + (filas.length - 1) * COL_GAP;
      const x0 = Math.max(40, (900 - totalW) / 2);
      filas.forEach((e, i) => { posDe[e.id] = { x: x0 + i * (NODE_W + COL_GAP), y: Number(lvl) * ROW_H + 40 }; });
    });

    const rfNodes = etapas.map(etapa => {
      const sel = selectedStage?.id === etapa.id;
      const tieneChat = (chatHistories[selectedIssue.id]?.[etapa.id]?.length || 0) > 0;
      return {
      id: etapa.id,
      data: { label: `${tieneChat ? '💬 ' : ''}${etapa.label}\n\n${etapa.desc || ''}` },
      position: posDe[etapa.id] || { x: 300, y: 40 },
      style: {
        background: sel ? 'rgba(245,166,35,0.2)' : 'rgba(10,14,30,0.9)',
        color: sel ? '#f5a623' : '#c4c8d6',
        border: `1px solid ${sel ? '#f5a623' : (tieneChat ? 'rgba(0,212,255,0.55)' : 'rgba(80,100,150,0.4)')}`,
        borderRadius: '6px',
        width: 250,
        fontSize: '12px',
        textAlign: 'center',
        cursor: 'pointer',
        boxShadow: sel ? '0 0 15px rgba(245,166,35,0.3)' : 'none',
        transition: 'all 0.2s'
      }
    };
    });

    const rfEdges = conexiones.map((c, i) => ({
      id: `e${i}-${c.source}-${c.target}`,
      source: c.source,
      target: c.target,
      label: c.label || '',
      animated: true,
      style: { stroke: '#ff3060', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#ff3060' }
    }));

    return { nodes: rfNodes, edges: rfEdges };
  }, [selectedIssue, selectedStage, chatHistories]);

  // ---- Chat del issue ----
  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedIssue) return;

    const userMsg = { role: 'user', text: inputText };
    const key = selectedStage?.id || 'general';   // el hilo de la etapa en foco
    const push = (msg) => setChatHistories(prev => {
      const ic = { ...(prev[selectedIssue.id] || {}) };
      ic[key] = [...(ic[key] || []), msg];
      return { ...prev, [selectedIssue.id]: ic };
    });
    push(userMsg);
    setInputText('');
    setIsTyping(true);

    try {
      let contextPrompt = `Contexto del Proceso/Issue:
Título: ${selectedIssue.label}
Descripción general: ${selectedIssue.desc || 'Sin descripción'}
`;

      if (selectedStage) {
        contextPrompt += `\nATENCIÓN: El usuario está preguntando Específicamente sobre la Etapa "${selectedStage.label}":\n${selectedStage.desc}\nEnfoca tu búsqueda de soluciones en esta etapa.`;
      }

      contextPrompt += `\n\nPregunta del usuario: ${inputText}`;

      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: contextPrompt, node_ids: [selectedIssue.id] })
      });
      const data = await res.json();

      let texto = data.result || 'No se recibió respuesta.';
      // Mostrar la afinidad SOLO cuando hay respaldo real del grafo (no en cada respuesta).
      if (typeof data.max_sim === 'number' && data.max_sim >= 0.4) {
        texto += `\n\n<small style="color:#6a7686">⊙ fundado en tu grafo · afinidad ${Math.round(data.max_sim * 100)}%</small>`;
      }
      push({ role: 'assistant', text: texto });
    } catch (e) {
      push({ role: 'assistant', text: 'Error de conexión con el agente.' });
    } finally {
      setIsTyping(false);
    }
  };

  const TABS = [
    { id: 'clasificacion', label: '⬢ Clasificación' },
    { id: 'analisis', label: '⬡ Reporte' },
    { id: 'solve',    label: '◎ Solución' },
    { id: 'flujo',    label: '⛬ Flujograma' },
    { id: 'chat',     label: '💬 Chat' },
  ];

  return (
    <div className="library-overlay">
      <div className="library-panel" style={{ flexDirection: 'row', width: 'min(1300px, 95vw)', height: '88vh', maxHeight: '900px' }}>

        {/* PANEL IZQUIERDO: LISTA DE ISSUES */}
        <div style={{ width: '320px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)' }}>
          <div className="library-header" style={{ padding: '20px 16px' }}>
            <span className="library-title" style={{ fontSize: 14, letterSpacing: 1.5 }}>⚠ Procesos y Problemas</span>
          </div>

          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setSelectedIssueId('new')}
              style={{
                width: '100%', padding: '12px', marginBottom: '16px', borderRadius: '6px',
                background: selectedIssueId === 'new' ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${selectedIssueId === 'new' ? 'var(--gold)' : 'transparent'}`,
                color: selectedIssueId === 'new' ? 'var(--gold)' : 'var(--text)',
                cursor: 'pointer', fontWeight: 600, fontSize: 13, transition: 'all 0.2s'
              }}
            >
              + Declarar Nuevo Proceso o Problema
            </button>
            <input
              className="lib-search"
              style={{ width: '100%', height: 40, borderRadius: 6, padding: '0 12px' }}
              placeholder="Buscar existentes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {issues.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', marginTop: 24 }}>No hay procesos activos.</div>
            ) : (
              issues.map(issue => (
                <div
                  key={issue.id}
                  onClick={() => setSelectedIssueId(issue.id)}
                  style={{
                    padding: '14px', borderRadius: '6px', cursor: 'pointer', marginBottom: '10px',
                    border: `1px solid ${selectedIssueId === issue.id ? 'rgba(255,48,96,0.6)' : 'var(--border)'}`,
                    background: selectedIssueId === issue.id ? 'rgba(255,48,96,0.1)' : 'rgba(0,0,0,0.2)',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{issue.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {issue.desc || 'Sin descripción...'}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    {issue.synthesis && (
                      <span style={{ fontSize: 10, color: '#00d4ff', fontWeight: 600, letterSpacing: 0.5 }}>⬡ REPORTE</span>
                    )}
                    {issue.flujograma?.etapas?.length > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 600, letterSpacing: 0.5 }}>⛬ FLUJOGRAMA</span>
                    )}
                    {issue.solve && (
                      <span style={{ fontSize: 10, color: issue.solve.human_review?.status === 'approved' ? '#00ff88' : '#00d4ff', fontWeight: 600, letterSpacing: 0.5 }}>
                        ◎ {issue.solve.human_review?.status === 'approved' ? 'APROBADA' : 'SOLUCIÓN'}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* PANEL DERECHO: CONTENIDO */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg, rgba(9, 12, 26, 0.99) 0%, rgba(5, 7, 18, 1) 100%)', position: 'relative' }}>
          <button className="panel-close" onClick={onClose} style={{ position: 'absolute', top: 16, right: 20, zIndex: 10, fontSize: 16 }}>✕</button>

          {selectedIssueId === 'new' ? (
            <NewIssueForm onRefresh={onRefresh} setSelectedIssueId={setSelectedIssueId} onOpenProcess={onOpenProcess} setDetailTab={setDetailTab} />
          ) : (
            // --- VISTA: DETALLE DEL ISSUE (pestañas Reporte / Flujograma / Chat) ---
            selectedIssue && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

                {/* HEADER: título, eliminar y pestañas */}
                <div style={{ padding: '18px 24px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingRight: 36 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: '#ff3060' }}>{selectedIssue.label}</div>
                      {selectedIssue.desc && (
                        <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 6, lineHeight: 1.5 }}>{selectedIssue.desc}</div>
                      )}
                    </div>
                    <button onClick={deleteIssue} title="Eliminar este issue del grafo"
                      style={{
                        background: 'none', border: '1px solid rgba(255,48,96,0.35)', color: '#ff3060',
                        borderRadius: 6, cursor: 'pointer', height: 30, padding: '0 10px', fontSize: 11.5, flexShrink: 0,
                      }}>
                      🗑 Eliminar
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    {TABS.map(t => (
                      <button key={t.id} onClick={() => setDetailTab(t.id)}
                        style={{
                          padding: '9px 16px', fontSize: 12.5, cursor: 'pointer',
                          background: 'none', border: 'none',
                          borderBottom: `2px solid ${detailTab === t.id ? '#ff3060' : 'transparent'}`,
                          color: detailTab === t.id ? '#ff3060' : 'var(--text-mid)', fontWeight: 600,
                        }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PESTAÑA: REPORTE */}
                {detailTab === 'analisis' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                    {selectedIssue.synthesis ? (
                      <SynthesisView syn={selectedIssue.synthesis} />
                    ) : (
                      <div style={{ color: 'var(--text-mid)', fontSize: 13, lineHeight: 1.7, maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
                        Este issue se creó antes de que el reporte quedara guardado en el grafo,
                        así que su análisis se perdió. Eliminalo y declaralo de nuevo para obtener
                        el reporte completo de los 4 agentes — a partir de ahora queda persistido.
                      </div>
                    )}
                  </div>
                )}

                {/* PESTAÑA: ALGEDI SOLVE */}
                {detailTab === 'clasificacion' && (
                  <ClasificacionView issue={selectedIssue} onRefresh={onRefresh} />
                )}

                {detailTab === 'solve' && (
                  <SolveView issue={selectedIssue} onRefresh={onRefresh} />
                )}

                {/* PESTAÑA: FLUJOGRAMA */}
                {detailTab === 'flujo' && (
                  selectedIssue.flujograma?.etapas?.length > 0 ? (
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.6)', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 5, fontSize: 11.5, color: 'var(--gold)', fontWeight: 600, letterSpacing: 1 }}>
                        Seleccioná una etapa para enfocar el chat en ella
                      </div>
                      <ReactFlow
                        nodes={initialElements.nodes}
                        edges={initialElements.edges}
                        onNodeClick={(_, node) => {
                          const etapa = selectedIssue.flujograma.etapas.find(e => e.id === node.id);
                          setSelectedStage(etapa);
                          setDetailTab('chat');
                        }}
                        fitView
                        fitViewOptions={{ padding: 0.2 }}
                        attributionPosition="bottom-right"
                      >
                        <Background color="#5a6ea0" gap={20} size={1} opacity={0.15} />
                        <Controls showInteractive={false} />
                      </ReactFlow>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-mid)', fontSize: 13, padding: 24, textAlign: 'center' }}>
                      Este issue no describe un proceso con etapas — no se extrajo flujograma.
                      {'\n'}Si debería tenerlo, eliminalo y declaralo de nuevo detallando los pasos.
                    </div>
                  )
                )}

                {/* PESTAÑA: CHAT */}
                {detailTab === 'chat' && (<>
                  <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {selectedStage ? (
                      <>
                        <span style={{ fontSize: 12, color: 'var(--gold)', padding: '4px 8px', background: 'rgba(245,166,35,0.2)', borderRadius: 4 }}>
                          Etapa en foco: {selectedStage.label}
                        </span>
                        <button onClick={() => setSelectedStage(null)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: 4 }}>
                          [Quitar foco]
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        Conversando sobre el proceso general — podés enfocar una etapa desde el Flujograma.
                      </span>
                    )}
                    {currentChat.length > 0 && (
                      <button onClick={clearChat} title="Borra esta conversación"
                        style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', color: 'var(--text-mid)', borderRadius: 5, cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>
                        🗑 Borrar conversación
                      </button>
                    )}
                  </div>

                  <div className="agent-messages" style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
                    {currentChat.length === 0 && (
                      <div style={{ color: 'var(--text-mid)', fontSize: 13, textAlign: 'center', marginTop: 40, fontStyle: 'italic' }}>
                        {selectedStage ? `Pregunta sobre la etapa "${selectedStage.label}" y el agente cruzará la consulta con tu biblioteca.` : `Inicia una conversación sobre este proceso.`}
                      </div>
                    )}
                    {currentChat.map((msg, idx) => (
                      <div key={idx} className={`agent-msg ${msg.role}`} style={{ maxWidth: '85%', fontSize: 14, lineHeight: 1.6 }}>
                        {msg.role === 'assistant' ? (
                          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text || '') }} />
                        ) : (
                          <p>{msg.text}</p>
                        )}
                      </div>
                    ))}
                    {isTyping && (
                      <div className="agent-msg assistant">
                        <span className="thinking-dots">Analizando con el grafo</span>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="agent-input-row" style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,48,96,0.15)', flexShrink: 0 }}>
                    <input
                      className="agent-input"
                      style={{ border: '1px solid rgba(255,48,96,0.3)', minHeight: 48, fontSize: 14 }}
                      placeholder={selectedStage ? `Soluciones para la etapa: ${selectedStage.label}...` : "Escribe tu consulta..."}
                      value={inputText}
                      onChange={e => setInputText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(); }}
                      disabled={isTyping}
                    />
                    <button
                      className="agent-send"
                      style={{ borderColor: 'rgba(255,48,96,0.6)', color: '#ff3060', minWidth: 48, fontSize: 18 }}
                      onClick={handleSendMessage}
                      disabled={isTyping || !inputText.trim()}
                    >
                      ➔
                    </button>
                  </div>
                </>)}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
