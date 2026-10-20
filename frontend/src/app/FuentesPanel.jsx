/**
 * Panel de Fuentes Vivas: URLs monitoreadas para detectar cambios.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Radio, CheckCircle2, AlertTriangle, Clock, RefreshCw, Trash2, ExternalLink,
  Plus, FileText, Link as LinkIcon, Globe, Loader2, Bell, Eye,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fetchWatchedSources, createWatchedSource, deleteWatchedSource,
  checkWatchedSource, markWatchedSourceSeen, getWatchedSourcesPendingCount,
  updateWatchedSource,
} from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_INTERVAL = 30000;

const STATUS_ICONS = {
  pending: Clock,
  ok: CheckCircle2,
  changed: Bell,
  error: AlertTriangle,
};

const STATUS_LABELS = {
  pending: 'Pendiente',
  ok: 'OK',
  changed: 'Actualizada',
  error: 'Error',
};

const KIND_ICONS = {
  pdf: FileText,
  listing: LinkIcon,
  html: Globe,
};

const KIND_LABELS = {
  pdf: 'PDF directo',
  listing: 'Página con links',
  html: 'Página web',
};

function SourceRow({ source, onCheck, onDelete, onMarkSeen, onToggle }) {
  const [checking, setChecking] = useState(false);
  const StatusIcon = STATUS_ICONS[source.status] || Clock;
  const KindIcon = KIND_ICONS[source.kind] || Globe;

  const handleCheck = async () => {
    setChecking(true);
    try {
      await onCheck(source.id);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={cn(
      'flex items-start gap-3 rounded-sm p-2.5 transition-colors',
      source.status === 'error' ? 'bg-danger/5' :
      source.status === 'changed' ? 'bg-accent/10' : 'bg-surface-2',
    )}>
      <div className="mt-0.5 shrink-0">
        <KindIcon className="size-4 text-ink-dim" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-ink">
            {source.label}
          </span>
          <span className={cn(
            'flex shrink-0 items-center gap-1 text-[11px]',
            source.status === 'ok' ? 'text-accent' :
            source.status === 'changed' ? 'text-warning' :
            source.status === 'error' ? 'text-danger' : 'text-ink-dim',
          )}>
            <StatusIcon className="size-3" />
            {STATUS_LABELS[source.status]}
          </span>
        </div>

        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-muted hover:text-accent hover:underline"
        >
          <span className="truncate">{source.url}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>

        {source.last_error && source.status === 'error' && (
          <p className="mt-1 text-[11px] text-danger">{source.last_error}</p>
        )}

        <div className="mt-1 flex items-center gap-3 text-[10.5px] text-ink-dim">
          <span>Cada {source.frequency_hours}h</span>
          {source.change_count > 0 && (
            <span>{source.change_count} cambio{source.change_count > 1 ? 's' : ''}</span>
          )}
          {source.last_check && (
            <span>Última: {new Date(source.last_check).toLocaleDateString('es-AR', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {source.status === 'changed' && (
          <button
            type="button"
            onClick={() => onMarkSeen(source.id)}
            className="rounded-xs p-1 text-warning hover:bg-warning/10"
            title="Marcar como vista"
          >
            <Eye className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className="rounded-xs p-1 text-ink-dim hover:bg-surface-3 hover:text-ink disabled:opacity-50"
          title="Revisar ahora"
        >
          {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => onToggle(source.id, !source.enabled)}
          className={cn(
            'rounded-xs p-1 hover:bg-surface-3',
            source.enabled ? 'text-accent' : 'text-ink-dim',
          )}
          title={source.enabled ? 'Desactivar' : 'Activar'}
        >
          <Radio className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(source.id)}
          className="rounded-xs p-1 text-ink-dim hover:bg-danger/10 hover:text-danger"
          title="Eliminar"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function AddSourceForm({ seccion, onAdd, onCancel }) {
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState('pdf');
  const [label, setLabel] = useState('');
  const [frequency, setFrequency] = useState(24);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      await onAdd({
        url: url.trim(),
        kind,
        label: label.trim() || undefined,
        frequency_hours: frequency,
        seccion,
      });
      setUrl('');
      setLabel('');
    } catch (err) {
      setError(err.message || 'Error al agregar fuente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-md border border-accent/30 bg-accent/5 p-3">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] text-ink-muted">URL a monitorear</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://ejemplo.com/documento.pdf"
            className="text-[12px]"
          />
        </div>
        
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] text-ink-muted">Tipo</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded-sm border border-hair bg-surface px-2 py-1.5 text-[12px] text-ink"
            >
              <option value="pdf">PDF directo</option>
              <option value="listing">Página con links a PDFs</option>
              <option value="html">Página web</option>
            </select>
          </div>
          <div className="w-24">
            <label className="mb-1 block text-[11px] text-ink-muted">Cada (horas)</label>
            <Input
              type="number"
              min={1}
              value={frequency}
              onChange={(e) => setFrequency(parseInt(e.target.value, 10) || 24)}
              className="text-[12px]"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-ink-muted">Nombre (opcional)</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ej: Tarifario vial 2024"
            className="text-[12px]"
          />
        </div>

        {error && (
          <p className="text-[11px] text-danger">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm" disabled={loading || !url.trim()}>
            {loading ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Plus className="mr-1 size-3" />}
            Agregar
          </Button>
        </div>
      </div>
    </form>
  );
}

export function useFuentesVivas(seccion) {
  const [sources, setSources] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [srcs, count] = await Promise.all([
        fetchWatchedSources(seccion),
        getWatchedSourcesPendingCount(seccion),
      ]);
      setSources(srcs);
      setPendingCount(count);
    } catch (e) {
      console.error('[fuentes] Error:', e);
    }
  }, [seccion]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [refresh]);

  return { sources, pendingCount, refresh };
}

export function FuentesBadge({ pendingCount, onClick }) {
  if (!pendingCount) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center gap-1.5 rounded-sm bg-warning/15 px-2 py-1 text-[11.5px] text-warning transition-colors hover:bg-warning/20"
      title={`${pendingCount} fuente${pendingCount > 1 ? 's' : ''} actualizada${pendingCount > 1 ? 's' : ''}`}
    >
      <Bell className="size-3.5" />
      <span className="font-medium">{pendingCount}</span>
    </button>
  );
}

export default function FuentesPanel({ open, onOpenChange, seccion, sources, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = async (data) => {
    await createWatchedSource(data);
    setShowAdd(false);
    onRefresh?.();
  };

  const handleCheck = async (id) => {
    await checkWatchedSource(id);
    onRefresh?.();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta fuente? Los documentos ya ingeridos no se borran.')) return;
    await deleteWatchedSource(id);
    onRefresh?.();
  };

  const handleMarkSeen = async (id) => {
    await markWatchedSourceSeen(id);
    onRefresh?.();
  };

  const handleToggle = async (id, enabled) => {
    await updateWatchedSource(id, { enabled });
    onRefresh?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(540px,94vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-4" />
            Fuentes vivas
          </DialogTitle>
        </DialogHeader>

        <p className="text-[12px] text-ink-muted">
          URLs que se revisan periódicamente. Cuando detectan cambios, reingresan el contenido automáticamente.
        </p>

        <div className="max-h-[50vh] min-h-[100px] overflow-y-auto">
          {sources.length === 0 && !showAdd ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Radio className="size-8 text-ink-dim" />
              <p className="mt-2 text-[13px] text-ink-muted">No hay fuentes monitoreadas</p>
              <p className="mt-1 text-[12px] text-ink-dim">
                Agregá una URL para que se revise periódicamente
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => setShowAdd(true)}
              >
                <Plus className="mr-1 size-3" />
                Agregar fuente
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onCheck={handleCheck}
                  onDelete={handleDelete}
                  onMarkSeen={handleMarkSeen}
                  onToggle={handleToggle}
                />
              ))}
              
              {showAdd ? (
                <AddSourceForm
                  seccion={seccion}
                  onAdd={handleAdd}
                  onCancel={() => setShowAdd(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="flex items-center justify-center gap-1.5 rounded-sm border border-dashed border-hair py-2 text-[12px] text-ink-muted hover:border-accent hover:text-accent"
                >
                  <Plus className="size-3" />
                  Agregar fuente
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hair pt-3">
          <p className="text-[11px] text-ink-dim">
            {sources.filter(s => s.enabled).length} activa{sources.filter(s => s.enabled).length !== 1 ? 's' : ''}
            {' · '}
            {sources.filter(s => s.status === 'changed').length} con cambios
          </p>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
