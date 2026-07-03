import React, { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

export default function AgentPanel({ node, allNodes, onClose, onHighlight }) {
  const color    = '#00d4ff';
  const convKey  = `algedi_agent_convs_${node?.id || 'global'}`;
  const legacyConvKey = `pragmaforge_agent_convs_${node?.id || 'global'}`; // migración: convs guardadas con el nombre anterior
  const oldKey   = `pragmaforge_agent_${node?.id || 'global'}`;            // migración: formato single, aún más viejo

  const initialMsg = node
    ? `Contexto: **"${node.label}"**. ¿Qué querés saber?`
    : `Agente global de Algedi. Exploro relaciones, busco conceptos y sintetizo tu grafo — **fundado en tus documentos**. Si algo no está en tu conocimiento, te lo digo en vez de inventarlo. ¿Qué necesitás?`;

  const makeConv = () => ({
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: 'Nueva conversación',
    msgs: [{ role: 'assistant', text: initialMsg }],
    ts: Date.now(),
  });

  const [convs, setConvs] = useState(() => {
    try {
      const saved = localStorage.getItem(convKey);
      if (saved) { const c = JSON.parse(saved); if (Array.isArray(c) && c.length) return c; }
      const legacy = localStorage.getItem(legacyConvKey);   // migrar convs del nombre anterior (PragmaForge → Algedi)
      if (legacy) { const c = JSON.parse(legacy); if (Array.isArray(c) && c.length) return c; }
      const old = localStorage.getItem(oldKey);   // migrar la conversación vieja (single)
      if (old) {
        const m = JSON.parse(old);
        if (Array.isArray(m) && m.length > 1) return [{ id: 'c_mig', title: 'Conversación anterior', msgs: m, ts: Date.now() }];
      }
    } catch {}
    return [makeConv()];
  });
  const [activeId, setActiveId] = useState(() => convs[0]?.id);
  const [showList, setShowList] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy]   = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  const active = convs.find(c => c.id === activeId) || convs[0];
  const msgs   = active?.msgs || [];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  useEffect(() => { inputRef.current?.focus(); }, [activeId]);
  useEffect(() => { try { localStorage.setItem(convKey, JSON.stringify(convs)); } catch {} }, [convs, convKey]);

  const patchActive = useCallback((fn) => {
    setConvs(prev => prev.map(c => (c.id === activeId ? fn(c) : c)));
  }, [activeId]);

  const startNew = useCallback(() => {
    const c = makeConv();
    setConvs(prev => [c, ...prev]);
    setActiveId(c.id);
    setShowList(false);
    onHighlight?.([]);
  }, [onHighlight]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteConv = useCallback((id, e) => {
    e?.stopPropagation();
    setConvs(prev => {
      const rest = prev.filter(c => c.id !== id);
      const next = rest.length ? rest : [makeConv()];
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    patchActive(c => ({
      ...c,
      title: c.title === 'Nueva conversación' ? (text.length > 32 ? text.slice(0, 31) + '…' : text) : c.title,
      msgs: [...c.msgs, { role: 'user', text }],
    }));
    setBusy(true);

    const history = [...msgs, { role: 'user', text }]
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.text }));

    try {
      const systemPrompt = node
        ? `Sos el agente de Algedi analizando el nodo "${node.label}".
Tipo de fuente: ${node.fuente || 'concepto'}.
Descripción: ${node.desc || '(sin descripción)'}.
Fragmento clave: ${node.fragmento || '(sin fragmento)'}.
Conceptos principales: ${(node.conceptos || []).join(', ') || '(ninguno)'}.
Respondé en base a esta información. Usá los datos que tenés. Respondé en español con markdown cuando sea útil.`
        : `Sos el agente global de Algedi. Ayudás a explorar relaciones y conceptos del grafo de conocimiento. Respondé en español con markdown.`;
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: systemPrompt, messages: history }),
      });
      const data = await res.json();
      patchActive(c => ({ ...c, msgs: [...c.msgs, { role: 'assistant', text: data.reply || 'Sin respuesta.', veto: !!data.veto, sim: data.max_sim }] }));
      if (data.nodos_relevantes?.length) onHighlight(data.nodos_relevantes);
    } catch {
      patchActive(c => ({ ...c, msgs: [...c.msgs, { role: 'assistant', text: 'Error al conectar con el agente.' }] }));
    } finally {
      setBusy(false);
    }
  }

  const userMsgs = msgs.filter(m => m.role === 'user').length;

  return (
    <aside className="side-panel agent-panel">
      <div className="agent-header">
        <button className="agent-conv-toggle" onClick={() => setShowList(s => !s)} title="Cambiar de conversación">
          <span style={{ color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⬡ {node ? node.label : (active?.title || 'Agente Global')}
          </span>
          <span className="agent-conv-caret">{showList ? '▴' : '▾'} {convs.length}</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button className="agent-clear-btn" onClick={startNew} title="Nueva conversación">＋ Nueva</button>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {showList && (
        <div className="agent-conv-list">
          {convs.map(c => (
            <div
              key={c.id}
              className={`agent-conv-item${c.id === activeId ? ' active' : ''}`}
              onClick={() => { setActiveId(c.id); setShowList(false); }}
            >
              <span className="agent-conv-item-title">{c.title}</span>
              <button className="agent-conv-del" onClick={(e) => deleteConv(c.id, e)} title="Borrar conversación">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="poi-stripes" />
      <div className="poi-status">
        <span className="poi-status-blink">●</span> AGENT ONLINE · {node ? `NODE ${String(node.id).slice(0, 18)}` : 'GLOBAL'}
        {userMsgs > 0 && <span style={{ marginLeft: 8, color: '#6fcf97' }}>· {userMsgs} preguntas</span>}
      </div>

      <div className="agent-messages">
        {msgs.map((m, i) => (
          <div key={i} className={`agent-msg ${m.role}${m.veto ? ' agent-msg--veto' : ''}`}>
            <div dangerouslySetInnerHTML={{ __html: marked.parse(m.text) }} />
            {m.role === 'assistant' && typeof m.sim === 'number' && !m.veto && (
              <div className="agent-msg-afinidad">afinidad máx: {Math.round(m.sim * 100)}%</div>
            )}
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
          onChange={e => { setInput(e.target.value); if (e.target.value) onHighlight?.([]); }}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Preguntá algo..."
          disabled={busy}
        />
        <button className="agent-send" onClick={send} disabled={busy} style={{ borderColor: color, color }}>→</button>
      </div>
    </aside>
  );
}
