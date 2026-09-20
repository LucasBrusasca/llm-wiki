import React, { useState, useEffect, useCallback } from 'react';

/* ── HomeView · Architect-first Decision Desk ──────────────────────────────
   Algedi es para DECIDIR con evidencia, no chatear.
   
   CTA primario: Empezar decisión (Architect)
   El flujo es: PROBLEMA → EVIDENCIA → DECISIÓN → EXPEDIENTE
   
   Sin feature cards genéricas. Sin vibes de SaaS template.
   ────────────────────────────────────────────────────────────────────────── */

const RUTAS = [
  { key: 'redesign', label: 'Rediseño', hint: 'ordenar el proceso' },
  { key: 'rules', label: 'Reglas', hint: 'determinístico' },
  { key: 'data', label: 'Datos', hint: 'visibilidad' },
  { key: 'assistive', label: 'IA asistiva', hint: 'criterio' },
  { key: 'agent', label: 'Agente', hint: 'delegado' },
  { key: 'none', label: 'No implementar', hint: 'sin evidencia' },
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
      {/* Fondo con gradiente sutil */}
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

        {/* Hero: CTA Principal */}
        <section className="home-desk-hero">
          <h1>Decidí con evidencia</h1>
          <p className="home-desk-subtitle">
            Planteá un problema. Architect busca en tu corpus, clasifica la ruta y arma el expediente.
          </p>
          
          <button className="home-desk-cta" onClick={onStartArchitect}>
            <span className="home-desk-cta-icon">⬢</span>
            <span className="home-desk-cta-text">
              <strong>Empezar decisión</strong>
              <small>PROBLEMA → EVIDENCIA → DECISIÓN → EXPEDIENTE</small>
            </span>
            <span className="home-desk-cta-arrow">→</span>
          </button>

          {/* Las 6 rutas como referencia visual */}
          <div className="home-desk-rutas">
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
                const status = sv.human_review?.status || 'pendiente';
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
                        {ruta ? ruta.label : 'sin clasificar'} · {status}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Ejemplo de uso (cuando no hay expedientes) */}
        {!loading && (!expedientes || expedientes.length === 0) && (
          <section className="home-desk-ejemplo">
            <div className="home-desk-ejemplo-label">ejemplo · tesorería</div>
            <p>
              "Tenemos un proceso de conciliación bancaria que toma 3 días porque se hace 
              manual en Excel. Los errores de tipeo generan diferencias que después hay que rastrear."
            </p>
            <div className="home-desk-ejemplo-result">
              → Architect analizaría si es rediseño, reglas, datos, IA asistiva, agente o si no hay suficiente evidencia.
            </div>
          </section>
        )}

        {/* Accesos secundarios (mínimos) */}
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

        {/* Footer mínimo */}
        <footer className="home-desk-footer">
          <p>
            Architect no es un módulo más: es el proceso para llegar a una decisión 
            (o a "no implementar") con expediente y evidencia.
          </p>
        </footer>
      </div>
    </div>
  );
}
