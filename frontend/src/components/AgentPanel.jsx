import React, { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { clusterColor } from '../App.jsx';

marked.setOptions({ breaks: true, gfm: true });

export default function AgentPanel({ node, allNodes, onClose, onHighlight }) {
  const color   = node ? clusterColor(node.cluster) : '#f5a623';
  const storageKey = `pragmaforge_agent_${node?.id || 'global'}`;

  const initialMsg = node
    ? `Contexto: **"${node.label}"**. ¿Qué querés saber?`
    : `Agente global de PragmaForge. Puedo ayudarte a explorar relaciones, buscar conceptos y sintetizar información del grafo. ¿Qué necesitás?`;

  const [msgs, setMsgs] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [{ role: 'assistant', text: initialMsg }];
  });

  const [input, setInput] = useState('');
  const [busy, setBusy]   = useState(false);
  const bottomRef         = useRef(null);
  const inputRef          = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Persist on every change
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(msgs)); } catch {}
  }, [msgs, storageKey]);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(storageKey);
    setMsgs([{ role: 'assistant', text: initialMsg }]);
  }, [storageKey, initialMsg]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs(prev => [...prev, { role: 'user', text }]);
    setBusy(true);

    const history = [...msgs, { role: 'user', text }]
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.text }));

    try {
      const systemPrompt = node
        ? `Sos el agente de PragmaForge analizando el nodo "${node.label}".
Tipo de fuente: ${node.fuente || 'concepto'}.
Descripción: ${node.desc || '(sin descripción)'}.
Fragmento clave: ${node.fragmento || '(sin fragmento)'}.
Conceptos principales: ${(node.conceptos || []).join(', ') || '(ninguno)'}.
Respondé SIEMPRE en base a esta información sin decir que no podés acceder al recurso. Usá los datos que tenés. Respondé en español con markdown cuando sea útil.`
        : `Sos el agente global de PragmaForge. Ayudás a explorar relaciones y conceptos del grafo de conocimiento. Respondé en español con markdown.`;
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: systemPrompt, messages: history }),
      });
      const data = await res.json();
      setMsgs(prev => [...prev, { role: 'assistant', text: data.reply || 'Sin respuesta.' }]);
      if (data.nodos_relevantes?.length) onHighlight(data.nodos_relevantes);
    } catch {
      setMsgs(prev => [...prev, { role: 'assistant', text: 'Error al conectar con el agente.' }]);
    } finally {
      setBusy(false);
    }
  }

  const msgCount = msgs.filter(m => m.role !== 'assistant' || msgs.indexOf(m) > 0).length;
  const hasHistory = msgCount > 1;

  return (
    <aside className="side-panel agent-panel">
      <div className="agent-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⬡ {node ? node.label : 'Agente Global'}
          </span>
          {hasHistory && (
            <span style={{ fontSize: 9, color: '#6fcf97', letterSpacing: 1.5 }}>
              ● MEMORIA ACTIVA · {msgCount} mensajes
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {hasHistory && (
            <button
              className="agent-clear-btn"
              onClick={clearHistory}
              title="Borrar historial de esta conversación"
            >
              ↺ Borrar
            </button>
          )}
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="agent-messages">
        {msgs.map((m, i) => (
          <div key={i} className={`agent-msg ${m.role}`}>
            <div dangerouslySetInnerHTML={{ __html: marked.parse(m.text) }} />
          </div>
        ))}
        {busy && (
          <div className="agent-msg assistant">
            <span className="thinking-dots">Analizando</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="agent-input-row">
        <input
          ref={inputRef}
          className="agent-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Preguntá algo..."
          disabled={busy}
        />
        <button
          className="agent-send"
          onClick={send}
          disabled={busy}
          style={{ borderColor: color, color }}
        >
          →
        </button>
      </div>
    </aside>
  );
}
