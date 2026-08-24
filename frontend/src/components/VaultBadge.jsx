import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Badge de "Ingesta Continua" (carpeta mágica).
 * Sondea /api/vault/status y:
 *   - muestra la carpeta vigilada y cuántos documentos lleva absorbidos,
 *   - cuando el backend está ingiriendo un archivo del vault, muestra la barra en vivo,
 *   - dispara onGraphChanged() cuando entra un nodo nuevo o termina una tanda,
 *     para que el grafo se actualice solo (el momento "wow").
 */
export default function VaultBadge({ onGraphChanged }) {
  const [data, setData] = useState(null);
  /* Ocultable a mano: en reposo el badge no aporta nada nuevo y ocupaba la esquina
     permanentemente. Se recuerda la decisión, y vuelve solo cuando hay algo que
     mostrar de verdad (una ingesta en curso). */
  const [oculto, setOculto] = useState(
    () => localStorage.getItem('algedi_vault_oculto') === '1');
  const prevRef = useRef({ count: 0, state: 'idle' });
  const changedRef = useRef(onGraphChanged);
  changedRef.current = onGraphChanged;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/vault/status');
        if (!r.ok) return;
        const s = await r.json();
        if (!alive) return;
        const prev = prevRef.current;
        // Nodo nuevo absorbido, o tanda que pasó de "procesando" a "listo": recargar grafo.
        const gotNew = s.count > prev.count;
        const finished = prev.state === 'processing' && s.state !== 'processing';
        if (gotNew || finished) changedRef.current?.();
        prevRef.current = { count: s.count, state: s.state };
        setData(s);
      } catch { /* backend ocupado: reintenta al próximo tick */ }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!data || !data.enabled || !data.available) return null;

  const processing = data.state === 'processing';
  if (oculto && !processing) return null;

  const pct = Math.max(0, Math.min(100, data.progress || 0));

  return createPortal(
    <div
      title={`Ingesta Continua activa\nCarpeta vigilada: ${data.folder}\nSoltá archivos, o un links.txt / .url (arrastrando un enlace del navegador).\nSubcarpetas = secciones. Todo se agrega solo.`}
      /* Arriba a la derecha, bajo el header: es un indicador de ESTADO y va con el
         estado, no en la esquina inferior izquierda donde chocaba con los
         controles de layout del grafo. */
      style={{
        position: 'fixed', right: 22, top: 78, zIndex: 92,
        display: 'flex', flexDirection: 'column', gap: 5,
        minWidth: 200, maxWidth: 300, padding: '9px 12px',
        borderRadius: 10, fontSize: 11.5, lineHeight: 1.35,
        fontFamily: "'Sora', ui-sans-serif, system-ui, sans-serif",
        color: 'var(--text-mid)',
        background: 'var(--glass)',
        border: `1px solid ${processing ? 'rgba(47,224,200,0.5)' : 'var(--border)'}`,
        boxShadow: 'var(--shadow-soft)',
        backdropFilter: 'blur(22px) saturate(150%)',
        WebkitBackdropFilter: 'blur(22px) saturate(150%)',
        transition: 'border-color .3s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: processing ? '#63c8e6' : '#5fd38d',
            boxShadow: processing ? '0 0 8px #63c8e6' : '0 0 6px #5fd38d',
            animation: processing ? 'algediPulse 1s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ fontWeight: 600, letterSpacing: .2 }}>
          {processing ? 'Absorbiendo documento…' : 'Ingesta Continua'}
        </span>
        <span style={{ marginLeft: 'auto', opacity: .7, fontVariantNumeric: 'tabular-nums' }}>
          {data.count} doc{data.count === 1 ? '' : 's'}
        </span>
        <button
          onClick={() => { setOculto(true); localStorage.setItem('algedi_vault_oculto', '1'); }}
          title="Ocultar. Vuelve solo cuando entre un documento nuevo."
          aria-label="Ocultar el aviso de Ingesta Continua"
          style={{
            border: 0, background: 'transparent', cursor: 'pointer', padding: '0 0 0 4px',
            color: 'var(--text-dim)', fontSize: 13, lineHeight: 1, flexShrink: 0,
          }}
        >×</button>
      </div>

      {processing ? (
        <>
          <div style={{
            height: 4, borderRadius: 4, overflow: 'hidden',
            background: 'rgba(255,255,255,0.10)',
          }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: 'linear-gradient(90deg,#3f8fd0,#63c8e6)',
              transition: 'width .4s ease',
            }} />
          </div>
          <div style={{
            opacity: .8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {data.label ? `“${data.label}” · ${pct}%` : `${data.message || 'Procesando…'} · ${pct}%`}
          </div>
        </>
      ) : (
        <div style={{ opacity: .6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          👁 vigilando <code style={{ opacity: .85 }}>vault/</code>
          {data.queued > 0 ? ` · ${data.queued} en cola` : ' · soltá archivos ahí'}
        </div>
      )}

      <style>{`@keyframes algediPulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>,
    document.body
  );
}
