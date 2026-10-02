/**
 * Plantas de habitaciones para el grafo de grafos: el edificio (cada sección es una
 * habitación) y cada sección (cada tema es una habitación). El tamaño de una
 * habitación sigue a lo que contiene; el reparto busca habitaciones lo más cuadradas
 * posible (treemap «squarified», Bruls et al.) y deja paredes entre ellas.
 *
 * Lógica pura, sin React.
 */

const peorProporcion = (fila, lado) => {
  const suma = fila.reduce((a, r) => a + r.area, 0);
  let max = 0;
  let min = Infinity;
  for (const r of fila) { max = Math.max(max, r.area); min = Math.min(min, r.area); }
  return Math.max((lado * lado * max) / (suma * suma), (suma * suma) / (lado * lado * min));
};

/** Reparte `items` ({ area }) en el rectángulo, de mayor a menor, en filas a lo largo
 *  del lado corto: cada fila crece mientras no empeore la proporción. */
function squarify(items, x, y, w, h) {
  const out = [];
  let resto = items;
  while (resto.length) {
    const lado = Math.min(w, h);
    let n = 1;
    while (n < resto.length && peorProporcion(resto.slice(0, n + 1), lado) <= peorProporcion(resto.slice(0, n), lado)) n += 1;
    const fila = resto.slice(0, n);
    const suma = fila.reduce((a, r) => a + r.area, 0);
    if (w >= h) {
      const ancho = suma / h;
      let yy = y;
      for (const r of fila) { const alto = r.area / ancho; out.push({ ...r, x, y: yy, w: ancho, h: alto }); yy += alto; }
      x += ancho; w -= ancho;
    } else {
      const alto = suma / w;
      let xx = x;
      for (const r of fila) { const ancho = r.area / alto; out.push({ ...r, x: xx, y, w: ancho, h: alto }); xx += ancho; }
      y += alto; h -= alto;
    }
    resto = resto.slice(n);
  }
  return out;
}

/**
 * Planta: las habitaciones (`{ key, peso }`) repartidas en un rectángulo de
 * `ancho` × `alto`, con `pared` de separación. Ninguna queda más chica que `minimo`
 * del total (una sección vacía también es una habitación). Devuelve key → { x, y, w, h }.
 */
export function planta(items, { ancho = 1600, alto = 1000, pared = 40, minimo = 0.06 } = {}) {
  if (!items.length) return new Map();
  const total = items.reduce((a, i) => a + (i.peso || 0), 0) || 1;
  const pesos = items.map((i) => ({ key: i.key, p: Math.max(i.peso || 0, total * minimo) }));
  const suma = pesos.reduce((a, i) => a + i.p, 0);
  const area = ancho * alto;
  const orden = pesos
    .map((i) => ({ key: i.key, area: (i.p / suma) * area }))
    .sort((a, b) => b.area - a.area || a.key.localeCompare(b.key));
  const media = pared / 2;
  return new Map(squarify(orden, 0, 0, ancho, alto).map((r) => [r.key, {
    x: r.x + media, y: r.y + media, w: Math.max(r.w - pared, 1), h: Math.max(r.h - pared, 1),
  }]));
}

/** La pared del fondo de una habitación vista de frente (la caja del teseracto): el
 *  marco hacia adentro, con algo menos de profundidad arriba y abajo. */
export function fondoDe(w, h) {
  const d = Math.min(w, h) * 0.14;
  return { x: d, y: d * 0.8, w: Math.max(w - 2 * d, 1), h: Math.max(h - 1.6 * d, 1) };
}

/** Puntos (x, y) llevados al rectángulo `r` conservando su forma, con margen. */
export function encajar(puntos, r, margen = 0.08) {
  if (!puntos.length) return [];
  const xs = puntos.map((p) => p.x);
  const ys = puntos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const mw = r.w * margen;
  const mh = r.h * margen;
  const escala = Math.min((r.w - 2 * mw) / Math.max(x1 - x0, 1), (r.h - 2 * mh) / Math.max(y1 - y0, 1));
  const ox = r.x + (r.w - (x1 - x0) * escala) / 2;
  const oy = r.y + (r.h - (y1 - y0) * escala) / 2;
  return puntos.map((p) => ({ ...p, x: ox + (p.x - x0) * escala, y: oy + (p.y - y0) * escala }));
}

/** Viewport que encuadra un rectángulo en un lienzo de W×H, con margen en px. */
export function encuadre({ x, y, w, h }, W, H, { aire = 40, arriba = 56, maxZoom = 1.5 } = {}) {
  const zoom = Math.min((W - 2 * aire) / Math.max(w, 1), (H - arriba - aire) / Math.max(h, 1), maxZoom);
  return {
    zoom,
    x: (W - w * zoom) / 2 - x * zoom,
    y: arriba + (H - arriba - aire - h * zoom) / 2 - y * zoom,
  };
}
