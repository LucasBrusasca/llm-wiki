/**
 * Nivel de detalle de los grafos, el MISMO en 2D y en 3D: qué nodo es su tarjeta
 * (miniatura + título: el nodo ES el documento), cuál lleva un chip con el título y
 * cuál queda en punto. Cada vista proyecta sus nodos a pantalla y mide su `escala`
 * (px de pantalla por unidad de escena en la posición del nodo); la decisión, las
 * prioridades y el anti-choque salen de acá.
 */

/** Medidas de las piezas en px de pantalla (las dibuja PiezasNodo). */
export const TARJETA = {
  chica: { w: 256, h: 78 },
  grande: { w: 288, h: 92 },   // la del documento elegido
};

export const CHIP = { maxW: 240, padX: 8, alto1: 22, alto2: 36 };
const FUENTE_CHIP = '500 11.5px Inter, ui-sans-serif, system-ui, sans-serif';

let lienzo = null;
const medidas = new Map();

/**
 * Medidas del chip en px, midiendo el texto con la misma fuente que su CSS. Si no
 * entra en una línea, busca el corte que deja las dos líneas más parejas y achica
 * la caja a esa medida: al ancho máximo quedaba un hueco a la derecha. `lineas: 3`
 * significa que ni así entra y el CSS lo corta con «…» (el hover muestra el título).
 */
export function medirChip(label) {
  const t = String(label || '');
  const hit = medidas.get(t);
  if (hit) return hit;
  if (!lienzo) lienzo = document.createElement('canvas').getContext('2d');
  lienzo.font = FUENTE_CHIP;
  const ancho = (s) => lienzo.measureText(s).width;
  const extra = CHIP.padX * 2 + 2 + 2;   // padding + borde + 2 px de holgura entre canvas y DOM
  const caja = (texto) => Math.ceil(texto) + extra;
  const util = CHIP.maxW - extra;
  const tw = ancho(t);
  let m;
  if (tw <= util) {
    m = { w: caja(tw), h: CHIP.alto1, lineas: 1 };
  } else {
    const palabras = t.split(/\s+/);
    let mejor = Infinity;
    for (let i = 1; i < palabras.length; i++) {
      if (/^[—–\-·|:,.;)]/.test(palabras[i])) continue;   // la segunda línea no arranca con «— …»
      const peor = Math.max(ancho(palabras.slice(0, i).join(' ')), ancho(palabras.slice(i).join(' ')));
      if (peor <= util && peor < mejor) mejor = peor;
    }
    m = mejor < Infinity
      ? { w: caja(mejor), h: CHIP.alto2, lineas: 2 }
      : { w: CHIP.maxW, h: CHIP.alto2, lineas: 3 };
  }
  // Con Inter todavía cargando se mide con otra fuente: no guardar ese valor.
  if (document.fonts?.check?.(FUENTE_CHIP) !== false) medidas.set(t, m);
  return m;
}

/**
 * Estado de un nodo respecto de lo que se está mirando:
 * 'sel' elegido · 'pin' otro extremo del vínculo fijado · 'origen' del vecindario
 * fijado · 'vecino' · 'tenue' (contexto) · 'normal' (sin selección).
 */
export function estadoNodo(id, { selectedId, pinOtro, vecinos, ego }) {
  if (ego) {
    if (id === selectedId) return 'sel';
    if (id === pinOtro) return 'pin';
    if (id === ego.origen) return 'origen';
    return ego.ids.has(id) ? 'vecino' : 'tenue';
  }
  if (!selectedId) return 'normal';
  if (id === selectedId) return 'sel';
  if (pinOtro) return id === pinOtro ? 'pin' : 'tenue';
  return vecinos?.has(id) ? 'vecino' : 'tenue';
}

/** Vecinos del elegido (o el conjunto fijado): los que acompañan al foco. */
export function vecinosDe({ selectedId, ego, relIndex }) {
  if (ego) return ego.ids;
  if (!selectedId) return null;
  return new Set((relIndex.get(selectedId) || []).map((r) => r.otherId));
}

/**
 * Cuándo gana detalle cada clase, en `escala` (px de pantalla por unidad de escena
 * del 3D). `prio` decide quién se queda con el lugar cuando no entra todo: el
 * elegido, el otro extremo del vínculo fijado, el origen del vecindario, los vecinos
 * (y lo que marcó el agente), los más conectados y el resto. Con algo elegido, lo
 * que no tiene relación con él queda en punto.
 *
 * Referencia en 3D: el encuadre inicial deja la nube entre ~0.5 y ~1.1 (puntos); el
 * vuelo al elegido lo deja cerca de 2.4.
 */
