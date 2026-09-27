/**
 * Capa de acceso a la API de Algedi.
 *
 * El backend responde en español: `/api/graph` devuelve `{ nodos, relaciones }`.
 * Todo el resto de la UI consume lo que sale de acá, así que este archivo es el
 * único lugar que conoce esos nombres. (El rediseño anterior asumió `documents`
 * y dejó la biblioteca vacía: no repetir eso.)
 */

async function jsonOrThrow(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSections() {
  const d = await fetch('/api/sections').then(jsonOrThrow);
  return Array.isArray(d.secciones) ? d.secciones : [];
}

/**
 * Grafo de una sección. Devuelve nodos SIN el embedding (384 floats x N nodos
 * son ~1MB de basura que nada en la UI usa) y con x/y/z listos para el lienzo.
 * Si el backend no está (ej. GitHub Pages), cae al snapshot estático de demo.
 */
export async function fetchGraph(seccion, { signal } = {}) {
  let data;
  try {
    data = await fetch(`/api/graph?seccion=${encodeURIComponent(seccion)}`, { signal })
      .then(jsonOrThrow);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    data = await fetch(`${import.meta.env.BASE_URL}demo-graph.json`, { signal }).then(jsonOrThrow);
  }
  return normalizeGraph(data);
}

const SCALE = 250;

export function normalizeGraph(data) {
  const nodes = (data?.nodos || []).map((n) => {
    const { embedding, ...resto } = n;              // fuera el embedding
    return {
      ...resto,
      tags: Array.isArray(n.tags) ? n.tags : [],
      conceptos: Array.isArray(n.conceptos) ? n.conceptos : [],
      x: (n.x3d ?? 0) * SCALE,
      y: (n.y3d ?? 0) * SCALE,
      z: (n.z3d ?? 0) * SCALE,
    };
  });
  const edges = (data?.relaciones || []).map((r) => ({
    source: r.source?.id ?? r.source,
    target: r.target?.id ?? r.target,
    score: r.score ?? 0,
    label: r.label || 'RELACIONADO_CON',
    description: r.description || '',
    shared_concepts: Array.isArray(r.shared_concepts) ? r.shared_concepts : [],
    metodo: r.metodo,
    base_relacion: r.base_relacion,
    evidencia: r.evidencia || null,
    is_manual: !!r.is_manual,
    revision: r.revision || null,
  }));
  return { nodes, edges };
}

/** Renombrar / eliminar sección. Devuelve el Response para que el llamador vea el 403. */
export function renameSection(from, to, password) {
  return fetch('/api/sections/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, password }),
  });
}

/** Borrar una sección. `password` sólo hace falta si la sección tiene documentos. */
export function deleteSection(nombre, password) {
  return fetch('/api/sections/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, password }),
  });
}

// ── Notas, tablas y ejecución ─────────────────────────────────────────
/** Crea una nota (nodo NOTA) en una sección. */
export async function crearNota({ label, desc = '', seccion, tags = [] }) {
  const d = await fetch('/api/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, desc, seccion, tags }),
  }).then(jsonOError);
  return d.node;
}

/** Grilla de sólo lectura de un xlsx/xls/csv ligado a un nodo. */
export async function fetchTabla(nodeId, { hoja, limite = 200, stats = false } = {}) {
  const q = new URLSearchParams({ limite: String(limite), stats: String(stats) });
  if (hoja) q.set('hoja', hoja);
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/table?${q}`).then(jsonOError);
}

/**
 * Ejecuta el script del nodo. Sin `confirm` sólo PROPONE: devuelve el plan (qué corre,
 * qué versión, con qué datos y límites). Con `confirm` corre la `version` propuesta; si
 * el código cambió desde la propuesta, el backend responde 409 y no corre nada.
 */
export async function ejecutarArchivo(nodeId, confirm = false, { version, origen = 'ui' } = {}) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm, version, origen }),
  }).then(jsonOError);
}

/** Corridas de un nodo (completas) y la versión actual de su código. */
export async function fetchEjecuciones(nodeId, limit = 5) {
  const d = await fetch(`/api/node/${encodeURIComponent(nodeId)}/runs?limit=${limit}`).then(jsonOError);
  return { versionActual: d.version_actual || null, runs: d.runs || [] };
}

// ── Workbench: scripts y datos como nodos ─────────────────────────────
/** Log de corridas (scripts y consultas) de una sección, las más nuevas primero. */
export async function fetchCorridas(seccion, limit = 50) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (seccion) q.set('seccion', seccion);
  const d = await fetch(`/api/runs?${q}`).then(jsonOError);
  return d.runs || [];
}

/** Una corrida con su salida completa y el plan que se confirmó. */
export async function fetchCorrida(id) {
  return fetch(`/api/runs/${encodeURIComponent(id)}`).then(jsonOError);
}

/** Crea un script-nodo (archivo + nodo SCRIPT) en la sección. */
export async function crearScript({ nombre, seccion, codigo }) {
  return fetch('/api/workbench/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, seccion, codigo }),
  }).then(jsonOError);
}

export async function fetchCodigo(nodeId) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/codigo`).then(jsonOError);
}

/**
 * Guarda el código. `versionBase` evita pisar un cambio ajeno (409). Si el archivo vive
 * en el vault del usuario, la primera llamada devuelve `needs_confirmation`.
 */
