// ── Descubrimientos ────────────────────────────────────────────────────────
// Hallazgos calculados 100% sobre los datos del grafo (embeddings + estructura).
// SIN LLM: la confianza sale de números reales (coseno, estructura), no de una
// "corazonada" del modelo. Tres tipos: Puente, Hueco, Aislado.

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const ends = l => [l.source?.id ?? l.source, l.target?.id ?? l.target];
const trunc = (s, n = 40) => (s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''));

// Grupo de un nodo: el TEMA de la taxonomía LLM manda (nombre ya legible);
// fallback al cluster HDBSCAN con su concepto dominante como nombre.
function makeGrouper(docs) {
  // Nombre legible por cluster (solo para el fallback sin tema).
  const groups = {};
  docs.forEach(n => { if (n.cluster != null && n.cluster >= 0) (groups[n.cluster] ??= []).push(n); });
  const clusterName = {};
  Object.entries(groups).forEach(([cid, members]) => {
    const freq = {};
    members.forEach(n => (n.conceptos || []).forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    clusterName[cid] = top ? top[0] : `Grupo ${cid}`;
  });
  return n => {
    if (n.tema && n.tema !== 'Sin clasificar') return n.tema;
    if (n.cluster != null && n.cluster >= 0) return clusterName[n.cluster];
    return null; // sin grupo
  };
}

// Nodos AISLADOS: su mejor parecido (coseno) con cualquier otro es bajo → tema suelto.
function findAislados(docs, adj) {
  const out = [];
  docs.forEach(n => {
    let maxCos = 0, mejor = null;
    docs.forEach(m => {
      if (m.id === n.id) return;
      const c = cosine(n.embedding, m.embedding);
      if (c > maxCos) { maxCos = c; mejor = m; }
    });
    const deg = adj.get(n.id)?.size || 0;
    if (maxCos < 0.5 || deg === 0) {
      out.push({
        tipo: 'aislado', nodeIds: [n.id], titulo: n.label,
        texto: `"${trunc(n.label)}" casi no se conecta con el resto — su mejor parecido es ${Math.round(maxCos * 100)}%${mejor ? ` (con "${trunc(mejor.label, 28)}")` : ''}. ¿Tema suelto o falta material que lo enganche?`,
        confianza: Math.max(0, Math.min(1, 1 - maxCos)),
        mecanismo: 'estructural',
      });
    }
  });
  return out.sort((a, b) => b.confianza - a.confianza).slice(0, 5);
}

// PUENTES (transversales): los POCOS nodos que tocan más TEMAS distintos. En un corpus
// disperso es un cuello de botella; en uno denso, tu documento más interdisciplinario.
// Mostramos solo el top — no "casi todos lo son".
function findPuentes(docs, byId, adj, groupOf) {
  const totalGrupos = new Set(docs.map(groupOf).filter(Boolean)).size;
  const scored = [];
  docs.forEach(n => {
    const propio = groupOf(n);
    if (!propio) return;
    const otros = new Set();
    adj.get(n.id)?.forEach(mid => {
      const m = byId.get(mid);
      const g = m && groupOf(m);
      if (g && g !== propio) otros.add(g);
    });
    if (otros.size >= 2) scored.push({ n, span: otros.size, otros: [...otros] });
  });
  scored.sort((a, b) => b.span - a.span);
  return scored.slice(0, 3).map(({ n, span, otros }) => {
    const nombres = otros.map(g => `"${g}"`).slice(0, 3).join(' · ');
    return {
      tipo: 'puente', nodeIds: [n.id], titulo: n.label,
      texto: `"${trunc(n.label)}" toca ${span} temas distintos (${nombres}) — es de tus documentos más transversales, conecta temas que casi no se hablan entre sí.`,
      confianza: Math.min(1, (span / Math.max(2, totalGrupos)) * 0.9 + 0.1),
      mecanismo: 'estructural',
    };
  });
}

// TEMAS DESCONECTADOS: pares de temas sin NINGUNA arista entre sí. Señal honesta de
// silos en tu conocimiento (o de que simplemente no se tocan — vos juzgás).
function findTemasAislados(docs, adj, groupOf) {
  const porGrupo = {};
  docs.forEach(n => { const g = groupOf(n); if (g) (porGrupo[g] ??= []).push(n); });
  const grupos = Object.keys(porGrupo).filter(g => porGrupo[g].length >= 3);
  if (grupos.length < 2) return [];
  // matriz de contacto entre grupos
  const contacto = {};
  docs.forEach(n => {
    const gn = groupOf(n);
    if (!gn) return;
    adj.get(n.id)?.forEach(mid => {
      const m = docs.find(d => d.id === mid);
      const gm = m && groupOf(m);
      if (gm && gm !== gn) { (contacto[gn] ??= new Set()).add(gm); }
    });
  });
  const out = [];
  grupos.forEach(g => {
    const vecinos = contacto[g]?.size || 0;
    if (vecinos === 0) {
      out.push({
        tipo: 'silo', nodeIds: porGrupo[g].map(n => n.id), titulo: g,
        texto: `El tema "${g}" (${porGrupo[g].length} docs) no tiene NINGUNA relación con otros temas — es un silo. ¿Falta el documento que lo conecte con el resto de tu conocimiento?`,
        confianza: Math.min(1, 0.5 + porGrupo[g].length * 0.06),
        mecanismo: 'estructural',
      });
    }
  });
  return out.slice(0, 2);
}

// HUECOS: conceptos mencionados por varios documentos pero sin un nodo dedicado al tema.
function findHuecos(docs) {
  const freq = {};
  docs.forEach(n => (n.conceptos || []).forEach(c => {
    const k = c.toLowerCase().trim();
    (freq[k] ??= { count: 0, label: c }).count++;
  }));
  const labelsLower = docs.map(n => (n.label || '').toLowerCase());
  const out = [];
  Object.values(freq).forEach(({ count, label }) => {
    if (count < 3) return;
    const lc = label.toLowerCase();
    if (labelsLower.some(L => L.includes(lc))) return; // ya hay un doc dedicado
    out.push({
      tipo: 'hueco', nodeIds: [], concepto: label, titulo: label,
      texto: `Mencionás "${label}" en ${count} documentos, pero ninguno trata específicamente ese tema. Posible hueco para llenar.`,
      confianza: Math.min(1, 0.4 + count * 0.08),
      mecanismo: 'estructural',
    });
  });
  return out.sort((a, b) => b.confianza - a.confianza).slice(0, 4);
}

export function computeDiscoveries(nodes, links) {
  const docs = (nodes || []).filter(n => !n.is_issue && !n.is_centroid);
  if (docs.length < 3) return [];
  const byId = new Map(docs.map(n => [n.id, n]));
  const adj = new Map(docs.map(n => [n.id, new Set()]));
  (links || []).forEach(l => {
    const [s, t] = ends(l);
    if (adj.has(s) && adj.has(t)) { adj.get(s).add(t); adj.get(t).add(s); }
  });
  const groupOf = makeGrouper(docs);
  return [
    ...findPuentes(docs, byId, adj, groupOf),
    ...findTemasAislados(docs, adj, groupOf),
    ...findHuecos(docs),
    ...findAislados(docs, adj),
  ];
}
