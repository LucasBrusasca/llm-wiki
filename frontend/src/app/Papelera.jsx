import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Undo2, Loader2, ShieldAlert, Link2, StickyNote, Quote } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchPapelera, restaurarDePapelera, eliminarDePapelera, vaciarPapelera } from '@/lib/api';
import { estaHabilitada } from '@/security.js';
import { iconoDe, fuenteLabel, colorFuente } from '@/lib/nodes';
import { cn, fechaCorta } from '@/lib/utils';

/**
 * Confirmación de lo irreversible, en el lugar: qué se borra, y la clave de
 * administrador si está configurada (campo enmascarado, nunca en la URL).
 */
function ConfirmarBorrado({ titulo, detalle, conClave, ocupado, error, onConfirmar, onCancelar }) {
  const [clave, setClave] = useState('');
  return (
    <div className="mt-2 rounded-md border border-danger/40 bg-danger/[0.06] p-2.5">
      <p className="flex items-start gap-1.5 text-[12.5px] text-ink">
        <ShieldAlert className="mt-px size-3.5 shrink-0 text-danger" /> {titulo}
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{detalle}</p>
      <form
        className="mt-2 flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); onConfirmar(clave); }}
      >
        {conClave && (
          <Input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="Clave de administrador"
            autoComplete="current-password"
            autoFocus
            className="h-6 w-[190px] text-[12px]"
            aria-label="Clave de administrador"
          />
        )}
        <Button type="submit" variant="danger" size="sm" disabled={ocupado || (conClave && !clave)}>
          {ocupado ? <Loader2 className="animate-spin" /> : <Trash2 />} Eliminar definitivamente
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>Cancelar</Button>
      </form>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function Item({ it, seccion, ocupado, confirmando, conClave, error, onRestaurar, onPedirBorrar, onBorrar, onCancelar }) {
  const Icon = iconoDe(it);
  const r = it.resumen || {};
  return (
    <li className="hairline-b px-3.5 py-2.5" style={{ '--c': colorFuente(it) }}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-cat" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] text-ink" title={it.label}>{it.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-dim">
            {fuenteLabel(it) && <span>{fuenteLabel(it)}</span>}
            <span className={cn('capitalize', it.dominio !== seccion && 'text-ink-muted')}>{it.dominio}</span>
            <span>borrado {fechaCorta(it.eliminado_at)}</span>
            {r.aristas > 0 && <span className="flex items-center gap-0.5"><Link2 className="size-3" />{r.aristas}</span>}
            {r.notas > 0 && <span className="flex items-center gap-0.5"><StickyNote className="size-3" />{r.notas}</span>}
            {r.pasajes > 0 && <span className="flex items-center gap-0.5" title="Pasajes citables"><Quote className="size-3" />{r.pasajes}</span>}
          </p>
          {it.en_grafo && (
            <p className="mt-1 text-[11px] text-warn">Ya está de nuevo en el grafo (se volvió a ingerir): no hace falta restaurarlo.</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!it.en_grafo && (
            <Button variant="outline" size="sm" onClick={onRestaurar} disabled={ocupado}>
              {ocupado && !confirmando ? <Loader2 className="animate-spin" /> : <Undo2 />} Restaurar
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onPedirBorrar} disabled={ocupado} aria-label="Eliminar definitivamente" title="Eliminar definitivamente">
            <Trash2 />
          </Button>
        </div>
      </div>
      {confirmando && (
        <ConfirmarBorrado
          titulo={<>Eliminar «{it.label}» para siempre</>}
          detalle="No se puede deshacer: se pierden sus relaciones, notas y pasajes. El archivo subido también se borra si ningún otro documento lo usa (lo de la carpeta vault no se toca)."
          conClave={conClave}
          ocupado={ocupado}
          error={error}
          onConfirmar={onBorrar}
          onCancelar={onCancelar}
        />
      )}
    </li>
  );
}

/**
 * Papelera: lo que se sacó de la biblioteca. Restaurar lo devuelve tal cual (con sus
 * relaciones, notas y pasajes); eliminar definitivamente no tiene vuelta atrás y pide
 * la clave de administrador si está configurada.
 */
export default function Papelera({ open, onOpenChange, seccion, onCambio }) {
  const [items, setItems] = useState(null);
  const [conClave, setConClave] = useState(false);
  const [ocupado, setOcupado] = useState(null);       // id en curso, o 'vaciar'
  const [confirmando, setConfirmando] = useState(null); // id, o 'vaciar'
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    fetchPapelera().then(setItems).catch((e) => { setItems([]); setError(e.message); });
  }, []);

  useEffect(() => {
    if (!open) return;
    setItems(null); setConfirmando(null); setError(null); setAviso(null);
    cargar();
    estaHabilitada().then(setConClave);
  }, [open, cargar]);

  async function restaurar(it) {
    setOcupado(it.id); setError(null); setAviso(null);
    try {
      const r = await restaurarDePapelera(it.id);
      const esperan = r.aristas?.esperan || 0;
      setAviso(`«${it.label}» volvió a «${r.dominio}»${r.dominio !== seccion ? ' (otra sección)' : ''}`
        + (esperan ? `. ${esperan} ${esperan === 1 ? 'relación vuelve' : 'relaciones vuelven'} cuando restaures el otro documento.` : '.'));
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(null);
    }
  }

  async function borrar(id, clave) {
    setOcupado(id); setError(null); setAviso(null);
    try {
      const r = id === 'vaciar' ? await vaciarPapelera(clave) : await eliminarDePapelera(id, clave);
      setItems((prev) => (id === 'vaciar' ? [] : prev.filter((x) => x.id !== id)));
      setConfirmando(null);
      setAviso(id === 'vaciar'
        ? `Papelera vacía: se eliminaron ${r.eliminados} ${r.eliminados === 1 ? 'documento' : 'documentos'}.`
        : 'Eliminado definitivamente.');
      onCambio?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(null);
    }
  }

  const pedirBorrar = (id) => { setConfirmando(id); setError(null); setAviso(null); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(520px,94vw)]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Trash2 className="size-3.5 text-ink-dim" /> Papelera</SheetTitle>
          <SheetDescription>
            Lo que sacaste de la biblioteca, de todas las secciones. Restaurar lo devuelve tal cual; eliminar definitivamente no tiene vuelta atrás.
          </SheetDescription>
        </SheetHeader>

        {aviso && <p className="hairline-b bg-accent/[0.06] px-3.5 py-2 text-[12px] text-ink">{aviso}</p>}
        {error && !confirmando && <p className="hairline-b px-3.5 py-2 text-[12px] text-danger">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null ? (
            <p className="flex items-center gap-1.5 px-3.5 py-4 text-[12px] text-ink-dim"><Loader2 className="size-3.5 animate-spin" /> Leyendo la papelera…</p>
          ) : items.length ? (
            <ul>
              {items.map((it) => (
                <Item
                  key={it.id}
                  it={it}
                  seccion={seccion}
                  ocupado={ocupado === it.id}
                  confirmando={confirmando === it.id}
                  conClave={conClave}
                  error={confirmando === it.id ? error : null}
                  onRestaurar={() => restaurar(it)}
                  onPedirBorrar={() => pedirBorrar(it.id)}
                  onBorrar={(clave) => borrar(it.id, clave)}
                  onCancelar={() => setConfirmando(null)}
                />
              ))}
            </ul>
          ) : (
            <p className="px-3.5 py-8 text-center text-[12px] text-ink-dim">La papelera está vacía.</p>
          )}
        </div>

        {items?.length > 0 && (
          <div className="shrink-0 border-t border-hair px-3.5 py-2">
            {confirmando === 'vaciar' ? (
              <ConfirmarBorrado
                titulo={<>Vaciar la papelera: {items.length} {items.length === 1 ? 'documento' : 'documentos'} para siempre</>}
                detalle="No se puede deshacer. Los archivos subidos que ningún otro documento use también se borran (lo de la carpeta vault no se toca)."
                conClave={conClave}
                ocupado={ocupado === 'vaciar'}
                error={error}
                onConfirmar={(clave) => borrar('vaciar', clave)}
                onCancelar={() => setConfirmando(null)}
              />
            ) : (
              <Button variant="danger" size="sm" onClick={() => pedirBorrar('vaciar')} disabled={ocupado !== null}>
                <Trash2 /> Vaciar papelera
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
