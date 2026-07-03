import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const STEPS = [
  { at: 15,  label: 'Extrayendo contenido…' },
  { at: 50,  label: 'Procesando con IA…' },
  { at: 65,  label: 'Generando embeddings semánticos…' },
  { at: 88,  label: 'Calculando posición 3D (UMAP)…' },
  { at: 100, label: 'Incorporando al grafo…' },
];

// Extensiones soportadas (única fuente de verdad para el input y el filtro de carpeta).
const ACCEPT_EXT  = ['.pdf', '.xlsx', '.xls', '.html', '.htm', '.txt', '.md', '.docx', '.pptx', '.pptm'];
const ACCEPT_ATTR = ACCEPT_EXT.join(',');
const isSupported = name => ACCEPT_EXT.some(ext => String(name).toLowerCase().endsWith(ext));

// Mensaje de error legible (los del proveedor vienen crudos de httpx).
function humanizeError(msg) {
  if (!msg) return 'Error en la ingesta';
  const m = String(msg);
  if (m.includes('429')) return 'Límite de la API de IA alcanzado — esperá un momento y reintentá';
  if (m.includes('503')) return 'El servicio de IA está saturado — probá de nuevo en unos segundos';
  if (m.toLowerCase().includes('timed out') || m.toLowerCase().includes('timeout'))
    return 'La IA tardó demasiado en responder — reintentá';
  return m;
}

