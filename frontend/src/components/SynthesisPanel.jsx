import React, { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { clusterColor } from '../App.jsx';

marked.setOptions({ breaks: true, gfm: true });

export default function SynthesisPanel({ allNodes, selectedIds, onClose, onClearSelection }) {
  const [result, setResult]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [prompt, setPrompt]   = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [result]);

  const selected = allNodes.filter(n => selectedIds.has(n.id));

  const generate = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    setResult('');

    const nodesCtx = selected.map(n =>
      `**${n.label}** (${n.fuente || 'concepto'})\n` +
      `Descripción: ${n.desc || '—'}\n` +
      `Conceptos: ${(n.conceptos || []).join(', ') || '—'}\n` +
      `Fragmento: ${n.fragmento || '—'}`
    ).join('\n\n---\n\n');

    const system = `Sos el agente de síntesis de PragmaForge. Se te proporcionan ${selected.length} nodos del grafo de conocimiento. Tu tarea es generar un documento de síntesis estructurado que:
1. Identifique los temas centrales y cómo se vinculan entre los nodos
2. Detecte patrones, convergencias y posibles contradicciones
3. Proponga oportunidades de integración entre los conceptos
4. Concluya con los insights más relevantes

Respondé en español con markdown. Sé conciso pero profundo.

NODOS:
${nodesCtx}`;

    const userMsg = prompt.trim() || 'Generá la síntesis de estos nodos.';

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });
      const data = await res.json();
      setResult(data.reply || 'Sin respuesta.');
    } catch {
      setResult('Error al conectar con el agente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="side-panel synth-panel">
      <div className="agent-header">
        <span style={{ color: '#f5a623' }}>⬡ SÍNTESIS</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {selected.length} nodo{selected.length !== 1 ? 's' : ''} seleccionado{selected.length !== 1 ? 's' : ''}
          </span>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Selected node chips */}
      <div className="synth-chips">
        {selected.length === 0
          ? <span className="synth-hint">Clickeá nodos en el grafo para agregarlos</span>
          : selected.map(n => (
            <span key={n.id} className="synth-chip"
              style={{ borderColor: clusterColor(n.cluster) + '66', color: clusterColor(n.cluster) }}>
              {n.label.length > 24 ? n.label.slice(0, 23) + '…' : n.label}
            </span>
          ))
        }
        {selected.length > 0 && (
          <button className="synth-clear" onClick={onClearSelection}>Limpiar</button>
        )}
      </div>

      {/* Optional prompt */}
      <div className="synth-prompt-row">
        <input
          className="agent-input"
          placeholder="Pregunta opcional (ej: ¿Cómo se relacionan con IA?)"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()}
          disabled={busy}
        />
      </div>

      {/* Generate button */}
      <button
        className="btn-primary"
        style={{ borderColor: '#f5a623', color: '#f5a623', margin: '0 20px' }}
        onClick={generate}
        disabled={busy || !selected.length}
      >
        {busy ? 'Generando síntesis…' : '⬡ Generar síntesis'}
      </button>

      {/* Result */}
      {result && (
        <div className="synth-result">
          <div className="panel-section-label" style={{ marginBottom: 10 }}>DOCUMENTO DE SÍNTESIS</div>
          <div
            className="agent-msg assistant"
            style={{ maxWidth: '100%', alignSelf: 'stretch' }}
            dangerouslySetInnerHTML={{ __html: marked.parse(result) }}
          />
          <div ref={bottomRef} />
        </div>
      )}
    </aside>
  );
}
