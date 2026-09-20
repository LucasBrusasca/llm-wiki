import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ArchitectCanvas from './ArchitectCanvas.jsx';

/* ── Algedi Architect · Decision Desk ─────────────────────────────────────────
   STEPPER 1→4: Resolver un problema con evidencia, no chatear.
   
   DOMAIN-AGNOSTIC: This flow works for ANY corpus. The same Architect works for
   finance, legal, HR, ops, engineering — just change the ingested documents.
   Example placeholders may mention specific domains but are NOT hardcoded logic.
   
   DIFFERENTIATED: Evidence approve/reject + Abstain + Saved expediente.
   Not chat-for-chat's-sake. Not Multiverso. Not generic SaaS.
   ───────────────────────────────────────────────────────────────────────────── */

const RUTAS = [
  { key: 'redesign',  label: 'Rediseño',       hint: 'ordenar el proceso',      tone: '#2DD4BF' },
  { key: 'rules',     label: 'Reglas',         hint: 'determinístico',          tone: '#3B82F6' },
  { key: 'data',      label: 'Datos / BI',     hint: 'visibilidad y calidad',   tone: '#06B6D4' },
  { key: 'assistive', label: 'IA asistiva',    hint: 'criterio con control',    tone: '#A855F7' },
  { key: 'agent',     label: 'Agente',         hint: 'acción delegada',         tone: '#EC4899' },
  { key: 'none',      label: 'No implementar', hint: 'la evidencia no alcanza', tone: '#EAB308' },
];

const STEPS = [
  { id: 1, key: 'problema',   label: 'PROBLEMA',   desc: 'Definí qué resolver', instruction: 'Describí el problema en tus palabras' },
  { id: 2, key: 'evidencia',  label: 'EVIDENCIA',  desc: 'Fuentes del corpus', instruction: 'Aprobá o descartá cada fuente' },
  { id: 3, key: 'decision',   label: 'DECISIÓN',   desc: 'Ruta y flujo', instruction: 'Elegí la ruta de intervención' },
  { id: 4, key: 'expediente', label: 'EXPEDIENTE', desc: 'Guardar versión', instruction: 'Revisá y guardá el expediente' },
];

const EXAMPLE_PROBLEMS = [
  "Un proceso manual que toma demasiado tiempo y genera errores frecuentes.",
  "Decisiones que dependen de criterio individual sin reglas claras.",
  "Información dispersa que dificulta tomar decisiones informadas.",
  "Tareas repetitivas que podrían automatizarse con las herramientas actuales.",
];

