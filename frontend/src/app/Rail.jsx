import React, { useState } from 'react';
import { Plus, Upload, Terminal, Hash, ChevronDown, MoreHorizontal, Pencil, Trash2, Sparkles, StickyNote } from 'lucide-react';
import { hayNombresAutomaticos } from '@/lib/temas';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { renameSection, deleteSection } from '@/lib/api';
import { pedirClave, avisarClaveIncorrecta } from '@/security.js';
import { Button } from '@/components/ui/button';
import { tipoMeta, fuenteLabel, iconoDe, colorFuente, colorTipo, colorSeccion } from '@/lib/nodes';
import { cn } from '@/lib/utils';

function Grupo({ titulo, children, accion, plegable = false }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <div className="px-2.5 pt-5">
      <div className="mb-1 flex h-6 items-center justify-between px-1.5">
        <button
          className={cn('flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-dim', plegable && 'hover:text-ink-muted')}
          onClick={() => plegable && setAbierto((a) => !a)}
          type="button"
        >
          {titulo}
          {plegable && <ChevronDown className={cn('size-3 transition-transform', !abierto && '-rotate-90')} />}
        </button>
        {accion}
      </div>
      {abierto && <div className="mt-0.5 flex flex-col">{children}</div>}
    </div>
  );
}

