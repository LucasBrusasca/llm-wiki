import React, { useState, useEffect, useCallback } from 'react';

/* ── HomeView · Architect-first Decision Desk ──────────────────────────────
   Algedi es para DECIDIR con evidencia, no chatear.
   
   DOMAIN-AGNOSTIC: Works for any corpus. The flow adapts to whatever
   documents are ingested — finance, legal, HR, ops, engineering, etc.
   
   DIFFERENTIATED: Evidence approve/reject + Abstain + Saved expediente.
   Not chat-for-chat's-sake. Not Multiverso. Not generic SaaS.
   ────────────────────────────────────────────────────────────────────────── */

const RUTAS = [
  { key: 'redesign', label: 'Rediseño' },
  { key: 'rules', label: 'Reglas' },
  { key: 'data', label: 'Datos' },
  { key: 'assistive', label: 'IA asistiva' },
  { key: 'agent', label: 'Agente' },
  { key: 'none', label: 'No implementar' },
];

export default function HomeView({
  seccion,
  onStartArchitect,
  onOpenGraph,
  onOpenLibrary,
  onOpenAgent,
  onOpenIssue,
  onChangeSection,
  onOpenMultiverse,
}) {
  const [expedientes, setExpedientes] = useState(null);
  const [loading, setLoading] = useState(true);

  const cargarExpedientes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/graph?seccion=${encodeURIComponent(seccion)}`);
      const d = await r.json();
      const issues = (d.nodos || [])
        .filter(n => n.is_issue)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 4);
      setExpedientes(issues);
    } catch {
      setExpedientes([]);
    } finally {
      setLoading(false);
    }
  }, [seccion]);

  useEffect(() => {
    cargarExpedientes();
  }, [cargarExpedientes]);

  return (
    <div className="home-desk">
      <div className="home-desk-bg" />
      
      <div className="home-desk-content">
        {/* Header mínimo */}
        <header className="home-desk-header">
          <div className="home-desk-brand">
            <span className="home-desk-icon">◈</span>
            <span className="home-desk-name">ALGEDI</span>
          </div>
          <div className="home-desk-nav">
            {onOpenMultiverse && (
              <button className="home-desk-nav-btn" onClick={onOpenMultiverse}>
                ◈ Multiverso
              </button>
            )}
            <div className="home-desk-section">
              <span className="home-desk-section-dot" />
              <span>{seccion}</span>
              {onChangeSection && (
                <button className="home-desk-section-change" onClick={onChangeSection}>
                  cambiar
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Hero: propuesta de valor diferenciada */}
        <section className="home-desk-hero">
          <h1>Decidí con evidencia</h1>
          <p className="home-desk-subtitle">
            Planteá un problema. Architect busca en tu corpus, vos aprobás o descartás 
            cada fuente, y el expediente queda guardado con las citas.
          </p>
          
          <button className="home-desk-cta" onClick={onStartArchitect}>
            <span className="home-desk-cta-icon">⬢</span>
            <span className="home-desk-cta-text">
              <strong>Empezar decisión</strong>
              <small>PROBLEMA → EVIDENCIA → DECISIÓN → EXPEDIENTE</small>
            </span>
            <span className="home-desk-cta-arrow">→</span>
          </button>

          {/* Diferenciadores clave */}
          <div className="home-desk-diff">
            <div className="home-desk-diff-item">
              <span className="home-desk-diff-icon">✓ ✗</span>
              <span>Aprobá o descartá cada fuente</span>
            </div>
            <div className="home-desk-diff-item">
              <span className="home-desk-diff-icon">⊘</span>
              <span>Abstención si no hay evidencia</span>
            </div>
            <div className="home-desk-diff-item">
              <span className="home-desk-diff-icon">◈</span>
              <span>Expediente con citas guardado</span>
            </div>
          </div>

          {/* Las 6 rutas como referencia visual */}
          <div className="home-desk-rutas">
            <span className="home-desk-rutas-label">6 rutas posibles:</span>
            {RUTAS.map(r => (
              <span key={r.key} className="home-desk-ruta">
                {r.label}
              </span>
            ))}
          </div>
        </section>

        {/* Expedientes recientes (si hay) */}
        {!loading && expedientes && expedientes.length > 0 && (
          <section className="home-desk-expedientes">
            <div className="home-desk-exp-header">
              <h2>Expedientes recientes</h2>
              <button className="home-desk-exp-all" onClick={() => onOpenIssue && onOpenIssue()}>
                Ver todos →
              </button>
            </div>
            <div className="home-desk-exp-list">
              {expedientes.map(exp => {
                const sv = exp.solve || {};
                const ruta = RUTAS.find(r => r.key === sv.classification);
                const citasCount = sv.citations?.length || 0;
                return (
                  <button
                    key={exp.id}
                    className="home-desk-exp-item"
                    onClick={() => onOpenIssue && onOpenIssue(exp)}
                  >
                    <span className="home-desk-exp-dot" />
                    <span className="home-desk-exp-info">
                      <span className="home-desk-exp-label">{exp.label}</span>
                      <span className="home-desk-exp-meta">
                        {ruta ? ruta.label : 'sin clasificar'} · {citasCount} cita{citasCount !== 1 ? 's' : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Empty state con guía clara */}
        {!loading && (!expedientes || expedientes.length === 0) && (
          <section className="home-desk-empty">
            <div className="home-desk-empty-content">
              <h3>Sin expedientes en "{seccion}"</h3>
              <p>
                Empezá tu primer caso: describí un problema, revisá la evidencia 
                del corpus, y guardá el expediente con las fuentes citadas.
              </p>
              <button className="home-desk-empty-cta" onClick={onStartArchitect}>
                Empezar primer caso →
              </button>
            </div>
          </section>
        )}

        {/* Accesos secundarios (mínimos, no compiten con el CTA) */}
        <section className="home-desk-secondary">
          <button className="home-desk-sec-btn" onClick={onOpenLibrary}>
            <span>⊞</span> Biblioteca
          </button>
          <button className="home-desk-sec-btn" onClick={onOpenAgent}>
            <span>⬡</span> Agente RAG
          </button>
          <button className="home-desk-sec-btn" onClick={onOpenGraph}>
            <span>◎</span> Explorar grafo
          </button>
        </section>

        {/* Footer con nota de replicabilidad */}
        <footer className="home-desk-footer">
          <p>
            El mismo flujo funciona para cualquier corpus: finanzas, legal, RRHH, 
            operaciones, ingeniería. Solo cambiá los documentos en la Biblioteca.
          </p>
        </footer>
      </div>
    </div>
  );
}