export const DETALLE = {
  sel: { prio: 0, tarjeta: 0.8, chip: 0 },
  pin: { prio: 1, tarjeta: 1.1, chip: 0 },
  origen: { prio: 2, tarjeta: 1.2, chip: 0.45 },
  vecino: { prio: 3, tarjeta: 1.8, chip: 0.75 },
  hito: { prio: 4, tarjeta: 2, chip: 1.15 },
  normal: { prio: 5, tarjeta: 2.2, chip: 1.35 },
};

/** Fila de DETALLE que le toca a un nodo (null = queda en punto). */
export function claseDetalle(estado, { destacado = false, hito = false } = {}) {
  if (estado === 'sel' || estado === 'pin' || estado === 'origen') return estado;
  if (estado === 'vecino' || destacado) return 'vecino';
  if (estado === 'tenue') return null;
  return hito ? 'hito' : 'normal';
}

/** Sin selección, los más conectados de lo visible son hitos: los primeros en mostrar su nombre. */
export function calcularHitos({ selectedId, ego, relIndex, visibleIds }, n = 6) {
  if (selectedId || ego) return new Set();
  return new Set([...relIndex.entries()]
    .filter(([id]) => visibleIds.has(id))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, n)
    .map(([id]) => id));
}

export const MAX_TARJETAS = 6;
export const MAX_CHIPS = 10;
const AIRE_PX = 5;   // separación mínima entre piezas

/**
 * Radio del punto en pantalla: crece con la escala (acercarse lo agranda) pero con
 * tope, para que de cerca no sea un globo ni de lejos polvo.
 */
export const radioPantalla = (r, escalaPx, fuerte = false) => Math.min(fuerte ? 13 : 9, Math.max(2.2, r * escalaPx));

/**
 * Reparte tarjetas y chips por prioridad sin encimarlos entre sí ni con `ocupadas`
 * (paneles del lienzo). Cada candidato ya viene proyectado a pantalla:
 * { id, x, y, escala, clase, rpx (radio del punto), label, orden }; dentro de una
 * misma clase gana el `orden` menor (en 3D, lo más cercano y al centro).
 * Devuelve Map id → { modo: 'tarjeta' | 'chip', dim, sep }.
 */
export function colocarPiezas(cands, { W, H, ocupadas = [], maxTarjetas = MAX_TARJETAS, maxChips = MAX_CHIPS }) {
  const entra = (r) => r[0] >= 0 && r[1] >= 0 && r[2] <= W && r[3] <= H;
  const choca = (r, lista) => lista.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  const puestas = ocupadas.slice();
  const res = new Map();
  let nT = 0;
  let nC = 0;
  const orden = cands
    .filter((c) => DETALLE[c.clase])
    .sort((a, b) => DETALLE[a.clase].prio - DETALLE[b.clase].prio || a.orden - b.orden);
  for (const c of orden) {
    const u = DETALLE[c.clase];
    const obligado = u.prio <= 1;   // el elegido y el otro extremo del vínculo pueden quedar a medias en el borde
    if (nT < maxTarjetas && c.escala >= u.tarjeta) {
      const t = u.prio === 0 ? TARJETA.grande : TARJETA.chica;
      const r = [c.x - t.w / 2 - AIRE_PX, c.y - t.h / 2 - AIRE_PX, c.x + t.w / 2 + AIRE_PX, c.y + t.h / 2 + AIRE_PX];
      if ((obligado || entra(r)) && !choca(r, puestas)) {
        puestas.push(r);
        nT += 1;
        res.set(c.id, { modo: 'tarjeta', dim: t });
        continue;
      }
    }
    if (nC < maxChips && c.escala >= u.chip) {
      const m = medirChip(c.label);
      const sep = Math.round(c.rpx + 6);
      const r = [c.x + sep - AIRE_PX, c.y - m.h / 2 - AIRE_PX, c.x + sep + m.w + AIRE_PX, c.y + m.h / 2 + AIRE_PX];
      if ((obligado || entra(r)) && !choca(r, puestas)) {
        puestas.push(r);
        nC += 1;
        res.set(c.id, { modo: 'chip', dim: m, sep });
      }
    }
  }
  return res;
}

/** Rectángulos (relativos a `caja`) de los paneles marcados con data-hud: ahí no va ninguna pieza. */
export function medirHud(caja) {
  if (!caja) return [];
  const base = caja.getBoundingClientRect();
  return [...caja.querySelectorAll('[data-hud]')].map((el) => {
    const r = el.getBoundingClientRect();
    return [r.left - base.left, r.top - base.top, r.right - base.left, r.bottom - base.top];
  });
}
