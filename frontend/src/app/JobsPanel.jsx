import React, { useEffect, useState, useCallback } from 'react';
import {
  Loader2, CheckCircle2, AlertTriangle, Clock, RefreshCw, X, FileText, Link as LinkIcon, Youtube,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getActiveJobs, retryJob, cancelJob } from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_INTERVAL = 2000;

const STATUS_ICONS = {
  queued: Clock,
  running: Loader2,
  done: CheckCircle2,
  failed: AlertTriangle,
};

const STATUS_LABELS = {
  queued: 'En cola',
  running: 'Procesando',
  done: 'Completado',
  failed: 'Falló',
};

const KIND_ICONS = {
  file: FileText,
  url: LinkIcon,
  youtube: Youtube,
};

function JobRow({ job, onRetry, onCancel, onDone }) {
  const StatusIcon = STATUS_ICONS[job.status] || Clock;
  const KindIcon = KIND_ICONS[job.kind] || FileText;
  const isActive = job.status === 'queued' || job.status === 'running';

  return (
    <div className={cn(
      'flex items-start gap-3 rounded-sm p-2.5 transition-colors',
      job.status === 'failed' ? 'bg-danger/5' : job.status === 'done' ? 'bg-accent/5' : 'bg-surface-2',
    )}>
      <div className="mt-0.5 shrink-0">
        <KindIcon className="size-4 text-ink-dim" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-ink">{job.label}</span>
          <span className={cn(
            'flex shrink-0 items-center gap-1 text-[11px]',
            job.status === 'done' ? 'text-accent' : job.status === 'failed' ? 'text-danger' : 'text-ink-dim',
          )}>
            <StatusIcon className={cn('size-3', job.status === 'running' && 'animate-spin')} />
            {STATUS_LABELS[job.status]}
          </span>
        </div>

        {job.message && (
          <p className="mt-0.5 text-[11.5px] text-ink-muted">{job.message}</p>
        )}

        {job.error_message && (
          <p className="mt-1 text-[11.5px] text-danger">{job.error_message}</p>
        )}

        {isActive && job.progress > 0 && (
          <div className="mt-1.5">
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>
        )}

        {job.status === 'done' && job.node_id && (
          <button
            type="button"
            onClick={() => onDone?.(job.node_id)}
            className="mt-1 text-[11px] text-accent hover:underline"
          >
            Ver en el grafo →
          </button>
        )}
      </div>

      <div className="shrink-0">
        {job.status === 'queued' && (
          <button
            type="button"
            onClick={() => onCancel(job.id)}
            className="rounded-xs p-1 text-ink-dim hover:bg-surface-3 hover:text-ink"
            title="Cancelar"
          >
            <X className="size-3.5" />
          </button>
        )}
        {job.status === 'failed' && (
          <button
            type="button"
            onClick={() => onRetry(job.id)}
            className="rounded-xs p-1 text-ink-dim hover:bg-surface-3 hover:text-ink"
            title="Reintentar"
          >
            <RefreshCw className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function useJobs(onJobDone) {
  const [active, setActive] = useState([]);
  const [recent, setRecent] = useState([]);
  const [lastCompletedId, setLastCompletedId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getActiveJobs();
      setActive(data.active || []);
      setRecent(data.recent || []);

      const justCompleted = (data.recent || []).find(
        (j) => j.status === 'done' && j.id !== lastCompletedId
      );
      if (justCompleted && onJobDone) {
        setLastCompletedId(justCompleted.id);
        onJobDone(justCompleted);
      }
    } catch (e) {
      console.error('[jobs] Error al obtener jobs:', e);
    }
  }, [onJobDone, lastCompletedId]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [refresh]);

  return { active, recent, refresh };
}

export function JobsBadge({ active, onClick }) {
  if (!active?.length) return null;

  const running = active.filter((j) => j.status === 'running');
  const queued = active.filter((j) => j.status === 'queued');
  const progress = running[0]?.progress || 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center gap-1.5 rounded-sm bg-accent/10 px-2 py-1 text-[11.5px] text-accent transition-colors hover:bg-accent/15"
    >
      <Loader2 className="size-3.5 animate-spin" />
      <span className="font-medium">
        {running.length > 0 ? `${progress}%` : `${queued.length} en cola`}
      </span>
      {running.length + queued.length > 1 && (
        <span className="text-accent/70">
          +{running.length + queued.length - 1}
        </span>
      )}
    </button>
  );
}

export default function JobsPanel({ open, onOpenChange, active, recent, onRefresh, onSelectNode }) {
  const handleRetry = async (jobId) => {
    try {
      await retryJob(jobId);
      onRefresh?.();
    } catch (e) {
      console.error('Error al reintentar:', e);
    }
  };

  const handleCancel = async (jobId) => {
    try {
      await cancelJob(jobId);
      onRefresh?.();
    } catch (e) {
      console.error('Error al cancelar:', e);
    }
  };

  const handleDone = (nodeId) => {
    onSelectNode?.(nodeId);
    onOpenChange?.(false);
  };

  const allJobs = [...active, ...recent.filter((r) => !active.some((a) => a.id === r.id))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,94vw)]">
        <DialogHeader>
          <DialogTitle>Jobs de ingesta</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] min-h-[120px] overflow-y-auto">
          {allJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Clock className="size-8 text-ink-dim" />
              <p className="mt-2 text-[13px] text-ink-muted">No hay jobs recientes</p>
              <p className="mt-1 text-[12px] text-ink-dim">
                Los documentos que ingieras aparecerán acá
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {allJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onRetry={handleRetry}
                  onCancel={handleCancel}
                  onDone={handleDone}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-hair pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
