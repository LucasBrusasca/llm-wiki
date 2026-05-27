import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import ReactFlow, { Background, Controls, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import { clusterColor } from '../App.jsx';

const FUENTE_ICON = { youtube: '▶', pdf: '⬛', tesis: '⬛', excel: '⊞', html: '⊡', concepto: '◈', issue: '⚠' };

// Subcomponente para evitar que el re-render afecte la lista lateral al escribir
function NewIssueForm({ onRefresh, setSelectedIssueId }) {
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

  const STEPS = [
    { at: 15, label: 'Obteniendo contenido de referencia…' },
    { at: 20, label: 'Analizando el problema…' },
    { at: 50, label: 'Guardando en el grafo y extrayendo flujograma…' },
    { at: 70, label: 'Buscando conexiones relevantes…' },
    { at: 85, label: 'Generando síntesis con el agente…' },
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
        <div className="issue-result">
          <div className="issue-result-label" style={{ fontSize: 14 }}>PROCESO DETECTADO EXITOSAMENTE</div>
          <div className="issue-result-title" style={{ fontSize: 24, margin: '12px 0' }}>{result?.label}</div>
          
          <div className="issue-result-actions" style={{ marginTop: 30, display: 'flex', gap: 16 }}>
            <button 
              className="issue-new-btn" 
              style={{ padding: '12px 24px', fontSize: 14, borderRadius: 8 }}
              onClick={() => { setSelectedIssueId(result?.nodo_id); onRefresh(); }}
            >
              Ver Flujograma Interactivo
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


export default function IssuePanel({ allNodes, onClose, onRefresh, onNavigate }) {
  const [selectedIssueId, setSelectedIssueId] = useState('new');
  const [search, setSearch] = useState('');

  // Estados para "Chat de Issue"
  const [chatHistories, setChatHistories] = useState({});
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedStage, setSelectedStage] = useState(null);
  const messagesEndRef = useRef(null);

  const issues = useMemo(() => {
    const q = search.toLowerCase();
    return allNodes
      .filter(n => n.is_issue)
      .filter(n => !q || n.label.toLowerCase().includes(q) || (n.desc || '').toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allNodes, search]);

  const selectedIssue = useMemo(() => issues.find(i => i.id === selectedIssueId), [issues, selectedIssueId]);
  const currentChat = selectedIssueId && selectedIssueId !== 'new' ? (chatHistories[selectedIssueId] || []) : [];

  // Reset stage selection when issue changes
  useEffect(() => {
    setSelectedStage(null);
  }, [selectedIssueId]);

  // Auto-scroll chat
  useEffect(() => {
    if (selectedIssueId !== 'new') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentChat, isTyping, selectedIssueId]);

  // ---- Lógica de Flujograma (React Flow) ----
  const initialElements = useMemo(() => {
    if (!selectedIssue || !selectedIssue.flujograma) return { nodes: [], edges: [] };
    const { etapas = [], conexiones = [] } = selectedIssue.flujograma;
    
    // Layout en árbol muy básico, de arriba hacia abajo
    const rfNodes = etapas.map((etapa, idx) => ({
      id: etapa.id,
      data: { label: `${etapa.label}\n\n${etapa.desc || ''}` },
      position: { x: 300, y: idx * 120 + 40 },
      style: {
        background: selectedStage?.id === etapa.id ? 'rgba(245,166,35,0.2)' : 'rgba(10,14,30,0.9)',
        color: selectedStage?.id === etapa.id ? '#f5a623' : '#c4c8d6',
        border: `1px solid ${selectedStage?.id === etapa.id ? '#f5a623' : 'rgba(80,100,150,0.4)'}`,
        borderRadius: '6px',
        width: 250,
        fontSize: '12px',
        textAlign: 'center',
        cursor: 'pointer',
        boxShadow: selectedStage?.id === etapa.id ? '0 0 15px rgba(245,166,35,0.3)' : 'none',
        transition: 'all 0.2s'
      }
    }));

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
  }, [selectedIssue, selectedStage]);

  // ---- Lógica de Chat de Issue ----
  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedIssue) return;
    
    const userMsg = { role: 'user', text: inputText };
    setChatHistories(prev => ({
      ...prev,
      [selectedIssue.id]: [...(prev[selectedIssue.id] || []), userMsg]
    }));
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
      
      const aiMsg = { role: 'assistant', text: data.result || 'No se recibió respuesta.' };
      setChatHistories(prev => ({
        ...prev,
        [selectedIssue.id]: [...(prev[selectedIssue.id] || []), aiMsg]
      }));
    } catch (e) {
      setChatHistories(prev => ({
        ...prev,
        [selectedIssue.id]: [...(prev[selectedIssue.id] || []), { role: 'assistant', text: 'Error de conexión con el agente.' }]
      }));
    } finally {
      setIsTyping(false);
    }
  };

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
                  {issue.flujograma && issue.flujograma.etapas?.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--gold)', marginTop: 8, fontWeight: 600, letterSpacing: 0.5 }}>⬡ FLUJOGRAMA DISPONIBLE</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* PANEL DERECHO: CONTENIDO */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg, rgba(9, 12, 26, 0.99) 0%, rgba(5, 7, 18, 1) 100%)', position: 'relative' }}>
          <button className="panel-close" onClick={onClose} style={{ position: 'absolute', top: 16, right: 20, zIndex: 10, fontSize: 16 }}>✕</button>

          {selectedIssueId === 'new' ? (
            <NewIssueForm onRefresh={onRefresh} setSelectedIssueId={setSelectedIssueId} />
          ) : (
            // --- VISTA: DETALLE DEL ISSUE (FLUJOGRAMA + CHAT) ---
            selectedIssue && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                
                {/* ZONA SUPERIOR: FLUJOGRAMA */}
                {selectedIssue.flujograma && selectedIssue.flujograma.etapas?.length > 0 && (
                  <div style={{ flex: 1, minHeight: '40%', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.6)', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 5, fontSize: 12, color: 'var(--gold)', fontWeight: 600, letterSpacing: 1 }}>
                      FLUJOGRAMA INTERACTIVO (Selecciona una etapa)
                    </div>
                    <ReactFlow 
                      nodes={initialElements.nodes}
                      edges={initialElements.edges}
                      onNodeClick={(_, node) => {
                        const etapa = selectedIssue.flujograma.etapas.find(e => e.id === node.id);
                        setSelectedStage(etapa);
                      }}
                      fitView
                      fitViewOptions={{ padding: 0.2 }}
                      attributionPosition="bottom-right"
                    >
                      <Background color="#5a6ea0" gap={20} size={1} opacity={0.15} />
                      <Controls showInteractive={false} />
                    </ReactFlow>
                  </div>
                )}

                {/* HEADER INFO DEL CHAT */}
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(255,48,96,0.04)', flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#ff3060', marginBottom: 6 }}>{selectedIssue.label}</div>
                  
                  {selectedStage ? (
                    <div style={{ fontSize: 13, color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ padding: '4px 8px', background: 'rgba(245,166,35,0.2)', borderRadius: 4 }}>Etapa en Foco: {selectedStage.label}</span>
                      <button onClick={() => setSelectedStage(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: 4 }}>[Quitar foco]</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Conversando sobre el proceso general.</div>
                  )}
                </div>

                {/* ZONA INFERIOR: CHAT */}
                <div className="agent-messages" style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
                  {currentChat.length === 0 && (
                    <div style={{ color: 'var(--text-mid)', fontSize: 13, textAlign: 'center', marginTop: 40, fontStyle: 'italic' }}>
                      {selectedStage ? `Pregunta sobre la etapa "${selectedStage.label}" y el agente cruzará la consulta con tu biblioteca.` : `Inicia una conversación sobre este proceso.`}
                    </div>
                  )}
                  {currentChat.map((msg, idx) => (
                    <div key={idx} className={`agent-msg ${msg.role}`} style={{ maxWidth: '85%', fontSize: 14, lineHeight: 1.6 }}>
                      {msg.role === 'assistant' ? (
                        <div dangerouslySetInnerHTML={{ __html: msg.text }} />
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
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
