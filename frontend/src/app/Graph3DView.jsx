import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { Maximize, Pin, PinOff, Link2, X, Expand } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import ColorPanel, { calcularLeyenda } from '@/app/ColorPanel';
import NodoTooltip from '@/app/NodoTooltip';
import { resolverColor, fuenteLabel } from '@/lib/nodes';

/**
 * Vista "Explorar 3D": modo de impacto, nunca el home.
 *
 * - Posiciones FIJAS desde la proyección 3D del backend (embeddings → UMAP):
 *   no hay simulación corriendo, nada se mueve ni titila.
 * - Aristas: líneas GL de 1px, quietas. Sólo la relación fijada se engrosa.
 * - Lejos: puntos livianos. Cerca o al elegir: UNA tarjeta con miniatura real +
 *   título. Hover: tooltip con el título completo. "Más aire" separa la vista.
 * - Clic en un nodo → mismo Inspector. Clic en el vacío → suelta el pin.
 */

const ESCALA = 320;
const K_FUERTES = 2;
const MAX_ETIQUETAS = 8;

function podar(edges, k) {
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

function rgba(hex, a) {
  const h = (hex || '#888').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(n, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

// Texturas compartidas (se crean una vez): halo radial para el brillo suave.
let haloTex = null;
function texturaHalo() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

/**
 * Chip de etiqueta: título corto, sin miniatura, ancho máximo fijo. Mide lo mismo
 * en pantalla a cualquier distancia (sizeAttenuation=false), así que no crece ni
 * se pierde al orbitar.
 */
const CHIP_ANCHO_MAX = 140;   // px de pantalla
const CHIP_ALTO = 22;

function spriteEtiqueta(texto, { fuerte, acento, fondo, tinta, vh }) {
  const K = 2;                                   // canvas al doble: texto nítido
  const pad = 7 * K;
  const fs = 12 * K;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  // Recortar hasta que entre en el ancho máximo.
  let t = String(texto || '');
  const maxTexto = CHIP_ANCHO_MAX * K - pad * 2;
  if (g.measureText(t).width > maxTexto) {
    while (t.length > 1 && g.measureText(`${t}…`).width > maxTexto) t = t.slice(0, -1);
    t = `${t}…`;
  }
  const w = Math.min(CHIP_ANCHO_MAX * K, Math.ceil(g.measureText(t).width) + pad * 2);
  const h = CHIP_ALTO * K;
  c.width = w;
  c.height = h;
  g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  g.fillStyle = rgba(fondo, 0.92);
  rectRedondeado(g, 1, 1, w - 2, h - 2, 7 * K);
  g.fill();
  g.lineWidth = 1.5 * K;
  g.strokeStyle = fuerte ? acento : rgba(tinta, 0.28);
  g.stroke();
  g.fillStyle = fuerte ? '#ffffff' : rgba(tinta, 0.92);
  g.textBaseline = 'middle';
  g.fillText(t, pad, h / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false,
  }));
  const alto = CHIP_ALTO / (vh || 840);          // fracción del alto del lienzo
  sp.scale.set(alto * (w / h), alto, 1);
  sp.renderOrder = 10;
  return sp;
}

function rectRedondeado(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Parte un título en hasta `max` líneas que entren en `ancho`, con elipsis. */
function lineas(g, texto, ancho, max) {
  const palabras = String(texto || '').split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of palabras) {
    const prueba = cur ? `${cur} ${w}` : w;
    if (g.measureText(prueba).width <= ancho) { cur = prueba; continue; }
    if (cur) out.push(cur);
    cur = w;
    if (out.length === max) break;
  }
  if (out.length < max && cur) out.push(cur);
  if (out.length === max && palabras.join(' ').length > out.join(' ').length) {
    let u = out[max - 1];
    while (u.length > 1 && g.measureText(`${u}…`).width > ancho) u = u.slice(0, -1);
    out[max - 1] = `${u}…`;
  }
  return out.slice(0, max);
}

/**
 * Tarjeta de previsualización: UNA sola a la vez, con medidas fijas
 * (200×168, miniatura 120×90 en 4:3 y barra de título de dos líneas).
 * Tamaño constante en pantalla: no crece al acercar la cámara.
 */
const CARD_W = 200;
const CARD_H = 168;
const THUMB_W = 120;
const THUMB_H = 90;

const tarjetas = new Map();
function tarjetaDe(node, { borde, fondo, tinta, origen, vh }) {
  const clave = `${node.id}|${borde}|${Math.round((vh || 840) / 40)}`;
  const hit = tarjetas.get(clave);
  if (hit) return hit;

  const K = 2;                                   // canvas al doble para que se lea
  const W = CARD_W * K;
  const H = CARD_H * K;
  const tw = THUMB_W * K;
  const th = THUMB_H * K;
  const tx = (W - tw) / 2;
  const ty = 9 * K;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;

  const fondoTarjeta = () => {
    g.clearRect(0, 0, W, H);
    rectRedondeado(g, 2, 2, W - 4, H - 4, 8 * K);
    g.fillStyle = rgba(fondo, 0.96);
    g.fill();
  };
  const marcoThumb = () => {
    rectRedondeado(g, tx, ty, tw, th, 7 * K);
    g.fillStyle = rgba(borde, 0.14);
    g.fill();
  };
  const placeholder = () => {
    g.save();
    rectRedondeado(g, tx, ty, tw, th, 7 * K);
    g.clip();
    g.fillStyle = rgba(borde, 0.16);
    g.fillRect(tx, ty, tw, th);
    g.fillStyle = rgba(borde, 0.95);
    g.font = `700 ${20 * K}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(origen || 'DOC', W / 2, ty + th / 2);
    g.restore();
    g.textAlign = 'left';
  };
  const titulo = () => {
    // Barra de título: 2 líneas como máximo, 12px, con elipsis.
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `500 ${12 * K}px Inter, system-ui, sans-serif`;
    g.fillStyle = rgba(tinta, 0.97);
    const pad = 10 * K;
    lineas(g, node.label, W - pad * 2, 2).forEach((l, i) => g.fillText(l, pad, ty + th + 9 * K + i * 16 * K));
    // Borde del color del origen/tema, al final para que quede por encima.
    rectRedondeado(g, 2, 2, W - 4, H - 4, 8 * K);
    g.lineWidth = 2 * K;
    g.strokeStyle = borde;
    g.stroke();
    tex.needsUpdate = true;
  };

  fondoTarjeta(); marcoThumb(); placeholder(); titulo();

  if (node.fuente_path || node.fuente_url) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      fondoTarjeta();
      g.save();
      rectRedondeado(g, tx, ty, tw, th, 7 * K);
      g.clip();
      g.fillStyle = '#ffffff';
      g.fillRect(tx, ty, tw, th);
      // object-fit: cover, anclado arriba (la primera página manda).
      const esc = Math.max(tw / img.width, th / img.height);
      g.drawImage(img, tx + (tw - img.width * esc) / 2, ty, img.width * esc, img.height * esc);
      g.restore();
      titulo();
    };
    img.src = `/thumb/${encodeURIComponent(node.id)}`;   // mismo origen: el canvas no queda "tainted"
  }

  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false,
  }));
  const alto = CARD_H / (vh || 840);
  sp.scale.set(alto * (CARD_W / CARD_H), alto, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 20;
  tarjetas.set(clave, sp);
  return sp;
}

// Niveles de detalle según cuán cerca está la cámara del conjunto:
//   lejos  → sólo puntos
//   medio  → puntos + chips del elegido / vecindario
//   cerca  → además, UNA tarjeta de preview
const LOD_LEJOS = 1.5;    // × el radio de la nube
const LOD_CERCA = 0.75;

// "Más aire": factor de separación de la VISTA (no toca embeddings ni posiciones guardadas).
const NIVELES_AIRE = [1, 1.4, 2];
const SEPARACION_MIN = 26;   // distancia mínima entre centros al resolver solapes (unidades de escena)

/**
 * Posiciones de vista: proyección 3D del backend, expandida por `aire` alrededor
 * del centro y con un relajado anti-solape (colisión) para que ningún par quede
 * encimado. Es sólo presentación: la vecindad semántica se conserva.
 */
function posicionesVista(nodes, aire) {
  const pts = nodes.map((n) => [(n.x3d ?? 0) * ESCALA, (n.y3d ?? 0) * ESCALA, (n.z3d ?? 0) * ESCALA]);
  const N = pts.length;
  if (!N) return pts;
  const c = [0, 0, 0];
  for (const q of pts) { c[0] += q[0] / N; c[1] += q[1] / N; c[2] += q[2] / N; }
  for (const q of pts) for (let k = 0; k < 3; k++) q[k] = c[k] + (q[k] - c[k]) * aire;
  const iters = N > 800 ? 4 : N > 300 ? 8 : 14;
  const d2min = SEPARACION_MIN * SEPARACION_MIN;
  for (let it = 0; it < iters; it++) {
    let movio = false;
    for (let i = 0; i < N; i++) {
      const a = pts[i];
      for (let j = i + 1; j < N; j++) {
        const b = pts[j];
        let dx = b[0] - a[0]; let dy = b[1] - a[1]; let dz = b[2] - a[2];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= d2min) continue;
        movio = true;
        if (d2 < 1e-6) { dx = ((i * 7 + j) % 3) - 1 || 0.5; dy = 0.3; dz = -0.2; d2 = dx * dx + dy * dy + dz * dz; }
        const d = Math.sqrt(d2);
        const empuje = (SEPARACION_MIN - d) / 2 / d;
        a[0] -= dx * empuje; a[1] -= dy * empuje; a[2] -= dz * empuje;
        b[0] += dx * empuje; b[1] += dy * empuje; b[2] += dz * empuje;
      }
    }
    if (!movio) break;
  }
  return pts;
}


export default function Graph3DView({
  nodes, edges, visibleIds, selectedId, highlightIds, onSelect, relIndex,
  pinnedEdge, onClearPin, colorMode, onColorMode, colorDe: colorVar, temas, compacto, ego, onFijar,
}) {
  const fgRef = useRef(null);
  const cajaRef = useRef(null);
  const objs = useRef(new Map());      // id → { g, r, et, estado, fuerte, node, color, tarjeta }
  const hoverRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, ancho: 0, alto: 0 });
  const [hover, setHover] = useState(null);
  const [aire, setAire] = useState(0);   // índice en NIVELES_AIRE
  const rafRef = useRef(0);
  const [tam, setTam] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = cajaRef.current;
    if (!el) return undefined;
    const medir = () => {
      const r = el.getBoundingClientRect();
      setTam((p) => (Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Colores del tema actual resueltos a hex (three.js no entiende CSS vars).
  const paleta = useMemo(() => ({
    fondo: resolverColor('var(--color-canvas)', '#05060c'),
    acento: resolverColor('var(--color-accent)', '#22d3ee'),
    tinta: resolverColor('var(--color-ink)', '#e9edf7'),
    superficie: resolverColor('var(--color-surface)', '#0a0c16'),
    arista: resolverColor('var(--edge)', '#3a4466'),
  }), []);

  const colorDe = useCallback((n) => resolverColor(colorVar(n)), [colorVar]);

  const pin = pinnedEdge && selectedId
    && (pinnedEdge.source === selectedId || pinnedEdge.target === selectedId)
    && visibleIds.has(pinnedEdge.source) && visibleIds.has(pinnedEdge.target)
    ? pinnedEdge : null;
  const pinOtro = pin ? (pin.source === selectedId ? pin.target : pin.source) : null;

  const vecinos = useMemo(
    () => (ego ? ego.ids : selectedId ? new Set((relIndex.get(selectedId) || []).map((r) => r.otherId)) : null),
    [selectedId, relIndex, ego],
  );
  const grado = useCallback((id) => relIndex.get(id)?.length || 0, [relIndex]);

  // Datos del grafo: posiciones fijas. Se recrean sólo cuando cambia el conjunto visible.
  const data = useMemo(() => {
    const vis = nodes.filter((n) => visibleIds.has(n.id));
    const pos = posicionesVista(vis, NIVELES_AIRE[aire] || 1);
    // Con vecindario fijado, ese conjunto se abre un poco más: es lo que se está
    // leyendo y no tiene que quedar amontonado (sigue siendo vista, no embeddings).
    if (ego) {
      const idx = vis.map((n, i) => (ego.ids.has(n.id) ? i : -1)).filter((i) => i >= 0);
      if (idx.length > 1) {
        const c = [0, 0, 0];
        idx.forEach((i) => { c[0] += pos[i][0] / idx.length; c[1] += pos[i][1] / idx.length; c[2] += pos[i][2] / idx.length; });
        idx.forEach((i) => { for (let k = 0; k < 3; k++) pos[i][k] = c[k] + (pos[i][k] - c[k]) * 1.9; });
      }
    }
    const ns = vis.map((n, i) => {
      const [x, y, z] = pos[i];
      return { id: n.id, node: n, x, y, z, fx: x, fy: y, fz: z };
    });
    const ve = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    const fuertes = new Set(podar(ve, K_FUERTES));
    const links = ve.map((e) => ({
      source: e.source, target: e.target, label: e.label, score: e.score, fuerte: fuertes.has(e),
    }));
    return { nodes: ns, links };
  }, [nodes, edges, visibleIds, aire, ego]);

  // Qué nodos llevan etiqueta persistente.
  const etiquetados = useMemo(() => {
    const out = new Set();
    if (selectedId) out.add(selectedId);
    if (pinOtro) out.add(pinOtro);
    if (ego) {
      out.add(ego.origen);
      for (const id of ego.ids) { if (out.size >= MAX_ETIQUETAS + 4) break; if (visibleIds.has(id)) out.add(id); }
      return out;
    }
    highlightIds.forEach((id) => out.size < MAX_ETIQUETAS && out.add(id));
    if (selectedId && !pinOtro) {
      for (const r of relIndex.get(selectedId) || []) {
        if (out.size >= MAX_ETIQUETAS) break;
        if (visibleIds.has(r.otherId)) out.add(r.otherId);
      }
    }
    if (!selectedId) {
      [...relIndex.entries()]
        .filter(([id]) => visibleIds.has(id))
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 4)
        .forEach(([id]) => out.add(id));
    }
    return out;
  }, [selectedId, pinOtro, ego, highlightIds, relIndex, visibleIds]);

  const estadoDe = useCallback((id) => {
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
  }, [selectedId, pinOtro, vecinos, ego]);

  const nodeObject = useCallback((d) => {
    const estado = estadoDe(d.id);
    const fuerte = estado === 'sel' || estado === 'pin';
    const color = new THREE.Color(colorDe(d.node));
    const r = 3 + Math.sqrt(grado(d.id)) * 1.1 + (fuerte ? 2 : 0);
    const alpha = estado === 'tenue' ? 0.28 : 1;   // contexto visible, no negro

    const g = new THREE.Group();
    const esfera = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 14),
      new THREE.MeshBasicMaterial({ color, transparent: alpha < 1, opacity: alpha }),
    );
    g.add(esfera);

    // Halo suave (additive). Más intenso en el elegido; apagado en los tenues.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texturaHalo(),
      color: fuerte || estado === 'origen' ? new THREE.Color(paleta.acento) : color,
      transparent: true,
      opacity: estado === 'tenue' ? 0.1 : fuerte ? 0.75 : estado === 'origen' ? 0.6 : 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const hs = r * (fuerte ? 4.5 : 3.2);   // halo contenido: de cerca no se vuelve un globo
    halo.scale.set(hs, hs, 1);
    g.add(halo);

    let et = null;
    if (etiquetados.has(d.id)) {
      et = spriteEtiqueta(d.node.label, {
        fuerte, acento: paleta.acento, fondo: paleta.superficie, tinta: paleta.tinta, vh: tam.h,
      });
      et.center.set(-0.06, 0.5);   // un poco a la derecha del nodo, en unidades de pantalla
      et.position.set(r * 1.3, 0, 0);
      g.add(et);
    }
    objs.current.set(d.id, { g, r, et, estado, fuerte, node: d.node, color: `#${color.getHexString()}` });
    return g;
  }, [estadoDe, colorDe, grado, etiquetados, paleta, tam.h]);

  // Centro y radio de la nube: definen los umbrales de detalle (LOD).
  const encuadre = useMemo(() => {
    const ns = data.nodes;
    if (!ns.length) return { centro: new THREE.Vector3(), radio: 1 };
    let cx = 0; let cy = 0; let cz = 0;
    for (const d of ns) { cx += d.fx / ns.length; cy += d.fy / ns.length; cz += d.fz / ns.length; }
    let radio = 1;
    for (const d of ns) radio = Math.max(radio, Math.hypot(d.fx - cx, d.fy - cy, d.fz - cz));
    return { centro: new THREE.Vector3(cx, cy, cz), radio };
  }, [data.nodes]);

  // ── Detalle por distancia: puntos → chips → una tarjeta ──
  const actualizarTarjetas = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera().position;
    const dist = cam.distanceTo(encuadre.centro);
    const nivel = dist > encuadre.radio * LOD_LEJOS ? 'lejos'
      : dist < encuadre.radio * LOD_CERCA ? 'cerca' : 'medio';

    // La tarjeta es la del elegido; sin selección, la del nodo más cercano, y
    // sólo de cerca. De lejos no hay ninguna: la vista queda en puntos.
    let unica = null;
    if (nivel !== 'lejos') {
      if (selectedId && objs.current.has(selectedId)) unica = selectedId;
      else if (nivel === 'cerca') {
        let mejor = Infinity;
        for (const [id, o] of objs.current) {
          if (!o.g.parent) { objs.current.delete(id); continue; }
          const d = cam.distanceTo(o.g.position);
          if (d < mejor) { mejor = d; unica = id; }
        }
      }
    }

    for (const [id, o] of objs.current) {
      if (!o.g.parent) { objs.current.delete(id); continue; }   // objeto viejo, fuera de escena
      const ver = id === unica;
      if (ver) {
        const t = tarjetaDe(o.node, {
          borde: o.fuerte ? paleta.acento : o.color,
          fondo: paleta.superficie,
          tinta: paleta.tinta,
          origen: fuenteLabel(o.node),
          vh: tam.h,
        });
        if (o.tarjeta && o.tarjeta !== t) o.tarjeta.visible = false;
        if (t.parent !== o.g) o.g.add(t);
        t.position.set(0, o.r * 1.25, 0);
        t.visible = true;
        o.tarjeta = t;
      } else if (o.tarjeta) {
        o.tarjeta.visible = false;                                // nunca quedan dos abiertas
      }
    }

    // Chips: nunca de lejos, y nunca encimados. Se proyectan a pantalla y se
    // colocan por prioridad (elegido → origen del vecindario → vecinos → resto);
    // el que pisaría a otro ya puesto, no se dibuja.
    const camara = fg.camera();
    const rects = [];
    const prioridad = (id) => (id === selectedId ? 0 : ego && id === ego.origen ? 1 : vecinos?.has(id) ? 2 : 3);
    const candidatos = [...objs.current.entries()]
      .filter(([id, o]) => o.et && id !== unica)
      .map(([id, o]) => ({ id, o, p: prioridad(id), d: cam.distanceTo(o.g.position) }))
      .sort((a, b) => a.p - b.p || a.d - b.d);

    for (const { o } of candidatos) {
      if (nivel === 'lejos') { o.et.visible = false; continue; }
      const v = o.g.position.clone().project(camara);
      if (v.z > 1) { o.et.visible = false; continue; }          // detrás de la cámara
      const x = (v.x * 0.5 + 0.5) * tam.w;
      const y = (-v.y * 0.5 + 0.5) * tam.h;
      const ancho = o.et.scale.x * tam.h;                        // el sprite mide en fracción de alto
      const alto = o.et.scale.y * tam.h;
      const r = [x + 6, y - alto / 2 - 2, x + 6 + ancho, y + alto / 2 + 2];
      const choca = rects.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
      o.et.visible = !choca;
      if (!choca) rects.push(r);
    }
  }, [selectedId, paleta, encuadre, tam.h, tam.w, ego, vecinos]);

  // Recalcular como mucho una vez por frame.
  const programar = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      actualizarTarjetas();
    });
  }, [actualizarTarjetas]);

  const esPin = useCallback((l) => {
    if (!pin) return false;
    const s = l.source?.id ?? l.source;
    const t = l.target?.id ?? l.target;
    return s === pin.source && t === pin.target && l.label === pin.label;
  }, [pin]);

  const linkVisible = useCallback((l) => {
    const s = l.source?.id ?? l.source;
    const t = l.target?.id ?? l.target;
    if (selectedId && (s === selectedId || t === selectedId)) return true;
    if (ego && ego.ids.has(s) && ego.ids.has(t)) return true;
    return l.fuerte;
  }, [selectedId, ego]);

  const linkColor = useCallback((l) => {
    const s = l.source?.id ?? l.source;
    const t = l.target?.id ?? l.target;
    const propia = selectedId && (s === selectedId || t === selectedId);
    if (esPin(l)) return rgba(paleta.acento, 1);
    if (ego) {
      const dentro = ego.ids.has(s) && ego.ids.has(t);
      if (!dentro) return rgba(paleta.arista, 0.07);
      return propia && !pin ? rgba(paleta.acento, 0.75) : rgba(paleta.arista, pin ? 0.3 : 0.7);
    }
    if (pin) return rgba(paleta.arista, propia ? 0.25 : 0.08);
    if (propia) return rgba(paleta.acento, 0.65);
    return rgba(paleta.arista, selectedId ? 0.15 : 0.55);
  }, [selectedId, pin, ego, esPin, paleta]);

  const linkWidth = useCallback((l) => (esPin(l) ? 1.1 : 0), [esPin]);


  // Sólo en desarrollo: acceso a la instancia para depurar desde la consola.
  useEffect(() => { if (import.meta.env.DEV) window.__algedi3d = fgRef.current; });

  // Fondo + niebla leve (profundidad sin efectos animados).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene();
    scene.fog = new THREE.FogExp2(paleta.fondo, 0.00045);
  }, [paleta]);

  // Encuadre calculado a mano: las posiciones son fijas y conocidas, así que no
  // dependemos de cuándo el motor termina de ubicar los nodos (zoomToFit corría
  // con todo en el origen y dejaba la cámara adentro de la nube).
  const encuadrar = useCallback((ms = 700) => {
    const fg = fgRef.current;
    if (!fg || !data.nodes.length) return;
    let cx = 0; let cy = 0; let cz = 0;
    for (const d of data.nodes) { cx += d.fx; cy += d.fy; cz += d.fz; }
    cx /= data.nodes.length; cy /= data.nodes.length; cz /= data.nodes.length;
    let r = 0;
    for (const d of data.nodes) r = Math.max(r, Math.hypot(d.fx - cx, d.fy - cy, d.fz - cz));
    const fov = (fg.camera()?.fov || 50) * (Math.PI / 180);
    const aspecto = tam.w && tam.h ? Math.min(1, tam.w / tam.h) : 1;
    const dist = (r / Math.sin(fov / 2)) / aspecto * 0.95 + 40;
    fg.cameraPosition({ x: cx, y: cy, z: cz + dist }, { x: cx, y: cy, z: cz }, ms);
  }, [data.nodes, tam.w, tam.h]);

  const listo = tam.w > 0 && data.nodes.length > 0;
  const firma = `${data.nodes.length}:${visibleIds.size}`;

  // Una sola autoridad para la cámara: sin selección → vista de conjunto; con
  // selección → volar al elegido (o al punto medio del vínculo fijado). Corre
  // recién cuando el lienzo existe (listo), así no lo pisa un encuadre tardío.
  useEffect(() => {
    const fg = fgRef.current;
    if (!listo || !fg) return undefined;
    const t = setTimeout(() => {
      const byId = new Map(data.nodes.map((d) => [d.id, d]));
      if (ego) {
        const pts = [...ego.ids].map((id) => byId.get(id)).filter(Boolean);
        if (!pts.length) return;
        const c = pts.reduce((acc, d) => ({ x: acc.x + d.fx / pts.length, y: acc.y + d.fy / pts.length, z: acc.z + d.fz / pts.length }), { x: 0, y: 0, z: 0 });
        const r = Math.max(60, ...pts.map((d) => Math.hypot(d.fx - c.x, d.fy - c.y, d.fz - c.z)));
        const dist = r / Math.sin(((fg.camera().fov || 50) * Math.PI) / 360) + 60;
        const cam = fg.camera().position;
        const dx = cam.x - c.x; const dy = cam.y - c.y; const dz = cam.z - c.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        fg.cameraPosition({ x: c.x + (dx / len) * dist, y: c.y + (dy / len) * dist, z: c.z + (dz / len) * dist }, c, 900);
        return;
      }
      if (!selectedId) { encuadrar(800); return; }
      const a = byId.get(selectedId);
      if (!a) { encuadrar(800); return; }
      const b = pinOtro ? byId.get(pinOtro) : null;
      const foco = b
        ? { x: (a.fx + b.fx) / 2, y: (a.fy + b.fy) / 2, z: (a.fz + b.fz) / 2 }
        : { x: a.fx, y: a.fy, z: a.fz };
      const sep = b ? Math.hypot(a.fx - b.fx, a.fy - b.fy, a.fz - b.fz) : 0;
      const dist = Math.max(380, sep * 1.8);
      // Acercarse desde donde está la cámara ahora: no gira el mundo de golpe.
      const cam = fg.camera().position;
      const dx = cam.x - foco.x; const dy = cam.y - foco.y; const dz = cam.z - foco.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      fg.cameraPosition(
        { x: foco.x + (dx / len) * dist, y: foco.y + (dy / len) * dist, z: foco.z + (dz / len) * dist },
        foco,
        900,
      );
    }, 80);
    return () => clearTimeout(t);
  }, [listo, firma, ego ? `ego:${ego.origen}` : selectedId, ego ? null : pinOtro]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fg = fgRef.current;
    if (!listo || !fg) return undefined;
    const ctr = fg.controls();
    ctr.addEventListener('change', programar);
    const t = setTimeout(programar, 120);          // después de que el motor ubicó los objetos
    const t2 = setTimeout(programar, 1100);        // y al terminar el vuelo de cámara
    return () => { ctr.removeEventListener('change', programar); clearTimeout(t); clearTimeout(t2); };
  }, [listo, programar, nodeObject, data]);

  const leyenda = useMemo(() => calcularLeyenda(nodes, visibleIds, colorMode, temas), [nodes, visibleIds, colorMode, temas]);

  return (
    <div
      ref={cajaRef}
      onMouseMove={(e) => {
        const r = cajaRef.current.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top, ancho: r.width, alto: r.height };
        if (hoverRef.current) setHover((h) => (h ? { ...h, ...mouseRef.current } : h));
      }}
      onMouseLeave={() => { hoverRef.current = null; setHover(null); }}
      onPointerDown={() => setHover(null)}
      className="relative size-full overflow-hidden"
      style={{
        background: `radial-gradient(ellipse 70% 60% at 50% 45%, color-mix(in oklab, ${paleta.acento} 9%, #0a0f1f) 0%, ${paleta.fondo} 72%)`,
      }}
    >
      {!nodes.length && (
        <div className="absolute inset-0 grid place-items-center text-[12px] text-ink-dim">Sin nodos para graficar.</div>
      )}
      {tam.w > 0 && nodes.length > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={tam.w}
          height={tam.h}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          controlType="orbit"
          enableNodeDrag={false}
          cooldownTicks={1}
          warmupTicks={0}
          nodeThreeObject={nodeObject}
          onNodeHover={(d) => {
            hoverRef.current = d?.id || null;
            if (cajaRef.current) cajaRef.current.style.cursor = d ? 'pointer' : '';
            setHover(d ? { node: d.node, ...mouseRef.current } : null);
          }}
          linkVisibility={linkVisible}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={1}
          linkDirectionalParticles={0}
          onNodeClick={(d) => onSelect(d.id)}
          onBackgroundClick={() => pinnedEdge && onClearPin?.()}
        />
      )}

      <div className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap items-start gap-2 text-[11px] text-ink-dim">
        <span className="whitespace-nowrap rounded-xs border border-hair bg-surface/90 px-1.5 py-0.5">
          Explorar 3D · {data.nodes.length} nodos · arrastrá para orbitar · acercate para ver un documento
        </span>
        {pin && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Link2 className="size-3 text-accent" />
            <span className="max-w-[220px] truncate">{data.nodes.find((d) => d.id === pinOtro)?.node.label}</span>
            <button type="button" onClick={onClearPin} className="text-ink-dim hover:text-ink" aria-label="Soltar vínculo"><X className="size-3" /></button>
          </span>
        )}
        {ego && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Pin className="size-3 text-accent" />
            <span className="max-w-[220px] truncate">Vecindario de {data.nodes.find((d) => d.id === ego.origen)?.node.label}</span>
            <span className="text-ink-dim">{ego.ids.size}</span>
            <button type="button" onClick={onFijar} className="text-ink-dim hover:text-ink" aria-label="Desfijar vecindario"><X className="size-3" /></button>
          </span>
        )}
        <ColorPanel modo={colorMode} onModo={onColorMode} leyenda={leyenda} compacto={compacto} />
      </div>

      {hover && <NodoTooltip node={hover.node} x={hover.x} y={hover.y} ancho={hover.ancho} alto={hover.alto} temas={temas} />}

      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
        {(selectedId || ego) && (
          <>
            <Hint texto={ego ? 'Desfijar vecindario · Esc' : 'Fijar relaciones del elegido'} side="right">
              <button
                type="button"
                aria-label={ego ? 'Desfijar vecindario' : 'Fijar relaciones'}
                onClick={onFijar}
                className={`grid size-7 place-items-center hover:bg-surface-2 ${ego ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
              >
                {ego ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </button>
            </Hint>
            <div className="h-px bg-hair" />
          </>
        )}
        <Hint texto={`Más aire: separar nodos ×${NIVELES_AIRE[(aire + 1) % NIVELES_AIRE.length]} (sólo la vista; no cambia los embeddings)`} side="right">
          <button
            type="button"
            aria-label="Más aire"
            onClick={() => setAire((a) => (a + 1) % NIVELES_AIRE.length)}
            className={`grid h-7 min-w-7 place-items-center px-1 text-[10.5px] font-medium hover:bg-surface-2 ${aire ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
          >
            <span className="flex items-center gap-0.5"><Expand className="size-3.5" />{aire ? `×${NIVELES_AIRE[aire]}` : ''}</span>
          </button>
        </Hint>
        <div className="h-px bg-hair" />
        <Hint texto="Encuadrar todo" side="right">
          <button type="button" aria-label="Encuadrar todo" onClick={() => encuadrar(600)} className="grid size-7 place-items-center text-ink-muted hover:bg-surface-2 hover:text-ink">
            <Maximize className="size-3.5" />
          </button>
        </Hint>
      </div>
    </div>
  );
}
