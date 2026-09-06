import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ArchitectCanvas from './ArchitectCanvas.jsx';

/* ── Architect · Taller de Casos de Algedi ───────────────────────────────────
   CANVAS-FIRST: el flujograma es la pantalla principal, no un tab aparte.
   - Admisión compacta arriba (prompt del problema)
   - Canvas como área de trabajo central
   - Click en nodo → drawer lateral (no cambiar de vista)
   - 6 rutas son SUGERENCIA, no clasificación obligatoria
   ────────────────────────────────────────────────────────────────────────── */

const RUTAS = [
  { key: 'redesign',  label: 'Rediseño',       hint: 'ordenar el proceso',      tone: '#B8F0FF' },
  { key: 'rules',     label: 'Reglas',         hint: 'determinístico',          tone: '#7FDBFF' },
  { key: 'data',      label: 'Datos / BI',     hint: 'visibilidad y calidad',   tone: '#5AC8FA' },
  { key: 'assistive', label: 'IA asistiva',    hint: 'criterio con control',    tone: '#49B6E8' },
  { key: 'agent',     label: 'Agente',         hint: 'acción delegada',         tone: '#2E86B8' },
  { key: 'none',      label: 'No implementar', hint: 'la evidencia no alcanza', tone: '#FFB44D' },
];

