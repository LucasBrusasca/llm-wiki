import React from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Plegar / desplegar un panel lateral. Hay UN control por panel y vive siempre en
 * la esquina exterior de arriba (izquierda para el rail, derecha para el detalle):
 * abierto, en la primera fila del panel; plegado, en una franja de 44 px que lo deja
 * en el mismo punto de la pantalla. Plegar y volver a abrir es el mismo clic sin
 * mover el mouse. Los atajos `[` y `]` hacen lo mismo y no dibujan nada aparte.
 */
const ICONOS = {
  izquierda: { abierto: PanelLeftClose, plegado: PanelLeftOpen },
  derecha: { abierto: PanelRightClose, plegado: PanelRightOpen },
};

/** Cuadro del ícono: 28 px, glifo de 16 px. El mismo abierto y plegado. */
function Cuadro({ lado, abierto, marca, className }) {
  const Icon = ICONOS[lado][abierto ? 'abierto' : 'plegado'];
  return (
    <span
      className={cn(
        'relative grid size-7 shrink-0 place-items-center rounded-sm text-ink-muted transition-colors',
        className,
      )}
    >
      <Icon className="size-4" />
      {marca && <span className="absolute right-[3px] top-[3px] size-1.5 rounded-full bg-accent ring-2 ring-surface" />}
    </span>
  );
}

/** Control de plegar, para la cabecera del panel abierto. */
export function BotonPanel({ lado, texto, atajo, onClick, className }) {
  return (
    <Hint texto={`${texto} · ${atajo}`}>
      <button
        type="button"
        onClick={onClick}
        aria-label={texto}
        aria-expanded
        className={cn('group rounded-sm', className)}
      >
        <Cuadro lado={lado} abierto className="group-hover:bg-surface-3 group-hover:text-ink" />
      </button>
    </Hint>
  );
}

/**
 * Panel plegado: franja angosta con el control de volver a abrirlo arriba. Toda la
 * franja es el blanco del clic (el borde de la pantalla es fácil de acertar), pero lo
 * único que se dibuja es el ícono. `marca`: punto de acento cuando el panel tiene algo
 * para mostrar (p. ej. un documento elegido en el detalle).
 */
export function PanelPlegado({ lado, texto, atajo, onAbrir, marca = false }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={texto}
      aria-expanded={false}
      className={cn(
        'group flex w-11 shrink-0 flex-col items-center bg-surface pt-2 outline-none',
        lado === 'izquierda' ? 'hairline-r' : 'hairline-l',
      )}
    >
      <Hint texto={`${texto} · ${atajo}`} side={lado === 'izquierda' ? 'right' : 'left'}>
        <span>
          <Cuadro
            lado={lado}
            abierto={false}
            marca={marca}
            className="group-hover:bg-surface-3 group-hover:text-ink group-focus-visible:outline group-focus-visible:outline-1 group-focus-visible:outline-accent"
          />
        </span>
      </Hint>
    </button>
  );
}
