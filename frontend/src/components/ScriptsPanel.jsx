import React, { useState, useEffect, useCallback } from 'react';

export default function ScriptsPanel({ 
  seccion, 
  allNodes, 
  selectedNodeIds = [],
  onClose, 
  onRefresh,
  onNavigate 
}) {
  const [scripts, setScripts] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('registry'); // registry | propose | runs
  const [proposals, setProposals] = useState([]);
  const [proposing, setProposing] = useState(false);
  const [query, setQuery] = useState('');
  const [runningScript, setRunningScript] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [scriptInputs, setScriptInputs] = useState({});

  const loadScripts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/scripts');
      const data = await r.json();
      setScripts(data.scripts || []);
    } catch (e) {
      console.error('Error cargando scripts:', e);
    }
    setLoading(false);
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch('/api/scripts/runs?limit=15');
      const data = await r.json();
      setRuns(data.runs || []);
    } catch (e) {
      console.error('Error cargando ejecuciones:', e);
    }
  }, []);

  useEffect(() => {
    loadScripts();
    loadRuns();
  }, [loadScripts, loadRuns]);

  const addScriptToGraph = async (scriptId) => {
    try {
      const r = await fetch('/api/scripts/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script_id: scriptId,
          seccion: seccion || 'personal',
          link_to_nodes: selectedNodeIds,
        }),
      });
      const data = await r.json();
      if (r.ok) {
        window.alert(`Script añadido al grafo: ${data.label}`);
        if (onRefresh) onRefresh();
      } else {
        window.alert(`Error: ${data.detail || 'No se pudo añadir'}`);
      }
    } catch (e) {
      window.alert('Error de conexión');
    }
  };

  const proposeScripts = async () => {
    setProposing(true);
    try {
      const r = await fetch('/api/scripts/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query,
          node_ids: selectedNodeIds,
          limit: 5,
        }),
      });
      const data = await r.json();
      setProposals(data.proposals || []);
      setTab('propose');
    } catch (e) {
      console.error('Error proponiendo scripts:', e);
    }
    setProposing(false);
  };

  const runScript = async (scriptId, inputs = {}) => {
    setRunningScript(scriptId);
    setRunResult(null);
    try {
      const r = await fetch('/api/scripts/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script_id: scriptId,
          inputs: inputs,
          confirm: true,
          context_node_ids: selectedNodeIds,
        }),
      });
      const data = await r.json();
      setRunResult(data);
      loadRuns();
    } catch (e) {
      setRunResult({ error: 'Error de conexión' });
    }
    setRunningScript(null);
  };

  const renderScriptCard = (script, showActions = true) => (
    <div key={script.id} className="script-card">
      <div className="script-header">
        <span className="script-icon">⚙</span>
        <div className="script-info">
          <span className="script-name">{script.name}</span>
          <span className="script-version">v{script.version}</span>
        </div>
      </div>
      <p className="script-desc">{script.description}</p>
      <div className="script-tags">
        {(script.tags || []).map(t => (
          <span key={t} className="script-tag">{t}</span>
        ))}
      </div>
      {showActions && (
        <div className="script-actions">
          <button 
            className="script-btn script-btn--primary"
            onClick={() => addScriptToGraph(script.id)}
            title="Añadir como nodo al grafo"
          >
            ⊕ Añadir al grafo
          </button>
          <button 
            className="script-btn"
            onClick={() => {
              const inputs = scriptInputs[script.id] || {};
              if (window.confirm(`¿Ejecutar "${script.name}"?`)) {
                runScript(script.id, inputs);
              }
            }}
            disabled={runningScript === script.id}
          >
            {runningScript === script.id ? '⏳ Ejecutando…' : '▶ Ejecutar'}
          </button>
        </div>
      )}
    </div>
  );

  const renderProposalCard = (proposal) => (
    <div key={proposal.script_id} className="script-card script-card--proposal">
      <div className="script-header">
        <span className="script-icon">💡</span>
        <div className="script-info">
          <span className="script-name">{proposal.name}</span>
          <span className="script-score">Relevancia: {proposal.score}</span>
        </div>
      </div>
      <p className="script-desc">{proposal.description}</p>
      <p className="script-reason">
        <strong>Razón:</strong> {proposal.reason}
      </p>
      <div className="script-tags">
        {(proposal.tags || []).map(t => (
          <span key={t} className="script-tag">{t}</span>
        ))}
      </div>
      <div className="script-actions">
        <button 
          className="script-btn script-btn--confirm"
          onClick={() => {
            if (window.confirm(`¿Confirmar ejecución de "${proposal.name}"?`)) {
              runScript(proposal.script_id, {});
            }
          }}
          disabled={runningScript === proposal.script_id}
        >
          {runningScript === proposal.script_id ? '⏳ Ejecutando…' : '✓ Confirmar y ejecutar'}
        </button>
        <button 
          className="script-btn"
          onClick={() => addScriptToGraph(proposal.script_id)}
        >
          ⊕ Solo añadir
        </button>
      </div>
    </div>
  );

  return (
    <div className="scripts-overlay">
      <div className="scripts-panel">
        <div className="scripts-header">
          <span className="scripts-title">⚙ Scripts · {scripts.length} disponibles</span>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>

        {/* Agent Propose Section */}
        <div className="scripts-propose-section">
          <div className="scripts-propose-row">
            <input
              type="text"
              className="scripts-query-input"
              placeholder="¿Qué quieres hacer? (ej: resumir documentos, validar JSON...)"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && proposeScripts()}
            />
            <button 
              className="script-btn script-btn--primary"
              onClick={proposeScripts}
              disabled={proposing}
            >
              {proposing ? '⏳ Buscando…' : '🔍 Proponer scripts'}
            </button>
          </div>
          {selectedNodeIds.length > 0 && (
            <div className="scripts-context-info">
              📌 Contexto: {selectedNodeIds.length} nodo(s) seleccionado(s)
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="scripts-tabs">
          <button 
            className={`scripts-tab${tab === 'registry' ? ' active' : ''}`}
            onClick={() => setTab('registry')}
          >
            📋 Registry
          </button>
          <button 
            className={`scripts-tab${tab === 'propose' ? ' active' : ''}`}
            onClick={() => setTab('propose')}
          >
            💡 Propuestas {proposals.length > 0 && `(${proposals.length})`}
          </button>
          <button 
            className={`scripts-tab${tab === 'runs' ? ' active' : ''}`}
            onClick={() => { setTab('runs'); loadRuns(); }}
          >
            📜 Ejecuciones
          </button>
        </div>

        {/* Run Result */}
        {runResult && (
          <div className={`scripts-result ${runResult.status === 'error' ? 'scripts-result--error' : ''}`}>
            <div className="scripts-result-header">
              <span>{runResult.status === 'error' ? '❌ Error' : '✅ Resultado'}</span>
              <button onClick={() => setRunResult(null)}>✕</button>
            </div>
            <pre className="scripts-result-content">
              {JSON.stringify(runResult.outputs || runResult.error, null, 2)}
            </pre>
            {runResult.duration_ms && (
              <div className="scripts-result-meta">
                Duración: {runResult.duration_ms}ms
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="scripts-content">
          {loading ? (
            <div className="scripts-loading">Cargando scripts…</div>
          ) : tab === 'registry' ? (
            <div className="scripts-list">
              {scripts.length === 0 ? (
                <div className="scripts-empty">No hay scripts en el registry</div>
              ) : (
                scripts.map(s => renderScriptCard(s))
              )}
            </div>
          ) : tab === 'propose' ? (
            <div className="scripts-list">
              {proposals.length === 0 ? (
                <div className="scripts-empty">
                  Escribe una consulta y presiona "Proponer scripts" para obtener sugerencias.
                </div>
              ) : (
                proposals.map(p => renderProposalCard(p))
              )}
            </div>
          ) : (
            <div className="scripts-runs-list">
              {runs.length === 0 ? (
                <div className="scripts-empty">Sin ejecuciones recientes</div>
              ) : (
                runs.map(run => (
                  <div key={run.id} className={`scripts-run ${run.status === 'error' ? 'scripts-run--error' : ''}`}>
                    <div className="scripts-run-header">
                      <span className="scripts-run-id">#{run.id}</span>
                      <span className="scripts-run-script">{run.script_id}</span>
                      <span className={`scripts-run-status scripts-run-status--${run.status}`}>
                        {run.status === 'completed' ? '✓' : '✕'}
                      </span>
                    </div>
                    <div className="scripts-run-meta">
                      {run.created_at && new Date(run.created_at).toLocaleString('es-AR')}
                      {run.duration_ms && ` · ${run.duration_ms}ms`}
                    </div>
                    {run.status === 'error' && run.error_message && (
                      <div className="scripts-run-error">{run.error_message}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .scripts-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(10, 12, 20, 0.85);
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding: 60px 20px 20px;
          overflow-y: auto;
        }
        .scripts-panel {
          background: var(--panel-bg, #181c2a);
          border: 1px solid var(--border, #2a2e3e);
          border-radius: 12px;
          width: min(800px, 95vw);
          max-height: calc(100vh - 100px);
          display: flex;
          flex-direction: column;
          box-shadow: 0 12px 40px rgba(0,0,0,0.5);
        }
        .scripts-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border, #2a2e3e);
        }
        .scripts-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--gold, #c9a25e);
        }
        .scripts-propose-section {
          padding: 16px 20px;
          background: rgba(201, 162, 94, 0.05);
          border-bottom: 1px solid var(--border, #2a2e3e);
        }
        .scripts-propose-row {
          display: flex;
          gap: 12px;
        }
        .scripts-query-input {
          flex: 1;
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--border, #2a2e3e);
          border-radius: 8px;
          padding: 10px 14px;
          color: var(--text, #e8ecf4);
          font-size: 14px;
          outline: none;
        }
        .scripts-query-input:focus {
          border-color: var(--gold, #c9a25e);
        }
        .scripts-context-info {
          margin-top: 8px;
          font-size: 12px;
          color: #8fa1bd;
        }
        .scripts-tabs {
          display: flex;
          gap: 4px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border, #2a2e3e);
        }
        .scripts-tab {
          background: transparent;
          border: none;
          color: #8fa1bd;
          padding: 8px 16px;
          font-size: 13px;
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.2s;
        }
        .scripts-tab:hover {
          background: rgba(255,255,255,0.05);
        }
        .scripts-tab.active {
          background: rgba(201, 162, 94, 0.15);
          color: var(--gold, #c9a25e);
        }
        .scripts-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
        }
        .scripts-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .scripts-loading, .scripts-empty {
          text-align: center;
          color: #6a7a8c;
          padding: 40px;
        }
        .script-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border, #2a2e3e);
          border-radius: 10px;
          padding: 16px;
        }
        .script-card--proposal {
          border-color: rgba(201, 162, 94, 0.3);
          background: rgba(201, 162, 94, 0.05);
        }
        .script-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .script-icon {
          font-size: 24px;
          opacity: 0.8;
        }
        .script-info {
          flex: 1;
        }
        .script-name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text, #e8ecf4);
          display: block;
        }
        .script-version, .script-score {
          font-size: 11px;
          color: #6a7a8c;
        }
        .script-desc {
          font-size: 13px;
          color: #9aabbd;
          margin: 0 0 10px;
          line-height: 1.5;
        }
        .script-reason {
          font-size: 12px;
          color: var(--gold, #c9a25e);
          margin: 0 0 10px;
          padding: 8px 12px;
          background: rgba(201, 162, 94, 0.1);
          border-radius: 6px;
        }
        .script-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }
        .script-tag {
          font-size: 10px;
          background: rgba(0, 212, 255, 0.15);
          color: #00d4ff;
          padding: 3px 8px;
          border-radius: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .script-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .script-btn {
          background: rgba(255,255,255,0.08);
          border: 1px solid var(--border, #2a2e3e);
          color: var(--text, #e8ecf4);
          padding: 8px 14px;
          font-size: 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .script-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.12);
        }
        .script-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .script-btn--primary {
          background: rgba(201, 162, 94, 0.2);
          border-color: rgba(201, 162, 94, 0.4);
          color: var(--gold, #c9a25e);
        }
        .script-btn--primary:hover:not(:disabled) {
          background: rgba(201, 162, 94, 0.3);
        }
        .script-btn--confirm {
          background: rgba(100, 200, 100, 0.2);
          border-color: rgba(100, 200, 100, 0.4);
          color: #8cd98c;
        }
        .script-btn--confirm:hover:not(:disabled) {
          background: rgba(100, 200, 100, 0.3);
        }
        .scripts-result {
          margin: 0 20px 16px;
          background: rgba(100, 200, 100, 0.1);
          border: 1px solid rgba(100, 200, 100, 0.3);
          border-radius: 8px;
          overflow: hidden;
        }
        .scripts-result--error {
          background: rgba(200, 100, 100, 0.1);
          border-color: rgba(200, 100, 100, 0.3);
        }
        .scripts-result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: rgba(0,0,0,0.2);
          font-size: 12px;
          font-weight: 600;
        }
        .scripts-result-header button {
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 0;
          font-size: 14px;
        }
        .scripts-result-content {
          padding: 12px;
          font-size: 12px;
          font-family: monospace;
          margin: 0;
          max-height: 200px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .scripts-result-meta {
          padding: 6px 12px;
          font-size: 11px;
          color: #6a7a8c;
          border-top: 1px solid rgba(255,255,255,0.1);
        }
        .scripts-runs-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .scripts-run {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border, #2a2e3e);
          border-radius: 8px;
          padding: 12px;
        }
        .scripts-run--error {
          border-color: rgba(200, 100, 100, 0.3);
        }
        .scripts-run-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 4px;
        }
        .scripts-run-id {
          font-size: 11px;
          color: #6a7a8c;
          font-family: monospace;
        }
        .scripts-run-script {
          font-size: 13px;
          font-weight: 500;
          color: var(--text, #e8ecf4);
        }
        .scripts-run-status {
          margin-left: auto;
          font-size: 12px;
        }
        .scripts-run-status--completed {
          color: #8cd98c;
        }
        .scripts-run-status--error {
          color: #d98c8c;
        }
        .scripts-run-meta {
          font-size: 11px;
          color: #6a7a8c;
        }
        .scripts-run-error {
          font-size: 12px;
          color: #d98c8c;
          margin-top: 6px;
          padding: 6px 8px;
          background: rgba(200, 100, 100, 0.1);
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