export default function ArchitectPanel({ onClose, seccion, onNavigate, onDesarrollar, onAbrirExpediente, allNodes = [] }) {
  // Estado del caso
  const [caseName, setCaseName] = useState('');
  const [problem, setProblem] = useState('');
  const [admisionExpandida, setAdmisionExpandida] = useState(true);
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState('');
  
  // Expedientes (vista alternativa, accesible pero no principal)
  const [vistaExpedientes, setVistaExpedientes] = useState(false);
  const [expedientes, setExpedientes] = useState(null);
  
  // Análisis y sugerencias de rutas
  const [sugerencias, setSugerencias] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);

  // Referencia al canvas para comunicación
  const canvasRef = useRef(null);

  const cargarExpedientes = useCallback(async () => {
    setExpedientes(null);
    try {
      const r = await fetch(`/api/graph?seccion=${encodeURIComponent(seccion)}`);
      const d = await r.json();
      const issues = (d.nodos || []).filter(n => n.is_issue);
      setExpedientes(issues);
    } catch { setExpedientes([]); }
  }, [seccion]);

  // Procesar el problema - FLUJO RÁPIDO (sin chat multi-turno obligatorio)
  // Solo extrae el brief y genera nombre. El análisis de rutas es opcional y separado.
  const procesarProblema = useCallback(async () => {
    const texto = problem.trim();
    if (!texto || texto.length < 10) {
      setError('Describí el problema con al menos una oración.');
      return;
    }
    setPensando(true);
    setError('');
    
    // Generar nombre del caso localmente (sin LLM) para reducir latencia
    if (!caseName) {
      const palabras = texto.split(/\s+/).slice(0, 4).join(' ');
      setCaseName(palabras + (texto.split(/\s+/).length > 4 ? '…' : ''));
    }
    
    // Colapsar admisión inmediatamente para dar feedback
    setAdmisionExpandida(false);
    
    try {
      // Llamada opcional al backend para enriquecer (no bloquea el flujo)
      const r = await fetch('/api/architect/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: [{ role: 'user', content: texto }] 
        }),
      });
      const d = await r.json().catch(() => ({}));
      
      if (r.ok) {
        // Si el LLM generó un nombre mejor, usarlo
        if (d.case_name && d.case_name !== 'Caso sin título') {
          setCaseName(d.case_name);
        }
        // Notificar al canvas que puede generar un flujo inicial
        if (canvasRef.current?.onProblemProcessed) {
          canvasRef.current.onProblemProcessed(d);
        }
      }
      // Si falla, no es crítico - el usuario puede seguir trabajando
    } catch {
      // Silencioso: el canvas sigue funcional aunque falle el enriquecimiento
    } finally {
      setPensando(false);
    }
  }, [problem, caseName]);

  // Analizar el caso completo (opcional, para sugerencias de rutas)
  const analizarCaso = useCallback(async (flowData) => {
    if (!problem.trim()) {
      setError('Primero describí el problema.');
      return;
    }
    setAnalizando(true);
    setSugerencias(null);
    try {
      const r = await fetch('/api/architect/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_name: caseName || 'Caso sin título',
          problem: problem.trim(),
          objective: '',
          current_process: '',
          available_data: '',
          constraints: '',
          expected_value: '',
          flow: flowData, // enviar el flujo si existe
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || `Error ${r.status}`);
      setSugerencias(data);
      setMostrarSugerencias(true);
    } catch (e) {
      setError(`Error al analizar: ${e.message}`);
    } finally {
      setAnalizando(false);
    }
  }, [problem, caseName]);

  const rutaSugerida = useMemo(
    () => sugerencias ? RUTAS.find(r => r.key === sugerencias.classification) : null,
    [sugerencias]
  );

  return (
    <div className="arch-overlay">
      <div className="arch-panel arch-panel--canvas-first">

        {/* ── Cabecera compacta ── */}
        <header className="arch-head arch-head--compact">
          <div className="arch-head-id">
            <span className="arch-mark">⬢</span>
            <span className="arch-title">ARCHITECT</span>
            <span className="arch-sub">· Taller de casos</span>
          </div>
          <div className="arch-head-actions">
            <button 
              className={`arch-tab-btn${!vistaExpedientes ? ' active' : ''}`}
              onClick={() => setVistaExpedientes(false)}
            >
              Caso actual
            </button>
            <button 
              className={`arch-tab-btn${vistaExpedientes ? ' active' : ''}`}
              onClick={() => { setVistaExpedientes(true); cargarExpedientes(); }}
            >
              Expedientes
            </button>
            <span className="arch-chip">sección · {seccion}</span>
            <button className="panel-close" onClick={onClose} title="Cerrar Architect">✕</button>
          </div>
        </header>

        {vistaExpedientes ? (
          /* ── Vista de expedientes (alternativa, no principal) ── */
          <div className="arch-expedientes-view">
            <div className="arch-exps">
              {expedientes === null && <div className="arch-empty">Buscando expedientes…</div>}
              {expedientes?.length === 0 && (
                <div className="arch-empty">
                  Todavía no hay expedientes en <b>{seccion}</b>.<br />
                  Empezá uno desde «Caso actual».
                </div>
              )}
              {expedientes?.map(n => {
                const sv = n.solve || null;
                const rt = RUTAS.find(r => r.key === sv?.classification);
                const hr = sv?.human_review?.status || 'sin decisión';
                return (
                  <button key={n.id} className="arch-exp"
                          onClick={() => {
                            // Cargar expediente en el canvas
                            setCaseName(n.label);
                            if (n.solve?.inputs?.problem) {
                              setProblem(n.solve.inputs.problem);
                            }
                            setSugerencias(n.solve);
                            setVistaExpedientes(false);
                          }}>
                    <span className="arch-exp-dot" style={{ background: rt?.tone || 'var(--text-dim)' }} />
                    <span className="arch-exp-main">
                      <b>{n.label}</b>
                      <small>{rt ? rt.label : 'sin clasificar'} · {hr}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* ── Vista principal: Admisión + Canvas ── */
          <div className="arch-workspace">
            
            {/* ── Admisión compacta (arriba) ── */}
            <div className={`arch-admission${admisionExpandida ? ' expanded' : ' collapsed'}`}>
              <div className="arch-admission-header" onClick={() => setAdmisionExpandida(e => !e)}>
                <span className="arch-admission-toggle">{admisionExpandida ? '▾' : '▸'}</span>
                <span className="arch-admission-title">
                  {caseName || 'Nuevo caso'} {problem && !admisionExpandida && <small>— {problem.slice(0, 60)}…</small>}
                </span>
              </div>
              
              {admisionExpandida && (
                <div className="arch-admission-body">
                  <div className="arch-admission-row">
                    <input
                      className="arch-input arch-input--name"
                      placeholder="Nombre del caso (opcional)"
                      value={caseName}
                      onChange={e => setCaseName(e.target.value)}
                    />
                  </div>
                  <div className="arch-admission-row">
                    <textarea
                      className="arch-textarea arch-textarea--problem"
                      rows={3}
                      placeholder="Describí el problema como se lo contarías a un colega. Ej: 'Tenemos un proceso de aprobación que tarda 3 días y nadie sabe en qué paso está.'"
                      value={problem}
                      onChange={e => setProblem(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey && problem.trim().length > 10) {
                          e.preventDefault();
                          procesarProblema();
                        }
                      }}
                    />
                    <button 
                      className="arch-btn arch-btn--start"
                      onClick={procesarProblema}
                      disabled={pensando || problem.trim().length < 10}
                    >
                      {pensando ? 'Procesando…' : 'Ir al canvas →'}
                    </button>
                  </div>
                  {error && <div className="arch-error arch-error--inline">{error}</div>}
                  <p className="arch-hint">
                    Pasás directo al canvas. La evidencia de <b>{seccion}</b> se vincula en cada nodo.
                  </p>
                </div>
              )}
            </div>

            {/* ── Canvas (área principal) ── */}
            <div className="arch-canvas-area">
              <ArchitectCanvas
                ref={canvasRef}
                seccion={seccion}
                allNodes={allNodes}
                caseName={caseName}
                initialProblem={problem}
                onClose={onClose}
                onAnalyze={analizarCaso}
                sugerencias={sugerencias}
                analizando={analizando}
              />
            </div>

            {/* ── Sugerencias de rutas (colapsable, opcional) ── */}
            {sugerencias && (
              <div className={`arch-suggestions${mostrarSugerencias ? ' open' : ''}`}>
                <button 
                  className="arch-suggestions-toggle"
                  onClick={() => setMostrarSugerencias(s => !s)}
                >
                  {mostrarSugerencias ? '▾' : '▸'} Sugerencia de ruta
                  {rutaSugerida && (
                    <span className="arch-suggestions-badge" style={{ background: rutaSugerida.tone }}>
                      {rutaSugerida.label}
                    </span>
                  )}
                </button>
                {mostrarSugerencias && (
                  <div className="arch-suggestions-body">
                    <p className="arch-suggestions-hint">
                      <strong>Opcional:</strong> Esto es una sugerencia basada en tu corpus. 
                      No es necesario seguirla — podés trabajar directamente en el canvas.
                    </p>
                    <div className="arch-rutas-mini">
                      {RUTAS.map(r => {
                        const on = rutaSugerida?.key === r.key;
                        return (
                          <div key={r.key} className={`arch-ruta-mini${on ? ' on' : ''}`}
                               style={on ? { borderColor: r.tone, background: `${r.tone}22` } : undefined}>
                            <span className="arch-ruta-dot" style={{ background: r.tone }} />
                            <span className="arch-ruta-l">{r.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    {sugerencias.problem_understanding && (
                      <p className="arch-understand">{sugerencias.problem_understanding}</p>
                    )}
                    {sugerencias.critical_review?.objection && (
                      <div className="arch-objection-mini">
                        <b>Objeción:</b> {sugerencias.critical_review.objection}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