// Toast flotante de progreso: NO bloquea la app — la ingesta corre en el backend y
// esto solo la mira. Va por portal a <body> para seguir visible aunque la Biblioteca
// (que contiene este panel) esté oculta.
function ProgressToast({ status, queueInfo, onCancel }) {
  const pct = status.progress || 0;
  const step = STEPS.find(s => pct <= s.at) || STEPS[STEPS.length - 1];
  // Para playlists el backend manda "Video X/N: título…": lo mostramos tal cual.
  const liveMsg = /^Video \d+\/\d+/.test(status.message || '') ? status.message
                : /lista de YouTube/i.test(status.message || '') ? status.message
                : null;
  const st = status.state;

  return createPortal(
    <div className={`ingest-toast${st === 'done' ? ' ingest-toast--done' : ''}${st === 'error' ? ' ingest-toast--error' : ''}`}>
      <div className="ingest-toast-head">
        {st === 'processing' && <div className="ingest-toast-spinner" />}
        {st === 'done' && <span style={{ color: '#5fd38d', flexShrink: 0 }}>✓</span>}
        {st === 'error' && <span style={{ color: '#e87a6e', flexShrink: 0 }}>✕</span>}
        <span className="ingest-toast-title" title={queueInfo?.name || status.message}>
          {st === 'processing'
            ? (queueInfo ? `Cargando ${queueInfo.current}/${queueInfo.total} · ${queueInfo.name || ''}` : 'Cargando…')
            : status.message}
        </span>
        <button className="ingest-toast-cancel" onClick={onCancel} title={st === 'processing' ? 'Cancelar la carga' : 'Cerrar'}>✕</button>
      </div>
      {st === 'processing' && (
        <>
          <div className="ingest-toast-bar-wrap">
            <div className="ingest-toast-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="ingest-toast-step">{liveMsg || step.label} · {pct}%{status.label ? ` · "${status.label}"` : ''}</div>
          <div className="ingest-toast-step" style={{ opacity: 0.65 }}>Corre en segundo plano — podés seguir usando la app</div>
        </>
      )}
    </div>,
    document.body
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
  const folderInputRef = useRef(null);
  const ingestModeRef = useRef('file');   // 'file' | 'url' → la rama URL NO usa la cola de archivos
  const onRefreshRef  = useRef(onRefresh); // siempre la última versión (startPolling tiene deps [])
  onRefreshRef.current = onRefresh;
  // Ref-based callback so the polling interval always calls the latest version
  const processNextRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // webkitdirectory / directory no son props estándar de React: se setean como
  // propiedades del DOM para que el input "subir carpeta" funcione.
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.webkitdirectory = true;
      folderInputRef.current.directory = true;
    }
  }, []);

  // Auto-cerrar los toasts de error (7s) y de éxito (6s) para que no queden "colgados".
  useEffect(() => {
    if (status.state !== 'error' && status.state !== 'done') return;
    const ms = status.state === 'error' ? 7000 : 6000;
    const t = setTimeout(() => {
      setStatus(s => ((s.state === 'error' || s.state === 'done') ? { state: 'idle', message: '', label: '', progress: 0 } : s));
    }, ms);
    return () => clearTimeout(t);
  }, [status.state, status.message]);

  const startPolling = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/ingest/status');
        const s = await r.json();
        if (s.state === 'error') s.message = humanizeError(s.message);
        setStatus(s);
        if (s.state === 'done') {
          clearInterval(pollRef.current);
          if (ingestModeRef.current === 'url') {
            // URL: no hay cola de archivos → usar el mensaje del backend (cuenta los
            // videos de la playlist, p.ej. "8 de 12 videos…") + limpiar el input.
            ingestModeRef.current = 'file';
            setUrl('');
            onRefreshRef.current?.();
            setStatus({ state: 'done', message: s.message || 'Documento incorporado al grafo.', label: '', progress: 100 });
          } else {
            processNextRef.current?.();
          }
        }
        if (s.state === 'error') {
          clearInterval(pollRef.current);
          ingestModeRef.current = 'file';
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
      setFileNames([]);   // limpiar el chip del archivo (ya no "queda pegado")
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
    setQueueInfo({ current: idx + 1, total: queue.length, name: queue[idx]?.name });
    await sendFile(queue[idx], skipUmap);
  }, [sendFile, onRefresh]);

  // Always keep processNextRef current
  processNextRef.current = processNext;

  const startFiles = useCallback(async (files) => {
    ingestModeRef.current = 'file';
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

  // Carga masiva: al elegir una carpeta, el navegador entrega TODOS sus archivos
  // (recursivo). Filtramos a los tipos soportados y los mandamos a la misma cola.
  const handleFolderChange = useCallback(e => {
    const all = Array.from(e.target.files || []);
    e.target.value = '';
    if (!all.length) return;
    const files = all.filter(f => isSupported(f.name));
    if (!files.length) {
      setStatus({
        state: 'error', label: '', progress: 0,
        message: `La carpeta (${all.length} archivo${all.length > 1 ? 's' : ''}) no tiene formatos compatibles`,
      });
      return;
    }
    setFileNames(files.map(f => f.name));
    setUrl('');
    startFiles(files);
  }, [startFiles]);

  const handleUrlSubmit = useCallback(e => {
    e.preventDefault();
    const val = url.trim();
    if (!val) return;
    setFileNames([]);
    setQueueInfo(null);
    ingestModeRef.current = 'url';   // el polling, al ver 'done', limpia la URL y avisa bien
    sendUrl(val);
  }, [url, sendUrl]);

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
      {(isProcessing || isDone || isError) && (
        <ProgressToast status={status} queueInfo={queueInfo} onCancel={reset} />
      )}

      <div className={`ingest-panel${inline ? ' ingest-panel--inline' : ''}`}>
        <label
          className={`ingest-drop${dragOver ? ' drag-over' : ''}${isProcessing ? ' disabled' : ''}`}
          onDragOver={isProcessing ? undefined : onDragOver}
          onDragLeave={isProcessing ? undefined : onDragLeave}
          onDrop={isProcessing ? undefined : onDrop}
        >
          <input
            type="file"
            accept={ACCEPT_ATTR}
            style={{ display: 'none' }}
            onChange={handleFileChange}
            disabled={isProcessing}
            multiple
          />
          <span className="ingest-drop-label">{dropLabel}</span>
        </label>

        {/* Carga masiva por carpeta (filtra a formatos soportados y los encola) */}
        <input
          ref={folderInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFolderChange}
          disabled={isProcessing}
          multiple
        />
        <button
          type="button"
          className="ingest-folder-btn"
          onClick={() => folderInputRef.current?.click()}
          disabled={isProcessing}
        >
          📁 Cargar una carpeta entera
        </button>

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

        {/* El estado (procesando / listo / error) se muestra en el toast flotante,
            visible incluso con la Biblioteca cerrada. */}
      </div>
    </>
  );
}
