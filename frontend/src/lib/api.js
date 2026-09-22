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

export function deleteSection(nombre, password) {
  return fetch('/api/sections/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, password }),
  });
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

export async function askAgent({ system, messages }) {
  return fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages }),
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
