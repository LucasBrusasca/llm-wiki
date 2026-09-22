/**
 * Temas legibles para estudiar.
 *
 * Prioridad del nombre de un documento:
 *  1. `tema` que puso el backend (taxonomía por LLM, /api/taxonomy) — nombre humano.
 *  2. Si sólo hay `cluster` numérico (HDBSCAN): nombre AUTOMÁTICO derivado de los
 *     conceptos más distintivos del cluster (frecuentes adentro, raros afuera).
 *     Es determinístico: mismos datos → mismo nombre; no se inventa en cada render.
 *  3. Ruido / sin cluster → "Sin tema".
 *
 * Nunca se muestra "tema 2": si un cluster no tiene conceptos suficientes para
 * nombrarse, queda "Cluster N (sin nombre)" y la UI ofrece nombrar con el LLM.
 */
import { normalizar } from '@/lib/utils';

export const SIN_TEMA = 'sin-tema';

const esTemaReal = (t) => !!t && t.trim() && normalizar(t) !== 'sin clasificar';

export function temaKey(n) {
  if (esTemaReal(n?.tema)) return `t:${n.tema.trim()}`;
  if (n?.cluster != null && n.cluster >= 0) return `c:${n.cluster}`;
  return SIN_TEMA;
}

/** Nombre automático de un cluster: 1–2 conceptos distintivos, sin redundancia. */
function nombrarCluster(docs, dfGlobal, totalDocs) {
  const cnt = new Map();          // concepto normalizado → { n, formas: Map(forma → n) }
  for (const d of docs) {
    const vistos = new Set();
    for (const c of d.conceptos || []) {
      const k = normalizar(c).trim();
      if (!k || k.length < 2 || vistos.has(k)) continue;
      vistos.add(k);
      const cur = cnt.get(k) || { n: 0, formas: new Map() };
      cur.n += 1;
      cur.formas.set(c, (cur.formas.get(c) || 0) + 1);
      cnt.set(k, cur);
    }
  }
  const minimo = docs.length >= 6 ? 2 : 1;
  const candidatos = [...cnt.entries()]
    .filter(([, v]) => v.n >= minimo)
    .map(([k, v]) => {
      const df = dfGlobal.get(k) || v.n;
      // Cobertura dentro del cluster × distintividad respecto de toda la sección.
      const score = (v.n / docs.length) * Math.log(1 + totalDocs / df);
      const forma = [...v.formas.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
      return { k, score, forma };
    })
    .sort((a, b) => b.score - a.score || a.k.localeCompare(b.k));

  const elegidos = [];
  for (const c of candidatos) {
    if (elegidos.some((e) => e.k.includes(c.k) || c.k.includes(e.k))) continue;
    elegidos.push(c);
    if (elegidos.length === 2) break;
  }
  if (!elegidos.length) return null;
  const cap = (s) => (s.length > 1 && s === s.toLowerCase() ? s[0].toUpperCase() + s.slice(1) : s);
  // "Modelos de Lenguaje Grandes (LLMs)" → "LLMs": la sigla es como se lo nombra al estudiar.
  const corto = (s) => {
    const m = /\(([^()]{2,12})\)\s*$/.exec(s);
    return m ? m[1].trim() : s;
  };
  return elegidos.map((e) => cap(corto(e.forma))).join(' · ');
}

/**
 * Índice de temas de la sección: key → { key, nombre, auto, color, count }.
 * Colores: por tamaño descendente → paleta de clusters; "Sin tema" apagado.
 */
export function construirTemas(nodes) {
  const grupos = new Map();
  for (const n of nodes) {
    const k = temaKey(n);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(n);
  }

  const df = new Map();
  for (const n of nodes) {
    const vistos = new Set();
    for (const c of n.conceptos || []) {
      const k = normalizar(c).trim();
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      df.set(k, (df.get(k) || 0) + 1);
    }
  }

  const out = new Map();
  const usados = new Map();
  const orden = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  let i = 0;
  for (const [k, docs] of orden) {
    let nombre;
    let auto = false;
    if (k === SIN_TEMA) nombre = 'Sin tema';
    else if (k.startsWith('t:')) nombre = k.slice(2);
    else {
      auto = true;
      const num = Number(k.slice(2)) + 1;
      nombre = nombrarCluster(docs, df, nodes.length) || `Cluster ${num} (sin nombre)`;
    }
    // Dos clusters con el mismo nombre automático: desambiguar sin mostrar sólo un número.
    const rep = usados.get(nombre) || 0;
    usados.set(nombre, rep + 1);
    if (rep) nombre = `${nombre} (${rep + 1})`;

    out.set(k, {
      key: k,
      nombre,
      auto,
      count: docs.length,
      color: k === SIN_TEMA ? 'var(--cl-noise)' : `var(--cl-${i++ % 10})`,
    });
  }
  return out;
}

export function temaDe(temas, n) {
  return temas.get(temaKey(n)) || { key: SIN_TEMA, nombre: 'Sin tema', auto: false, color: 'var(--cl-noise)', count: 0 };
}

/** ¿Hay clusters nombrados sólo automáticamente? (para ofrecer "Nombrar con IA") */
export function hayNombresAutomaticos(temas) {
  for (const t of temas.values()) if (t.auto) return true;
  return false;
}
