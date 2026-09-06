import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import ArchitectCanvas from './ArchitectCanvas.jsx';

/* ── Architect · Taller de Casos con Chat Interactivo ─────────────────────────
   CHAT + CANVAS: el usuario dialoga y el canvas se actualiza en vivo.
   - Chat lateral para ida y vuelta con sugerencias clickeables
   - Canvas como área de trabajo central
   - Click en nodo → drawer lateral
   - Sugerencias = botones que aplican acciones al canvas
   ───────────────────────────────────────────────────────────────────────────── */

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
  
  // Chat interactivo
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: '¡Hola! Contame qué problema querés resolver. Voy a ayudarte a armar el flujo de decisión.', suggestions: [
      { label: 'Empezar con plantilla', action: 'use_template', params: { template: 'simple' } },
    ]}
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  
  // Expedientes (vista alternativa)
  const [vistaExpedientes, setVistaExpedientes] = useState(false);
  const [expedientes, setExpedientes] = useState(null);
  
  // Análisis y sugerencias de rutas
  const [sugerencias, setSugerencias] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);

  // Referencia al canvas para comunicación
  const canvasRef = useRef(null);
  
  // Auto-scroll del chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const cargarExpedientes = useCallback(async () => {
    setExpedientes(null);
    try {
      const r = await fetch(`/api/graph?seccion=${encodeURIComponent(seccion)}`);
      const d = await r.json();
      const issues = (d.nodos || []).filter(n => n.is_issue);
      setExpedientes(issues);
    } catch { setExpedientes([]); }
  }, [seccion]);

  // Obtener estado actual del canvas
  const getCanvasState = useCallback(() => {
    if (canvasRef.current?.getFlowData) {
      const { nodes, edges } = canvasRef.current.getFlowData();
      return { nodes, edges, caseName, problem };
    }
    return { nodes: [], edges: [], caseName, problem };
  }, [caseName, problem]);

  // Enviar mensaje al chat
  const sendChatMessage = useCallback(async (messageText) => {
    const text = messageText?.trim() || chatInput.trim();
    if (!text || chatLoading) return;
    
    // Agregar mensaje del usuario inmediatamente
    const userMsg = { role: 'user', content: text };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);
    
    // Si es el primer mensaje sustancial, usarlo como problema
    if (!problem && text.length > 15) {
      setProblem(text);
    }
    
    try {
      const canvasState = getCanvasState();
      const allMessages = [...chatMessages, userMsg];
      
      const r = await fetch('/api/architect/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: allMessages.map(m => ({ role: m.role, content: m.content })),
          canvas_state: canvasState,
          seccion,
        }),
      });
      
      const data = await r.json().catch(() => ({}));
      
      // Agregar respuesta del asistente
      const assistantMsg = {
        role: 'assistant',
        content: data.message || 'Contame más sobre tu caso.',
        suggestions: data.suggestions || [],
      };
      setChatMessages(prev => [...prev, assistantMsg]);
      
      // Actualizar nombre del caso si el LLM sugirió uno mejor
      if (data.case_name && !caseName) {
        setCaseName(data.case_name);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Hubo un error. Intentá de nuevo.',
        suggestions: [],
      }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatMessages, chatLoading, problem, caseName, seccion, getCanvasState]);

  // Ejecutar una sugerencia clickeable
  const executeSuggestion = useCallback(async (suggestion) => {
    const { action, params = {}, label } = suggestion;
    
    // Feedback inmediato en el chat
    setChatMessages(prev => [...prev, {
      role: 'user',
      content: `→ ${label}`,
      isAction: true,
    }]);
    
    switch (action) {
      case 'generate_flow':
        if (canvasRef.current?.generarFlujoDesdePrompt) {
          setChatLoading(true);
          await canvasRef.current.generarFlujoDesdePrompt(problem);
          setChatLoading(false);
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: '¡Listo! Generé un flujo inicial. Podés editar los nodos haciendo click.',
            suggestions: [
              { label: 'Agregar paso', action: 'add_node', params: { type: 'paso', label: 'Nuevo paso' } },
              { label: 'Analizar rutas', action: 'analyze_routes', params: {} },
            ],
          }]);
        }
        break;
        
      case 'use_template':
        if (canvasRef.current?.cargarPlantilla) {
          canvasRef.current.cargarPlantilla(params.template || 'simple');
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `Cargué la plantilla "${params.template || 'simple'}". Hacé click en cualquier nodo para editarlo.`,
            suggestions: [
              { label: 'Generar desde problema', action: 'generate_flow', params: {} },
            ],
          }]);
        }
        break;
        
      case 'add_node':
        if (canvasRef.current?.addNode) {
          canvasRef.current.addNode(params.type || 'paso', params.label || 'Nuevo paso');
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `Agregué el nodo "${params.label}". Arrastralo donde quieras.`,
            suggestions: [],
          }]);
        }
        break;
        
      case 'find_evidence':
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Para vincular evidencia, hacé click en un nodo y usá el buscador en el drawer lateral.',
          suggestions: [],
        }]);
        break;
        
      case 'refine_problem':
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: '¿Podrías contarme un poco más sobre el problema? Por ejemplo: ¿cuál es el proceso actual? ¿qué decisiones se toman?',
          suggestions: [],
        }]);
        break;
        
      case 'analyze_routes':
        if (canvasRef.current?.getFlowData) {
          const flowData = canvasRef.current.getFlowData();
          await analizarCaso(flowData);
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: 'Analicé el caso. Mirá las sugerencias de ruta abajo del canvas.',
            suggestions: [],
          }]);
        }
        break;
        
      default:
        // Acción desconocida - enviar como mensaje
        sendChatMessage(label);
    }
  }, [problem, sendChatMessage]);

  // Analizar el caso (para rutas)
  const analizarCaso = useCallback(async (flowData) => {
    if (!problem.trim()) return;
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
          flow: flowData,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setSugerencias(data);
        setMostrarSugerencias(true);
      }
    } catch { }
    finally { setAnalizando(false); }
  }, [problem, caseName]);

  const rutaSugerida = useMemo(
    () => sugerencias ? RUTAS.find(r => r.key === sugerencias.classification) : null,
    [sugerencias]
  );

  return (
    <div className="arch-overlay">
      <div className="arch-panel arch-panel--chat">

        {/* ── Cabecera ── */}
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
          /* ── Vista de expedientes ── */
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
          /* ── Vista principal: Chat + Canvas ── */
          <div className="arch-workspace arch-workspace--chat">
            
            {/* ── Panel de Chat (izquierda) ── */}
            <div className="arch-chat-panel">
              <div className="arch-chat-header">
                <input
                  className="arch-chat-case-name"
                  placeholder="Nombre del caso"
                  value={caseName}
                  onChange={e => setCaseName(e.target.value)}
                />
              </div>
              
              <div className="arch-chat-messages">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`arch-chat-msg arch-chat-msg--${msg.role}${msg.isAction ? ' action' : ''}`}>
                    <div className="arch-chat-msg-content">{msg.content}</div>
                    {msg.suggestions?.length > 0 && (
                      <div className="arch-chat-suggestions">
                        {msg.suggestions.map((s, j) => (
                          <button
                            key={j}
                            className="arch-chat-suggestion"
                            onClick={() => executeSuggestion(s)}
                            disabled={chatLoading}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading && (
                  <div className="arch-chat-msg arch-chat-msg--assistant">
                    <div className="arch-chat-msg-content arch-chat-typing">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              
              <div className="arch-chat-input-wrap">
                <textarea
                  className="arch-chat-input"
                  placeholder="Escribí tu mensaje..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                  rows={2}
                />
                <button
                  className="arch-chat-send"
                  onClick={() => sendChatMessage()}
                  disabled={chatLoading || !chatInput.trim()}
                >
                  ↑
                </button>
              </div>
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

            {/* ── Sugerencias de rutas (colapsable) ── */}
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
                      <strong>Opcional:</strong> Sugerencia basada en tu corpus.
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
