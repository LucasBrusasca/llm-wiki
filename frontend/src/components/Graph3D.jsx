import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clusterColor, CLUSTER_PALETTE } from '../App.jsx';

/* ── Mapa plano de documentos (constelación de miniaturas) ── */
const NODE = {
  bg:      '#08090c', // fondo casi negro, plano (sin haze sci-fi)
  card:    '#10151d', // relleno de tarjeta neutra
  border:  'rgba(190,205,225,0.5)',  // borde fino de tarjeta
  label:   'rgba(205,215,230,0.85)', // texto de etiqueta
  line:    '120,178,235',            // líneas de conexión (azul claro, tono del logo) — rgb base
  issue:   '#ff3060',
};

// Flag de performance: si FPS < 30 se puede desactivar bloom vía VITE_BLOOM_ENABLED=false.
// Backdrop y nodos funcionan SIEMPRE, con o sin bloom.
const BLOOM_ENABLED =
  String(import.meta.env.VITE_BLOOM_ENABLED ?? 'true').toLowerCase() !== 'false';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ── Tamaño de tarjeta = centralidad (grado de conexiones), chico ── */
function cardHeight(degree, maxDegree) {
  const norm = maxDegree > 0 ? Math.sqrt(degree / maxDegree) : 0;
  return 5 + norm * 5; // ~5 (periférico) .. ~10 (hub) en unidades de mundo
}

// Dimensiones de la tarjeta normalizadas por ÁREA: un video 16:9 (ancho) y un PDF
// vertical ocupan la MISMA superficie → se ven del mismo tamaño (antes los videos
// salían enormes por ser anchos). faceH marca la escala según la centralidad.
function cardDims(faceH, aspect) {
  const area = faceH * faceH * 0.78;
  const fh = Math.sqrt(area / Math.max(0.2, aspect));
  return { fw: fh * aspect, fh };
}

const GLYPHS = {
  pdf: 'PDF', tesis: 'PDF', excel: 'XLS', audio: '♫', html: '◍', word: 'DOC',
  ppt: 'PPT', youtube: '▶', image: '▣', video: '▶', concepto: '◇',
};

