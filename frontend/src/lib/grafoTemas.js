/**
 * Temas del grafo de grafos: de qué tema es cada documento y cómo se relacionan.
 *
 * Cada tema es una habitación (lib/salas), y las relaciones entre documentos de temas
 * distintos se suman en una sola relación entre temas (sus puertas), con cuántas la
 * sostienen. Entrar a un tema muestra sus documentos en el mismo lugar donde estaban
 * (es acercarse, no cambiar de mapa) y los temas vecinos quedan como puertas al costado.
 *
 * Lógica pura, sin React: la usan el 2D y, más adelante, el 3D.
 */
import { temaKey } from '@/lib/temas';
import { extremos } from '@/lib/aristas';

/** Documentos visibles agrupados por tema: key → [ids], y de qué tema es cada uno. */
export function agruparPorTema(nodes, visibleIds) {
  const grupos = new Map();
  const temaDeId = new Map();
  for (const n of nodes) {
    if (!visibleIds.has(n.id)) continue;
    const k = temaKey(n);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(n.id);
    temaDeId.set(n.id, k);
  }
  return { grupos, temaDeId };
}

/** Relaciones entre temas: cada par, con cuántas relaciones entre sus documentos lo
 *  sostienen (`n`) y la suma de sus scores. Ordenadas de la más sostenida a la menos. */
export function aristasEntreTemas(edges, temaDeId) {
  const pares = new Map();
  for (const e of edges) {
    const [s, t] = extremos(e);
    const a = temaDeId.get(s);
    const b = temaDeId.get(t);
    if (!a || !b || a === b) continue;
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${x}\u0000${y}`;
    const p = pares.get(k) || { a: x, b: y, n: 0, peso: 0 };
    p.n += 1;
    p.peso += e.score || 0;
    pares.set(k, p);
  }
  return [...pares.values()].sort((p, q) => q.n - p.n || q.peso - p.peso);
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Dónde queda cada tema en el plano de documentos: la mediana de sus documentos (un
 *  documento suelto no lo corre). key → { x, y }. */
export function centrosDeTemas(grupos, centros) {
  const out = new Map();
  for (const [key, ids] of grupos) {
    const pts = ids.map((id) => centros.get(id)).filter(Boolean);
    if (pts.length) out.set(key, { x: mediana(pts.map((p) => p.x)), y: mediana(pts.map((p) => p.y)) });
  }
  return out;
}

/**
 * Al entrar a un tema: los otros temas con los que se conecta, como portales en dos
 * columnas, a izquierda y derecha de sus documentos: cada uno del lado hacia donde
 * queda ese tema y, en su columna, más arriba o más abajo según la misma dirección.
 * Columnas (y no un anillo) porque los rótulos son anchos: apilados no se pisan. Van
 * pegadas a los costados de los documentos, así los rótulos crecen hacia afuera y el
 * encuadre sólo les deja lugar de ese lado. La dirección sale del núcleo del tema
 * (mediana), que un documento suelto no corre.
 * Devuelve [{ key, n, docs: Map(docId → relaciones), x, y, lado: 'izq' | 'der' }].
 */
export function portalesDe(key, { edges, temaDeId, centros, idsDelTema, temasPos }) {
  const pts = idsDelTema.map((id) => centros.get(id)).filter(Boolean);
  if (!pts.length) return [];
  const cx = mediana(pts.map((p) => p.x));
  const cy = mediana(pts.map((p) => p.y));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const hueco = Math.max((x1 - x0) * 0.08, 60);

  const por = new Map();
  for (const e of edges) {
    const [s, t] = extremos(e);
    const ts = temaDeId.get(s);
    const tt = temaDeId.get(t);
    if (!ts || !tt || ts === tt) continue;
    let dentro;
    let fuera;
    if (ts === key) { dentro = s; fuera = tt; } else if (tt === key) { dentro = t; fuera = ts; } else continue;
    const p = por.get(fuera) || { key: fuera, n: 0, docs: new Map() };
    p.n += 1;
    p.docs.set(dentro, (p.docs.get(dentro) || 0) + 1);
    por.set(fuera, p);
  }

  const lados = { izq: [], der: [] };
  for (const p of por.values()) {
    const otro = temasPos.get(p.key);
    const dx = otro ? otro.x - cx : 1;
    const dy = otro ? otro.y - cy : 0;
    lados[dx < 0 ? 'izq' : 'der'].push({ ...p, orden: Math.atan2(dy, Math.abs(dx)) });
  }
  // En cada columna, de arriba abajo según hacia dónde queda. El paso es proporcional
  // al tamaño del tema: después de encuadrar, en pantalla queda parejo.
  const paso = Math.max((y1 - y0) * 0.14, (x1 - x0 + 2 * hueco) * 0.06, 60);
  const out = [];
  for (const [lado, lista] of Object.entries(lados)) {
    lista.sort((a, b) => a.orden - b.orden);
    lista.forEach(({ orden, ...p }, i) => {
      out.push({ ...p, lado, x: lado === 'izq' ? x0 - hueco : x1 + hueco, y: cy + (i - (lista.length - 1) / 2) * paso });
    });
  }
  return out;
}
