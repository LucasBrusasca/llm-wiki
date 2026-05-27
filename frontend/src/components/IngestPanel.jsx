import React, { useState, useRef, useCallback, useEffect } from 'react';

const STEPS = [
  { at: 15,  label: 'Extrayendo contenido…' },
  { at: 50,  label: 'Procesando con IA…' },
  { at: 65,  label: 'Generando embeddings semánticos…' },
  { at: 88,  label: 'Calculando posición 3D (UMAP)…' },
  { at: 100, label: 'Incorporando al grafo…' },
];

function ProgressOverlay({ status, queueInfo }) {
  const pct = status.progress || 0;
  const step = STEPS.find(s => pct <= s.at) || STEPS[STEPS.length - 1];

  return (
    <div className="ingest-overlay">
      <div className="ingest-overlay-box">
        <div className="ingest-overlay-spinner" />
        {queueInfo && (
          <div className="ingest-overlay-queue">
            ARCHIVO {queueInfo.current} DE {queueInfo.total}
          </div>
        )}
        <div className="ingest-overlay-step">{step.label}</div>
        <div className="ingest-overlay-bar-container">
          <div className="ingest-overlay-bar-wrap">
            <div className="ingest-overlay-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="ingest-overlay-pct">{pct}%</div>
        </div>
        {status.label && (
          <div className="ingest-overlay-label">"{status.label}"</div>
        )}
      </div>
    </div>
  );
}

