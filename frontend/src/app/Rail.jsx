import React, { useState } from 'react';
import { Plus, Upload, Terminal, Hash, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tipoMeta, fuenteLabel, iconoDe } from '@/lib/nodes';
import { cn } from '@/lib/utils';

function Grupo({ titulo, children, accion, plegable = false }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <div className="px-2 pt-3">
      <div className="flex h-6 items-center justify-between px-1.5">
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

function Fila({ activa, onClick, icon: Icon, label, count, marca, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'group flex h-7 items-center gap-2 rounded-sm px-1.5 text-left text-[12.5px] transition-colors',
        activa ? 'bg-surface-3 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {marca}
      {Icon && <Icon className={cn('size-3.5 shrink-0', activa ? 'text-accent' : 'text-ink-dim group-hover:text-ink-muted')} />}
      <span className="flex-1 truncate">{label}</span>
      {count != null && <span className="text-[11px] text-ink-dim">{count}</span>}
    </button>
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

export default function Rail({
  sections, seccion, onSeccion,
  facetas, tipos, onToggleTipo, fuentes, onToggleFuente,
  topConceptos, conceptos, onToggleConcepto,
  onIngest, onScripts,
}) {
  const nuevaSeccion = () => {
    const nombre = (window.prompt('Nombre de la nueva sección (silo aparte):') || '').trim().toLowerCase();
    if (nombre) onSeccion(nombre);
  };

  const tiposOrden = [...facetas.tipo.entries()].sort((a, b) => b[1] - a[1]);
  const fuentesOrden = [...facetas.fuente.entries()].sort((a, b) => b[1] - a[1]);
  const seccionesVista = sections.some((s) => s.nombre === seccion)
    ? sections
    : [...sections, { nombre: seccion, count: 0 }];

  return (
    <aside className="flex w-[260px] shrink-0 flex-col hairline-r bg-surface">
      <div className="flex gap-1.5 hairline-b p-2">
        <Button variant="default" size="md" className="flex-1" onClick={onIngest}>
          <Upload /> Ingestar
        </Button>
        <Button variant="outline" size="md" className="flex-1" onClick={onScripts}>
          <Terminal /> Scripts
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
          {seccionesVista.map((s) => (
            <Fila
              key={s.nombre}
              activa={s.nombre === seccion}
              onClick={() => onSeccion(s.nombre)}
              label={<span className="capitalize">{s.nombre}</span>}
              count={s.count}
              marca={<span className={cn('size-1.5 shrink-0 rounded-full', s.nombre === seccion ? 'bg-accent' : 'bg-hair-strong')} />}
            />
          ))}
        </Grupo>

        {tiposOrden.length > 1 && (
          <Grupo titulo="Tipo" plegable>
            {tiposOrden.map(([t, n]) => (
              <Fila
                key={t}
                activa={tipos.has(t)}
                onClick={() => onToggleTipo(t)}
                marca={<Check on={tipos.has(t)} />}
                icon={tipoMeta(t).icon}
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

    </aside>
  );
}
