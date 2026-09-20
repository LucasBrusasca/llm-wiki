import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

/* ══════════════════════════════════════════════════════════════════════════
   DIÁLOGOS DE LA APP — reemplazo de window.prompt / confirm / alert

   Los diálogos nativos no están disponibles en navegadores embebidos: en el
   webview donde corre Algedi, `window.prompt()` no devuelve null, LANZA
   "prompt() is not supported.". Como las funciones que gestionan secciones lo
   llamaban sin try/catch, la excepción abortaba el handler y el click quedaba
   muerto: crear, renombrar y eliminar secciones no hacían absolutamente nada,
   sin ningún error visible.

   Estos diálogos son promesas, así que el código que los usa se lee igual que
   antes (`const x = await pedirTexto(...)`), pero funcionan en todos lados y
   se ven como el resto de la app.
   ══════════════════════════════════════════════════════════════════════════ */

let abrir = null;   // lo instala <Dialog/> al montarse

function pedir(opts) {
  return new Promise((resolve) => {
    if (!abrir) {
      // Sin host montado no hay forma de preguntar. Cancelar es lo seguro:
      // nunca asumir un "sí" para una acción destructiva.
      resolve(null);
      return;
    }
    abrir({ ...opts, resolve });
  });
}

/** Pide un texto. Devuelve el string, o null si se canceló. */
export const pedirTexto = (titulo, opts = {}) =>
  pedir({ tipo: 'texto', titulo, ...opts });

/** Pide una clave (input enmascarado). Devuelve el string, o null. */
export const pedirSecreto = (titulo, opts = {}) =>
  pedir({ tipo: 'secreto', titulo, ...opts });

/** Confirmación. Devuelve true/false. */
export const confirmar = async (titulo, opts = {}) =>
  (await pedir({ tipo: 'confirmar', titulo, ...opts })) === true;

/** Aviso de una sola salida. */
export const avisar = (titulo, opts = {}) =>
  pedir({ tipo: 'aviso', titulo, ...opts });

export function Dialog() {
  const [estado, setEstado] = useState(null);
  const [valor, setValor] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    abrir = (opts) => {
      setValor(opts.valorInicial || '');
      setEstado(opts);
    };
    return () => { abrir = null; };
  }, []);

  useEffect(() => {
    if (estado && inputRef.current) inputRef.current.select();
  }, [estado]);

  if (!estado) return null;

  const pideTexto = estado.tipo === 'texto' || estado.tipo === 'secreto';
  const cerrar = (r) => { estado.resolve(r); setEstado(null); };
  const aceptar = () => {
    if (pideTexto) cerrar(valor);
    else cerrar(estado.tipo === 'confirmar' ? true : undefined);
  };
  const cancelar = () => cerrar(estado.tipo === 'confirmar' ? false : null);

  return createPortal(
    <div
      className="dlg-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget && estado.tipo !== 'aviso') cancelar(); }}
    >
      <div
        className={'dlg' + (estado.peligro ? ' dlg--peligro' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={estado.titulo}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); cancelar(); }
          if (e.key === 'Enter' && (pideTexto || estado.tipo !== 'texto')) { e.preventDefault(); aceptar(); }
        }}
      >
        <div className="dlg-title">{estado.titulo}</div>
        {estado.detalle && <div className="dlg-detail">{estado.detalle}</div>}

        {pideTexto && (
          <input
            ref={inputRef}
            className="dlg-input"
            type={estado.tipo === 'secreto' ? 'password' : 'text'}
            value={valor}
            placeholder={estado.placeholder || ''}
            autoFocus
            onChange={(e) => setValor(e.target.value)}
          />
        )}

        <div className="dlg-actions">
          {estado.tipo !== 'aviso' && (
            <button className="dlg-btn" onClick={cancelar}>Cancelar</button>
          )}
          <button
            className={'dlg-btn dlg-btn--ok' + (estado.peligro ? ' dlg-btn--peligro' : '')}
            onClick={aceptar}
            autoFocus={!pideTexto}
            disabled={pideTexto && !estado.permitirVacio && !valor.trim()}
          >
            {estado.confirmar || 'Aceptar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
