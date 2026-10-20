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
  // «Todas las secciones» ('*'): el grafo sin filtro de sección.
  const q = seccion && seccion !== '*' ? `?seccion=${encodeURIComponent(seccion)}` : '';
  try {
    data = await fetch(`/api/graph${q}`, { signal })
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
  // Documentos de OTRAS secciones relacionados con esta: no son parte del grafo de la
  // sección (no se dibujan), sólo se nombran en el panel y se abren cambiando de sección.
  const externos = (data?.externos || []).map((n) => ({ ...n, externo: true, conceptos: [], tags: [] }));
  return { nodes, edges, externos };
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
export async function ejecutarArchivo(nodeId, confirm = false, {
  version, origen = 'ui', parametros, pedido, decision,
} = {}) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm, version, origen, parametros, pedido, decision }),
  }).then(jsonOError);
}

// ── Explorador de datos ───────────────────────────────────────────────

/** Modelo de una fuente de datos: tablas, campos (tipo, clave, a qué apuntan) y relaciones. */
export async function fetchModelo(nodeId, { fresco = false } = {}) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/modelo${fresco ? '?fresco=true' : ''}`).then(jsonOError);
}

/** Tabla dinámica (formato largo + el SQL que se corrió). */
export async function pivotDatos(nodeId, spec) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/pivot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec }),
  }).then(jsonOError);
}

/** Relación marcada a mano entre dos campos ({desde: {tabla, columna}, hacia: …}). */
export async function agregarRelacionModelo(nodeId, rel) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/modelo/relaciones`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rel),
  }).then(jsonOError);
}

export async function quitarRelacionModelo(nodeId, rel) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/modelo/relaciones`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rel),
  }).then(jsonOError);
}

/** Guarda una tabla dinámica como nodo REPORTE. */
export async function crearReporte({ datos, titulo, spec, vista, tipo }) {
  return fetch('/api/reportes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ datos, titulo, spec, vista, tipo }),
  }).then(jsonOError);
}

/** Un reporte corrido con los datos de hoy: { reporte, datos, resultado }. Con
 *  `actualizar` la corrida queda anotada en Corridas. */
export async function fetchReporte(id, { actualizar = false } = {}) {
  return fetch(`/api/reportes/${encodeURIComponent(id)}${actualizar ? '?actualizar=true' : ''}`).then(jsonOError);
}

// ── Posibles duplicados ─────────────────────────────────────────────────
export async function fetchDuplicados() {
  const d = await fetch('/api/duplicados').then(jsonOError);
  return d.grupos || [];
}

export async function resolverDuplicados({ conservar, descartar }) {
  return fetch('/api/duplicados/resolver', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conservar, descartar }),
  }).then(jsonOError);
}

export async function noSonDuplicados(clave) {
  return fetch('/api/duplicados/no-son', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave }),
  }).then(jsonOError);
}

/** Vuelve a leer la fuente de un nodo y lo actualiza en el lugar (encola un job). */
export async function reprocesarNodo(id) {
  return fetch(`/api/node/${encodeURIComponent(id)}/reprocesar`, { method: 'POST' }).then(jsonOError);
}

/** Lo que tiene una sección, liviano: [{id, label, type, fuente, ext}]. */
export async function fetchContenidoSeccion(seccion) {
  const d = await fetch(`/api/sections/${encodeURIComponent(seccion)}/contenido`).then(jsonOError);
  return d.nodos || [];
}

// ── Nodo «Pregunta» (RAG como nodo) ─────────────────────────────────────
/** Guarda una pregunta como nodo y trae su evidencia (sin LLM, en segundos). */
export async function crearPregunta({ pregunta, alcance, dominio }) {
  return fetch('/api/preguntas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pregunta, alcance, dominio }),
  }).then(jsonOError);
}

/** { node, pregunta: {pregunta, alcance, pasajes, semaforo, corrida, respuesta}, documentos_nuevos } */
export async function fetchPregunta(id) {
  return fetch(`/api/preguntas/${encodeURIComponent(id)}`).then(jsonOError);
}

/** Vuelve a buscar la evidencia; `alcance` opcional ('*' = todas las secciones). */
export async function actualizarPregunta(id, alcance) {
  return fetch(`/api/preguntas/${encodeURIComponent(id)}/actualizar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alcance ? { alcance } : {}),
  }).then(jsonOError);
}