export default function ArchitectPanel({ onClose, seccion, onNavigate, onDesarrollar, onAbrirExpediente, allNodes = [] }) {
  const [currentStep, setCurrentStep] = useState(1);
  
  const [caseName, setCaseName] = useState('');
  const [problem, setProblem] = useState('');
  
  const [evidencias, setEvidencias] = useState([]);
  const [evidenciasAprobadas, setEvidenciasAprobadas] = useState(new Set());
  const [buscandoEvidencia, setBuscandoEvidencia] = useState(false);
  
  const [sugerencias, setSugerencias] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [rutaSeleccionada, setRutaSeleccionada] = useState(null);
  
  const canvasRef = useRef(null);
  
  const [guardando, setGuardando] = useState(false);
  const [expedienteGuardado, setExpedienteGuardado] = useState(null);
  
  const randomExample = useMemo(() => 
    EXAMPLE_PROBLEMS[Math.floor(Math.random() * EXAMPLE_PROBLEMS.length)], 
  []);

  // ─── PASO 1: PROBLEMA ───────────────────────────────────────────────────────
  const handleContinueProblema = useCallback(async () => {
    if (!problem.trim()) return;
    
    setBuscandoEvidencia(true);
    setEvidencias([]);
    
    try {
      const r = await fetch('/api/architect/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: problem }],
          canvas_state: { nodes: [], edges: [], caseName, problem },
          seccion,
        }),
      });
      
      const data = await r.json().catch(() => ({}));
      const sources = data.sources || [];
      setEvidencias(sources);
      
      const autoApproved = new Set();
      sources.forEach((s, i) => {
        if (s.sim && s.sim >= 0.5) autoApproved.add(i);
      });
      setEvidenciasAprobadas(autoApproved);
      
      if (data.case_name && !caseName) {
        setCaseName(data.case_name);
      }
      
      setCurrentStep(2);
    } catch (err) {
      console.error('Error buscando evidencia:', err);
      setCurrentStep(2);
    } finally {
      setBuscandoEvidencia(false);
    }
  }, [problem, caseName, seccion]);

  // ─── PASO 2: EVIDENCIA ──────────────────────────────────────────────────────
  const toggleEvidencia = useCallback((index) => {
    setEvidenciasAprobadas(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleContinueEvidencia = useCallback(async () => {
    setAnalizando(true);
    
    try {
      const evidenciasSeleccionadas = evidencias.filter((_, i) => evidenciasAprobadas.has(i));
      
      const r = await fetch('/api/architect/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_name: caseName || 'Caso sin título',
          problem: problem.trim(),
          objective: '',
          current_process: '',
          available_data: evidenciasSeleccionadas.map(e => e.label).join(', '),
          constraints: '',
          expected_value: '',
          evidence_ids: evidenciasSeleccionadas.map(e => e.node_id).filter(Boolean),
        }),
      });
      
      const data = await r.json().catch(() => ({}));
      
      if (r.ok) {
        setSugerencias(data);
        setRutaSeleccionada(data.classification || null);
      }
      
      setCurrentStep(3);
    } catch (err) {
      console.error('Error analizando:', err);
      setCurrentStep(3);
    } finally {
      setAnalizando(false);
    }
  }, [caseName, problem, evidencias, evidenciasAprobadas]);

  const handleAbstenerse = useCallback(() => {
    setSugerencias({ 
      classification: 'none', 
      problem_understanding: 'Se eligió abstenerse: la evidencia disponible no fue suficiente o relevante para fundamentar una recomendación.' 
    });
    setRutaSeleccionada('none');
    setCurrentStep(3);
  }, []);

  // ─── PASO 3: DECISIÓN ───────────────────────────────────────────────────────
  const handleContinueDecision = useCallback(() => {
    setCurrentStep(4);
  }, []);

  // ─── PASO 4: EXPEDIENTE ─────────────────────────────────────────────────────
  const handleGuardarExpediente = useCallback(async () => {
    setGuardando(true);
    
    try {
      const flowData = canvasRef.current?.getFlowData?.() || { nodes: [], edges: [] };
      const evidenciasSeleccionadas = evidencias.filter((_, i) => evidenciasAprobadas.has(i));
      
      const body = {
        label: caseName || `Expediente: ${problem.slice(0, 50)}...`,
        desc: problem,
        seccion,
        solve: {
          classification: rutaSeleccionada,
          problem_understanding: sugerencias?.problem_understanding || '',
          matrix: sugerencias?.matrix || [],
          critical_review: sugerencias?.critical_review || {},
          inputs: { problem, objective: '', constraints: '', available_data: '' },
          evidence_mode: evidenciasSeleccionadas.length > 0 ? 'chunks' : 'general',
          citations: evidenciasSeleccionadas.map((e, i) => ({
            marker: `[${i + 1}]`,
            chunk_id: e.node_id || e.id,
            label: e.label,
            excerpt: e.excerpt || '',
            page: e.page,
          })),
        },
        flujograma: flowData.nodes.length > 0 ? {
          etapas: flowData.nodes.map(n => ({ id: n.id, label: n.label, desc: '' })),
          conexiones: flowData.edges.map(e => ({ source: e.source, target: e.target, label: '' })),
        } : null,
      };
      
      const r = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      const data = await r.json().catch(() => ({}));
      
      if (r.ok) {
        setExpedienteGuardado({
          id: data.id || data.nodo_id,
          label: caseName || body.label,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Error guardando expediente:', err);
    } finally {
      setGuardando(false);
    }
  }, [caseName, problem, seccion, rutaSeleccionada, sugerencias, evidencias, evidenciasAprobadas]);

  const rutaActual = useMemo(
    () => RUTAS.find(r => r.key === rutaSeleccionada),
    [rutaSeleccionada]
  );

  const goToStep = useCallback((step) => {
    if (step < currentStep) setCurrentStep(step);
  }, [currentStep]);

  const currentStepData = STEPS.find(s => s.id === currentStep);

  return (
    <div className="arch-desk-overlay">
      <div className="arch-desk">
        
        {/* ── Header mínimo ── */}
        <header className="arch-desk-header">
          <div className="arch-desk-brand">
            <span className="arch-desk-icon">⬢</span>
            <span className="arch-desk-title">ARCHITECT</span>
            <span className="arch-desk-divider">·</span>
            <span className="arch-desk-section">{seccion}</span>
          </div>
          <div className="arch-desk-actions">
            <button className="arch-desk-link" onClick={onAbrirExpediente}>
              Ver expedientes
            </button>
            <button className="arch-desk-close" onClick={onClose}>✕</button>
          </div>
        </header>

        {/* ── Stepper 1→4 (IMPOSIBLE DE PERDER) ── */}
        <nav className="arch-stepper" role="navigation" aria-label="Pasos del proceso">
          {STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isDone = currentStep > step.id;
            const isClickable = step.id < currentStep;
            
            return (
              <button
                key={step.id}
                className={`arch-stepper-item${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}
                onClick={() => isClickable && goToStep(step.id)}
                disabled={!isClickable && !isActive}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className="arch-stepper-num">
                  {isDone ? '✓' : step.id}
                </span>
                <span className="arch-stepper-content">
                  <span className="arch-stepper-label">{step.label}</span>
                  <span className="arch-stepper-desc">{step.desc}</span>
                </span>
                {step.id < 4 && <span className="arch-stepper-arrow">→</span>}
              </button>
            );
          })}
        </nav>

        {/* ── Instrucción del paso actual (una línea, siempre visible) ── */}
        <div className="arch-step-instruction">
          <span className="arch-instruction-step">Paso {currentStep}:</span>
          <span className="arch-instruction-text">{currentStepData?.instruction}</span>
        </div>

        {/* ── Contenido según paso ── */}
        <main className="arch-desk-main">
          
          {/* ═══ PASO 1: PROBLEMA ═══ */}
          {currentStep === 1 && (
            <div className="arch-step-content arch-step-problema">
              <div className="arch-step-header">
                <h2>¿Qué problema querés resolver?</h2>
                <p className="arch-step-subtitle">
                  Describí la situación. Architect buscará evidencia en tu corpus para fundamentar la decisión.
                </p>
              </div>
              
              <div className="arch-problema-form">
                <div className="arch-input-group">
                  <label className="arch-input-label">Nombre del caso</label>
                  <input
                    className="arch-problema-name"
                    placeholder="Ej: Optimización de proceso X"
                    value={caseName}
                    onChange={e => setCaseName(e.target.value)}
                  />
                </div>
                
                <div className="arch-input-group">
                  <label className="arch-input-label">Descripción del problema</label>
                  <textarea
                    className="arch-problema-input"
                    placeholder={`Ej: ${randomExample}`}
                    value={problem}
                    onChange={e => setProblem(e.target.value)}
                    rows={5}
                    autoFocus
                  />
                  <span className="arch-input-hint">
                    Mencioná: proceso actual, puntos de dolor, resultado esperado.
                  </span>
                </div>
              </div>
              
              {/* Empty state guidance */}
              {!problem.trim() && (
                <div className="arch-empty-guidance">
                  <span className="arch-guidance-icon">→</span>
                  <span>Escribí el problema arriba para buscar evidencia en tu corpus.</span>
                </div>
              )}
              
              <div className="arch-step-actions">
                <button
                  className="arch-btn-primary"
                  onClick={handleContinueProblema}
                  disabled={!problem.trim() || buscandoEvidencia}
                >
                  {buscandoEvidencia ? (
                    <>
                      <span className="arch-btn-spinner" />
                      Buscando evidencia…
                    </>
                  ) : (
                    'Buscar evidencia →'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ═══ PASO 2: EVIDENCIA ═══ */}
          {currentStep === 2 && (
            <div className="arch-step-content arch-step-evidencia">
              <div className="arch-step-header">
                <h2>Revisá la evidencia</h2>
                <p className="arch-step-subtitle">
                  Hacé click en cada fuente para aprobarla (✓) o descartarla (✗). 
                  Solo las aprobadas fundamentarán la decisión.
                </p>
              </div>
              
              <div className="arch-evidencia-list">
                {evidencias.length === 0 ? (
                  <div className="arch-evidencia-empty">
                    <span className="arch-empty-icon">◇</span>
                    <h3>Sin evidencia en el corpus</h3>
                    <p>No se encontraron fuentes relevantes para este problema.</p>
                    <div className="arch-empty-actions">
                      <span>Podés:</span>
                      <button onClick={() => setCurrentStep(1)} className="arch-empty-link">
                        ← Reformular el problema
                      </button>
                      <span>o</span>
                      <button onClick={handleAbstenerse} className="arch-empty-link arch-empty-link--warn">
                        Abstenerse →
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {evidencias.map((ev, i) => {
                      const isApproved = evidenciasAprobadas.has(i);
                      return (
                        <button
                          key={i}
                          className={`arch-evidencia-chip${isApproved ? ' approved' : ' dismissed'}`}
                          onClick={() => toggleEvidencia(i)}
                          title={isApproved ? 'Click para descartar' : 'Click para aprobar'}
                        >
                          <span className="arch-chip-status" aria-label={isApproved ? 'Aprobada' : 'Descartada'}>
                            {isApproved ? '✓' : '✗'}
                          </span>
                          <span className="arch-chip-content">
                            <span className="arch-chip-label">{ev.label}</span>
                            {ev.excerpt && (
                              <span className="arch-chip-excerpt">{ev.excerpt.slice(0, 120)}…</span>
                            )}
                          </span>
                          <span className="arch-chip-sim" title="Relevancia">
                            {ev.sim ? `${Math.round(ev.sim * 100)}%` : '—'}
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
              
              {evidencias.length > 0 && (
                <div className="arch-evidencia-summary">
                  <div className="arch-summary-bar">
                    <div 
                      className="arch-summary-fill" 
                      style={{ width: `${(evidenciasAprobadas.size / evidencias.length) * 100}%` }}
                    />
                  </div>
                  <span className="arch-summary-count">
                    <strong>{evidenciasAprobadas.size}</strong> de {evidencias.length} fuentes aprobadas
                  </span>
                </div>
              )}
              
              <div className="arch-step-actions">
                <button
                  className="arch-btn-abstain"
                  onClick={handleAbstenerse}
                  title="Decidir que la evidencia no es suficiente"
                >
                  <span className="arch-btn-abstain-icon">⊘</span>
                  Abstenerse
                </button>
                <button
                  className="arch-btn-primary"
                  onClick={handleContinueEvidencia}
                  disabled={analizando}
                >
                  {analizando ? (
                    <>
                      <span className="arch-btn-spinner" />
                      Clasificando…
                    </>
                  ) : (
                    `Clasificar con ${evidenciasAprobadas.size} fuente${evidenciasAprobadas.size !== 1 ? 's' : ''} →`
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ═══ PASO 3: DECISIÓN ═══ */}
          {currentStep === 3 && (
            <div className="arch-step-content arch-step-decision">
              <div className="arch-decision-layout">
                
                {/* Panel izquierdo: clasificación */}
                <div className="arch-decision-panel">
                  <div className="arch-step-header">
                    <h2>Ruta de intervención</h2>
                    <p className="arch-step-subtitle">
                      Seleccioná qué tipo de solución corresponde. 
                      {sugerencias?.classification && ' La sugerida está marcada.'}
                    </p>
                  </div>
                  
                  <div className="arch-rutas-list">
                    {RUTAS.map(r => {
                      const isSelected = rutaSeleccionada === r.key;
                      const isSuggested = sugerencias?.classification === r.key;
                      return (
                        <button
                          key={r.key}
                          className={`arch-ruta-item${isSelected ? ' selected' : ''}${isSuggested && !isSelected ? ' suggested' : ''}`}
                          style={{ '--ruta-tone': r.tone }}
                          onClick={() => setRutaSeleccionada(r.key)}
                        >
                          <span className="arch-ruta-dot" />
                          <span className="arch-ruta-label">{r.label}</span>
                          <span className="arch-ruta-hint">{r.hint}</span>
                          {isSuggested && <span className="arch-ruta-badge">sugerida</span>}
                        </button>
                      );
                    })}
                  </div>
                  
                  {sugerencias?.problem_understanding && (
                    <div className="arch-understanding">
                      <h4>Comprensión del problema</h4>
                      <p>{sugerencias.problem_understanding}</p>
                    </div>
                  )}
                  
                  {sugerencias?.critical_review?.objection && (
                    <div className="arch-objection">
                      <h4>⚠ Objeción del verificador</h4>
                      <p>{sugerencias.critical_review.objection}</p>
                    </div>
                  )}

                  {!rutaSeleccionada && (
                    <div className="arch-empty-guidance">
                      <span className="arch-guidance-icon">→</span>
                      <span>Seleccioná una ruta para continuar al expediente.</span>
                    </div>
                  )}
                </div>
                
                {/* Panel derecho: canvas de flujo */}
                <div className="arch-decision-canvas">
                  <div className="arch-canvas-header">
                    <h3>Flujo de decisión</h3>
                    <span className="arch-canvas-hint">Opcional: modelá el proceso visualmente</span>
                  </div>
                  <div className="arch-canvas-container">
                    <ArchitectCanvas
                      ref={canvasRef}
                      seccion={seccion}
                      allNodes={allNodes}
                      caseName={caseName}
                      initialProblem={problem}
                      onClose={onClose}
                      sugerencias={sugerencias}
                      analizando={false}
                    />
                  </div>
                </div>
              </div>
              
              <div className="arch-step-actions">
                <button
                  className="arch-btn-primary"
                  onClick={handleContinueDecision}
                  disabled={!rutaSeleccionada}
                >
                  Guardar expediente →
                </button>
              </div>
            </div>
          )}

          {/* ═══ PASO 4: EXPEDIENTE ═══ */}
          {currentStep === 4 && (
            <div className="arch-step-content arch-step-expediente">
              {!expedienteGuardado ? (
                <>
                  <div className="arch-step-header">
                    <h2>Guardar expediente</h2>
                    <p className="arch-step-subtitle">
                      Este expediente quedará guardado con la evidencia aprobada y la ruta elegida.
                    </p>
                  </div>
                  
                  <div className="arch-expediente-preview">
                    <div className="arch-preview-section">
                      <label>Nombre del caso</label>
                      <input
                        className="arch-preview-input"
                        value={caseName}
                        onChange={e => setCaseName(e.target.value)}
                        placeholder="Sin título (se generará automáticamente)"
                      />
                    </div>
                    
                    <div className="arch-preview-section">
                      <label>Problema</label>
                      <div className="arch-preview-text">{problem}</div>
                    </div>
                    
                    <div className="arch-preview-section">
                      <label>Ruta seleccionada</label>
                      {rutaActual && (
                        <div 
                          className="arch-preview-ruta"
                          style={{ '--ruta-tone': rutaActual.tone }}
                        >
                          <span className="arch-ruta-dot" />
                          <span className="arch-preview-ruta-label">{rutaActual.label}</span>
                          <span className="arch-ruta-hint">{rutaActual.hint}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="arch-preview-section">
                      <label>Evidencia aprobada ({evidenciasAprobadas.size})</label>
                      <div className="arch-preview-evidencias">
                        {evidencias
                          .filter((_, i) => evidenciasAprobadas.has(i))
                          .map((ev, i) => (
                            <span key={i} className="arch-preview-ev-tag">
                              ◈ {ev.label}
                            </span>
                          ))
                        }
                        {evidenciasAprobadas.size === 0 && (
                          <span className="arch-preview-ev-none">
                            Sin evidencia — se eligió abstenerse o no había fuentes relevantes
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {sugerencias?.problem_understanding && (
                      <div className="arch-preview-section">
                        <label>Fundamento</label>
                        <div className="arch-preview-text arch-preview-text--sm">
                          {sugerencias.problem_understanding}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="arch-step-actions">
                    <button
                      className="arch-btn-primary arch-btn-save"
                      onClick={handleGuardarExpediente}
                      disabled={guardando}
                    >
                      {guardando ? (
                        <>
                          <span className="arch-btn-spinner" />
                          Guardando…
                        </>
                      ) : (
                        '◈ Guardar expediente'
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="arch-expediente-saved">
                  <div className="arch-saved-icon">✓</div>
                  <h2>Expediente guardado</h2>
                  <p className="arch-saved-name">{expedienteGuardado.label}</p>
                  <p className="arch-saved-time">
                    {new Date(expedienteGuardado.timestamp).toLocaleString('es-AR')}
                  </p>
                  
                  <div className="arch-saved-summary">
                    <div className="arch-saved-stat">
                      <span className="arch-saved-stat-value">{evidenciasAprobadas.size}</span>
                      <span className="arch-saved-stat-label">fuentes citadas</span>
                    </div>
                    <div className="arch-saved-stat">
                      <span className="arch-saved-stat-value" style={{ color: rutaActual?.tone }}>
                        {rutaActual?.label || '—'}
                      </span>
                      <span className="arch-saved-stat-label">ruta elegida</span>
                    </div>
                  </div>
                  
                  <div className="arch-saved-actions">
                    <button
                      className="arch-btn-secondary"
                      onClick={() => {
                        setCurrentStep(1);
                        setCaseName('');
                        setProblem('');
                        setEvidencias([]);
                        setEvidenciasAprobadas(new Set());
                        setSugerencias(null);
                        setRutaSeleccionada(null);
                        setExpedienteGuardado(null);
                      }}
                    >
                      + Nuevo caso
                    </button>
                    <button
                      className="arch-btn-primary"
                      onClick={() => {
                        if (onAbrirExpediente) onAbrirExpediente();
                      }}
                    >
                      Ver expedientes →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