export default function IngestPanel({ onRefresh, inline = false }) {
  const [url, setUrl]         = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus]   = useState({ state: 'idle', message: '', label: '', progress: 0 });
  const [fileNames, setFileNames] = useState([]);
  const [queueInfo, setQueueInfo] = useState(null);

  const pollRef       = useRef(null);
  const fileQueueRef  = useRef([]);
  const queueIdxRef   = useRef(0);
  // Ref-based callback so the polling interval always calls the latest version
  const processNextRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const startPolling = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/ingest/status');
        const s = await r.json();
        setStatus(s);
        if (s.state === 'done') {
          clearInterval(pollRef.current);
          processNextRef.current?.();
        }
        if (s.state === 'error') {
          clearInterval(pollRef.current);
          fileQueueRef.current = [];
          queueIdxRef.current  = 0;
          setQueueInfo(null);
        }
      } catch { /* keep polling */ }
    }, 700);
  }, []);

  const sendFile = useCallback(async (file, skipUmap) => {
    const form = new FormData();
    form.append('file', file);
    if (skipUmap) form.append('skip_umap', 'true');
    setStatus({ state: 'processing', message: 'Enviando…', label: '', progress: 5 });
    try {
      const r = await fetch('/api/ingest', { method: 'POST', body: form });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setStatus({ state: 'error', message: d.detail || `Error HTTP ${r.status}`, label: '', progress: 0 });
        fileQueueRef.current = [];
        queueIdxRef.current  = 0;
        setQueueInfo(null);
        return false;
      }
      startPolling();
      return true;
    } catch {
      setStatus({ state: 'error', message: 'No se pudo conectar con el backend', label: '', progress: 0 });
      fileQueueRef.current = [];
      queueIdxRef.current  = 0;
      setQueueInfo(null);
      return false;
    }
  }, [startPolling]);

  const sendUrl = useCallback(async (urlVal) => {
    const form = new FormData();
    form.append('url', urlVal);
    setStatus({ state: 'processing', message: 'Enviando…', label: '', progress: 5 });
    try {
      const r = await fetch('/api/ingest', { method: 'POST', body: form });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setStatus({ state: 'error', message: d.detail || `Error HTTP ${r.status}`, label: '', progress: 0 });
        return false;
      }
      startPolling();
      return true;
    } catch {
      setStatus({ state: 'error', message: 'No se pudo conectar con el backend', label: '', progress: 0 });
      return false;
    }
  }, [startPolling]);

  // This function is stored in processNextRef so the polling interval always calls
  // the current version, avoiding stale closures. Updated every render.
  const processNext = useCallback(async () => {
    const queue = fileQueueRef.current;
    const idx   = queueIdxRef.current;

    if (idx >= queue.length) {
      // All files processed
      if (queue.length > 1) {
        // Run UMAP once at the end for batch
        setStatus({ state: 'processing', message: 'Recalculando posiciones 3D…', label: '', progress: 85 });
        setQueueInfo(null);
        try {
          await fetch('/api/umap-refresh', { method: 'POST' });
          await new Promise(res => setTimeout(res, 5000));
        } catch { /* ignore */ }
      }
      const total = queue.length;
      fileQueueRef.current = [];
      queueIdxRef.current  = 0;
      setQueueInfo(null);
      onRefresh();
      setStatus({
        state: 'done',
        message: `${total} archivo${total > 1 ? 's' : ''} incorporado${total > 1 ? 's' : ''} al grafo.`,
        label: '', progress: 100,
      });
      return;
    }

    queueIdxRef.current = idx + 1;
    const isBatch  = queue.length > 1;
    const skipUmap = isBatch; // skip UMAP between files; run once at end
    setQueueInfo({ current: idx + 1, total: queue.length });
    await sendFile(queue[idx], skipUmap);
  }, [sendFile, onRefresh]);

  // Always keep processNextRef current
  processNextRef.current = processNext;

  const startFiles = useCallback(async (files) => {
    fileQueueRef.current = files;
    queueIdxRef.current  = 0;
    await processNext();
  }, [processNext]);

  const reset = useCallback(async () => {
    clearInterval(pollRef.current);
    fileQueueRef.current = [];
    queueIdxRef.current  = 0;
    await fetch('/api/ingest/reset', { method: 'POST' }).catch(() => {});
    setStatus({ state: 'idle', message: '', label: '', progress: 0 });
    setUrl(''); setFileNames([]); setQueueInfo(null);
  }, []);

  const handleFileChange = useCallback(e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setFileNames(files.map(f => f.name));
    setUrl('');
    startFiles(files);
    e.target.value = '';
  }, [startFiles]);

  const handleUrlSubmit = useCallback(e => {
    e.preventDefault();
    const val = url.trim();
    if (!val) return;
    setFileNames([]);
    setQueueInfo(null);
    sendUrl(val).then(ok => { if (ok) processNextRef.current = () => { onRefresh(); }; });
    // After URL done, just refresh once
    processNextRef.current = () => { onRefresh(); setStatus(s => ({ ...s, state: 'done' })); };
  }, [url, sendUrl, onRefresh]);

  const onDragOver  = e => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop      = e => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      setFileNames(files.map(f => f.name));
      setUrl('');
      startFiles(files);
    }
  };

  const isProcessing = status.state === 'processing';
  const isDone       = status.state === 'done';
  const isError      = status.state === 'error';

  const dropLabel = isProcessing
    ? queueInfo ? `⏳ Archivo ${queueInfo.current}/${queueInfo.total}…` : '⏳ Procesando…'
    : fileNames.length > 1
      ? `📄 ${fileNames.length} archivos`
      : fileNames.length === 1
        ? `📄 ${fileNames[0]}`
        : dragOver
          ? 'Soltá aquí — varios archivos aceptados'
          : '+ Arrastrá o clickeá — soporta múltiples archivos';

  return (
    <>
      {isProcessing && <ProgressOverlay status={status} queueInfo={queueInfo} />}

      <div className={`ingest-panel${inline ? ' ingest-panel--inline' : ''}`}>
        <label
          className={`ingest-drop${dragOver ? ' drag-over' : ''}${isProcessing ? ' disabled' : ''}`}
          onDragOver={isProcessing ? undefined : onDragOver}
          onDragLeave={isProcessing ? undefined : onDragLeave}
          onDrop={isProcessing ? undefined : onDrop}
        >
          <input
            type="file"
            accept=".pdf,.xlsx,.xls,.html,.htm,.txt,.md"
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={isProcessing}
            multiple
          />
          <span className="ingest-drop-label">{dropLabel}</span>
        </label>

        <form className="ingest-url-row" onSubmit={handleUrlSubmit}>
          <input
            className="ingest-url-input"
            placeholder="URL: YouTube, Wikipedia, artículo web…"
            value={url}
            onChange={e => { setUrl(e.target.value); setFileNames([]); }}
            disabled={isProcessing}
          />
          <button type="submit" className="ingest-submit" disabled={isProcessing || !url.trim()}>→</button>
        </form>

        {(isDone || isError) && (
          <div className={`ingest-status ingest-status--${status.state}`}>
            <span className="ingest-status-text">{status.message}</span>
            <button className="ingest-reset-btn" onClick={reset}>✕</button>
          </div>
        )}
      </div>
    </>
  );
}