/** El LLM redacta la respuesta con la evidencia guardada (tarda minutos en CPU). */
export async function redactarPregunta(id) {
  return fetch(`/api/preguntas/${encodeURIComponent(id)}/redactar`, { method: 'POST' }).then(jsonOError);
}

/** Verifica la procedencia de un chunk (rehashea la fuente y compara). */
export async function verificarChunk(chunkId) {
  return fetch(`/api/chunk/${encodeURIComponent(chunkId)}/verify`).then(jsonOError);
}

/** Nodos de datos de todas las secciones. */
export async function fetchFuentesDatos() {
  const d = await fetch('/api/fuentes-datos').then(jsonOError);
  return d.fuentes || [];
}

/** Parámetros de una herramienta (de su ficha) y los valores válidos: tablas y columnas. */
export async function fetchParametros(nodeId) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/parametros`).then(jsonOError);
}

/** Corridas de un nodo (completas) y la versión actual de su código. */
export async function fetchEjecuciones(nodeId, limit = 5) {
  const d = await fetch(`/api/node/${encodeURIComponent(nodeId)}/runs?limit=${limit}`).then(jsonOError);
  return { versionActual: d.version_actual || null, runs: d.runs || [] };
}

// ── Scripts y datos como nodos ────────────────────────────────────────
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

/** Bases Postgres configuradas en el backend (sin la clave) y, si ya están en el grafo
 *  de la sección, su nodo. */
export async function fetchConexiones(seccion) {
  const q = new URLSearchParams({ seccion: seccion || 'personal' });
  const d = await fetch(`/api/workbench/conexiones?${q}`).then(jsonOError);
  return d.conexiones || [];
}

/** Suma una base Postgres configurada como nodo de datos de la sección. */
export async function agregarConexion(nombre, seccion) {
  return fetch(`/api/workbench/conexiones/${encodeURIComponent(nombre)}/nodo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seccion }),
  }).then(jsonOError);
}

/** SQL de sólo lectura sobre un nodo de datos. Una base real (SQLite o Postgres) pide `confirm`. */
export async function consultarDatos(nodeId, { sql, limite = 200 }) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/consulta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, limite }),
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
/**
 * `jev`: lo que la persona eligió tocando una opción de una pregunta anterior del agente
 * ({ herramienta, parametros, pedido }); el agente no lo vuelve a decidir.
 */
export async function askAgent({ system, messages, seccion, contextoId, jev }) {
  return fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, seccion, contexto_id: contextoId, jev }),
  }).then(jsonOrThrow);
}

/** La navaja suiza: herramientas con su ficha. */
export async function fetchHerramientas() {
  const d = await fetch('/api/herramientas').then(jsonOrThrow);
  return d.herramientas || [];
}

/** Instala (o actualiza) la navaja de data science en la sección «herramientas». */
export async function instalarHerramientas({ seccion = 'herramientas', ejemplos = true } = {}) {
  return fetch('/api/herramientas/instalar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seccion, ejemplos }),
  }).then(jsonOrThrow);
}

export async function setNodeTags(nodeId, tags) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  }).then(jsonOrThrow);
}

/** Borrado directo, sin papelera (la UI usa la papelera). La clave va en el cuerpo:
 *  en la URL quedaría en los logs, y el backend la lee del cuerpo. */
