import React, { useState, useEffect, useCallback } from 'react';

/* ── HomeView · Experiencia Architect-first de Algedi ──────────────────────
   El usuario entiende en 30 segundos: "acá decido con evidencia".
   
   CTA primario: Empezar decisión (Architect)
   Accesos secundarios: Explorar grafo · Biblioteca · Agente RAG
   
   Referencia: docs/UX_ARCHITECT_PRIMERO.md, docs/ORGANIZACION_ESPACIOS.md
   ────────────────────────────────────────────────────────────────────────── */

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
        .slice(0, 5);
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
    <div className="home-view">
      <div className="home-content">
        {/* Identidad */}
        <header className="home-header">
          <div className="home-logo">
            <span className="home-logo-icon">◈</span>
            <span className="home-logo-text">ALGEDI</span>
          </div>
          <p className="home-tagline">
            Decidí con evidencia. Sobre lo que sabés.
          </p>
        </header>

        {/* CTA Principal: Architect */}
        <section className="home-primary">
          <button className="home-cta-primary" onClick={onStartArchitect}>
            <span className="home-cta-icon">⬢</span>
            <span className="home-cta-text">
              <strong>Empezar decisión</strong>
              <small>Planteá un problema · Architect te guía con tu corpus</small>
            </span>
          </button>
        </section>

        {/* Sección activa — más visible + atajos */}
        <div className="home-section-selector">
          <div className="home-section-current">
            <span className="home-section-dot" />
            <span className="home-section-label">Sección activa:</span>
            <strong className="home-section-name">{seccion}</strong>
          </div>
          <div className="home-section-actions">
            {onChangeSection && (
              <button className="home-section-change" onClick={onChangeSection}>
                Cambiar
              </button>
            )}
            {onOpenMultiverse && (
              <button className="home-section-multiverse" onClick={onOpenMultiverse}>
                ◈ Multiverso
              </button>
            )}
          </div>
        </div>

        {/* Expedientes recientes */}
        <section className="home-recent">
          <h3 className="home-section-title">Expedientes recientes</h3>
          {loading && <p className="home-loading">Cargando…</p>}
          {!loading && expedientes?.length === 0 && (
            <p className="home-empty">
              Todavía no hay expedientes en <strong>{seccion}</strong>.
              <br />
              Empezá tu primera decisión con Architect.
            </p>
          )}
          {!loading && expedientes?.length > 0 && (
            <ul className="home-exp-list">
              {expedientes.map(exp => {
                const sv = exp.solve || {};
                const status = sv.human_review?.status || 'pendiente';
                return (
                  <li key={exp.id} className="home-exp-item">
                    <button
                      className="home-exp-btn"
                      onClick={() => onOpenIssue && onOpenIssue(exp)}
                    >
                      <span className="home-exp-dot" />
                      <span className="home-exp-label">{exp.label}</span>
                      <span className="home-exp-status">{status}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!loading && expedientes?.length > 0 && (
            <button className="home-link" onClick={onOpenIssue}>
              Ver todos los expedientes →
            </button>
          )}
        </section>

        {/* Accesos secundarios */}
        <section className="home-secondary">
          <h3 className="home-section-title">Explorar y consultar</h3>
          <div className="home-grid">
            <button className="home-card" onClick={onOpenGraph}>
              <span className="home-card-icon">⬡</span>
              <span className="home-card-text">
                <strong>Explorar grafo</strong>
                <small>Visualizá y navegá tu conocimiento en 3D</small>
              </span>
            </button>
            <button className="home-card" onClick={onOpenLibrary}>
              <span className="home-card-icon">⊞</span>
              <span className="home-card-text">
                <strong>Biblioteca</strong>
                <small>Cargá y gestioná tus documentos</small>
              </span>
            </button>
            <button className="home-card" onClick={onOpenAgent}>
              <span className="home-card-icon">⬡</span>
              <span className="home-card-text">
                <strong>Agente RAG</strong>
                <small>Preguntá sobre tu conocimiento con citas</small>
              </span>
            </button>
          </div>
        </section>

        {/* Nota al pie */}
        <footer className="home-footer">
          <p>
            <strong>Architect</strong> no es un módulo más: es el hilo que cruza
            secciones y agrupaciones para llegar a una decisión (o a "no implementar"),
            con expediente.
          </p>
        </footer>
      </div>
    </div>
  );
}