export async function guardarCodigo(nodeId, { codigo, versionBase, confirm = false }) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/codigo`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo, version_base: versionBase, confirm }),
  }).then(jsonOError);
}

export async function fetchEsquema(nodeId) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/esquema`).then(jsonOError);
}

/** SQL de sólo lectura sobre un nodo de datos. Una base SQLite real pide `confirm`. */
export async function consultarDatos(nodeId, { sql, confirm = false, limite = 200 }) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/consulta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, confirm, limite }),
  }).then(jsonOError);
}

// ── Edición manual ────────────────────────────────────────────────────
async function jsonOError(res) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.detail || `HTTP ${res.status}`);
  return d;
}

/** Título, autor y tema de un nodo. Devuelve el nodo actualizado. */
export async function updateNode(nodeId, campos) {
  const d = await fetch(`/api/node/${encodeURIComponent(nodeId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(campos),
  }).then(jsonOError);
  return d.node;
}

export async function moveNodes(ids, seccion) {
  return fetch('/api/nodes/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, seccion }),
  }).then(jsonOError);
}

/** Crea una sección que persiste aunque esté vacía. */
export async function createSection(nombre) {
  return fetch('/api/sections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre }),
  }).then(jsonOError);
}

/**
 * Taxonomía de temas por LLM (endpoint existente). Sin `apply` sólo PROPONE y no
 * escribe nada; con `apply` persiste `tema` en TODOS los documentos (todas las
 * secciones), por eso va con clave si la seguridad está activa.
 */
export async function proponerTaxonomia() {
  return fetch('/api/taxonomy', { method: 'POST' }).then(jsonOrThrow);
}

export function aplicarTaxonomia(password) {
  return fetch('/api/taxonomy?apply=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

export async function searchSemantic(q, max = 24) {
  const d = await fetch(`/api/search?q=${encodeURIComponent(q)}&max_n=${max}`).then(jsonOrThrow);
  return Array.isArray(d.ids) ? d.ids : [];
}

/**
 * Pregunta al agente. Con `seccion` (y el documento que se está mirando) el agente
 * puede reconocer un pedido de acción ("corré limpieza.py") y devolver una propuesta
 * con plan en `accion`, que la UI muestra para confirmar: el agente nunca ejecuta solo.
 */
export async function askAgent({ system, messages, seccion, contextoId }) {
  return fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, seccion, contexto_id: contextoId }),
  }).then(jsonOrThrow);
}

export async function setNodeTags(nodeId, tags) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  }).then(jsonOrThrow);
}

export async function deleteNode(nodeId, password) {
  const qs = password ? `?password=${encodeURIComponent(password)}` : '';
  return fetch(`/api/node/${encodeURIComponent(nodeId)}${qs}`, { method: 'DELETE' }).then(jsonOrThrow);
}

// ── Ingesta ───────────────────────────────────────────────────────────
export async function ingestFile(file, seccion, { skipUmap = false } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('seccion', seccion);
  fd.append('skip_umap', String(skipUmap));
  return fetch('/api/ingest', { method: 'POST', body: fd }).then(jsonOrThrow);
}

export async function ingestUrls(urls, seccion) {
  const fd = new FormData();
  fd.append('url', urls);
  fd.append('seccion', seccion);
  return fetch('/api/ingest', { method: 'POST', body: fd }).then(jsonOrThrow);
}

export async function ingestStatus() {
  return fetch('/api/ingest/status').then(jsonOrThrow);
}

// ── Jobs (ingesta en background) ──────────────────────────────────────
export async function createJob(file, seccion) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('seccion', seccion);
  return fetch('/api/jobs', { method: 'POST', body: fd }).then(jsonOrThrow);
}

export async function createUrlJob(url, seccion) {
  const fd = new FormData();
  fd.append('url', url);
  fd.append('seccion', seccion);
  return fetch('/api/jobs', { method: 'POST', body: fd }).then(jsonOrThrow);
}

export async function getActiveJobs() {
  return fetch('/api/jobs/active').then(jsonOrThrow);
}

export async function getJob(jobId) {
  return fetch(`/api/jobs/${encodeURIComponent(jobId)}`).then(jsonOrThrow);
}

export async function retryJob(jobId) {
  return fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }).then(jsonOrThrow);
}

export async function cancelJob(jobId) {
  return fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).then(jsonOrThrow);
}

// ── Scripts (registry versionado — contrato a preservar) ──────────────
export async function fetchScripts() {
  const d = await fetch('/api/scripts').then(jsonOrThrow);
  return { scripts: d.scripts || [], version: d.version, count: d.count || 0 };
}

export async function fetchScriptRuns(limit = 20) {
  const d = await fetch(`/api/scripts/runs?limit=${limit}`).then(jsonOrThrow);
  return d.runs || [];
}

export async function proposeScripts({ query = '', nodeIds = [], limit = 3 }) {
  const d = await fetch('/api/scripts/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, node_ids: nodeIds, limit }),
  }).then(jsonOrThrow);
  return d.proposals || [];
}

export async function runScript({ scriptId, inputs = {}, confirm = false, contextNodeIds = [] }) {
  return fetch('/api/scripts/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script_id: scriptId, inputs, confirm, context_node_ids: contextNodeIds,
    }),
  }).then(jsonOrThrow);
}

export async function createScriptNode({ scriptId, seccion, linkTo = [] }) {
  return fetch('/api/scripts/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script_id: scriptId, seccion, link_to_nodes: linkTo }),
  }).then(jsonOrThrow);
}
