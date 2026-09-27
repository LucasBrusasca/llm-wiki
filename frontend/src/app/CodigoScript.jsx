import React, { useEffect, useRef, useState } from 'react';
import { Check, Eye, Pencil, Loader2, RotateCw, ShieldAlert, Link2, FunctionSquare, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchCodigo, guardarCodigo } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Código de un script-nodo: se lee con números de línea y se edita en el lugar.
 *
 * Guardar manda la versión que se estaba editando: si el archivo cambió mientras tanto
 * (otra pestaña, el vault), el backend no lo pisa y acá se ofrece recargar. Si el archivo
 * vive en el vault del usuario, guardar primero pide confirmación. Después de guardar se
 * muestra qué quedó vinculado: el backend recalcula sólo lo de este script.
 */
export default function CodigoScript({ node, onGuardado }) {
  const [datos, setDatos] = useState(null);        // { codigo, version, archivo, en_vault, analisis }
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState(false);
  const [estado, setEstado] = useState('cargando'); // cargando | limpio | sucio | guardando | confirmar | conflicto | error
  const [aviso, setAviso] = useState(null);
  const area = useRef(null);

  async function cargar() {
    setEstado('cargando'); setAviso(null);
    try {
      const d = await fetchCodigo(node.id);
      setDatos(d);
      setTexto(d.codigo);
      setEstado('limpio');
    } catch (e) {
      setAviso(e.message);
      setEstado('error');
    }
  }

  useEffect(() => { setEditando(false); cargar(); }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar(confirm = false) {
    if (!datos) return;
    setEstado('guardando'); setAviso(null);
    try {
      const r = await guardarCodigo(node.id, { codigo: texto, versionBase: datos.version, confirm });
      if (r.needs_confirmation) { setEstado('confirmar'); setAviso(r.message); return; }
      if (r.sin_cambios) { setEstado('limpio'); return; }
      setDatos((d) => ({ ...d, codigo: texto, version: r.version }));
      setEstado('limpio');
      const vinculos = r.cambios?.vinculos_codigo || [];
      setAviso(`Guardado · versión ${r.version.slice(0, 7)} · se actualizaron sólo los vínculos de este script`
        + (vinculos.length ? ` (${vinculos.length} por su código)` : ''));
      onGuardado?.(r);
    } catch (e) {
      const conflicto = /cambió/.test(e.message);
      setEstado(conflicto ? 'conflicto' : 'sucio');
      setAviso(e.message);
    }
  }

  function alTeclear(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      guardar();
      return;
    }
    if (e.key === 'Tab') {
      // Tab indenta (4 espacios, como PEP 8) en vez de sacar el foco del editor.
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const nuevo = `${texto.slice(0, a)}    ${texto.slice(b)}`;
      setTexto(nuevo);
      setEstado('sucio');
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4; });
    }
  }

  if (estado === 'cargando' && !datos) {
    return <p className="flex items-center gap-1.5 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo el código…</p>;
  }
  if (estado === 'error' && !datos) return <p className="text-[12px] text-danger">No se pudo leer el script: {aviso}</p>;

  const lineas = texto.split('\n');
  const a = datos?.analisis || {};
  const sucio = texto !== datos?.codigo;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => { setEditando((v) => !v); setTimeout(() => area.current?.focus(), 0); }}>
          {editando ? <><Eye /> Ver</> : <><Pencil /> Editar</>}
        </Button>
        {editando && (
          <Button variant="outline" size="sm" onClick={() => guardar()} disabled={!sucio || estado === 'guardando'}>
            {estado === 'guardando' ? <Loader2 className="animate-spin" /> : <Check />} Guardar
          </Button>
        )}
        <span className="ml-auto flex items-center gap-2 font-mono text-[10.5px] text-ink-dim">
          {datos?.archivo}
          {datos?.version && <span title="Versión del código (hash)">v {datos.version.slice(0, 7)}</span>}
          {sucio && <span className="text-warn">sin guardar</span>}
        </span>
      </div>

      {(a.funciones?.length > 0 || a.imports?.length > 0 || a.archivos?.length > 0 || a.error) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-dim">
          {a.funciones?.length > 0 && (
            <span className="flex items-center gap-1"><FunctionSquare className="size-3" /> {a.funciones.join(', ')}</span>
          )}
          {a.imports?.length > 0 && (
            <span className="flex items-center gap-1"><Package className="size-3" /> {a.imports.map((i) => i.modulo).join(', ')}</span>
          )}
          {a.archivos?.length > 0 && (
            <span className="flex items-center gap-1"><Link2 className="size-3" /> lee {a.archivos.map((x) => x.archivo).join(', ')}</span>
          )}
          {a.error && <span className="text-warn">error de sintaxis en {a.error}</span>}
        </div>
      )}

      {editando ? (
        <textarea
          ref={area}
          value={texto}
          spellCheck={false}
          onChange={(e) => { setTexto(e.target.value); setEstado('sucio'); }}
          onKeyDown={alTeclear}
          className="min-h-[320px] resize-y rounded-md border border-hair bg-surface-2 p-3 font-mono text-[12px] leading-[18px] text-ink focus:border-accent/60 focus:outline-none"
          aria-label="Código del script"
        />
      ) : (
        <div
          className="max-h-[420px] overflow-auto rounded-md border border-hair bg-surface-2/60"
          onDoubleClick={() => setEditando(true)}
          title="Doble clic para editar"
        >
          <pre className="flex min-w-max font-mono text-[12px] leading-[18px]">
            <code aria-hidden className="select-none border-r border-hair px-2 py-2 text-right text-ink-dim">
              {lineas.map((_, i) => <span key={i} className="block">{i + 1}</span>)}
            </code>
            <code className="px-3 py-2 text-ink/90">{texto || ' '}</code>
          </pre>
        </div>
      )}

      {estado === 'confirmar' && (
        <div className="rounded-md border border-warn/40 bg-warn/[0.07] p-2.5">
          <p className="flex items-start gap-1.5 text-[12px] text-ink"><ShieldAlert className="mt-px size-3.5 shrink-0 text-warn" /> {aviso}</p>
          <div className="mt-2 flex gap-1.5">
            <Button variant="default" size="sm" onClick={() => guardar(true)}><Check /> Confirmar y guardar</Button>
            <Button variant="ghost" size="sm" onClick={() => { setEstado('sucio'); setAviso(null); }}>Cancelar</Button>
          </div>
        </div>
      )}
      {estado === 'conflicto' && (
        <p className="flex items-center gap-2 text-[12px] text-warn">
          {aviso}
          <Button variant="outline" size="sm" onClick={cargar}><RotateCw /> Recargar</Button>
        </p>
      )}
      {aviso && !['confirmar', 'conflicto'].includes(estado) && (
        <p className={cn('text-[11.5px]', estado === 'sucio' ? 'text-danger' : 'text-ok')}>{aviso}</p>
      )}
    </div>
  );
}
