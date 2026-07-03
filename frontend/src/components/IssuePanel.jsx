import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import ReactFlow, { Background, Controls, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

// ── Reporte de los 4 agentes ────────────────────────────────────────────────
// Colapsable y renderizado como markdown. Compartido entre el resultado
// post-creación y la pestaña "Reporte" del detalle del issue.
const SYN_SECTIONS = [
  { key: 'proceso',  title: '⚙️ ANÁLISIS DE PROCESO',  color: '#00ff88' },
  { key: 'riesgos',  title: '⚠️ GESTIÓN DE RIESGOS',   color: '#ff9500' },
  { key: 'creativo', title: '💡 PERSPECTIVA CREATIVA',  color: '#00d4ff' },
  { key: 'red_team', title: '🔴 RED TEAM',              color: '#ff3366', dark: true },
];

function SynthesisView({ syn }) {
  const [collapsed, setCollapsed] = useState({});
  const isObject = typeof syn === 'object' && syn !== null;
  const sections = isObject
    ? SYN_SECTIONS.map(s => ({ ...s, content: syn[s.key] })).filter(s => s.content)
    : [{ key: 'synthesis', title: '⬡ SÍNTESIS', color: 'var(--gold)', content: syn }];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sections.map(({ key, title, color, content, dark }) => {
        const isCollapsed = collapsed[key];
        return (
          <div key={key} style={{
            borderRadius: 6,
            border: `1px solid ${dark ? 'rgba(255,51,102,0.3)' : `${color}33`}`,
            background: dark ? 'rgba(30,4,12,0.7)' : 'rgba(255,255,255,0.03)',
            overflow: 'hidden',
          }}>
            <button
              onClick={() => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', padding: '10px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                color, fontWeight: 700, fontSize: 11, letterSpacing: 1.2,
                fontFamily: 'monospace', textAlign: 'left',
              }}
            >
              {title}
              <span style={{ fontSize: 12, opacity: 0.7 }}>{isCollapsed ? '▸' : '▾'}</span>
            </button>
            {!isCollapsed && (
              <div
                style={{
                  padding: '10px 14px 14px', fontSize: 13, color: '#c4c8d6', lineHeight: 1.7,
                  borderTop: `1px solid ${dark ? 'rgba(255,51,102,0.15)' : 'rgba(255,255,255,0.06)'}`,
                }}
                dangerouslySetInnerHTML={{ __html: marked.parse(content || '') }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Formulario de nuevo issue ───────────────────────────────────────────────
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

  // Ordenados por umbral ascendente: el .find(progress <= at) devuelve el paso correcto.
  const STEPS = [
    { at: 15, label: 'Obteniendo contenido de referencia…' },
    { at: 25, label: 'Analizando el problema…' },
    { at: 40, label: 'Agente 1/4 — Análisis de procesos…' },
    { at: 55, label: 'Agente 2/4 — Gestión de riesgos…' },
    { at: 68, label: 'Agente 3/4 — Perspectiva creativa…' },
    { at: 80, label: 'Agente 4/4 — Red Team epistémico…' },
    { at: 90, label: 'Guardando en el grafo y extrayendo flujograma…' },
    { at: 95, label: 'Finalizando…' },
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
        <div className="issue-result" style={{ paddingBottom: 32 }}>
          <div className="issue-result-label" style={{ fontSize: 14 }}>PROCESO DETECTADO EXITOSAMENTE</div>
          <div className="issue-result-title" style={{ fontSize: 24, margin: '12px 0' }}>{result?.label}</div>

          {result?.synthesis && (
            <div style={{ marginTop: 20 }}>
              <SynthesisView syn={result.synthesis} />
            </div>
          )}

          <div className="issue-result-actions" style={{ marginTop: 24, display: 'flex', gap: 16 }}>
            <button
              className="issue-new-btn"
              style={{ padding: '12px 24px', fontSize: 14, borderRadius: 8 }}
              onClick={() => { setSelectedIssueId(result?.nodo_id); onRefresh(); }}
            >
              Abrir el issue (reporte + flujograma + chat)
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


// ── Panel principal ─────────────────────────────────────────────────────────
export default function IssuePanel({ allNodes, onClose, onRefresh, onNavigate }) {
  const [selectedIssueId, setSelectedIssueId] = useState('new');
  const [search, setSearch] = useState('');

  // Chat por issue — persistido en localStorage para no perder el diagnóstico
  // al cerrar el panel (mismo criterio que AgentPanel).
  const CHATS_KEY = 'algedi_issue_chats';
  const [chatHistories, setChatHistories] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CHATS_KEY) || '{}');
      return (saved && typeof saved === 'object') ? saved : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(chatHistories)); } catch {}
  }, [chatHistories]);

  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [selectedStage, setSelectedStage] = useState(null);
  const [detailTab, setDetailTab] = useState('analisis');
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

  // Reset al cambiar de issue: foco de etapa y pestaña por defecto (reporte si existe).
  useEffect(() => {
    setSelectedStage(null);
    const iss = issues.find(i => i.id === selectedIssueId);
    setDetailTab(iss?.synthesis ? 'analisis' : (iss?.flujograma?.etapas?.length ? 'flujo' : 'chat'));
  }, [selectedIssueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll chat
  useEffect(() => {
    if (selectedIssueId !== 'new' && detailTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [currentChat, isTyping, selectedIssueId, detailTab]);

  const clearChat = useCallback(() => {
    if (!selectedIssue) return;
    setChatHistories(prev => { const next = { ...prev }; delete next[selectedIssue.id]; return next; });
  }, [selectedIssue]);

  const deleteIssue = useCallback(async () => {
    if (!selectedIssue) return;
    if (!window.confirm(`¿Eliminar "${selectedIssue.label}" del grafo? Esta acción no se puede deshacer.`)) return;
    try {
      await fetch(`/api/node/${encodeURIComponent(selectedIssue.id)}`, { method: 'DELETE' });
      setChatHistories(prev => { const next = { ...prev }; delete next[selectedIssue.id]; return next; });
      setSelectedIssueId('new');
      onRefresh();
    } catch { /* el refresh mostrará el estado real */ }
  }, [selectedIssue, onRefresh]);

  // ---- Flujograma (React Flow) ----
  const initialElements = useMemo(() => {
    if (!selectedIssue || !selectedIssue.flujograma) return { nodes: [], edges: [] };
    const { etapas = [], conexiones = [] } = selectedIssue.flujograma;

    // Layout por niveles (BFS sobre las conexiones): las ramas se abren en columnas
    // en vez de apilarse todas en una sola línea vertical.
    const children = {};
    conexiones.forEach(c => { (children[c.source] ??= []).push(c.target); });
    const targets = new Set(conexiones.map(c => c.target));
    const raiz = etapas.find(e => !targets.has(e.id)) || etapas[0];
    const nivel = {};
    if (raiz) {
      const q = [[raiz.id, 0]]; nivel[raiz.id] = 0;
      while (q.length) {
        const [id, d] = q.shift();
        (children[id] || []).forEach(h => {
          if (nivel[h] === undefined) { nivel[h] = d + 1; q.push([h, d + 1]); }
        });
      }
    }
    let maxNivel = Math.max(0, ...Object.values(nivel).filter(Number.isFinite));
    etapas.forEach(e => { if (nivel[e.id] === undefined) { maxNivel += 1; nivel[e.id] = maxNivel; } });
    const porNivel = {};
    etapas.forEach(e => { (porNivel[nivel[e.id]] ??= []).push(e); });
    const NODE_W = 250, COL_GAP = 60, ROW_H = 150;
    const posDe = {};
    Object.entries(porNivel).forEach(([lvl, filas]) => {
      const totalW = filas.length * NODE_W + (filas.length - 1) * COL_GAP;
      const x0 = Math.max(40, (900 - totalW) / 2);
      filas.forEach((e, i) => { posDe[e.id] = { x: x0 + i * (NODE_W + COL_GAP), y: Number(lvl) * ROW_H + 40 }; });
    });

    const rfNodes = etapas.map(etapa => ({
      id: etapa.id,
      data: { label: `${etapa.label}\n\n${etapa.desc || ''}` },
      position: posDe[etapa.id] || { x: 300, y: 40 },
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

  // ---- Chat del issue ----
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

      let texto = data.result || 'No se recibió respuesta.';
      if (typeof data.max_sim === 'number' && data.max_sim > 0) {
        texto += `\n\n<small style="color:#7a8699">⊙ fundado en tu grafo · afinidad máx ${Math.round(data.max_sim * 100)}%</small>`;
      }
      const aiMsg = { role: 'assistant', text: texto };
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

  const TABS = [
    { id: 'analisis', label: '⬡ Reporte' },
    { id: 'flujo',    label: '⛬ Flujograma' },
    { id: 'chat',     label: '💬 Chat' },
  ];

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
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    {issue.synthesis && (
                      <span style={{ fontSize: 10, color: '#00d4ff', fontWeight: 600, letterSpacing: 0.5 }}>⬡ REPORTE</span>
                    )}
                    {issue.flujograma?.etapas?.length > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--gold)', fontWeight: 600, letterSpacing: 0.5 }}>⛬ FLUJOGRAMA</span>
                    )}
                  </div>
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
            // --- VISTA: DETALLE DEL ISSUE (pestañas Reporte / Flujograma / Chat) ---
            selectedIssue && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

                {/* HEADER: título, eliminar y pestañas */}
                <div style={{ padding: '18px 24px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingRight: 36 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: '#ff3060' }}>{selectedIssue.label}</div>
                      {selectedIssue.desc && (
                        <div style={{ fontSize: 12.5, color: 'var(--text-mid)', marginTop: 6, lineHeight: 1.5 }}>{selectedIssue.desc}</div>
                      )}
                    </div>
                    <button onClick={deleteIssue} title="Eliminar este issue del grafo"
                      style={{
                        background: 'none', border: '1px solid rgba(255,48,96,0.35)', color: '#ff3060',
                        borderRadius: 6, cursor: 'pointer', height: 30, padding: '0 10px', fontSize: 11.5, flexShrink: 0,
                      }}>
                      🗑 Eliminar
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    {TABS.map(t => (
                      <button key={t.id} onClick={() => setDetailTab(t.id)}
                        style={{
                          padding: '9px 16px', fontSize: 12.5, cursor: 'pointer',
                          background: 'none', border: 'none',
                          borderBottom: `2px solid ${detailTab === t.id ? '#ff3060' : 'transparent'}`,
                          color: detailTab === t.id ? '#ff3060' : 'var(--text-mid)', fontWeight: 600,
                        }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PESTAÑA: REPORTE */}
                {detailTab === 'analisis' && (
                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                    {selectedIssue.synthesis ? (
                      <SynthesisView syn={selectedIssue.synthesis} />
                    ) : (
                      <div style={{ color: 'var(--text-mid)', fontSize: 13, lineHeight: 1.7, maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
                        Este issue se creó antes de que el reporte quedara guardado en el grafo,
                        así que su análisis se perdió. Eliminalo y declaralo de nuevo para obtener
                        el reporte completo de los 4 agentes — a partir de ahora queda persistido.
                      </div>
                    )}
                  </div>
                )}

                {/* PESTAÑA: FLUJOGRAMA */}
                {detailTab === 'flujo' && (
                  selectedIssue.flujograma?.etapas?.length > 0 ? (
                    <div style={{ flex: 1, background: 'rgba(0,0,0,0.6)', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 12, left: 16, zIndex: 5, fontSize: 11.5, color: 'var(--gold)', fontWeight: 600, letterSpacing: 1 }}>
                        Seleccioná una etapa para enfocar el chat en ella
                      </div>
                      <ReactFlow
                        nodes={initialElements.nodes}
                        edges={initialElements.edges}
                        onNodeClick={(_, node) => {
                          const etapa = selectedIssue.flujograma.etapas.find(e => e.id === node.id);
                          setSelectedStage(etapa);
                          setDetailTab('chat');
                        }}
                        fitView
                        fitViewOptions={{ padding: 0.2 }}
                        attributionPosition="bottom-right"
                      >
                        <Background color="#5a6ea0" gap={20} size={1} opacity={0.15} />
                        <Controls showInteractive={false} />
                      </ReactFlow>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--text-mid)', fontSize: 13, padding: 24, textAlign: 'center' }}>
                      Este issue no describe un proceso con etapas — no se extrajo flujograma.
                      {'\n'}Si debería tenerlo, eliminalo y declaralo de nuevo detallando los pasos.
                    </div>
                  )
                )}

                {/* PESTAÑA: CHAT */}
                {detailTab === 'chat' && (<>
                  <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {selectedStage ? (
                      <>
                        <span style={{ fontSize: 12, color: 'var(--gold)', padding: '4px 8px', background: 'rgba(245,166,35,0.2)', borderRadius: 4 }}>
                          Etapa en foco: {selectedStage.label}
                        </span>
                        <button onClick={() => setSelectedStage(null)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, padding: 4 }}>
                          [Quitar foco]
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        Conversando sobre el proceso general — podés enfocar una etapa desde el Flujograma.
                      </span>
                    )}
                    {currentChat.length > 0 && (
                      <button onClick={clearChat} title="Borra esta conversación"
                        style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', color: 'var(--text-mid)', borderRadius: 5, cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}>
                        🗑 Borrar conversación
                      </button>
                    )}
                  </div>

                  <div className="agent-messages" style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
                    {currentChat.length === 0 && (
                      <div style={{ color: 'var(--text-mid)', fontSize: 13, textAlign: 'center', marginTop: 40, fontStyle: 'italic' }}>
                        {selectedStage ? `Pregunta sobre la etapa "${selectedStage.label}" y el agente cruzará la consulta con tu biblioteca.` : `Inicia una conversación sobre este proceso.`}
                      </div>
                    )}
                    {currentChat.map((msg, idx) => (
                      <div key={idx} className={`agent-msg ${msg.role}`} style={{ maxWidth: '85%', fontSize: 14, lineHeight: 1.6 }}>
                        {msg.role === 'assistant' ? (
                          <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.text || '') }} />
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
                </>)}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
