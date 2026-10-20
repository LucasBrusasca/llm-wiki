import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Pause, Play, X } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { rangoFechas } from '@/lib/timeline';

/**
 * Slider temporal: filtra el grafo a nodos conocidos hasta una fecha.
 * Play recorre min→max en ~6 s. Sin rango (un solo instante) no se muestra.
 */
export function useTimeline(nodes) {
  const [timelineDate, setTimelineDate] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const dates = useMemo(() => rangoFechas(nodes), [nodes]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (!dates || dates.min === dates.max) {
      setIsPlaying(false);
      return undefined;
    }
    const { min, max } = dates;
    const step = (max - min) / 60;
    setTimelineDate((prev) => {
      const t = prev ? new Date(prev).getTime() : min;
      // Al terminar, timelineDate queda en max: un replay tiene que volver al inicio.
      if (Number.isNaN(t) || t >= max - 1) return new Date(min).toISOString();
      return prev;
    });
    const id = setInterval(() => {
      setTimelineDate((prev) => {
        const t = prev ? new Date(prev).getTime() : min;
        const next = t + step;
        if (next >= max) {
          setIsPlaying(false);
          return new Date(max).toISOString();
        }
        return new Date(next).toISOString();
      });
    }, 100);
    return () => clearInterval(id);
  }, [isPlaying, dates]);

  return {
    timelineDate,
    setTimelineDate,
    isPlaying,
    setIsPlaying,
    dates,
  };
}

export default function TimelineSlider({ nodes, timelineDate, onTimelineChange, isPlaying, onPlayToggle }) {
  const dates = useMemo(() => rangoFechas(nodes), [nodes]);
  if (!dates || dates.min === dates.max) return null;

  const value = timelineDate ? new Date(timelineDate).getTime() : dates.max;
  const formatDate = (ts) => new Date(ts).toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-sm border border-hair bg-surface/95 px-2 py-1.5 shadow-lg shadow-black/30">
      <Hint texto={isPlaying ? 'Pausar reproducción' : 'Reproducir línea temporal'} side="top">
        <button
          type="button"
          onClick={onPlayToggle}
          className="grid size-6 place-items-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink"
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
      </Hint>
      <Calendar className="size-3.5 text-ink-dim" />
      <span className="min-w-[70px] text-[10px] text-ink-dim">{formatDate(dates.min)}</span>
      <input
        type="range"
        min={dates.min}
        max={dates.max}
        value={Number.isNaN(value) ? dates.max : value}
        onChange={(e) => onTimelineChange(new Date(Number(e.target.value)).toISOString())}
        className="h-1 w-40 cursor-pointer appearance-none rounded-full bg-hair accent-accent"
        aria-label="Fecha del grafo"
      />
      <span className="min-w-[70px] text-right text-[10px] text-ink-dim">{formatDate(value)}</span>
      <Hint texto="Mostrar todo (sin filtro temporal)" side="top">
        <button
          type="button"
          onClick={() => onTimelineChange(null)}
          disabled={!timelineDate}
          className={cn(
            'grid size-6 place-items-center rounded text-ink-muted hover:bg-surface-2 hover:text-ink',
            !timelineDate && 'opacity-40',
          )}
          aria-label="Mostrar todo"
        >
          <X className="size-3.5" />
        </button>
      </Hint>
    </div>
  );
}
