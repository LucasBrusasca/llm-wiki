/**
 * Aristas de los grafos, las MISMAS en 2D y en 3D: misma fuente (las relaciones que
 * devuelve /api/graph, sin grafo propio por vista), mismo criterio de cuáles se
 * dibujan y mismo peso visual. Cada vista traduce el estilo a su motor (px en React
 * Flow, unidades de escena en three.js).
 */

/** Aristas por nodo que cuentan como "fuertes": las que se ven sin elegir nada. */
export const K_FUERTES = 2;

/** Top-K por nodo (unión): el grafo queda conectado sin telaraña. */
export function podar(edges, k) {
  const por = new Map();
  for (const e of edges) {
    for (const id of [e.source, e.target]) {
      if (!por.has(id)) por.set(id, []);
      por.get(id).push(e);
    }
  }
  const keep = new Set();
  for (const arr of por.values()) {
    arr.sort((a, b) => (b.score || 0) - (a.score || 0));
    arr.slice(0, k).forEach((e) => keep.add(e));
  }
  return edges.filter((e) => keep.has(e));
}

/** Las relaciones entre nodos visibles, cada una marcada como fuerte o no. */
export function aristasVisibles(edges, visibleIds) {
  const ve = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  const fuertes = new Set(podar(ve, K_FUERTES));
  return ve.map((e) => ({ ...e, fuerte: fuertes.has(e) }));
}

export const extremos = (a) => [a.source?.id ?? a.source, a.target?.id ?? a.target];

export const esArista = (a, pin) => {
  if (!pin) return false;
  const [s, t] = extremos(a);
  return s === pin.source && t === pin.target && a.label === pin.label;
};

/**
 * Qué se dibuja y cómo. Sin nada elegido: sólo las fuertes. Con un elegido: además
 * todas las suyas, en acento, y el resto se apaga. Vínculo fijado: esa arista a
 * pleno y lo demás casi invisible. Vecindario: sus aristas internas. Hover sobre un
 * nodo: sus aristas se encienden (aunque sean débiles) y el resto se atenúa.
 * `todas`: también las débiles, a media opacidad.
 *
 * Devuelve { visible, acento, alfa, grosor } con grosor ∈ (0, 1]: 1 = vínculo
 * fijado; el resto sigue al score (0.6 → fino, ≥0.9 → más grueso) y las débiles
 * van un 30 % más finas.
 */
export function estiloArista(a, { selectedId, pin, ego, hoverId, todas = false }) {
  const [s, t] = extremos(a);
  const propia = !!selectedId && (s === selectedId || t === selectedId);
  const fijada = esArista(a, pin);
  const enEgo = !!ego && ego.ids.has(s) && ego.ids.has(t);
  const hover = hoverId && hoverId !== selectedId ? hoverId : null;
  const delHover = !!hover && (s === hover || t === hover);

  const visible = propia || enEgo || fijada || delHover || !!a.fuerte || todas;
  let acento = false;
  let alfa;
  if (fijada) { acento = true; alfa = 1; }
  else if (ego) {
    if (!enEgo) alfa = 0.07;
    else if (propia && !pin) { acento = true; alfa = 0.8; }
    else alfa = pin ? 0.3 : 0.6;
  } else if (pin) alfa = propia ? 0.3 : 0.08;
  else if (propia) { acento = true; alfa = 0.8; }
  else alfa = selectedId ? 0.18 : 0.5;

  // Débiles opcionales: presentes, pero a media voz.
  if (!a.fuerte && !propia && !enEgo && !fijada) alfa *= 0.5;
  if (hover) {
    if (delHover) { acento = true; alfa = Math.max(alfa, 0.7); }
    else alfa *= 0.35;
  }

  const n = Math.max(0, Math.min(1, ((a.score || 0) - 0.6) / 0.3));
  const grosor = fijada ? 1 : (0.55 + 0.45 * n) * (a.fuerte ? 1 : 0.7);
  return { visible, acento, alfa, grosor, fijada, propia, delHover };
}
