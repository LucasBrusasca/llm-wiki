import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ArchitectCanvas from './ArchitectCanvas.jsx';

/* ── Algedi Architect · Decision Desk ─────────────────────────────────────────
   STEPPER 1→4: Resolver un problema con evidencia, no chatear.
   
   1. PROBLEMA   — ¿Qué hay que resolver?
   2. EVIDENCIA  — Fuentes recuperadas: aprobar/descartar
   3. DECISIÓN   — Clasificación de ruta + canvas de flujo
   4. EXPEDIENTE — Guardar versión en el mismo lugar
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
  { id: 1, key: 'problema',   label: 'PROBLEMA',   desc: 'Definí qué resolver' },
  { id: 2, key: 'evidencia',  label: 'EVIDENCIA',  desc: 'Fuentes del corpus' },
  { id: 3, key: 'decision',   label: 'DECISIÓN',   desc: 'Ruta y flujo' },
  { id: 4, key: 'expediente', label: 'EXPEDIENTE', desc: 'Guardar versión' },
];

export default function ArchitectPanel({ onClose, seccion, onNavigate, onDesarrollar, onAbrirExpediente, allNodes = [] }) {
  // Paso actual del stepper
  const [currentStep, setCurrentStep] = useState(1);
  
  // Datos del caso
  const [caseName, setCaseName] = useState('');
  const [problem, setProblem] = useState('');
  
  // Evidencia recuperada
  const [evidencias, setEvidencias] = useState([]);
  const [evidenciasAprobadas, setEvidenciasAprobadas] = useState(new Set());
  const [buscandoEvidencia, setBuscandoEvidencia] = useState(false);
  
  // Análisis y clasificación
  const [sugerencias, setSugerencias] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [rutaSeleccionada, setRutaSeleccionada] = useState(null);
  
  // Canvas ref
  const canvasRef = useRef(null);
  
  // Expediente
  const [guardando, setGuardando] = useState(false);
  const [expedienteGuardado, setExpedienteGuardado] = useState(null);
  
  // Ejemplo de problema para tesorería/finanzas
  const ejemploProblema = "Tenemos un proceso de conciliación bancaria que toma 3 días porque se hace manual en Excel. Los errores de tipeo generan diferencias que después hay que rastrear.";

  // ─── PASO 1: PROBLEMA ───────────────────────────────────────────────────────
  const handleContinueProblema = useCallback(async () => {
    if (!problem.trim()) return;
    
    setBuscandoEvidencia(true);
    setEvidencias([]);
    
    try {
      // Buscar evidencia relevante en el corpus
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
      
      // Extraer fuentes del corpus
      const sources = data.sources || [];
      setEvidencias(sources);
      
      // Auto-aprobar fuentes con alta relevancia
      const autoApproved = new Set();
      sources.forEach((s, i) => {
        if (s.sim && s.sim >= 0.5) autoApproved.add(i);
      });
      setEvidenciasAprobadas(autoApproved);
      
      // Actualizar nombre si viene sugerido
      if (data.case_name && !caseName) {
        setCaseName(data.case_name);
      }
      
      setCurrentStep(2);
    } catch (err) {
      console.error('Error buscando evidencia:', err);
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
      // Analizar con las evidencias aprobadas
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
    } finally {
      setAnalizando(false);
    }
  }, [caseName, problem, evidencias, evidenciasAprobadas]);

  const handleAbstenerse = useCallback(() => {
    // Ir a decisión sin evidencia suficiente
    setSugerencias({ classification: 'none', problem_understanding: 'La evidencia disponible no es suficiente para recomendar una implementación.' });
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
      // Obtener datos del canvas
      const flowData = canvasRef.current?.getFlowData?.() || { nodes: [], edges: [] };
      const evidenciasSeleccionadas = evidencias.filter((_, i) => evidenciasAprobadas.has(i));
      
      // Crear el expediente como issue
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

  // Ruta actual con color
  const rutaActual = useMemo(
    () => RUTAS.find(r => r.key === rutaSeleccionada),
    [rutaSeleccionada]
  );

  // ─── NAVEGACIÓN DEL STEPPER ─────────────────────────────────────────────────
  const goToStep = useCallback((step) => {
    if (step < currentStep) setCurrentStep(step);
  }, [currentStep]);

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

        {/* ── Stepper 1→4 (siempre visible) ── */}
        <nav className="arch-stepper">
          {STEPS.map((step) => {
            const isActive = currentStep === step.id;
            const isDone = currentStep > step.id;
            const isClickable = step.id < currentStep;
            
            return (
              <button
                key={step.id}
                className={`arch-stepper-item${isActive ? ' active' : ''}${isDone ? ' done' : ''}`}
                onClick={() => isClickable && goToStep(step.id)}
                disabled={!isClickable}
              >
                <span className="arch-stepper-num">{step.id}</span>
                <span className="arch-stepper-content">
                  <span className="arch-stepper-label">{step.label}</span>
                  <span className="arch-stepper-desc">{step.desc}</span>
                </span>
                {step.id < 4 && <span className="arch-stepper-arrow">→</span>}
              </button>
            );
          })}
        </nav>

        {/* ── Contenido según paso ── */}
        <main className="arch-desk-main">
          
          {/* ═══ PASO 1: PROBLEMA ═══ */}
          {currentStep === 1 && (
            <div className="arch-step-content arch-step-problema">
              <div className="arch-step-header">
                <h2>¿Qué problema querés resolver?</h2>
                <p>Describí la situación actual. Architect buscará evidencia en tu corpus.</p>
              </div>
              
              <div className="arch-problema-form">
                <input
                  className="arch-problema-name"
                  placeholder="Nombre del caso (opcional)"
                  value={caseName}
                  onChange={e => setCaseName(e.target.value)}
                />
                
                <textarea
                  className="arch-problema-input"
                  placeholder={`Ej: ${ejemploProblema}`}
                  value={problem}
                  onChange={e => setProblem(e.target.value)}
                  rows={6}
                  autoFocus
                />
                
                <div className="arch-problema-hint">
                  <span className="arch-hint-icon">◈</span>
                  <span>Tip: Mencioná el proceso actual, los puntos de dolor y el resultado esperado.</span>
                </div>
              </div>
              
              <div className="arch-step-actions">
                <button
                  className="arch-btn-primary"
                  onClick={handleContinueProblema}
                  disabled={!problem.trim() || buscandoEvidencia}
                >
                  {buscandoEvidencia ? 'Buscando evidencia…' : 'Continuar'}
                </button>
              </div>
            </div>
          )}

          {/* ═══ PASO 2: EVIDENCIA ═══ */}
          {currentStep === 2 && (
            <div className="arch-step-content arch-step-evidencia">
              <div className="arch-step-header">
                <h2>Evidencia encontrada</h2>
                <p>Estas fuentes del corpus parecen relevantes. Aprobá o descartá cada una.</p>
              </div>
              
              <div className="arch-evidencia-list">
                {evidencias.length === 0 ? (
                  <div className="arch-evidencia-empty">
                    <span className="arch-empty-icon">◇</span>
                    <p>No se encontraron fuentes relevantes en el corpus para este problema.</p>
                    <p className="arch-empty-hint">Podés continuar sin evidencia o reformular el problema.</p>
                  </div>
                ) : (
                  evidencias.map((ev, i) => {
                    const isApproved = evidenciasAprobadas.has(i);
                    return (
                      <button
                        key={i}
                        className={`arch-evidencia-chip${isApproved ? ' approved' : ' dismissed'}`}
                        onClick={() => toggleEvidencia(i)}
                      >
                        <span className="arch-chip-status">
                          {isApproved ? '✓' : '✗'}
                        </span>
                        <span className="arch-chip-content">
                          <span className="arch-chip-label">{ev.label}</span>
                          {ev.excerpt && (
                            <span className="arch-chip-excerpt">{ev.excerpt.slice(0, 100)}…</span>
                          )}
                        </span>
                        <span className="arch-chip-sim">
                          {ev.sim ? `${Math.round(ev.sim * 100)}%` : '—'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              
              <div className="arch-evidencia-summary">
                <span className="arch-summary-count">
                  {evidenciasAprobadas.size} de {evidencias.length} fuentes aprobadas
                </span>
              </div>
              
              <div className="arch-step-actions">
                <button
                  className="arch-btn-secondary"
                  onClick={handleAbstenerse}
                >
                  Abstenerse
                </button>
                <button
                  className="arch-btn-primary"
                  onClick={handleContinueEvidencia}
                  disabled={analizando}
                >
                  {analizando ? 'Analizando…' : 'Continuar'}
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
                    <h2>Clasificación de ruta</h2>
                    <p>Basado en tu corpus, la intervención recomendada es:</p>
                  </div>
                  
                  <div className="arch-rutas-list">
                    {RUTAS.map(r => {
                      const isSelected = rutaSeleccionada === r.key;
                      return (
                        <button
                          key={r.key}
                          className={`arch-ruta-item${isSelected ? ' selected' : ''}`}
                          style={{ '--ruta-tone': r.tone }}
                          onClick={() => setRutaSeleccionada(r.key)}
                        >
                          <span className="arch-ruta-dot" />
                          <span className="arch-ruta-label">{r.label}</span>
                          <span className="arch-ruta-hint">{r.hint}</span>
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
                </div>
                
                {/* Panel derecho: canvas de flujo */}
                <div className="arch-decision-canvas">
                  <div className="arch-canvas-header">
                    <h3>Flujo de decisión</h3>
                    <span className="arch-canvas-hint">Opcional: modelá el proceso</span>
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
                  Continuar al expediente
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
                    <p>Revisá el resumen antes de crear el expediente.</p>
                  </div>
                  
                  <div className="arch-expediente-preview">
                    <div className="arch-preview-section">
                      <label>Nombre del caso</label>
                      <input
                        className="arch-preview-input"
                        value={caseName}
                        onChange={e => setCaseName(e.target.value)}
                        placeholder="Sin título"
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
                          <span>{rutaActual.label}</span>
                          <span className="arch-ruta-hint">{rutaActual.hint}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="arch-preview-section">
                      <label>Evidencia ({evidenciasAprobadas.size} fuentes)</label>
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
                          <span className="arch-preview-ev-none">Sin evidencia del corpus</span>
                        )}
                      </div>
                    </div>
                    
                    {sugerencias?.problem_understanding && (
                      <div className="arch-preview-section">
                        <label>Comprensión</label>
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
                      {guardando ? 'Guardando…' : '◈ Guardar expediente'}
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
                  
                  <div className="arch-saved-actions">
                    <button
                      className="arch-btn-secondary"
                      onClick={() => {
                        // Resetear para nuevo caso
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