export async function deleteNode(nodeId, password) {
  return fetch(`/api/node/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then(jsonOrThrow);
}

// ── Papelera ──────────────────────────────────────────────────────────
const postJson = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
}).then(jsonOError);

/** Qué se iría con estos documentos (aristas, notas, pasajes…), sin tocar nada. */
export const previaPapelera = (ids) => postJson('/api/papelera/previa', { ids });
export const moverAPapelera = (ids) => postJson('/api/papelera', { ids });
export const fetchPapelera = () => fetch('/api/papelera').then(jsonOError).then((d) => d.items || []);
export const restaurarDePapelera = (id) => postJson(`/api/papelera/${id}/restaurar`);
/** Para siempre. Pide la clave de administrador si está configurada. */
export const eliminarDePapelera = (id, password) => postJson(`/api/papelera/${id}/eliminar`, { password });
export const vaciarPapelera = (password) => postJson('/api/papelera/vaciar', { password });

/** El espacio 4D: todas las secciones con sus documentos y relaciones (liviano). */
export const fetchDimensiones = () => fetch('/api/dimensiones').then(jsonOError);

/** «Reagrupar»: rehace los temas de cada sección. Devuelve { temas_por_seccion }. */
export const reagruparTemas = () => fetch('/api/recompute-layout', { method: 'POST' }).then(jsonOError);

/** Recalcula todas las relaciones (también entre secciones); conserva las decisiones a mano. */
export const recalcularRelaciones = () => fetch('/api/recompute-relations', { method: 'POST' }).then(jsonOError);

/** El mismo tema para varios documentos (vacío = sin tema). */
export const temaNodos = (ids, tema) => postJson('/api/nodes/tema', { ids, tema });

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

/** Guarda el resultado de una corrida como nodo RESULTADO en el grafo. */
export async function saveRunAsNode(runId, { label, seccion } = {}) {
  return fetch(`/api/runs/${runId}/save-as-node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, seccion }),
  }).then(jsonOrThrow);
}

// ── Conversaciones del agente ─────────────────────────────────────────
export async function fetchConversations(seccion, limit = 50) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (seccion) q.set('seccion', seccion);
  const d = await fetch(`/api/conversations?${q}`).then(jsonOrThrow);
  return d.conversations || [];
}

export async function createConversation({ seccion, titulo, context_id }) {
  return fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seccion, titulo, context_id }),
  }).then(jsonOrThrow);
}

export async function fetchConversation(convId) {
  return fetch(`/api/conversations/${convId}`).then(jsonOrThrow);
}

export async function updateConversation(convId, { titulo }) {
  return fetch(`/api/conversations/${convId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo }),
  }).then(jsonOrThrow);
}

export async function deleteConversation(convId) {
  return fetch(`/api/conversations/${convId}`, { method: 'DELETE' }).then(jsonOrThrow);
}

export async function addConversationMessage(convId, message) {
  return fetch(`/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  }).then(jsonOrThrow);
}

export async function saveRelationsFromAnswer(convId, { message_id, pregunta }) {
  return fetch(`/api/conversations/${convId}/save-relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id, pregunta }),
  }).then(jsonOrThrow);
}

// ── Fuentes Vivas (watched sources) ───────────────────────────────────
export async function fetchWatchedSources(seccion, limit = 50) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (seccion) q.set('seccion', seccion);
  const d = await fetch(`/api/watched-sources?${q}`).then(jsonOrThrow);
  return d.sources || [];
}

export async function createWatchedSource({ url, kind = 'pdf', label, frequency_hours = 24, seccion }) {
  return fetch('/api/watched-sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, kind, label, frequency_hours, seccion }),
  }).then(jsonOrThrow);
}

export async function getWatchedSource(sourceId) {
  return fetch(`/api/watched-sources/${sourceId}`).then(jsonOrThrow);
}

export async function updateWatchedSource(sourceId, { label, frequency_hours, enabled }) {
  return fetch(`/api/watched-sources/${sourceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, frequency_hours, enabled }),
  }).then(jsonOrThrow);
}

export async function deleteWatchedSource(sourceId) {
  return fetch(`/api/watched-sources/${sourceId}`, { method: 'DELETE' }).then(jsonOrThrow);
}

export async function checkWatchedSource(sourceId) {
  return fetch(`/api/watched-sources/${sourceId}/check`, { method: 'POST' }).then(jsonOrThrow);
}

export async function markWatchedSourceSeen(sourceId) {
  return fetch(`/api/watched-sources/${sourceId}/mark-seen`, { method: 'POST' }).then(jsonOrThrow);
}

export async function getWatchedSourcesPendingCount(seccion) {
  const q = seccion ? `?seccion=${encodeURIComponent(seccion)}` : '';
  const d = await fetch(`/api/watched-sources/pending-count${q}`).then(jsonOrThrow);
  return d.count || 0;
}

export async function getWatchedSourcesRecentChanges(seccion, limit = 10) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (seccion) q.set('seccion', seccion);
  const d = await fetch(`/api/watched-sources/recent-changes?${q}`).then(jsonOrThrow);
  return d.changes || [];
}
