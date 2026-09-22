import React, { useEffect, useRef, useState } from 'react';
import { Check, Eye, Pencil, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { renderMarkdown } from '@/markdown';
import { cn } from '@/lib/utils';

/**
 * Cuerpo de una nota en markdown. Se ve renderizado; al editar guarda con el
 * botón o solo, 1,5 s después de dejar de escribir (y al salir del campo).
 */
export default function NotaEditor({ node, onGuardar }) {
  const [editando, setEditando] = useState(!node.desc);
  const [texto, setTexto] = useState(node.desc || '');
  const [estado, setEstado] = useState('limpio');   // limpio | pendiente | guardando | guardado | error
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const ultimo = useRef(node.desc || '');

  useEffect(() => {
    setTexto(node.desc || '');
    ultimo.current = node.desc || '';
    setEditando(!node.desc);
    setEstado('limpio');
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);

  async function guardar(valor = texto) {
    clearTimeout(timer.current);
    if (valor === ultimo.current) { setEstado('limpio'); return; }
    setEstado('guardando'); setError(null);
    try {
      await onGuardar(node.id, { desc: valor });
      ultimo.current = valor;
      setEstado('guardado');
      setTimeout(() => setEstado((e) => (e === 'guardado' ? 'limpio' : e)), 1600);
    } catch (e) {
      setError(e.message);
      setEstado('error');
    }
  }

  function alEscribir(valor) {
    setTexto(valor);
    setEstado('pendiente');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => guardar(valor), 1500);
  }

  const leyenda = {
    limpio: null,
    pendiente: 'sin guardar…',
    guardando: 'guardando…',
    guardado: 'guardado',
    error: `no se pudo guardar: ${error}`,
  }[estado];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setEditando((v) => !v)}>
          {editando ? <><Eye /> Ver</> : <><Pencil /> Editar</>}
        </Button>
        {editando && (
          <Button variant="outline" size="sm" onClick={() => guardar()} disabled={estado === 'guardando'}>
            {estado === 'guardando' ? <Loader2 className="animate-spin" /> : <Check />} Guardar
          </Button>
        )}
        {leyenda && (
          <span className={cn('text-[11px]', estado === 'error' ? 'text-danger' : estado === 'guardado' ? 'text-ok' : 'text-ink-dim')}>
            {leyenda}
          </span>
        )}
      </div>

      {editando ? (
        <textarea
          value={texto}
          onChange={(e) => alEscribir(e.target.value)}
          onBlur={() => guardar()}
          placeholder={'Escribí en markdown…\n\n## Idea\n- un punto\n- otro'}
          className="min-h-[340px] flex-1 resize-y rounded-md border border-hair bg-surface-2 p-3 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-dim focus:border-accent/60 focus:outline-none"
        />
      ) : (
        <div
          className="agent-md min-h-[200px] rounded-md border border-hair bg-surface-2/50 p-3 text-[12.5px] leading-relaxed text-ink/90"
          onDoubleClick={() => setEditando(true)}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(texto || '_Nota vacía. Doble clic para escribir._') }}
        />
      )}
    </div>
  );
}
