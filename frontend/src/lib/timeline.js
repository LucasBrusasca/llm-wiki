/** Fecha con la que el grafo reconstruye el pasado: cuándo Algedi supo del nodo. */
export function fechaNodo(n) {
  return n?.known_since || n?.creado || n?.created_at || null;
}

export function rangoFechas(nodes) {
  const d = (nodes || [])
    .map(fechaNodo)
    .filter(Boolean)
    .map((s) => new Date(s).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (!d.length) return null;
  return { min: d[0], max: d[d.length - 1] };
}

/** ids visibles cuya fecha es ≤ cutoff. Sin fecha, el nodo queda (no sabemos cuándo nació). */
export function idsHasta(visibleIds, nodes, cutoffIso) {
  if (!cutoffIso) return visibleIds;
  const cutoff = new Date(cutoffIso).getTime();
  if (Number.isNaN(cutoff)) return visibleIds;
  const byId = nodes instanceof Map ? nodes : new Map((nodes || []).map((n) => [n.id, n]));
  const out = new Set();
  for (const id of visibleIds) {
    const n = byId.get(id);
    if (!n) continue;
    const t = fechaNodo(n);
    if (!t || new Date(t).getTime() <= cutoff) out.add(id);
  }
  return out;
}

export function nodoHasta(n, cutoffIso) {
  if (!cutoffIso) return true;
  const t = fechaNodo(n);
  if (!t) return true;
  const cutoff = new Date(cutoffIso).getTime();
  return Number.isNaN(cutoff) || new Date(t).getTime() <= cutoff;
}
