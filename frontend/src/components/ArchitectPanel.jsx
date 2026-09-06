import React, { useState, useCallback, useMemo, useRef } from 'react';
import ArchitectCanvas from './ArchitectCanvas.jsx';

/* ── Architect · el gate de decisión de Algedi ─────────────────────────────
   Ante una necesidad y el corpus de la sección activa, Architect clasifica qué
   intervención corresponde entre seis rutas, compara alternativas en una matriz
   común, un verificador independiente objeta, y una persona decide.

   El panel NO clasifica: sólo representa el expediente que devuelve el backend
   (POST /api/architect/analyze). Toda la inteligencia corre en Algedi.

   CANVAS: modo flujograma visual donde el usuario modela su proceso y vincula
   evidencia antes de solicitar análisis.
   ────────────────────────────────────────────────────────────────────────── */

const RUTAS = [
  { key: 'redesign',  label: 'Rediseño',       hint: 'ordenar el proceso',      tone: '#B8F0FF' },
  { key: 'rules',     label: 'Reglas',         hint: 'determinístico',          tone: '#7FDBFF' },
  { key: 'data',      label: 'Datos / BI',     hint: 'visibilidad y calidad',   tone: '#5AC8FA' },
  { key: 'assistive', label: 'IA asistiva',    hint: 'criterio con control',    tone: '#49B6E8' },
  { key: 'agent',     label: 'Agente',         hint: 'acción delegada',         tone: '#2E86B8' },
  { key: 'none',      label: 'No implementar', hint: 'la evidencia no alcanza', tone: '#FFB44D' },
];

const PASOS = [
  { n: 1, k: 'recibe',    t: 'Recibe',    d: 'problema y restricciones' },
  { n: 2, k: 'recupera',  t: 'Recupera',  d: 'pasajes con cita' },
  { n: 3, k: 'clasifica', t: 'Clasifica', d: 'seis rutas' },
  { n: 4, k: 'compara',   t: 'Compara',   d: 'matriz común' },
  { n: 5, k: 'verifica',  t: 'Verifica',  d: 'objeción separada' },
  { n: 6, k: 'escala',    t: 'Escala',    d: 'decisión humana' },
  { n: 7, k: 'persiste',  t: 'Persiste',  d: 'expediente' },
];

const CRITERIOS = [
  { k: 'impact',         t: 'Impacto' },
  { k: 'data_readiness', t: 'Datos' },
  { k: 'complexity',     t: 'Simpleza' },
  { k: 'risk',           t: 'Seguridad' },
  { k: 'cost',           t: 'Costo' },
];

/* Lo que Architect devuelve como "entendido". No es un formulario que llena el
   usuario: es la lectura del sistema, editable, para que la persona la corrija. */
const CAMPOS = [
  { k: 'problem',         t: 'Problema' },
  { k: 'objective',       t: 'Objetivo' },
  { k: 'current_process', t: 'Proceso actual' },
  { k: 'available_data',  t: 'Datos disponibles' },
  { k: 'constraints',     t: 'Restricciones' },
  { k: 'expected_value',  t: 'Valor a comprobar' },
];

const VACIO = CAMPOS.reduce((a, c) => ({ ...a, [c.k]: '' }), { case_name: '' });

const SALUDO = {
  role: 'assistant',
  content: 'Contame el problema como se lo contarías a un colega. No hace falta que lo ordenes: si me falta algo que cambie la respuesta, te lo pregunto.',
};

const VEREDICTO = {
  viable:               { t: 'Viable',             tone: '#6FE3D4' },
  viable_with_changes:  { t: 'Viable con cambios', tone: '#FFB44D' },
  not_viable:           { t: 'No viable',          tone: '#FF5A78' },
};

function Escala({ valor }) {
  const v = Math.max(1, Math.min(5, Number(valor) || 1));
  return (
    <span className="arch-escala" title={`${v} de 5`}>
      {[1, 2, 3, 4, 5].map(i => (
        <i key={i} className={i <= v ? 'on' : ''} />
      ))}
    </span>
  );
}