// Tarjeta neutra (sin miniatura): rectángulo oscuro + borde fino + glyph del tipo.
function makeNeutralCardTexture(node, accent) {
  const cw = 128, ch = 96;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = NODE.card; ctx.fillRect(0, 0, cw, ch);
  // Barra superior + borde en el COLOR DEL CLUSTER → identidad de grupo (plano, no glow).
  if (accent) { ctx.fillStyle = accent; ctx.fillRect(0, 0, cw, 6); }
  ctx.strokeStyle = accent || NODE.border; ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, cw - 3, ch - 3);
  const glyph = GLYPHS[(node.fuente || '').toLowerCase()] || '◇';
  ctx.fillStyle = 'rgba(165,180,200,0.7)';
  ctx.font = `${glyph.length > 1 ? 26 : 40}px 'Courier New', monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(glyph, cw / 2, ch / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return { tex, aspect: cw / ch };
}

// Tarjeta con miniatura real: imagen + borde fino. Leve atenuación para que las
// páginas blancas no superen el umbral del bloom (se ven nítidas, no quemadas).
function makeThumbCardTexture(img, accent) {
  const ar = (img.naturalWidth / img.naturalHeight) || 1;
  const M = 128; let w, h;
  if (ar >= 1) { w = M; h = Math.max(8, Math.round(M / ar)); }
  else { h = M; w = Math.max(8, Math.round(M * ar)); }
  const pad = 4, cw = w + pad * 2, ch = h + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0c1118'; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, pad, pad, w, h);
  ctx.fillStyle = 'rgba(8,10,14,0.12)'; ctx.fillRect(pad, pad, w, h); // dim sutil
  // Identidad de cluster (plano, no glow): barra de color arriba + marco del mismo color.
  // La barra se lee aunque la tarjeta sea chica; el marco la encuadra.
  if (accent) { ctx.fillStyle = accent; ctx.fillRect(0, 0, cw, 7); }
  ctx.strokeStyle = accent || NODE.border; ctx.lineWidth = 3.5;
  ctx.strokeRect(1.75, 1.75, cw - 3.5, ch - 3.5);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return { tex, aspect: cw / ch };
}

// Palabras menores que van en minúscula (salvo si son la primera).
const MINOR_WORDS = new Set([
  'de','del','la','el','los','las','y','o','u','a','en','con','para','por','un','una','al','su',
  'of','the','an','and','or','in','on','to','for','with','at','by','from','as','vs',
]);

// Title Case "lindo": primera letra de cada palabra en mayúscula, el resto minúscula;
// palabras menores (de/en/of/in…) en minúscula; acrónimos (RAG, PDF, AI, LLM) preservados.
function titleCase(str) {
  const parts = (str || '').trim().split(/(\s+)/); // conserva los espacios
  let wordIdx = 0;
  return parts.map(tok => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const isFirst = wordIdx === 0;
    wordIdx++;
    const letters = tok.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    // acrónimo: todo mayúsculas y corto (RAG, PDF, AI, LLM, RAG:) → se respeta tal cual
    if (letters && letters === letters.toUpperCase() && letters.length <= 4) return tok;
    const lower = tok.toLowerCase();
    if (!isFirst && MINOR_WORDS.has(lower.replace(/[^a-záéíóúüñ]/g, ''))) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');
}

// Caption: etiqueta de texto chica centrada debajo de la tarjeta.
function buildCaption(text) {
  const pad = 5, fontPx = 34; // más px = texto más nítido
  const measure = document.createElement('canvas').getContext('2d');
  const font = `600 ${fontPx}px 'Courier New', monospace`;
  measure.font = font;
  let label = titleCase(text);
  if (label.length > 26) label = label.slice(0, 25) + '…';
  const tw = Math.max(1, Math.ceil(measure.measureText(label).width));
  const cw = tw + pad * 2, ch = fontPx + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  // Placa oscura con leve tinte cian + borde fino cian (identidad sin saturar).
  ctx.fillStyle = 'rgba(8,18,28,0.62)';
  roundRect(ctx, 0.5, 0.5, cw - 1, ch - 1, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,212,255,0.3)'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Contorno oscuro para contraste sobre fondos claros (páginas blancas).
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(label, cw / 2, ch / 2);
  ctx.fillStyle = 'rgba(238,245,255,0.98)'; // blanco hueso, más legible
  ctx.fillText(label, cw / 2, ch / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  const worldH = 1.7, worldW = worldH * cw / ch;
  sprite.scale.set(worldW, worldH, 1);
  sprite.renderOrder = 3;
  sprite.userData = { worldW, worldH };
  return sprite;
}

// ¿El nodo puede tener miniatura real? (todo documento con archivo: pdf/office/html/txt/img/video/youtube)
const THUMB_FUENTES = new Set(['pdf', 'tesis', 'youtube', 'image', 'video', 'html', 'word', 'ppt', 'excel']);
function hasThumb(node) {
  if (node.is_issue) return false;
  if (node.thumb_data) return true; // miniatura incrustada (demo estático sin backend)
  const f = (node.fuente || '').toLowerCase();
  if (THUMB_FUENTES.has(f)) return true;
  // Cualquier nodo con archivo de un tipo conocido (incluye txt/md, que entran como "concepto").
  return /\.(pdf|png|jpe?g|gif|webp|bmp|mp4|webm|mov|m4v|html?|docx?|pptx?|pptm|xlsx?|txt|md|markdown)$/i.test(node.fuente_path || '');
}

// Textura de punto (gradiente radial suave) para el nodo "de lejos" (LOD).
function makeDotTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0,    'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1,    'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  return t;
}
const DOT_TEX = makeDotTexture();

/* ── Nivel de detalle (LOD) ──
   Lejos: cada nodo es un punto de color por cluster (constelación limpia).
   Cerca: vuelve a ser la tarjeta con miniatura. LOD_FAR es estado global del zoom. */
let LOD_FAR = true; // arranca en "puntos" (vista general); las tarjetas aparecen al acercarse

function setNodeLOD(ud, far) {
  if (!ud) return;
  if (ud.face)    ud.face.visible = !far;
  if (ud.caption) ud.caption.visible = !far;
  if (ud.halo)    ud.halo.visible = !far;
  if (ud.dot)     ud.dot.visible = far;
}

// Clave de agrupamiento del grafo: el TEMA (taxonomía asignada por LLM) manda; si un
// nodo no tiene tema, cae al cluster HDBSCAN; si tampoco, queda sin grupo (gris neutro).
// Así el "grupo" (color/etiqueta/empaquetado) refleja la taxonomía, no la densidad.
function groupKey(node) {
  const t = node.tema;
  if (t && t !== 'Sin clasificar') return 't:' + t;
  if (node.cluster != null && node.cluster >= 0) return 'c:' + node.cluster;
  return null;
}

function groupColor(key) {
  if (key == null) return '#7db2eb';              // sin grupo → azul claro neutro
  if (key.startsWith('c:')) return clusterColor(parseInt(key.slice(2), 10));
  let h = 0;                                       // tema (string) → color estable
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CLUSTER_PALETTE[h % CLUSTER_PALETTE.length];
}

function nodeDotColor(node) {
  if (node.is_issue) return NODE.issue;
  return groupColor(groupKey(node));
}

/* ── Nodo = tarjeta rectangular plana con la miniatura del archivo ──
   Sin anillo de mira, sin glow fuerte. Tarjeta neutra para nodos sin miniatura. */
function buildNode(node, degree, maxDegree, texReg) {
  const group = new THREE.Group();
  const faceH = cardHeight(degree, maxDegree);
  const accent = nodeDotColor(node); // color del cluster, reutilizado en borde/punto/halo

  // Cara inicial: tarjeta neutra (se reemplaza por la miniatura si carga).
  const { tex, aspect } = makeNeutralCardTexture(node, accent);
  const faceMat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true, toneMapped: true,
  });
  const face = new THREE.Sprite(faceMat);
  let { fw, fh } = cardDims(faceH, aspect);
  face.scale.set(fw, fh, 1);
  face.renderOrder = 2;
  group.add(face);
  if (texReg) { texReg.add(tex); texReg.add(faceMat); }

  // Caption: etiqueta chica debajo de la tarjeta.
  const caption = buildCaption(node.label);
  caption.position.set(0, -(fh / 2) - caption.userData.worldH / 2 - 0.8, 0);
  group.add(caption);
  if (texReg) { texReg.add(caption.material.map); texReg.add(caption.material); }

  // Punto LOD: el nodo "de lejos" (color del cluster). Tamaño ~ centralidad.
  const dotColor = accent;
  const dotMat = new THREE.SpriteMaterial({
    // Blending NORMAL (no Additive): el punto NO "flamea" ni se quema al solaparse.
    // Look plano y elegante, no destello sci-fi.
    map: DOT_TEX, color: dotColor, transparent: true, opacity: 0.9,
    blending: THREE.NormalBlending, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  });
  const dot = new THREE.Sprite(dotMat);
  const dotBase = 2.2 + faceH * 0.18;
  dot.scale.setScalar(dotBase);
  dot.renderOrder = 1;
  group.add(dot);
  if (texReg) { texReg.add(dotMat); }

  // Halo del color del cluster DETRÁS de la tarjeta → diferencia visual por grupo
  // en la vista cercana (de lejos ya está el punto de color).
  const haloMat = new THREE.SpriteMaterial({
    // Tinte de color del cluster MUY sutil detrás de la tarjeta (no un aura brillante).
    map: DOT_TEX, color: dotColor, transparent: true, opacity: 0.12,
    blending: THREE.NormalBlending, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  });
  const clusterHalo = new THREE.Sprite(haloMat);
  clusterHalo.scale.setScalar(Math.max(fw, fh) * 1.6);
  clusterHalo.renderOrder = 0;
  group.add(clusterHalo);
  if (texReg) { texReg.add(haloMat); }

  group.userData = { face, caption, dot, halo: clusterHalo, dotColor, dotBase, baseFW: fw, baseFH: fh };
  setNodeLOD(group.userData, LOD_FAR); // estado inicial según el zoom actual

  // ── Miniatura real (lazy-load): reemplaza la tarjeta neutra al cargar ──
  if (hasThumb(node)) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const { tex: ttex, aspect: tar } = makeThumbCardTexture(img, accent);
        const old = faceMat.map;
        faceMat.map = ttex; faceMat.needsUpdate = true;
        ({ fw, fh } = cardDims(faceH, tar));
        face.scale.set(fw, fh, 1);
        group.userData.baseFW = fw; group.userData.baseFH = fh;
        caption.position.y = -(fh / 2) - caption.userData.worldH / 2 - 0.8;
        if (texReg) { texReg.add(ttex); if (old) texReg.delete(old); }
        if (old) old.dispose?.();
      } catch { /* mantiene la tarjeta neutra */ }
    };
    img.onerror = () => {};                             // 404 → tarjeta neutra
    // ?v= : cache-bust. Subir cuando cambia la generación de miniaturas (p.ej. HTML con estilos)
    // para forzar al navegador a re-pedirlas en vez de servir la versión vieja cacheada.
    img.src = node.thumb_data || `/thumb/${encodeURIComponent(node.id)}?v=2`;
  }

  return group;
}

// Etiqueta de cluster: placa oscura + borde y marcador del COLOR del cluster + texto
// brillante. El color la distingue de los captions de nodo y de otros clusters.
function buildClusterTextSprite(text, color) {
  const H = 66, fontPx = 26, leftPad = 48, rightPad = 26;
  const font = `bold ${fontPx}px 'Courier New', monospace`;
  // Truncar SÓLO si es absurdamente largo, y en borde de palabra (no a mitad).
  let display = text || '';
  if (display.length > 46) {
    display = display.slice(0, 45);
    const sp = display.lastIndexOf(' ');
    if (sp > 24) display = display.slice(0, sp);
    display += '…';
  }
  // Medir el texto y dimensionar la caja para que NO se corte.
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const textW = Math.ceil(measure.measureText(display).width);
  const W = leftPad + textW + rightPad;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  roundRect(ctx, 2, 2, W - 4, H - 4, 9);
  ctx.fillStyle = 'rgba(5, 9, 16, 0.96)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Marcador de color del cluster (cuadradito a la izquierda).
  ctx.fillStyle = color;
  roundRect(ctx, 16, H / 2 - 10, 20, 20, 4);
  ctx.fill();
  // Texto del concepto que caracteriza al grupo.
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(234,245,255,0.98)';
  ctx.fillText(display, leftPad, H / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  const worldW = W / 17.5; // caja proporcional al texto → mismo tamaño de letra, sin cortar
  sprite.scale.set(worldW, worldW * H / W, 1);
  sprite.renderOrder = 999;
  return sprite;
}

const GOLDEN_ANGLE = Math.PI * (1 + Math.sqrt(5));

// Fibonacci sphere — distributes N points uniformly on a sphere surface (looks 3D from any angle)
function fibonacciSphere(n, r, cx, cz) {
  return Array.from({ length: n }, (_, i) => {
    const phi = Math.acos(1 - 2 * (i + 0.5) / n);
    const theta = GOLDEN_ANGLE * i;
    return {
      fx: cx + r * Math.sin(phi) * Math.cos(theta),
      fy:      r * Math.cos(phi),
      fz: cz + r * Math.sin(phi) * Math.sin(theta),
    };
  });
}

// Pins nodes to pre-computed 3D cluster positions (stable, no simulation drift)
function applyDensityLayout(nodes) {
  const PAD = 13; // minimum separation between node centers in world units
  const clusters = {};
  nodes.forEach(n => {
    const k = groupKey(n);
    (clusters[k != null ? k : '-1'] ??= []).push(n);
  });
  const namedKeys = Object.keys(clusters).filter(k => k !== '-1')
    .sort((a, b) => clusters[b].length - clusters[a].length);
  const allGroups = namedKeys.map(k => clusters[k]);
  if (clusters['-1']?.length) allGroups.push(clusters['-1']);

  const nGroups = allGroups.length;
  const maxGroupSize = Math.max(...allGroups.map(g => g.length));

  if (nGroups === 1) {
    // Single cluster: Fibonacci sphere so it looks 3D from every camera angle
    const r = Math.max(PAD * 1.5, PAD * Math.cbrt(maxGroupSize) * 1.2);
    const pts = fibonacciSphere(allGroups[0].length, r, 0, 0);
    allGroups[0].forEach((n, i) => {
      Object.assign(n, pts[i]);
      n.x = n.fx; n.y = n.fy; n.z = n.fz;
      n.vx = 0; n.vy = 0; n.vz = 0;
    });
    return;
  }

  // Multiple clusters: ring of cluster centers, each cluster on its own Fibonacci sphere
  const groupR = Math.max(55, maxGroupSize * PAD * 0.9);
  allGroups.forEach((members, gi) => {
    const angle = (gi / nGroups) * Math.PI * 2;
    const cx = Math.cos(angle) * groupR;
    const cz = Math.sin(angle) * groupR;
    const r = Math.max(PAD, PAD * Math.cbrt(members.length) * 0.9);
    const pts = fibonacciSphere(members.length, r, cx, cz);
    members.forEach((n, i) => {
      Object.assign(n, pts[i]);
      n.x = n.fx; n.y = n.fy; n.z = n.fz;
      n.vx = 0; n.vy = 0; n.vz = 0;
    });
  });
}

// Pins nodes radially by cosine similarity to global centroid (stable, no simulation drift)
function applyCentroidLayout(nodes) {
  const NODE_FOOTPRINT = 12;
  const withEmb = nodes.filter(n => n.embedding?.length);
  if (!withEmb.length) {
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const r = Math.max(30, nodes.length * NODE_FOOTPRINT * 0.25);
      n.fx = Math.cos(angle) * r; n.fy = 0; n.fz = Math.sin(angle) * r;
      n.x = n.fx; n.y = n.fy; n.z = n.fz; n.vx = 0; n.vy = 0; n.vz = 0;
    });
    return;
  }
  const dim = withEmb[0].embedding.length;
  const centroid = new Array(dim).fill(0);
  withEmb.forEach(n => n.embedding.forEach((v, i) => { centroid[i] += v; }));
  centroid.forEach((_, i) => { centroid[i] /= withEmb.length; });
  let ncMag = 0; centroid.forEach(v => { ncMag += v * v; }); ncMag = Math.sqrt(ncMag);
  const simOf = emb => {
    if (!emb?.length) return 0;
    let dot = 0, na = 0;
    for (let i = 0; i < dim; i++) { dot += emb[i] * centroid[i]; na += emb[i] * emb[i]; }
    return dot / (Math.sqrt(na) * ncMag + 1e-10);
  };
  const sorted = [...nodes].sort((a, b) => simOf(b.embedding) - simOf(a.embedding));
  const maxR = Math.max(60, nodes.length * NODE_FOOTPRINT * 0.5);
  sorted.forEach((n, i) => {
    const targetR = (1 - Math.max(0, simOf(n.embedding))) * maxR;
    const angle = (i / sorted.length) * Math.PI * 2;
    n.fx = Math.cos(angle) * targetR;
    n.fy = (Math.floor(i / 8) - Math.floor(sorted.length / 16)) * NODE_FOOTPRINT * 0.7;
    n.fz = Math.sin(angle) * targetR;
    n.x = n.fx; n.y = n.fy; n.z = n.fz;
    n.vx = 0; n.vy = 0; n.vz = 0;
  });
}

export default function Graph3D({
  graphData, selectedNode, highlighted, filteredIds,
  onNodeClick, onNodeHover, onLinkClick, synthMode, layoutMode = 'components',
  projectRef, focusTrigger = 0, fitTrigger = 0,
}) {
  const fgRef                 = useRef();
  const spriteMap             = useRef(new Map()); // id -> THREE.Group del nodo
  const userInteracted        = useRef(false);
  const clusterLabelSprites   = useRef([]);
  const sceneReady            = useRef(false); // evita doble setup (StrictMode dev)
  const texReg                = useRef(new Set()); // texturas/materiales de miniaturas (para dispose)
  const wakeRef               = useRef(() => {});  // render-on-demand: despertar el loop
  const idleTimer             = useRef(null);      // timer para volver a dormir

  /* ── CANAL: centralidad = grado (cantidad de aristas conectadas) ── */
  const { degreeMap, maxDegree } = useMemo(() => {
    const m = new Map();
    (graphData.links || []).forEach(l => {
      const s = l.source?.id ?? l.source;
      const t = l.target?.id ?? l.target;
      if (s != null) m.set(s, (m.get(s) || 0) + 1);
      if (t != null) m.set(t, (m.get(t) || 0) + 1);
    });
    let max = 0;
    m.forEach(v => { if (v > max) max = v; });
    return { degreeMap: m, maxDegree: max };
  }, [graphData.links]);

  const nodeThreeObject = useMemo(() => {
    spriteMap.current = new Map();
    return node => {
      const obj = buildNode(node, degreeMap.get(node.id) || 0, maxDegree, texReg.current);
      spriteMap.current.set(node.id, obj);
      return obj;
    };
  }, [graphData, degreeMap, maxDegree]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dispose de texturas de miniaturas al cambiar el grafo o desmontar (evita leak en GPU).
  useEffect(() => {
    const reg = texReg.current;
    return () => { reg.forEach(o => { try { o.dispose?.(); } catch { /* noop */ } }); reg.clear(); };
  }, [graphData]);

  // Filtro de búsqueda cambia visibilidad de nodos → necesita un render (estamos en idle).
  useEffect(() => { wakeRef.current(); }, [filteredIds]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graphData.nodes.length) return;

    const SCALE = 30;

    fg.d3Force('cluster', null);
    fg.d3Force('centroid', null);
    fg.d3Force('bound', null);
    fg.d3Force('collide', null);
    fg.d3Force('radial', null);

    if (layoutMode === 'components') {
      // Pin each node to its UMAP 3D coordinate — exact semantic layout
      graphData.nodes.forEach(n => {
        if (n.x3d !== undefined && n.embedding) {
          n.fx = n.x3d * SCALE; n.fy = n.y3d * SCALE; n.fz = n.z3d * SCALE;
        } else {
          n.fx = (Math.random() - 0.5) * 40;
          n.fy = (Math.random() - 0.5) * 40;
          n.fz = (Math.random() - 0.5) * 40;
        }
        n.x = n.fx; n.y = n.fy; n.z = n.fz;
        n.vx = 0; n.vy = 0; n.vz = 0;
      });
      fg.d3Force('charge')?.strength(0);
      fg.d3Force('link')?.strength(0);
    } else if (layoutMode === 'density') {
      applyDensityLayout(graphData.nodes);
      fg.d3Force('charge')?.strength(0);
      fg.d3Force('link')?.strength(0);
    } else if (layoutMode === 'centroid') {
      applyCentroidLayout(graphData.nodes);
      fg.d3Force('charge')?.strength(0);
      fg.d3Force('link')?.strength(0);
    } else if (layoutMode === 'pca') {
      graphData.nodes.forEach(n => {
        if (n.x_pca != null) {
          n.fx = n.x_pca * SCALE; n.fy = n.y_pca * SCALE; n.fz = n.z_pca * SCALE;
        } else if (n.x3d != null) {
          n.fx = n.x3d * SCALE; n.fy = n.y3d * SCALE; n.fz = n.z3d * SCALE;
        } else {
          n.fx = (Math.random() - 0.5) * 40;
          n.fy = (Math.random() - 0.5) * 40;
          n.fz = (Math.random() - 0.5) * 40;
        }
        n.x = n.fx; n.y = n.fy; n.z = n.fz;
        n.vx = 0; n.vy = 0; n.vz = 0;
      });
      fg.d3Force('charge')?.strength(0);
      fg.d3Force('link')?.strength(0);
    }

    // Etiqueta flotante por cluster — SOLO en modo Densidad, donde los nodos de un
    // grupo están realmente juntos (en UMAP/PCA/Centroides quedan dispersos y la
    // etiqueta flotaría en el vacío). Se coloca sobre cada grupo.
    const scene = fg.scene();
    clusterLabelSprites.current.forEach(s => scene.remove(s));
    clusterLabelSprites.current = [];

    if (layoutMode === 'density') {
      const clusterGroups = {};
      graphData.nodes.forEach(n => {
        const k = groupKey(n);
        if (k == null) return;
        (clusterGroups[k] ??= []).push(n);
      });

      // En cuántos grupos aparece cada concepto (para distintividad tipo TF-IDF;
      // sólo se usa en el fallback de clusters HDBSCAN sin tema).
      const conceptClusters = {};
      Object.entries(clusterGroups).forEach(([cid, members]) => {
        const seen = new Set();
        members.forEach(n => (n.conceptos || []).forEach(c => seen.add(c)));
        seen.forEach(c => { (conceptClusters[c] ??= new Set()).add(cid); });
      });

      const usedLabels = new Set();
      Object.entries(clusterGroups).forEach(([key, members]) => {
        if (members.length < 2) return; // un solo nodo no es "grupo"
        const cx = members.reduce((s, n) => s + (n.fx ?? n.x ?? 0), 0) / members.length;
        const cz = members.reduce((s, n) => s + (n.fz ?? n.z ?? 0), 0) / members.length;
        const maxY = members.reduce((m, n) => Math.max(m, n.fy ?? n.y ?? 0), -Infinity);

        let labelText;
        if (key.startsWith('t:')) {
          labelText = key.slice(2);           // el TEMA (taxonomía LLM) ES la etiqueta
        } else {
          // Fallback: cluster HDBSCAN sin tema → concepto frecuente y distintivo
          // (frecuencia × rareza global). Si el grupo es heterogéneo, dos conceptos.
          const freq = {};
          members.forEach(n => (n.conceptos || []).forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
          const scored = Object.entries(freq)
            .map(([c, cnt]) => ({ c, cnt, score: cnt * (cnt / (conceptClusters[c]?.size || 1)) }))
            .sort((a, b) => b.score - a.score || b.cnt - a.cnt);
          const top = scored[0];
          labelText = top?.c || 'Grupo';
          if (top && top.cnt / members.length < 0.5 && scored[1]) labelText = `${top.c} · ${scored[1].c}`;
        }
        if (usedLabels.has(labelText)) labelText = `${labelText} ·`;
        usedLabels.add(labelText);

        const color = groupColor(key);
        const sprite = buildClusterTextSprite(labelText, color);
        sprite.position.set(cx, maxY + 8, cz);
        sprite.userData.cid = key;
        scene.add(sprite);
        clusterLabelSprites.current.push(sprite);
      });
    }

    fg.d3ReheatSimulation();
    wakeRef.current();  // el reheat reinicia ticks → mantener el render vivo
    userInteracted.current = false;

    if (layoutMode === 'components') {
      // UMAP: padding más chico → vista un poco MÁS CERCA (sigue en "puntos", no tarjetas).
      const t1 = setTimeout(() => { if (!userInteracted.current) fgRef.current?.zoomToFit(700, 50); }, 200);
      const t2 = setTimeout(() => { if (!userInteracted.current) fgRef.current?.zoomToFit(1000, 30); }, 1500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    } else {
      const t = setTimeout(() => { if (!userInteracted.current) fgRef.current?.zoomToFit(800, 60); }, 80);
      return () => clearTimeout(t);
    }
  }, [graphData, layoutMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Estado visual: atenuar las tarjetas no resaltadas, agrandar la seleccionada.
  useEffect(() => {
    spriteMap.current.forEach((obj, id) => {
      const ud = obj.userData;
      if (!ud?.face) return;
      const isSel = selectedNode?.id === id;
      const isDim = highlighted.size > 0 && !highlighted.has(id);
      ud.face.material.opacity    = isDim ? 0.22 : 1;
      ud.caption.material.opacity = isDim ? 0.12 : (isSel ? 1 : 0.7);
      const fs = isSel ? 1.28 : 1;
      ud.face.scale.set(ud.baseFW * fs, ud.baseFH * fs, 1);
      // Punto LOD (vista lejana): mismo estado de resalte.
      if (ud.dot) {
        ud.dot.material.color.set(isSel ? '#00d4ff' : ud.dotColor);
        ud.dot.material.opacity = isDim ? 0.14 : 1;
        ud.dot.scale.setScalar(isSel ? ud.dotBase * 1.6 : ud.dotBase);
      }
      // Halo de grupo (vista cercana): atenuar / realzar.
      if (ud.halo) ud.halo.material.opacity = isDim ? 0.06 : (isSel ? 0.5 : 0.28);
    });
    wakeRef.current();  // renderizar el cambio de highlight/selección (luego idle)
  }, [highlighted, selectedNode]);

  // (Sin fly-to automático al seleccionar: clickear un nodo NO mueve el grafo.)
  // Enfoque + destello EXPLÍCITO (botón ⌖ del panel): acerca la cámara al nodo y
  // garantiza que se vea su TARJETA pulsando (no el puntito del modo "lejos").
  // Clave: en modo "cerca" lo visible es `face` (tarjeta) + `halo`, NO `dot`.
  // Por eso forzamos la tarjeta visible durante todo el vuelo y pulsamos `face`.
  useEffect(() => {
    if (focusTrigger === 0 || !selectedNode || !fgRef.current) return;
    const target = graphData.nodes.find(n => n.id === selectedNode.id);
    if (!target) return;
    const obj = spriteMap.current.get(selectedNode.id);
    const ud = obj?.userData;
    if (!ud) return;

    // Volar la cámara hasta el nodo (queda dentro del umbral "cerca" < FAR_OUT).
    const dist = 70;
    const dx = target.x || 0.1, dy = target.y || 0.1, dz = target.z || 0.1;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const f = (len + dist) / len;
    fgRef.current.cameraPosition({ x: dx * f, y: dy * f, z: dz * f }, target, 900);

    // Bases para el pulso. La tarjeta NO es uniforme (ancho≠alto): escalar x/y juntos.
    const face = ud.face, halo = ud.halo;
    const fBX = face ? face.scale.x : 0, fBY = face ? face.scale.y : 0;
    const hOp = halo ? halo.material.opacity : 0, hSc = halo ? halo.scale.x : 0;
    const t0 = performance.now(), DUR = 1000;
    let raf;
    const tick = () => {
      const t = performance.now() - t0;
      // Mantener este nodo como TARJETA durante el vuelo, pase lo que pase con el LOD.
      setNodeLOD(ud, false);
      if (t >= DUR) {
        if (face) face.scale.set(fBX, fBY, 1);
        if (halo) { halo.material.opacity = hOp; halo.scale.setScalar(hSc); }
        wakeRef.current();
        return;
      }
      // Un solo pulso suave (0→1→0), sin parpadeo. Amplitudes chicas.
      const p = Math.sin(Math.PI * t / DUR);
      if (face) face.scale.set(fBX * (1 + p * 0.06), fBY * (1 + p * 0.06), 1);
      if (halo) { halo.material.opacity = Math.min(1, hOp + p * 0.22); halo.scale.setScalar(hSc * (1 + p * 0.18)); }
      wakeRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    wakeRef.current();
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [focusTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // (a) Recentrar la vista cuando ENTRAN nodos nuevos (tras una carga/ingesta).
  // Sí mueve la cámara, pero SÓLO cuando crece la cantidad de nodos — no en el uso
  // normal —, así no molesta mientras explorás. El delay deja que UMAP fije posiciones.
  const prevNodeCount = useRef(0);
  useEffect(() => {
    const n = graphData.nodes.length;
    const prev = prevNodeCount.current;
    prevNodeCount.current = n;
    if (prev === 0 || n <= prev) return; // primer render o sin altas → no tocar la cámara
    const t = setTimeout(() => { fgRef.current?.zoomToFit(800, 45); wakeRef.current(); }, 700);
    return () => clearTimeout(t);
  }, [graphData.nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Botón "Ver todo" (desenfocar): vuelve a la vista general con zoomToFit.
  useEffect(() => {
    if (fitTrigger === 0 || !fgRef.current) return;
    userInteracted.current = false;
    fgRef.current.zoomToFit(800, 50);
    wakeRef.current();
  }, [fitTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-time scene setup
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (sceneReady.current) return; // idempotente: no duplicar bloom/backdrop en StrictMode
    sceneReady.current = true;
    // Cap de pixelRatio a 1: en GPU integrada es el mayor ahorro (menos píxeles a dibujar).
    fg.renderer()?.setPixelRatio(1);

    // Mapa plano: SIN partículas, SIN grilla, SIN niebla (eso era el look sci-fi).
    // Fondo negro/plano. Los sprites son unlit → no hace falta iluminación.

    // ── Bloom MUY sutil (opcional): las miniaturas deben leerse nítidas, no quemadas.
    //    threshold alto (0.9) → sólo lo casi-blanco brilla apenas; las tarjetas están
    //    levemente atenuadas para quedar por debajo del umbral. Se puede apagar con
    //    VITE_BLOOM_ENABLED=false.
    if (BLOOM_ENABLED) {
      try {
        const composer = fg.postProcessingComposer?.();
        if (composer) {
          const size = fg.renderer()?.getSize(new THREE.Vector2()) || new THREE.Vector2(window.innerWidth, window.innerHeight);
          const bloomRes = new THREE.Vector2(
            Math.max(2, Math.round(size.x / 2)),
            Math.max(2, Math.round(size.y / 2)),
          );
          const bloom = new UnrealBloomPass(bloomRes, 0.12, 0.3, 0.9); // strength, radius, threshold
          composer.addPass(bloom);
          composer.addPass(new OutputPass());
        }
      } catch (e) {
        console.warn('[Graph3D] bloom no disponible:', e);
      }
    }

    // Navegación suave: OrbitControls (controlType="orbit") con damping/inercia.
    // Evita el giro brusco/descontrolado de TrackballControls ("se va para cualquier lado").
    const controls = fg.controls();
    if (controls) {
      controls.minDistance = 20;
      controls.maxDistance = 1800;
      if ('enableDamping' in controls) {
        controls.enableDamping = true;
        controls.dampingFactor = 0.12;  // glide suave al soltar
        controls.rotateSpeed   = 0.55;
        controls.zoomSpeed     = 0.7;
        controls.panSpeed      = 0.5;
      } else {
        controls.zoomSpeed = 0.6; // fallback trackball
      }
      controls.addEventListener('start', () => { userInteracted.current = true; });
    }

    // Proyección 3D→pantalla para el conector del panel flotante.
    if (projectRef) {
      projectRef.current = (x, y, z) => {
        try { return fgRef.current?.graph2ScreenCoords?.(x, y, z) || null; }
        catch { return null; }
      };
    }

    /* ── RENDER-ON-DEMAND ──────────────────────────────────────────────
       react-force-graph renderiza CADA frame para siempre (TWEEN/controls).
       Pausamos el render cuando no hay actividad y lo despertamos al interactuar:
       en reposo la GPU baja a ~0 (mantiene el último frame). */
    const IDLE_MS = 1500;
    const sleep = () => { fgRef.current?.pauseAnimation(); };
    const wake = () => {
      fgRef.current?.resumeAnimation();
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(sleep, IDLE_MS);
    };
    wakeRef.current = wake;

    const dom = fg.renderer()?.domElement;
    ['pointerdown', 'pointermove', 'wheel', 'touchstart'].forEach(ev =>
      dom?.addEventListener(ev, wake, { passive: true }));
    if (controls) controls.addEventListener('change', wake);
    wake(); // arranque (la simulación inicial mantiene vivo vía onEngineTick)

    /* ── NIVEL DE DETALLE (LOD) por zoom ──────────────────────────────
       VISTA POR DEFECTO = TARJETAS (archivos). Los puntos ("luces") aparecen
       SÓLO cuando te alejás mucho → vista panorámica para corpus grandes.
       El umbral es RELATIVO al tamaño del grafo (no números mágicos): así
       funciona igual con 25 o 500 nodos. Histéresis para que no parpadee. */
    const graphRadius = () => {
      // Desde spriteMap (ref → siempre actual, posiciones vivas de los grupos de nodos).
      const groups = spriteMap.current;
      if (!groups || groups.size === 0) return 100;
      let cx = 0, cy = 0, cz = 0, k = 0;
      groups.forEach(g => { cx += g.position.x; cy += g.position.y; cz += g.position.z; k++; });
      cx /= k; cy /= k; cz /= k;
      let m = 0;
      groups.forEach(g => {
        const dx = g.position.x - cx, dy = g.position.y - cy, dz = g.position.z - cz;
        m = Math.max(m, Math.sqrt(dx * dx + dy * dy + dz * dz));
      });
      return m || 100;
    };
    const updateLOD = () => {
      const cam = fgRef.current?.camera();
      const ctr = fgRef.current?.controls();
      if (!cam || !ctr) return;
      const R = graphRadius();
      // Bien sesgado a tarjetas: hay que alejarse a ~3-4× el radio para ver puntos.
      // Puntos en la vista general; tarjetas SÓLO al acercarse (zoom < ~1.6× el radio).
      const FAR_IN = R * 2.3, FAR_OUT = R * 1.6;
      const d = cam.position.distanceTo(ctr.target);
      let far = LOD_FAR;
      if (d > FAR_IN) far = true; else if (d < FAR_OUT) far = false;
      const changed = far !== LOD_FAR;
      if (changed) LOD_FAR = far;
      if (changed || far) {
        // En modo lejos, escalar los puntos ∝ distancia → tamaño ~constante en pantalla
        // (un sprite normal se achica con la distancia y desaparecería).
        const dotScale = Math.max(2.5, d * 0.02);
        spriteMap.current.forEach(obj => {
          const ud = obj.userData;
          if (changed) setNodeLOD(ud, far);
          if (far && ud.dot) ud.dot.scale.setScalar(dotScale);
        });
        // NO llamar a wake() acá: este handler corre dentro del evento 'change' de los
        // controles; el otro listener ya despierta el loop. Llamar resumeAnimation acá
        // re-dispara 'change' → recursión infinita.
      }
    };
    if (controls) controls.addEventListener('change', updateLOD);
    // Estado inicial (fuera del evento 'change' → acá sí es seguro despertar).
    setTimeout(() => { updateLOD(); wakeRef.current(); }, 400);
  }, []);


  const nodeVisibility = useCallback(node => {
    if (!filteredIds) return true;
    return filteredIds.has(node.id);
  }, [filteredIds]);

  // Líneas finas tipo telaraña: blanco/gris claro, rectas (sin cian grueso).
  const linkColor = useCallback(link => {
    const isIssueLink = link.source?.is_issue || link.target?.is_issue;
    const L = NODE.line; // rgb gris claro
    if (isIssueLink) {
      if (!selectedNode && !highlighted.size) return 'rgba(255,48,96,0.45)';
      const s = link.source?.id ?? link.source, t = link.target?.id ?? link.target;
      return (s === selectedNode?.id || t === selectedNode?.id) ? '#ff3060' : 'rgba(255,48,96,0.08)';
    }
    if (!selectedNode && !highlighted.size) return `rgba(${L},0.16)`;
    const s = link.source?.id ?? link.source, t = link.target?.id ?? link.target;
    return (s === selectedNode?.id || t === selectedNode?.id)
      ? `rgba(${L},0.7)`
      : `rgba(${L},0.04)`;
  }, [selectedNode, highlighted]);

  const linkWidth = useCallback(link => {
    if (!selectedNode && !highlighted.size) return 0.25; // telaraña fina
    const s = link.source?.id ?? link.source, t = link.target?.id ?? link.target;
    return (s === selectedNode?.id || t === selectedNode?.id) ? 0.45 : 0.1; // resaltada, pero fina
  }, [selectedNode, highlighted]);

  const handleHover = useCallback(node => {
    document.body.style.cursor = node ? (synthMode ? 'crosshair' : 'pointer') : 'default';
    if (onNodeHover) onNodeHover(node || null);
  }, [onNodeHover, synthMode]);

  const handleLinkHover = useCallback(link => {
    document.body.style.cursor = link ? 'pointer' : 'default';
  }, []);

  const handleEngineTick = useCallback(() => {
    wakeRef.current();  // mantiene el render vivo mientras la física corre
    if (!clusterLabelSprites.current.length) return;
    const clusterGroups = {};
    graphData.nodes.forEach(n => {
      const k = groupKey(n);
      if (k == null) return;
      (clusterGroups[k] ??= []).push(n);
    });
    clusterLabelSprites.current.forEach(sprite => {
      const cid = sprite.userData.cid;
      const members = clusterGroups[cid];
      if (!members || !members.length) return;
      const cx = members.reduce((s, n) => s + (n.x || 0), 0) / members.length;
      const cz = members.reduce((s, n) => s + (n.z || 0), 0) / members.length;
      const maxY = members.reduce((max, n) => Math.max(max, n.y || 0), -Infinity);
      sprite.position.set(cx, maxY + 8, cz);
    });
  }, [graphData]);

  const handleEngineStop = useCallback(() => {
    if (!userInteracted.current && (layoutMode === 'components' || layoutMode === 'pca')) {
      fgRef.current?.cameraPosition({ x: 0, y: 0, z: 120 }, { x: 0, y: 0, z: 0 }, 800);
    }
    wakeRef.current();  // render del frame final asentado (luego entra en idle)
  }, [layoutMode]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        controlType="orbit"
        backgroundColor="#08090c"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        nodeVisibility={nodeVisibility}
        nodeLabel=""
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={1}
        linkDirectionalParticles={0}
        onNodeClick={onNodeClick}
        onNodeHover={handleHover}
        onLinkClick={onLinkClick}
        onLinkHover={handleLinkHover}
        onEngineTick={handleEngineTick}
        onEngineStop={handleEngineStop}
        showNavInfo={false}
        d3AlphaDecay={0.06}
        d3VelocityDecay={0.6}
        warmupTicks={20}
        cooldownTicks={60}
        cooldownTime={3500}
      />
    </div>
  );
}
