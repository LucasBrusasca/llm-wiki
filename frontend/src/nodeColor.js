/* ══════════════════════════════════════════════════════════════════════════
   COLOR DE NODO — fuente única

   Vivía dentro de Graph3D. El Multiverso tiene que pintar los mismos nodos con
   exactamente el mismo color: si las dos vistas calculan el color por su
   cuenta, cualquier retoque en una hace que entrar a una sección cambie de
   paleta a mitad de la transición, y el corte se vuelve visible.
   ══════════════════════════════════════════════════════════════════════════ */

/* Este módulo no importa NADA a propósito. Vivía dentro de App.jsx, pero
   App → Graph3D → nodeColor → App es un ciclo, y `ISSUE_COLOR` se consume en un
   literal de módulo de Graph3D: con el ciclo, ese const todavía está en zona
   muerta temporal cuando Graph3D se evalúa y la app explota al cargar. Siendo
   hoja del grafo de módulos el ciclo no existe. App.jsx re-exporta lo suyo. */

// Paleta de clusters: 10 matices bien separados en tono, todos con al menos un
// canal RGB bajo, que es lo que mantiene la identidad del matiz sobre el fondo
// oscuro y evita el aspecto lavado.
export const CLUSTER_PALETTE = [
  '#FF5A5F', // rojo coral
  '#3B82F6', // azul
  '#10B981', // verde esmeralda (único verde)
  '#F59E0B', // ámbar/naranja
  '#8B5CF6', // violeta
  '#EC4899', // rosa/magenta
  '#06B6D4', // cian
  '#EF4444', // rojo intenso
  '#6366F1', // índigo
  '#D97706', // naranja oscuro
];

// Reservado: sólo para lo excepcional (issues, alertas). Si aparece, significa algo.
export const ALERT_COLOR = '#FFB44D';

// Ámbar del nodo marcado como issue.
export const ISSUE_COLOR = '#FFBA55';

// Negro profundo con sesgo azulado. Es el fondo del grafo y también el color
// hacia el que desvanece la niebla del Multiverso.
export const BG_COLOR = '#030508';

// Sin grupo: gris frío y apagado, para que el ruido retroceda en vez de competir.
export const NO_GROUP_COLOR = '#565A78';

/* El NODO se pinta más claro que su propia arista. Con la paleta oscura, nodo y
   arista compartiendo color exacto hacía que las aristas —que son muchísimas
   más— dominaran la pantalla y los nodos desaparecieran. Aclarar sólo el nodo
   mantiene la paleta oscura del conjunto y devuelve al nodo la jerarquía que le
   corresponde: el documento es la entidad, la arista es la relación. */
export function aclarar(hex, k = 0.14) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mez = (c) => Math.round(c + (255 - c) * k);
  const r = mez((n >> 16) & 255);
  const g = mez((n >> 8) & 255);
  const b = mez(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export function groupKey(node) {
  const t = node.tema;
  if (t && t !== 'Sin clasificar') return 't:' + t;
  if (node.cluster != null && node.cluster >= 0) return 'c:' + node.cluster;
  return null;
}

export function clusterColor(cluster) {
  // Sin grupo: gris frío y apagado, para que el ruido retroceda en vez de competir.
  if (cluster === undefined || cluster === null || cluster < 0) return NO_GROUP_COLOR;
  return CLUSTER_PALETTE[cluster % CLUSTER_PALETTE.length];
}

export function groupColor(key) {
  if (key == null) return NO_GROUP_COLOR;
  if (key.startsWith('c:')) return clusterColor(parseInt(key.slice(2), 10));
  let h = 0;                                       // tema (string) → color estable
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CLUSTER_PALETTE[h % CLUSTER_PALETTE.length];
}

export function nodeDotColor(node) {
  if (node.is_issue) return ISSUE_COLOR;
  // El HUB se sobreexpone a blanco. Es lo que produce los núcleos brillantes de
  // las referencias: no es un color más de la paleta, es luz saturada en el
  // centro de la estrella.
  if (node.is_hub) return '#FFFFFF';
  return groupColor(groupKey(node));
}

/* ── Color de identidad de una SECCIÓN ──────────────────────────────────────
   Una sección no tiene color propio en ningún lado: en el selector es un punto
   cyan igual para todas, y en el Multiverso las nubes eran todas la misma sopa
   pastel, porque cada nodo se pinta por su cluster. Sin identidad por sección
   no hay forma de distinguir una dimensión de otra de un vistazo.

   Se asigna por hash del nombre —estable, no depende del orden de la lista— y
   se resuelven las colisiones probando el siguiente índice libre, así dos
   secciones nunca comparten color mientras haya cupo en la paleta. */
export function sectionColors(nombres) {
  const out = new Map();
  const usados = new Set();
  const orden = [...nombres].sort();          // determinista, no según llegada
  for (const n of orden) {
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    let idx = h % CLUSTER_PALETTE.length;
    for (let k = 0; k < CLUSTER_PALETTE.length && usados.has(idx); k++) {
      idx = (idx + 1) % CLUSTER_PALETTE.length;
    }
    usados.add(idx);
    out.set(n, CLUSTER_PALETTE[idx]);
  }
  return out;
}