export default function ArchitectPanel({ onClose, seccion, onNavigate, onDesarrollar, onAbrirExpediente, allNodes = [] }) {
  const [chat, setChat]       = useState([SALUDO]);  // diálogo de admisión
  const [entrada, setEntrada] = useState('');
  const [pensando, setPensando] = useState(false);   // admisión en curso
  const [form, setForm]       = useState(VACIO);     // lo que Architect entendió
  const [listo, setListo]     = useState(false);     // admisión suficiente
  const [faltantes, setFaltantes] = useState([]);
  const [busy, setBusy]       = useState(false);     // análisis en curso
  const [paso, setPaso]       = useState(0);
  const [error, setError]     = useState('');
  const [exp, setExp]         = useState(null);      // expediente devuelto
  const [decision, setDecision] = useState(null);
  const [nota, setNota]       = useState('');
  const [verSrc, setVerSrc]   = useState(false);
  const tickRef = useRef(null);
  const finChatRef = useRef(null);

  /* Pantalla unica: el recorrido nuevo, canvas de flujograma, y los expedientes
     viven en la MISMA superficie con pestañas. */
  const [vista, setVista] = useState('nuevo');        // 'nuevo' | 'canvas' | 'expedientes'
  const [expedientes, setExpedientes] = useState(null);

  const cargarExpedientes = useCallback(async () => {
    setExpedientes(null);
    try {
      const r = await fetch(`/api/graph?seccion=${encodeURIComponent(seccion)}`);
      const d = await r.json();
      const issues = (d.nodos || []).filter(n => n.is_issue);
      setExpedientes(issues);
    } catch { setExpedientes([]); }
  }, [seccion]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  /* Admisión conversacional: manda el diálogo entero y recibe o bien una
     repregunta, o bien el brief listo. El backend no guarda estado. */
  const conversar = useCallback(async () => {
    const texto = entrada.trim();
    if (!texto || pensando) return;
    const nuevo = [...chat, { role: 'user', content: texto }];
    setChat(nuevo); setEntrada(''); setPensando(true); setError('');
    try {
      const r = await fetch('/api/architect/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nuevo.filter(m => m !== SALUDO) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || `Error ${r.status}`);
      setForm({ ...d.brief, case_name: d.case_name || 'Caso sin título' });
      setFaltantes(d.faltantes || []);
      setListo(!!d.suficiente);
      setChat(c => [...c, {
        role: 'assistant',
        content: d.suficiente
          ? (d.resumen || 'Ya tengo con qué trabajar.')
          : (d.pregunta || 'Contame un poco más.'),
      }]);
      if (d.suficiente) setPaso(1);
    } catch (e) {
      setChat(c => [...c, { role: 'assistant', content: `No pude interpretarlo: ${e.message}` }]);
    } finally {
      setPensando(false);
      setTimeout(() => finChatRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  }, [entrada, chat, pensando]);

  const ruta = useMemo(
    () => RUTAS.find(r => r.key === exp?.classification) || null,
    [exp]
  );

  const detener = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const analizar = useCallback(async () => {
    if (form.problem.trim().length < 12) {
      setError('Describí el problema con más detalle: al menos una o dos oraciones concretas.');
      return;
    }
    setBusy(true); setError(''); setExp(null); setDecision(null); setNota('');
    // El avance visual acompaña las dos llamadas al LLM; se congela en "verifica"
    // hasta que llega la respuesta real. No inventa progreso posterior.
    setPaso(1);
    let n = 1;
    tickRef.current = setInterval(() => { n = Math.min(n + 1, 5); setPaso(n); }, 9000);
    try {
      const r = await fetch('/api/architect/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, case_name: form.case_name || 'Caso sin título' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || `Error ${r.status}`);
      detener();
      setExp(data);
      setPaso(6);
    } catch (e) {
      detener();
      setPaso(0);
      setError(`No se generó ninguna clasificación: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [form, detener]);

  /* La decisión humana se PERSISTE contra el mismo endpoint que usa Issue.
     Architect ya guarda su corrida como expediente; la revisión se escribe encima
     de ese mismo objeto, así el expediente queda completo y reabrible. */
  const registrar = useCallback(async (estado) => {
    if (!exp) return;
    const local = { status: estado, note: nota.trim(), at: new Date().toISOString() };
    setDecision(local);
    setPaso(7);
    const id = exp.expediente_id;
    if (!id) return;                       // corrida vieja sin expediente: sólo local
    // El backend sólo admite approved | revision_requested.
    const decision = estado === 'approved' ? 'approved' : 'revision_requested';
    try {
      const r = await fetch(`/api/issues/${encodeURIComponent(id)}/solve/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          note: nota.trim() || (estado === 'discarded' ? 'Descartado por el responsable.' : ''),
        }),
      });
      setDecision({ ...local, guardado: r.ok });
    } catch {
      setDecision({ ...local, guardado: false });
    }
  }, [exp, nota]);

  const descargar = useCallback(() => {
    if (!exp) return;
    const doc = { ...exp, human_review: { ...(exp.human_review || {}), ...(decision || {}) }, seccion };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `algedi-architect-${(form.case_name || 'expediente').replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exp, decision, form.case_name, seccion]);

  const review = exp?.critical_review || {};
  const ver = VEREDICTO[review.verdict] || null;
  const citas = exp?.citations || [];
  const matriz = exp?.matrix || [];

  return (
    <div className="arch-overlay">
      <div className="arch-panel">

        {/* ── Cabecera: identidad y etapa ── */}
        <header className="arch-head">
          <div className="arch-head-id">
            <span className="arch-mark">⬢</span>
            <div>
              <div className="arch-title">ARCHITECT</div>
              <div className="arch-sub">Decidir qué construir, antes de elegir la tecnología</div>
            </div>
          </div>
          <nav className="arch-tabs" role="tablist">
            <button role="tab" aria-selected={vista === 'nuevo'}
                    className={`arch-tab${vista === 'nuevo' ? ' on' : ''}`}
                    onClick={() => setVista('nuevo')}>Admisión</button>
            <button role="tab" aria-selected={vista === 'canvas'}
                    className={`arch-tab${vista === 'canvas' ? ' on' : ''}`}
                    onClick={() => setVista('canvas')}>
              ◇ Canvas
            </button>
            <button role="tab" aria-selected={vista === 'expedientes'}
                    className={`arch-tab${vista === 'expedientes' ? ' on' : ''}`}
                    onClick={() => { setVista('expedientes'); cargarExpedientes(); }}>
              Expedientes
            </button>
          </nav>
          <div className="arch-head-meta">
            <span className="arch-chip">sección · {seccion}</span>
            <span className="arch-chip arch-chip--soft">nivel 4 · multiagentes + HITL</span>
            <button className="panel-close" onClick={onClose} title="Cerrar Architect">✕</button>
          </div>
        </header>

        {/* ── Protocolo: hace legible el recorrido completo ── */}
        <ol className="arch-steps">
          {PASOS.map(p => (
            <li key={p.k}
                className={`arch-step${paso === p.n ? ' now' : ''}${paso > p.n ? ' done' : ''}`}>
              <span className="arch-step-n">{paso > p.n ? '✓' : p.n}</span>
              <span className="arch-step-t">{p.t}</span>
              <span className="arch-step-d">{p.d}</span>
            </li>
          ))}
        </ol>

        {vista === 'canvas' ? (
          <ArchitectCanvas
            seccion={seccion}
            allNodes={allNodes}
            caseName={form.case_name}
            initialProblem={form.problem}
            onClose={onClose}
          />
        ) : vista === 'expedientes' ? (
          <div className="arch-exps">
            {expedientes === null && <div className="arch-empty">Buscando expedientes…</div>}
            {expedientes?.length === 0 && (
              <div className="arch-empty">
                Todavía no hay expedientes en <b>{seccion}</b>.<br />
                Empezá uno desde «Caso nuevo».
              </div>
            )}
            {!!expedientes?.length && onAbrirExpediente && (
              <button className="arch-run arch-run--next" onClick={() => onAbrirExpediente(null)}>
                Abrir en el módulo Issue (flujograma y chat por etapa) →
              </button>
            )}
            {expedientes?.map(n => {
              const sv = n.solve || null;
              const rt = RUTAS.find(r => r.key === sv?.classification);
              const hr = sv?.human_review?.status || 'sin decisión';
              return (
                <button key={n.id} className="arch-exp"
                        onClick={() => {
                          if (n.solve) {
                            // Se carga en ESTA pantalla, con su ruta, matriz,
                            // objeción y decisión: es el mismo objeto que produjo
                            // Architect, no una vista aparte.
                            setExp({ ...n.solve, expediente_id: n.id });
                            setForm(f => ({ ...f, ...(n.solve.inputs || {}), case_name: n.label }));
                            setDecision(n.solve.human_review?.status
                              && n.solve.human_review.status !== 'pending'
                              ? { status: n.solve.human_review.status,
                                  note: n.solve.human_review.note || '',
                                  at: n.solve.human_review.updated_at || new Date().toISOString(),
                                  guardado: true }
                              : null);
                            setPaso(7);
                            setVista('nuevo');
                          } else if (onAbrirExpediente) { onAbrirExpediente(n.id); }
                          else { onNavigate?.(n.id); }
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
        ) : (
        <div className="arch-body">

          {/* ── 1 · Admisión conversacional ── */}
          <section className="arch-col arch-col--brief">
            <div className="arch-col-head"><h3>Contame el caso</h3><span>01 · ADMISIÓN</span></div>

            <div className="arch-chat">
              {chat.map((m, i) => (
                <div key={i} className={`arch-msg arch-msg--${m.role}`}>{m.content}</div>
              ))}
              {pensando && <div className="arch-msg arch-msg--assistant arch-msg--wait">Pensando…</div>}
              <div ref={finChatRef} />
            </div>

            <div className="arch-compose">
              <textarea
                className="arch-textarea" rows={3} value={entrada}
                placeholder="Escribí como hablás. Enter para enviar, Shift+Enter para renglón nuevo."
                disabled={pensando}
                onChange={e => setEntrada(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); conversar(); }
                }}
              />
              <button className="arch-send" onClick={conversar} disabled={pensando || !entrada.trim()}>
                Enviar
              </button>
            </div>

            {/* Lo que Architect entendió: se muestra para CORREGIR, no para llenar. */}
            {form.problem && (
              <details className="arch-brief" open={listo}>
                <summary>Esto entendí — corregí lo que haga falta</summary>
                <label className="arch-label" htmlFor="arch-case">Nombre del caso</label>
                <input id="arch-case" className="arch-input" value={form.case_name}
                       onChange={e => set('case_name', e.target.value)} />
                {CAMPOS.map(c => (
                  <React.Fragment key={c.k}>
                    <label className="arch-label" htmlFor={`arch-${c.k}`}>{c.t}</label>
                    <textarea id={`arch-${c.k}`} className="arch-textarea" rows={2}
                              value={form[c.k]} onChange={e => set(c.k, e.target.value)} />
                  </React.Fragment>
                ))}
                {!!faltantes.length && (
                  <div className="arch-faltantes">
                    <b>Huecos declarados</b>
                    <ul>{faltantes.map((f, i) => <li key={i}>{f}</li>)}</ul>
                  </div>
                )}
              </details>
            )}

            {form.problem && (
              <button className="arch-run" onClick={analizar} disabled={busy || pensando}>
                {busy ? 'Recuperando · comparando · verificando…'
                      : listo ? 'Analizar con Architect'
                              : 'Analizar igual, con los huecos'}
              </button>
            )}

            <p className="arch-note">
              Architect recupera evidencia del corpus de <b>{seccion}</b>. Si no hay pasajes con
              afinidad suficiente, lo declara y no lo presenta como fuente.
            </p>
            {error && <div className="arch-error">{error}</div>}
          </section>

          {/* ── 2 · Rutas ── */}
          <section className="arch-col arch-col--rutas">
            <div className="arch-col-head"><h3>Ruta recomendada</h3><span>02 · CLASE</span></div>
            <div className="arch-rutas">
              {RUTAS.map(r => {
                const on = ruta?.key === r.key;
                return (
                  <div key={r.key} className={`arch-ruta${on ? ' on' : ''}`}
                       style={on ? { '--tone': r.tone } : undefined}>
                    <span className="arch-ruta-dot" style={{ background: r.tone }} />
                    <span className="arch-ruta-l">{r.label}</span>
                    <span className="arch-ruta-h">{r.hint}</span>
                  </div>
                );
              })}
            </div>

            {exp && (
              <>
                <div className="arch-col-head arch-col-head--sub">
                  <h3>Matriz comparativa</h3><span>03 · CRITERIOS</span>
                </div>
                <div className="arch-matriz-wrap">
                  <table className="arch-matriz">
                    <thead>
                      <tr>
                        <th>Ruta</th>
                        {CRITERIOS.map(c => <th key={c.k}>{c.t}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {matriz.map((row, i) => {
                        const meta = RUTAS.find(r => r.key === row.route);
                        return (
                          <tr key={i} className={row.route === ruta?.key ? 'on' : ''}>
                            <td>{meta?.label || row.route}</td>
                            {CRITERIOS.map(c => (
                              <td key={c.k}><Escala valor={row[c.k]} /></td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {/* ── 3 · Expediente ── */}
          <section className="arch-col arch-col--exp">
            <div className="arch-col-head"><h3>Expediente</h3><span>04 · REGISTRO</span></div>

            {!exp && !busy && (
              <div className="arch-empty">
                Todavía no hay expediente.<br />
                Completá el brief y ejecutá Architect.
              </div>
            )}
            {busy && <div className="arch-empty arch-empty--busy">Dos agentes trabajando sobre tu corpus…</div>}

            {exp && (
              <>
                <div className="arch-verdict">
                  <span className="arch-verdict-route" style={{ color: ruta?.tone }}>
                    {exp.classification_label || ruta?.label}
                  </span>
                  {ver && (
                    <span className="arch-verdict-tag" style={{ color: ver.tone, borderColor: ver.tone }}>
                      {ver.t}
                    </span>
                  )}
                </div>

                {exp.expediente_id && (
                  <div className="arch-saved">
                    Guardado como expediente · aparece en la pestaña <b>Expedientes</b>
                  </div>
                )}
                <div className="arch-evid">
                  <span className={`arch-evid-dot ${exp.evidence_mode}`} />
                  {exp.evidence_mode === 'chunks'
                    ? `Evidencia de la biblioteca · ${citas.length} pasajes citados`
                    : 'Conocimiento general declarado · sin respaldo del corpus'}
                </div>

                {exp.problem_understanding && (
                  <p className="arch-understand">{exp.problem_understanding}</p>
                )}

                {!!(exp.trace || []).length && (
                  <ol className="arch-trace">
                    {exp.trace.map((t, i) => <li key={i}>{t}</li>)}
                  </ol>
                )}

                <div className="arch-objection">
                  <b>Objeción del verificador</b>
                  <p>{review.objection || review.findings?.[0]?.finding || 'Sin objeción informada.'}</p>
                  {!!(review.evidence_gaps || []).length && (
                    <ul className="arch-gaps">
                      {review.evidence_gaps.map((g, i) => <li key={i}>{g}</li>)}
                    </ul>
                  )}
                </div>

                {!!citas.length && (
                  <div className="arch-src">
                    <button className="arch-src-toggle" onClick={() => setVerSrc(v => !v)}>
                      {verSrc ? '▾' : '▸'} Fuentes recuperadas ({citas.length})
                    </button>
                    {verSrc && (
                      <ol className="arch-src-list">
                        {citas.map(c => (
                          <li key={c.marker}>
                            <button className="arch-src-link"
                                    onClick={() => onNavigate && onNavigate(c.node_id)}
                                    title="Ver este documento en el grafo">
                              [{c.marker}] {c.label}{c.page ? ` · p. ${c.page}` : ''}
                            </button>
                            <span className="arch-src-x">{c.excerpt}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                {/* ── Decisión humana ── */}
                <div className="arch-decision">
                  <div className="arch-decision-h">Decisión humana</div>
                  <textarea className="arch-textarea" rows={2} value={nota}
                            placeholder="Comentario del responsable (obligatorio para pedir cambios)"
                            onChange={e => setNota(e.target.value)} />
                  <div className="arch-decision-btns">
                    <button className="arch-btn arch-btn--ok"
                            onClick={() => registrar('approved')}>Aprobar ruta</button>
                    <button className="arch-btn"
                            disabled={!nota.trim()}
                            onClick={() => registrar('revision_requested')}>Pedir cambio</button>
                    <button className="arch-btn arch-btn--no"
                            onClick={() => registrar('discarded')}>Descartar</button>
                  </div>
                  <div className="arch-decision-log">
                    {decision
                      ? `${decision.status} · ${new Date(decision.at).toLocaleString('es-AR')}`
                        + (decision.note ? ` · ${decision.note}` : '')
                        + (decision.guardado === true ? ' · guardado en el expediente'
                           : decision.guardado === false ? ' · NO se pudo guardar' : '')
                      : 'Sin decisión humana registrada. Architect recomienda; no aprueba.'}
                  </div>
                  {onDesarrollar && exp.classification !== 'none' && (
                    <button className="arch-run arch-run--next" onClick={onDesarrollar}>
                      Desarrollar esta ruta en un expediente →
                    </button>
                  )}
                  <button className="arch-download" onClick={descargar}>
                    Descargar expediente JSON
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
        )}
      </div>
    </div>
  );
}