function Fila({ activa, onClick, icon: Icon, label, count, marca, title, menu, color }) {
  const boton = (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={color ? { '--c': color } : undefined}
      className={cn(
        'group flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[12.5px] transition-colors',
        activa ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {marca}
      {Icon && <Icon className={cn('size-3.5 shrink-0', color ? 'text-cat' : activa ? 'text-accent' : 'text-ink-dim group-hover:text-ink-muted')} />}
      <span className="flex-1 truncate">{label}</span>
      {count != null && <span className={cn('text-[11px] text-ink-dim', menu && 'group-hover/fila:hidden')}>{count}</span>}
    </button>
  );
  if (!menu) return boton;
  return (
    <div className="group/fila relative">
      {boton}
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 group-hover/fila:block has-[[data-state=open]]:block">{menu}</div>
    </div>
  );
}

function Check({ on }) {
  return (
    <span
      className={cn(
        'grid size-3 shrink-0 place-items-center rounded-[3px] border transition-colors',
        on ? 'border-accent bg-accent' : 'border-hair-strong group-hover:border-ink-dim',
      )}
    >
      {on && <svg viewBox="0 0 10 10" className="size-2 text-accent-ink"><path d="M2 5.2 4.1 7.2 8 3" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>}
    </span>
  );
}

// Espejo de SECCIONES_BASE en el backend: no se eliminan aunque estén en cero.
const SECCIONES_BASE = new Set(['personal', 'finanzas', 'maestria']);

export default function Rail({
  sections, seccion, onSeccion, onNuevaSeccion,
  facetas, tipos, onToggleTipo, fuentes, onToggleFuente,
  topConceptos, conceptos, onToggleConcepto,
  temas, temasSel, onToggleTema, onNombrarTemas,
  onIngest, onScripts, onNuevaNota, onSeccionesCambiadas, onSeccionEliminada, ancho = 272,
}) {
  async function renombrar(nombre) {
    const nuevo = (window.prompt(`Nuevo nombre para «${nombre}»:`, nombre) || '').trim().toLowerCase();
    if (!nuevo || nuevo === nombre) return;
    const clave = await pedirClave(`renombrar «${nombre}»`);
    if (!clave) return;
    const r = await renameSection(nombre, nuevo, clave.password).catch(() => null);
    if (r?.status === 403) { avisarClaveIncorrecta(); return; }
    if (!r?.ok) { window.alert('No se pudo renombrar la sección.'); return; }
    onSeccionesCambiadas(nombre === seccion ? nuevo : seccion);
  }

  async function eliminar(nombre, count) {
    // Una sección vacía es un rótulo: borrarla no destruye nada y no pide la clave.
    // Con documentos adentro, el menú ni siquiera deja llegar hasta acá.
    if (count > 0) return;
    if (!window.confirm(`Se elimina la sección «${nombre}». No borra nodos (está vacía).`)) return;
    const r = await deleteSection(nombre).catch(() => null);
    if (!r?.ok) { window.alert('No se pudo eliminar la sección.'); return; }
    onSeccionEliminada?.(nombre);
    const otra = sections.find((s) => s.nombre !== nombre)?.nombre || 'personal';
    onSeccionesCambiadas(nombre === seccion ? otra : seccion);
  }

  const nuevaSeccion = () => {
    const nombre = (window.prompt('Nombre de la nueva sección (silo aparte):') || '').trim().toLowerCase();
    if (!nombre) return;
    if (onNuevaSeccion) onNuevaSeccion(nombre);
    else onSeccion(nombre);
  };

  const tiposOrden = [...facetas.tipo.entries()].sort((a, b) => b[1] - a[1]);
  const fuentesOrden = [...facetas.fuente.entries()].sort((a, b) => b[1] - a[1]);
  const seccionesVista = sections;

  return (
    <aside className="flex shrink-0 flex-col hairline-r bg-surface" style={{ width: ancho }}>
      <div className="flex gap-2 hairline-b p-2.5">
        <Button variant="default" size="lg" className="flex-1 glow-sel" onClick={onIngest}>
          <Upload /> Ingestar
        </Button>
        <Button variant="outline" size="lg" className="flex-1" onClick={onNuevaNota}>
          <StickyNote /> Nota
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pb-4">
        <Grupo
          titulo="Secciones"
          accion={
            <button onClick={nuevaSeccion} className="grid size-5 place-items-center rounded-xs text-ink-dim hover:bg-surface-2 hover:text-ink" title="Nueva sección" type="button">
              <Plus className="size-3.5" />
            </button>
          }
        >
          {seccionesVista.map((s, i) => (
            <Fila
              key={s.nombre}
              activa={s.nombre === seccion}
              onClick={() => onSeccion(s.nombre)}
              label={<span className="capitalize">{s.nombre}</span>}
              count={s.count}
              marca={(
                <span
                  className={cn('size-2 shrink-0 rounded-[3px] dot-cat transition-opacity', s.nombre === seccion ? 'opacity-100' : 'opacity-45')}
                  style={{ '--c': colorSeccion(i) }}
                />
              )}
              menu={(
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`Opciones de ${s.nombre}`} className="grid size-5 place-items-center rounded-xs text-ink-dim hover:bg-surface-3 hover:text-ink">
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="right">
                    <DropdownMenuItem onSelect={() => renombrar(s.nombre)}><Pencil /> Renombrar</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {/* Eliminar sólo lo que no destruye nada: sección propia y vacía.
                        El item queda visible pero deshabilitado y diciendo por qué, en
                        vez de desaparecer y dejar pensando que la opción no existe. */}
                    <DropdownMenuItem
                      disabled={SECCIONES_BASE.has(s.nombre) || s.count > 0}
                      title={SECCIONES_BASE.has(s.nombre) ? 'Sección base'
                        : s.count > 0 ? 'Mové o borrá los nodos primero' : undefined}
                      onSelect={() => eliminar(s.nombre, s.count)}
                      className="text-danger [&_svg]:text-danger"
                    >
                      <Trash2 /> Eliminar sección
                    </DropdownMenuItem>
                    {(SECCIONES_BASE.has(s.nombre) || s.count > 0) && (
                      <div className="px-2 pb-1 text-[10.5px] text-ink-dim">
                        {SECCIONES_BASE.has(s.nombre) ? 'Sección base' : 'Mové o borrá los nodos primero'}
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            />
          ))}
        </Grupo>

        {temas.size > 0 && (
          <Grupo
            titulo="Temas"
            plegable
            accion={hayNombresAutomaticos(temas) && (
              <button
                type="button"
                onClick={onNombrarTemas}
                title="Los nombres automáticos salen de los conceptos de cada cluster. Podés pedirle al LLM una taxonomía legible."
                className="flex items-center gap-1 rounded-xs px-1 text-[10.5px] text-ink-dim hover:bg-surface-2 hover:text-accent"
              >
                <Sparkles className="size-3" /> Nombrar con IA
              </button>
            )}
          >
            {[...temas.values()].sort((a, b) => (a.key === 'sin-tema') - (b.key === 'sin-tema') || b.count - a.count).map((t) => (
              <Fila
                key={t.key}
                activa={temasSel.has(t.key)}
                onClick={() => onToggleTema(t.key)}
                marca={<Check on={temasSel.has(t.key)} />}
                label={(
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full dot-cat" style={{ '--c': t.color }} />
                    <span className="truncate">{t.nombre}</span>
                  </span>
                )}
                count={t.count}
                title={t.auto ? `${t.nombre} — nombre automático (conceptos del cluster)` : t.nombre}
              />
            ))}
          </Grupo>
        )}

        {tiposOrden.length > 1 && (
          <Grupo titulo="Tipo" plegable>
            {tiposOrden.map(([t, n]) => (
              <Fila
                key={t}
                activa={tipos.has(t)}
                onClick={() => onToggleTipo(t)}
                marca={<Check on={tipos.has(t)} />}
                icon={tipoMeta(t).icon}
                color={colorTipo(t)}
                label={tipoMeta(t).plural}
                count={n}
              />
            ))}
          </Grupo>
        )}

        {fuentesOrden.length > 0 && (
          <Grupo titulo="Origen" plegable>
            {fuentesOrden.map(([f, n]) => (
              <Fila
                key={f}
                activa={fuentes.has(f)}
                onClick={() => onToggleFuente(f)}
                marca={<Check on={fuentes.has(f)} />}
                icon={iconoDe({ fuente: f })}
                color={colorFuente(f)}
                label={f === 'sin-origen' ? 'Sin origen' : fuenteLabel({ fuente: f })}
                count={n}
              />
            ))}
          </Grupo>
        )}

        {topConceptos.length > 0 && (
          <Grupo titulo="Conceptos" plegable>
            {topConceptos.map((c) => (
              <Fila
                key={c.key}
                activa={conceptos.has(c.key)}
                onClick={() => onToggleConcepto(c.key)}
                icon={Hash}
                label={c.label}
                count={c.count}
                title={`Filtrar por «${c.label}»`}
              />
            ))}
          </Grupo>
        )}
      </nav>

      {/* El registry de scripts queda como acceso secundario: lo que se ejecuta en el
          día a día es el archivo del nodo, desde su inspector. */}
      <button
        type="button"
        onClick={onScripts}
        className="flex h-8 shrink-0 items-center gap-1.5 border-t border-hair px-3 text-[11.5px] text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink-muted"
        title="Registry de scripts (legacy): los archivos .py de tus documentos se ejecutan desde el inspector"
      >
        <Terminal className="size-3" /> Scripts (registry legacy)
      </button>

    </aside>
  );
}
