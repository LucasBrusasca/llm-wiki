import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clusterColor, CLUSTER_PALETTE } from '../App.jsx';

/* ── PERF: throttle genérico para reducir recálculos en eventos de alta frecuencia ── */
function throttle(fn, ms) {
  let last = 0, pending = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); }
    else if (!pending) { pending = setTimeout(() => { pending = null; last = performance.now(); fn(...args); }, ms - (now - last)); }
  };
}

/* ── Sistema visual premium: fondo profundo, nodos nítidos, edges legibles ── */
const NODE = {
  bg:      '#030508', // negro profundo con sesgo azulado: más cinematográfico
  card:    '#0D151F80', // relleno de tarjeta neutra (translúcido, más contraste)
  border:  'rgba(130,180,220,0.45)', // borde más visible
  label:   'rgba(230,242,255,0.95)',  // texto de etiqueta más brillante
  line:    '100,210,255',             // conexiones: cian más vibrante
  issue:   '#FFBA55',                // ámbar: reservado para lo excepcional
  sel:     '#FFFFFF',                // retícula de selección
  glow:    'rgba(90,200,250,0.15)',  // glow sutil para hover (sin bloom)
};

// "#7C8CFF" → "124,140,255". Se cachea porque linkColor corre por arista y por frame.
const _rgbCache = new Map();
// PERF: cache de colores de aristas para evitar recálculos por frame
const _linkColorCache = new Map();
let _linkColorCacheKey = '';
/* El NODO se pinta mas claro que su propia arista. Con la paleta oscura, nodo y
   arista compartiendo color exacto hacia que las aristas —que son muchisimas mas—
   dominaran la pantalla y los nodos desaparecieran. Aclarar solo el nodo mantiene
   la paleta oscura del conjunto y devuelve al nodo la jerarquia que le corresponde:
   el documento es la entidad, la arista es la relacion. */
function aclarar(hex, k = 0.14) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mez = c => Math.round(c + (255 - c) * k);
  const r = mez((n >> 16) & 255), g = mez((n >> 8) & 255), b = mez(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/* La ARISTA se pinta mas oscura que el nodo, con el mismo matiz. Al subir el
   brillo de la paleta, las aristas heredaron ese brillo — y son un orden de
   magnitud mas numerosas que los nodos, asi que pasaron a ser el elemento
   dominante de la pantalla. El matiz sigue identificando al grupo; lo que baja
   es su peso visual. */
function oscurecer(hex, k = 0.45) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mez = c => Math.round(c * (1 - k));
  const r = mez((n >> 16) & 255), g = mez((n >> 8) & 255), b = mez(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function hexToRgb(hex) {
  const k = String(hex || '');
  const hit = _rgbCache.get(k);
  if (hit) return hit;
  const m = /^#?([0-9a-f]{6})$/i.exec(k.trim());
  const out = m
    ? `${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4, 6), 16)}`
    : NODE.line;
  _rgbCache.set(k, out);
  return out;
}

// Flag de performance: si FPS < 30 se puede desactivar bloom vía VITE_BLOOM_ENABLED=false.
// Backdrop y nodos funcionan SIEMPRE, con o sin bloom.
const BLOOM_ENABLED =
  String(import.meta.env.VITE_BLOOM_ENABLED ?? 'false').toLowerCase() === 'true';

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

/* ── Tamaño de tarjeta = centralidad (grado de conexiones) ── */
function cardHeight(degree, maxDegree) {
  const norm = maxDegree > 0 ? Math.sqrt(degree / maxDegree) : 0;
  // FIX: tamaño medio para que las miniaturas sean reconocibles
  // Antes: 1.8..4.0 (muy chico, no se veía el preview)
  // Ahora: 3.0..6.0 (visible pero no gigante)
  return 3.0 + norm * 3.0;
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
  
  // Fondo con gradiente sutil para profundidad
  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#0F1820');
  bg.addColorStop(1, '#0A1218');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);
  
  // Barra superior del color del cluster (más ancha y brillante)
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, cw, 5);
    // Brillo sutil debajo de la barra
    const glow = ctx.createLinearGradient(0, 5, 0, 20);
    glow.addColorStop(0, accent.replace(')', ',0.2)').replace('rgb', 'rgba'));
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 5, cw, 15);
  }
  
  // Borde nítido
  ctx.strokeStyle = accent || NODE.border;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(1, 1, cw - 2, ch - 2);
  
  // Glyph del tipo de archivo (más visible)
  const glyph = GLYPHS[(node.fuente || '').toLowerCase()] || '◇';
  ctx.fillStyle = 'rgba(180,200,220,0.85)';
  ctx.font = `${glyph.length > 1 ? 24 : 36}px 'JetBrains Mono', 'Courier New', monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(glyph, cw / 2, ch / 2 + 4);
  
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
  ctx.fillStyle = '#0B0B16'; ctx.fillRect(0, 0, cw, ch);
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

// Truncado inteligente: preserva palabras clave, no corta a mitad de palabra
function smartTruncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  // Intentar cortar en un espacio antes del límite
  let cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  // Si hay un espacio razonable (no muy al inicio), cortar ahí
  if (lastSpace > maxLen * 0.5) {
    cut = cut.slice(0, lastSpace);
  }
  return cut.trim() + '…';
}

// Caption: etiqueta de texto centrada debajo de la tarjeta.
// FIX: títulos más largos (hasta 48 chars) con truncado inteligente, 2 líneas si es necesario
function buildCaption(text, fullText = null) {
  const pad = 10, fontPx = 28, lineH = 34; // fuente legible, padding generoso
  const measure = document.createElement('canvas').getContext('2d');
  const font = `600 ${fontPx}px 'Sora', 'Inter', system-ui, sans-serif`;
  measure.font = font;
  
  const original = titleCase(text);
  const full = fullText || original;  // texto completo para tooltip
  
  // Truncado inteligente: hasta 48 chars, o 2 líneas de ~28 cada una
  let lines = [];
  if (original.length <= 48) {
    // Cabe en una línea
    lines = [original];
  } else {
    // Intentar 2 líneas de ~28 chars
    const firstLine = smartTruncate(original, 28);
    const rest = original.slice(firstLine.length - 1).trim(); // sin el "…"
    if (rest.length > 0) {
      const secondLine = smartTruncate(rest, 26);
      lines = [firstLine.replace('…', ''), secondLine];
    } else {
      lines = [smartTruncate(original, 48)];
    }
  }
  
  const numLines = lines.length;
  const maxTw = Math.max(...lines.map(l => Math.ceil(measure.measureText(l).width)));
  const cw = maxTw + pad * 2;
  const ch = lineH * numLines + pad * 2;
  
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  
  // Fondo más sólido con blur visual (sin performance hit)
  ctx.fillStyle = 'rgba(8,12,20,0.92)';
  roundRect(ctx, 0, 0, cw, ch, 6);
  ctx.fill();
  
  // Borde sutil con gradiente
  ctx.strokeStyle = 'rgba(90,200,250,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  
  // Dibujar cada línea
  lines.forEach((line, i) => {
    const y = pad + lineH / 2 + i * lineH;
    // Sombra más definida
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.strokeText(line, cw / 2, y);
    // Texto blanco brillante
    ctx.fillStyle = 'rgba(245,250,255,1)';
    ctx.fillText(line, cw / 2, y);
  });
  
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  const worldH = 1.8 + (numLines - 1) * 0.9;  // más alto si hay 2 líneas
  const worldW = worldH * cw / ch;
  sprite.scale.set(worldW, worldH, 1);
  sprite.renderOrder = 3;
  sprite.userData = { worldW, worldH, fullText: full };  // guardar texto completo
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

// Textura de punto premium: núcleo nítido con borde sutil, sin blur excesivo.
/* Look moderno: centro sólido con caída rápida y un anillo exterior muy tenue.
   Evita el "confeti blur" manteniendo el núcleo definido. */
function makeDotTexture() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const cx = s / 2;

  // Anillo exterior muy sutil: da profundidad sin blur
  const outer = g.createRadialGradient(cx, cx, s * 0.28, cx, cx, s * 0.48);
  outer.addColorStop(0, 'rgba(255,255,255,0)');
  outer.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  outer.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = outer; g.fillRect(0, 0, s, s);

  // Núcleo sólido: borde definido, no difuso
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, s * 0.28);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.7, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.85, 'rgba(255,255,255,0.6)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.fillRect(0, 0, s, s);

  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
const DOT_TEX = makeDotTexture();

/* Anillo de selección premium: círculo completo con glow sutil.
   Más visible y moderno que los arcos fragmentados. */
function makeRingTexture() {
  const s = 256, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const cx = s / 2, r = s * 0.38;

  // Glow exterior sutil (sin afectar performance)
  g.strokeStyle = 'rgba(90,200,250,0.25)';
  g.lineWidth = s * 0.06;
  g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();

  // Anillo principal blanco
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = s * 0.022;
  g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();

  // Punto de referencia arriba (indica orientación)
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  g.arc(cx, cx - r, s * 0.025, 0, Math.PI * 2);
  g.fill();

  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
const RING_TEX = makeRingTexture();

/* ── Nivel de detalle (LOD) ──
   Lejos: cada nodo es un punto de color por cluster (constelación limpia).
   Cerca: vuelve a ser la tarjeta con miniatura. LOD_FAR es estado global del zoom. */
let LOD_FAR = true; // arranca en "puntos" (vista general); las tarjetas aparecen al acercarse
let SHOW_CLUSTER_LABELS = false; // las etiquetas de cluster solo se ven en zoom intermedio
let LINK_ALPHA_MULT = 0.55; // Opacidad base más alta para mejor legibilidad (ajustado por zoom)

function setNodeLOD(ud, far, isHovered = false) {
  if (!ud) return;
  if (ud.esFragmento) return;   // siempre punto
  if (ud.face)    ud.face.visible = !far;
  // FIX: caption visible en hover, selección, o zoom cercano para identificar documentos
  // El nodo elegido, sus vecinos, o el hover conservan el nombre aunque el LOD los pase a punto.
  if (ud.caption) ud.caption.visible = !far || !!ud.forzarCaption || isHovered;
  if (ud.halo)    ud.halo.visible = !far;
  if (ud.dot)     ud.dot.visible = far;
  // El anillo acompaña el LOD: rodea el punto de lejos y la tarjeta de cerca.
  if (ud.ring) {
    ud.ring.scale.setScalar(
      far ? ud.dotBase * 2.4 : Math.max(ud.baseFW, ud.baseFH) * 1.32
    );
  }
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
  if (key == null) return '#565A78';              // sin grupo → gris frío: retrocede
  if (key.startsWith('c:')) return clusterColor(parseInt(key.slice(2), 10));
  let h = 0;                                       // tema (string) → color estable
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CLUSTER_PALETTE[h % CLUSTER_PALETTE.length];
}

function nodeDotColor(node) {
  if (node.is_issue) return NODE.issue;
  // El HUB se sobreexpone a blanco. Es lo que produce los nucleos brillantes de las
  // referencias: no es un color mas de la paleta, es luz saturada en el centro de la
  // estrella. El color del tema lo siguen aportando los fragmentos que lo rodean.
  if (node.is_hub) return '#FFFFFF';
  return groupColor(groupKey(node));
}

// Un fragmento es un punto y nada mas: sin tarjeta, sin etiqueta, sin halo.
// Con 4.397 fragmentos, cinco sprites por nodo serian 22.000 objetos y el
// navegador no lo sostiene. Uno solo por fragmento: ~4.800 en total.
function esFragmento(node) { return node?.type === 'FRAGMENTO'; }

/* ── Nodo = tarjeta rectangular plana con la miniatura del archivo ──
   Sin anillo de mira, sin glow fuerte. Tarjeta neutra para nodos sin miniatura. */
function buildNode(node, degree, maxDegree, texReg) {
  const group = new THREE.Group();

  if (esFragmento(node)) {
    const color = nodeDotColor(node);
    const mat = new THREE.SpriteMaterial({
      map: DOT_TEX, color, transparent: true, opacity: 0.8,
      blending: THREE.NormalBlending, depthWrite: false, depthTest: true,
      fog: false, toneMapped: false,
    });
    const dot = new THREE.Sprite(mat);
    const base = 0.9;
    dot.scale.setScalar(base);
    group.add(dot);
    if (texReg) texReg.add(mat);
    group.userData = { dot, dotColor: color, dotBase: base, esFragmento: true };
    return group;
  }

  const faceH = cardHeight(degree, maxDegree);
  const accent = nodeDotColor(node); // color del cluster, reutilizado en borde/punto/halo

  // Cara inicial: tarjeta neutra (se reemplaza por la miniatura si carga).
  const { tex, aspect } = makeNeutralCardTexture(node, accent);
  const faceMat = new THREE.SpriteMaterial({
    /* depthWrite + alphaTest: la tarjeta escribe profundidad donde es opaca, asi
       las aristas que pasan POR DETRAS quedan ocultas y solo se ven las que pasan
       por delante. Antes, con depthWrite en false, la tarjeta no ocluia nada y
       todas las lineas se dibujaban encima del documento. El alphaTest evita que
       los pixeles transparentes del borde escriban profundidad. */
    map: tex, transparent: true, depthWrite: true, alphaTest: 0.45,
    depthTest: true, toneMapped: true,
  });
  const face = new THREE.Sprite(faceMat);
  let { fw, fh } = cardDims(faceH, aspect);
  face.scale.set(fw, fh, 1);
  face.renderOrder = 2;
  group.add(face);
  if (texReg) { texReg.add(tex); texReg.add(faceMat); }

  // Caption: etiqueta chica debajo de la tarjeta.
  const caption = buildCaption(node.label);
  /* La etiqueta se construye con ALTURA fija y ancho proporcional al largo del
     texto: un titulo de 26 caracteres terminaba midiendo ~20 unidades, mas del
     doble que la tarjeta que nombra, y tapaba el grafo. Se reescala para que
     nunca supere ~1.5x el ancho del documento. */
  {
    const anchoMax = Math.max(fw, fh) * 1.5;
    const anchoAct = caption.scale.x;
    if (anchoAct > anchoMax) {
      const k = anchoMax / anchoAct;
      caption.scale.multiplyScalar(k);
      caption.userData.worldH *= k;
    }
  }
  // FIX: guardar escala base para poder aplicar labelScale dinámicamente
  caption.userData.baseScaleX = caption.scale.x;
  caption.userData.baseScaleY = caption.scale.y;
  caption.position.set(0, -(fh / 2) - caption.userData.worldH / 2 - 0.8, 0);
  group.add(caption);
  if (texReg) { texReg.add(caption.material.map); texReg.add(caption.material); }

  // Punto LOD: el nodo "de lejos" (color del cluster). Tamaño ~ centralidad.
  const dotColor = aclarar(accent, 0.14);
  const dotMat = new THREE.SpriteMaterial({
    // Blending NORMAL, a proposito. El aditivo suma la luz del punto con la de su
    // propio halo y el resultado tira a blanco: un magenta saturado termina en rosa
    // palido. Ese truco funciona en Opte o Codebase Memory porque tienen decenas de
    // miles de puntos diminutos donde la suma ES la señal de densidad; con ~90 nodos
    // grandes no suma densidad, solo lava el color.
    map: DOT_TEX, color: dotColor, transparent: true, opacity: 1,
    blending: THREE.NormalBlending, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  });
  const dot = new THREE.Sprite(dotMat);
  // Rango amplio a proposito: en las referencias el hub es varias veces la hoja.
  // Escalado x0.576 respecto del sprite anterior: es exactamente la proporcion en
  // que crecio el nucleo dentro de la textura, asi que el punto se ve igual de
  // grande pero su area de clic se reduce casi a la mitad.
  const dotBase = (node.is_hub ? 2.4 : 1.6)
    + Math.pow(maxDegree > 0 ? degree / maxDegree : 0, 0.7) * (node.is_hub ? 7.5 : 6.1);
  dot.scale.setScalar(dotBase);
  dot.renderOrder = 1;
  group.add(dot);
  if (texReg) { texReg.add(dotMat); }

  // Halo del color del cluster DETRÁS de la tarjeta → diferencia visual por grupo
  // en la vista cercana (de lejos ya está el punto de color).
  const haloMat = new THREE.SpriteMaterial({
    // Aura del cluster detras de la tarjeta: tinte sutil, no un aura encendida.
    map: DOT_TEX, color: dotColor, transparent: true, opacity: 0.12,
    blending: THREE.NormalBlending, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
  });
  const clusterHalo = new THREE.Sprite(haloMat);
  clusterHalo.scale.setScalar(Math.max(fw, fh) * 1.6);
  clusterHalo.renderOrder = 0;
  group.add(clusterHalo);
  if (texReg) { texReg.add(haloMat); }

  // Anillo de selección/hover. Vive en ambos LOD (punto y tarjeta) porque marcar
  // qué estás tocando importa igual de lejos que de cerca. Oculto por defecto.
  const ringMat = new THREE.SpriteMaterial({
    map: RING_TEX, color: NODE.sel, transparent: true, opacity: 0,
    blending: THREE.NormalBlending, depthWrite: false, depthTest: false,
    fog: false, toneMapped: false,
  });
  const ring = new THREE.Sprite(ringMat);
  ring.scale.setScalar(dotBase * 2.4);
  ring.renderOrder = 3;
  ring.visible = false;
  group.add(ring);
  if (texReg) { texReg.add(ringMat); }

  group.userData = {
    face, caption, dot, halo: clusterHalo, ring,
    dotColor, dotBase, baseFW: fw, baseFH: fh,
  };
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
// FIX: truncado más agresivo para que no tapen los nodos al hacer zoom
function buildClusterTextSprite(text, color) {
  const H = 52, fontPx = 20, leftPad = 36, rightPad = 18;  // más compacto
  const font = `600 ${fontPx}px 'Sora', 'Inter', system-ui, sans-serif`;
  
  // FIX: truncado mucho más agresivo (max ~35 chars) para evitar pills gigantes
  let display = text || '';
  if (display.length > 36) {
    display = display.slice(0, 35);
    const sp = display.lastIndexOf(' ');
    if (sp > 20) display = display.slice(0, sp);
    display += '…';
  }
  
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const textW = Math.ceil(measure.measureText(display).width);
  const W = leftPad + textW + rightPad;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  
  // Fondo premium con gradiente muy sutil
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, 'rgba(12, 18, 28, 0.95)');
  bgGrad.addColorStop(1, 'rgba(6, 10, 18, 0.97)');
  roundRect(ctx, 1, 1, W - 2, H - 2, 8);
  ctx.fillStyle = bgGrad;
  ctx.fill();
  
  // Borde con el color del cluster (más sutil)
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Marcador de color (círculo en lugar de cuadrado, más moderno)
  ctx.beginPath();
  ctx.arc(24, H / 2, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  // Anillo exterior sutil
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Texto con sombra sutil
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(display, leftPad + 1, H / 2 + 2);
  ctx.fillStyle = 'rgba(245,252,255,1)';
  ctx.fillText(display, leftPad, H / 2);
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
  const PAD = 16; // minimum separation between node centers in world units
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
    const r = Math.max(PAD * 1.8, PAD * Math.cbrt(maxGroupSize) * 1.6);
    const pts = fibonacciSphere(allGroups[0].length, r, 0, 0);
    allGroups[0].forEach((n, i) => {
      Object.assign(n, pts[i]);
      n.x = n.fx; n.y = n.fy; n.z = n.fz;
      n.vx = 0; n.vy = 0; n.vz = 0;
    });
    return;
  }

  // Multiple clusters: ring of cluster centers, each cluster on its own Fibonacci sphere.
  // Radio de esfera más grande → las tarjetas (que son billboards y se ven de frente)
  // se separan en pantalla en vez de encimarse al proyectar la esfera a 2D.
  const groupR = Math.max(75, maxGroupSize * PAD * 1.15);
  allGroups.forEach((members, gi) => {
    const angle = (gi / nGroups) * Math.PI * 2;
    const cx = Math.cos(angle) * groupR;
    const cz = Math.sin(angle) * groupR;
    const r = Math.max(PAD * 1.4, PAD * Math.cbrt(members.length) * 1.5);
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
  ragDebugMode = false, ragDebugResults = [],
  labelScale = 1.0,  // FIX: escala de labels (0.7 = compacto, 1.0 = normal, 1.4 = amplio)
}) {
  const fgRef                 = useRef();
  const stageRef              = useRef(null);      // contenedor real del lienzo
  // react-force-graph usa el tamaño de la VENTANA si no se le pasa width/height.
  // Con la barra lateral eso desencuadraba el grafo: dibujaba 1280px de ancho dentro
  // de un hueco de 1048px, y el zoomToFit centraba sobre un área que no existe.
  const [stageSize, setStageSize] = React.useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const medir = () => {
      const r = el.getBoundingClientRect();
      setStageSize(prev =>
        (Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1)
          ? prev
          : { w: Math.round(r.width), h: Math.round(r.height) }
      );
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Al cambiar el tamaño útil (abrir un panel lateral, redimensionar la ventana),
  // reencuadrar si el usuario no movió la cámara a mano.
  useEffect(() => {
    if (!stageSize.w || !stageSize.h) return;
    if (userInteracted.current) return;
    const t = setTimeout(() => { fgRef.current?.zoomToFit(500, 40); wakeRef.current(); }, 180);
    return () => clearTimeout(t);
  }, [stageSize.w, stageSize.h]);
  const spriteMap             = useRef(new Map()); // id -> THREE.Group del nodo
  const userInteracted        = useRef(false);
  const clusterLabelSprites   = useRef([]);
  const clusterHulls          = useRef([]);   // burbuja translucida por grupo
  const sceneReady            = useRef(false); // evita doble setup (StrictMode dev)
  const texReg                = useRef(new Set()); // texturas/materiales de miniaturas (para dispose)
  const wakeRef               = useRef(() => {});  // render-on-demand: despertar el loop
  const idleTimer             = useRef(null);      // timer para volver a dormir
  const prevLayoutRef         = useRef(null);      // detectar cambio de layout vs refresh
  const didFitRef             = useRef(false);     // ya encuadró alguna vez
  const fitPendingRef         = useRef(true);      // encuadrar en el próximo asentamiento
  const hoverIdRef            = useRef(null);      // FIX: ID del nodo en hover (para mostrar caption)

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

  /* ── RAG Debug: Set de IDs de nodos recuperados ── */
  const ragNodeIds = useMemo(() => {
    if (!ragDebugMode || !ragDebugResults.length) return new Set();
    return new Set(ragDebugResults.map(r => r.node_id));
  }, [ragDebugMode, ragDebugResults]);

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
    } else if (layoutMode === 'force') {
      // Relacional: las ARISTAS dan la forma. Soltamos las posiciones fijas y dejamos
      // correr la simulación física — repulsión fuerte (nodos bien separados) +
      // atracción por relación. Así saltan a la vista hubs, puentes y aislados.
      graphData.nodes.forEach(n => {
        n.fx = undefined; n.fy = undefined; n.fz = undefined;
        if (n.x == null || !Number.isFinite(n.x)) {
          n.x = (Math.random() - 0.5) * 140;
          n.y = (Math.random() - 0.5) * 140;
          n.z = (Math.random() - 0.5) * 140;
        }
        n.vx = 0; n.vy = 0; n.vz = 0;
      });
      const charge = fg.d3Force('charge');
      if (charge) charge.strength(-230).distanceMax(SCALE * 12);  // separación amplia, sin explotar
      const link = fg.d3Force('link');
      if (link) link.distance(SCALE * 1.4).strength(0.32);
      fg.d3ReheatSimulation?.();
    }

    // Etiqueta flotante por cluster — SOLO en modo Densidad, donde los nodos de un
    // grupo están realmente juntos (en UMAP/PCA/Centroides quedan dispersos y la
    // etiqueta flotaría en el vacío). Se coloca sobre cada grupo.
    const scene = fg.scene();
    clusterLabelSprites.current.forEach(s => scene.remove(s));
    clusterLabelSprites.current = [];
    clusterHulls.current.forEach(m => {
      scene.remove(m); m.geometry?.dispose?.(); m.material?.dispose?.();
    });
    clusterHulls.current = [];

    // Densidad y UMAP: en ambos los grupos quedan espacialmente juntos, asi que
    // la burbuja y la etiqueta significan algo. En Relacional manda la fisica de
    // vinculos y los grupos se entremezclan: ahi la burbuja mentiria.
    if (layoutMode === 'density' || layoutMode === 'components') {
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

        /* Burbuja del grupo: esfera translucida que encierra a sus miembros.
           Responde a "no se a que cluster corresponde cada nodo": el color solo
           obliga a recordar diez tonos; el encierro se ve de una. Se dibuja por
           dentro (BackSide) y sin escribir profundidad para que NO tape nodos. */
        const cyG = members.reduce((a, n) => a + (n.fy ?? n.y ?? 0), 0) / members.length;
        // Radio ROBUSTO: percentil 75 de las distancias, no el maximo. Un solo nodo
        // lejano inflaba la esfera hasta cubrir la pantalla; el percentil encierra
        // el cuerpo del grupo e ignora al outlier.
        const dist = members
          .map(n => Math.hypot(
            (n.fx ?? n.x ?? 0) - cx, (n.fy ?? n.y ?? 0) - cyG, (n.fz ?? n.z ?? 0) - cz,
          ))
          .sort((a, b) => a - b);
        const p75 = dist[Math.min(dist.length - 1, Math.floor(dist.length * 0.75))] || 0;
        const radio = Math.max(5, Math.min(p75 * 1.15, 46));
        const hull = new THREE.Mesh(
          new THREE.SphereGeometry(radio, 24, 18),
          new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.045,
            side: THREE.BackSide, depthWrite: false, depthTest: true,
            // NORMAL, no aditivo: con aditivo la luz se ACUMULA donde dos burbujas
            // se solapan y el centro del grafo se volvia una mancha gris.
            blending: THREE.NormalBlending, toneMapped: false, fog: false,
          }),
        );
        hull.position.set(cx, cyG, cz);
        hull.renderOrder = -1;
        hull.userData.cid = key;
        // Burbuja desactivada: en las referencias los grupos se distinguen por
        // SEPARACION y por color de arista interna, no por un volumen encima.
        hull.visible = false;
        scene.add(hull);
        clusterHulls.current.push(hull);

        const sprite = buildClusterTextSprite(labelText, color);
        // La etiqueta va SOBRE el centro de su grupo, no arriba del nodo mas alto:
        // con maxY quedaban todas amontonadas en el techo y no se sabia a cual
        // correspondia cada una. Un desplazamiento chico alcanza para no tapar nodos.
        const cyLbl = members.reduce((a, n) => a + (n.fy ?? n.y ?? 0), 0) / members.length;
        sprite.position.set(cx, cyLbl + 4, cz);
        sprite.userData.cid = key;
        // PERF: inicializar ocultas, se muestran solo en zoom intermedio
        sprite.visible = SHOW_CLUSTER_LABELS;
        scene.add(sprite);
        clusterLabelSprites.current.push(sprite);
      });
    }

    // reheat SIEMPRE: aplica las posiciones nuevas (los layouts fijos "acomodan" los nodos;
    // Relacional corre la física). El ENCUADRE de cámara lo hace handleEngineStop una sola
    // vez tras asentarse, y SOLO si cambió el modo o es la primera carga → no se viene encima
    // en cada refresh de datos.
    fg.d3ReheatSimulation();
    wakeRef.current();

    const layoutChanged = prevLayoutRef.current !== layoutMode;
    prevLayoutRef.current = layoutMode;
    if (layoutChanged || !didFitRef.current) {
      didFitRef.current = true;
      fitPendingRef.current = true;
      userInteracted.current = false;
    }
  }, [graphData, layoutMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Estado visual: atenuar las tarjetas no resaltadas, agrandar la seleccionada.
  // RAG Debug: resaltar nodos recuperados, atenuar el resto.
  useEffect(() => {
    // Vecinos directos del nodo elegido (para mostrarles el nombre).
    const conectados = new Set();
    if (selectedNode) {
      graphData.links.forEach(l => {
        const s = l.source?.id ?? l.source, t2 = l.target?.id ?? l.target;
        if (s === selectedNode.id) conectados.add(t2);
        else if (t2 === selectedNode.id) conectados.add(s);
      });
    }
    spriteMap.current.forEach((obj, id) => {
      const ud = obj.userData;
      if (!ud?.face) return;
      const isSel = selectedNode?.id === id;
      
      // RAG Debug: nodos recuperados se resaltan, el resto se atenúa fuertemente
      const isRagHit = ragNodeIds.has(id);
      const ragActive = ragNodeIds.size > 0;
      
      // isDim: atenuado por búsqueda normal O por RAG debug (no recuperado)
      const isDim = ragActive
        ? !isRagHit && !isSel  // RAG mode: solo brillan los recuperados + seleccionado
        : (highlighted.size > 0 && !highlighted.has(id));
      
      // Lo seleccionado se marca por FORMA (anillo + escala), no sólo por opacidad:
      // un delta de 0.9 a 1.0 en un punto de 2px era imperceptible.
      // Lo atenuado baja más que antes, para que el foco realmente destaque.
      const faceOpacity = isDim ? (ragActive ? 0.08 : 0.16) : 1;
      ud.face.material.opacity = faceOpacity;
      ud.caption.material.opacity = isDim ? 0.05 : (isSel ? 1 : 0.62);
      
      // Escala de tarjeta: base (labelScale) + boost por selección/RAG hit
      // Seleccionado: +30% para destacar el preview
      // RAG hit: +20% para identificar resultados
      const boost = isSel ? 1.3 : (isRagHit && ragActive ? 1.2 : 1);
      ud.face.scale.set(ud.baseFW * boost, ud.baseFH * boost, 1);

      // Punto LOD (vista lejana): conserva SU color de grupo — cambiarlo a cian
      // hacía perder la referencia de a qué tema pertenece el nodo elegido.
      // RAG hits: cambiar a color distintivo (cian brillante)
      if (ud.dot) {
        if (isRagHit && ragActive) {
          ud.dot.material.color.set('#00FFFF');  // cian brillante para RAG hits
          ud.dot.material.opacity = 1;
          ud.dot.scale.setScalar(ud.dotBase * 1.5);
        } else {
          ud.dot.material.color.set(ud.dotColor);
          ud.dot.material.opacity = isDim ? (ragActive ? 0.06 : 0.12) : (isSel ? 1 : 0.88);
          ud.dot.scale.setScalar(isSel ? ud.dotBase * 1.45 : ud.dotBase);
        }
      }
      // Halo de grupo (vista cercana): atenuar / realzar, sutil.
      if (ud.halo) {
        if (isRagHit && ragActive) {
          ud.halo.material.opacity = 0.5;  // halo más visible para RAG hits
        } else {
          ud.halo.material.opacity = isDim ? 0.02 : (isSel ? 0.34 : 0.2);
        }
      }

      // Anillo: la señal principal de "esto es lo que estás tocando".
      // Al seleccionar, los VECINOS muestran su nombre: saber con que se conecta
      // es la pregunta que uno se hace al clickear, y antes habia que adivinarla.
      if (ud.caption) {
        const vecino = selectedNode ? conectados.has(id) : false;
        /* `conectados` son los VECINOS, no incluye al nodo elegido: sin isSel aca,
           el documento en foco era el unico sin nombre visible. */
        // RAG hits siempre muestran caption
        ud.caption.visible = isSel || vecino || (isRagHit && ragActive) || (!isDim && !LOD_FAR);
        if (isSel) ud.caption.material.opacity = 1;
        else if (vecino) ud.caption.material.opacity = 0.95;
        else if (isRagHit && ragActive) ud.caption.material.opacity = 0.9;
        ud.forzarCaption = isSel || vecino || (isRagHit && ragActive);
      }
      if (ud.ring) {
        ud.ring.visible = false;   // retícula retirada a pedido: molestaba mas de lo que marcaba
        ud.ring.material.opacity = 0;
      }
    });
    wakeRef.current();  // renderizar el cambio de highlight/selección (luego idle)
  }, [highlighted, selectedNode, graphData, ragNodeIds]);

  // FIX: actualizar escala de captions Y tarjetas cuando cambia labelScale
  useEffect(() => {
    spriteMap.current.forEach((obj) => {
      const ud = obj.userData;
      // Escalar caption
      if (ud?.caption?.userData?.baseScaleX) {
        const capUd = ud.caption.userData;
        ud.caption.scale.set(capUd.baseScaleX * labelScale, capUd.baseScaleY * labelScale, 1);
      }
      // Escalar tarjeta (face) - las miniaturas también deben escalar
      if (ud?.face && ud?.baseFW && ud?.baseFH) {
        ud.face.scale.set(ud.baseFW * labelScale, ud.baseFH * labelScale, 1);
        // Reposicionar caption debajo de la tarjeta escalada
        if (ud.caption) {
          const scaledFH = ud.baseFH * labelScale;
          ud.caption.position.y = -(scaledFH / 2) - (ud.caption.userData?.worldH || 1) / 2 - 0.8;
        }
      }
    });
    wakeRef.current();
  }, [labelScale]);

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
    // Vista inicial ALEJADA: se entra viendo todo el grafo, no metido adentro.
    const t = setTimeout(() => {
      fgRef.current?.zoomToFit(900, 60);
      wakeRef.current();
    }, 700);
    return () => clearTimeout(t);
  }, [graphData.nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Botón "Ver todo" (desenfocar): vuelve a la vista general con zoomToFit.
  useEffect(() => {
    if (fitTrigger === 0 || !fgRef.current) return;
    userInteracted.current = false;
    fgRef.current.zoomToFit(800, 70);
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
          const bloom = new UnrealBloomPass(bloomRes, 0.05, 0.3, 0.92); // strength, radius, threshold — sutil, no gamer
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
      controls.minDistance = 8;      // deja acercarse de verdad a leer una tarjeta
      controls.maxDistance = 2600;   // y alejarse a ver el corpus entero
      if ('enableDamping' in controls) {
        controls.enableDamping = true;
        // Damping algo más bajo: el movimiento se siente continuo en vez de cortado,
        // sin llegar al drift que obligaba a corregir de más.
        controls.dampingFactor = 0.18;
        controls.rotateSpeed   = 0.6;
        controls.zoomSpeed     = 1.05;  // el 0.7 anterior exigía muchas vueltas de rueda
        controls.panSpeed      = 0.6;
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
      // Umbral mas exigente: las tarjetas aparecen recien bien cerca, cuando hay
      // pocos documentos en cuadro y hay lugar para leerlas.
      const FAR_IN = R * 2.0, FAR_OUT = R * 1.45;
      const d = cam.position.distanceTo(ctr.target);
      let far = LOD_FAR;
      if (d > FAR_IN) far = true; else if (d < FAR_OUT) far = false;
      const changed = far !== LOD_FAR;
      if (changed) LOD_FAR = far;

      // PERF: las etiquetas de cluster solo se ven en zoom intermedio (no muy cerca, no muy lejos)
      // Fix: escalar inversamente al zoom para que no crezcan y tapen todo al acercarse
      const LABEL_SHOW = R * 3.2, LABEL_HIDE = R * 0.9;  // rango más amplio pero con escala controlada
      const showLabels = d > LABEL_HIDE && d < LABEL_SHOW;
      if (showLabels !== SHOW_CLUSTER_LABELS) {
        SHOW_CLUSTER_LABELS = showLabels;
        clusterLabelSprites.current.forEach(s => { s.visible = showLabels; });
      }
      
      // FIX: escalar etiquetas de cluster inversamente al zoom para tamaño visual constante
      // Al acercarse (d pequeña) → escala baja; al alejarse → escala normal (1)
      // Esto evita que las pills gigantes tapen los nodos
      if (showLabels) {
        const baseScale = 1.0;  // escala de referencia a distancia media
        const refDist = R * 2.0;  // distancia de referencia
        // Escala inversa con límites: min 0.3 (muy cerca), max 1.2 (lejos)
        const clusterLabelScale = Math.min(1.2, Math.max(0.3, (d / refDist) * baseScale));
        clusterLabelSprites.current.forEach(s => {
          s.scale.setScalar(clusterLabelScale);
        });
      }

      // PERF: aristas más tenues de lejos (menos overdraw visual, más legible)
      const newAlphaMult = d > R * 2.5 ? 0.25 : (d > R * 1.5 ? 0.5 : 1.0);
      if (Math.abs(newAlphaMult - LINK_ALPHA_MULT) > 0.05) {
        LINK_ALPHA_MULT = newAlphaMult;
        _linkColorCache.clear(); // forzar recálculo de colores
      }

      if (true) {
        // En modo lejos, escalar los puntos ∝ distancia → tamaño ~constante en pantalla
        // (un sprite normal se achica con la distancia y desaparecería). El coeficiente
        // 0.02 es el look original; el Math.min(...) es un TOPE para que al alejarte mucho
        // no crezcan sin límite y se vuelvan blobs brillantes (era el "brilla al zoom").
        const dotScale = Math.min(7, Math.max(2.5, d * 0.02));

        // TOPE DE TARJETAS. Antes, al acercarse, TODOS los nodos mostraban su
        // tarjeta con titulo: 65 tarjetas superpuestas eran ilegibles (y con miles
        // seria imposible). Ahora solo las N mas cercanas a la camara se abren;
        // el resto queda como punto. Es tambien lo que hace viable escalar.
        const MAX_TARJETAS = 12;
        let cercanos = null;
        if (!far) {
          cercanos = new Set(
            [...spriteMap.current.entries()]
              .map(([id, obj]) => [id, cam.position.distanceToSquared(obj.position)])
              .sort((a, b) => a[1] - b[1])
              .slice(0, MAX_TARJETAS)
              .map(([id]) => id),
          );
        }
        spriteMap.current.forEach((obj, id) => {
          const ud = obj.userData;
          const comoPunto = far || (cercanos ? !cercanos.has(id) : false);
          // FIX: pasar estado de hover para mantener caption visible al pasar el mouse
          const isHovered = hoverIdRef.current === id;
          setNodeLOD(ud, comoPunto, isHovered);
          if (comoPunto && ud.dot) ud.dot.scale.setScalar(far ? dotScale : ud.dotBase);
        });
        // NO llamar a wake() acá: este handler corre dentro del evento 'change' de los
        // controles; el otro listener ya despierta el loop. Llamar resumeAnimation acá
        // re-dispara 'change' → recursión infinita.
      }
    };
    // PERF: throttle updateLOD para no recalcular en cada frame de arrastre
    const throttledLOD = throttle(updateLOD, 50);
    if (controls) controls.addEventListener('change', throttledLOD);
    // Estado inicial (fuera del evento 'change' → acá sí es seguro despertar).
    setTimeout(() => { updateLOD(); wakeRef.current(); }, 400);
  }, []);


  const nodeVisibility = useCallback(node => {
    if (!filteredIds) return true;
    return filteredIds.has(node.id);
  }, [filteredIds]);

  // Líneas finas tipo telaraña: blanco/gris claro, rectas (sin cian grueso).
  /* Las aristas son el cuerpo visual de la red, no un detalle de fondo.
     Toman el color del nodo de origen: así el tejido se lee por tema y el grafo
     deja de ser una telaraña gris uniforme. */
  /* Sin realimentacion visual no habia forma de saber que una linea era
     apuntable: el cursor cambiaba, pero con lineas de 1px el cursor tapa
     justamente lo que estas apuntando. Encender la relacion bajo el puntero
     hace visible el blanco antes de hacer clic. */
  const [hoverLink, setHoverLink] = useState(null);
  
  // FIX: tooltip con nombre completo del documento en hover
  const [nodeTooltip, setNodeTooltip] = useState(null); // { text, x, y }

  const linkColor = useCallback(link => {
    // PERF: cache de colores por arista - invalidar cuando cambian selección/hover
    const cacheKey = `${selectedNode?.id || ''}_${highlighted.size}_${hoverLink?.__id || ''}`;
    if (cacheKey !== _linkColorCacheKey) {
      _linkColorCache.clear();
      _linkColorCacheKey = cacheKey;
    }
    const linkId = `${link.source?.id ?? link.source}_${link.target?.id ?? link.target}`;
    const isHover = hoverLink && link === hoverLink;
    const fullKey = `${linkId}_${isHover ? 'h' : ''}`;
    const cached = _linkColorCache.get(fullKey);
    if (cached) return cached;

    const nodoOrigen = typeof link.source === 'object' ? link.source : null;
    const nodoDestino = typeof link.target === 'object' ? link.target : null;
    const s = link.source?.id ?? link.source;
    const t = link.target?.id ?? link.target;
    const enFoco = s === selectedNode?.id || t === selectedNode?.id;
    const hayFoco = !!selectedNode || highlighted.size > 0;

    const issue = nodoOrigen?.is_issue || nodoDestino?.is_issue;

    const gkO = nodoOrigen ? groupKey(nodoOrigen) : null;
    const gkD = nodoDestino ? groupKey(nodoDestino) : null;
    const mismoGrupo = gkO != null && gkO === gkD;

    // Aristas GRIS NEUTRO por defecto - el color está en los nodos, no en las líneas
    // Solo resaltamos con color en hover/selección
    let rgb, alphaBase;
    if (issue) { 
      rgb = hexToRgb(NODE.issue); alphaBase = 0.5; 
    } else {
      // Gris neutro para TODAS las aristas (mismo grupo o no)
      rgb = '120,135,160'; 
      alphaBase = link.spoke ? 0.15 : (mismoGrupo ? 0.28 : 0.18);
    }

    let result;
    if (isHover) {
      // FIX: hover más brillante (cian/turquesa) para destacar claramente la arista
      result = 'rgba(47,224,200,1)';  // turquesa sólido, muy visible
    } else {
      // PERF: aplicar multiplicador de opacidad según zoom
      const alpha = (!hayFoco ? alphaBase : (enFoco ? 1 : 0.04)) * LINK_ALPHA_MULT;
      result = `rgba(${rgb},${Math.max(0.02, alpha)})`;
    }
    _linkColorCache.set(fullKey, result);
    return result;
  }, [selectedNode, highlighted, hoverLink]);

  /* FIX: linkWidth > 0 en hover para que la arista sea más visible y fácil de
     seleccionar. Con linkWidth > 0, react-force-graph dibuja un cilindro en lugar
     de THREE.Line (1px). Solo engrosamos en hover para no saturar el grafo. */
  const linkWidth = useCallback(link => {
    if (hoverLink && link === hoverLink) return 2;  // arista hover más gruesa
    return 0;  // el resto sigue siendo 1px
  }, [hoverLink]);

  /* Curvatura: las líneas rectas leen como diagrama de ingeniería; las curvas
     leen como filamento. Es el cambio que más acerca el grafo a una red neuronal.
     Se varía por par de nodos para que las aristas paralelas no se superpongan. */
  const linkCurvature = useCallback(link => {
    const s = String(link.source?.id ?? link.source ?? '');
    const t = String(link.target?.id ?? link.target ?? '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return 0.10 + (h % 100) / 100 * 0.10;   // 0.10 .. 0.20
  }, []);

  // Hover: anillo tenue del color del grupo. Distinto de la selección (anillo blanco
  // y opaco), para que se distinga "lo que estoy señalando" de "lo que elegí".
  // FIX: también mostrar caption y agrandar tarjeta en hover para identificar el documento
  const paintHover = useCallback((id, on) => {
    const ud = spriteMap.current.get(id)?.userData;
    if (!ud?.ring) return;
    const isSel = selectedNode?.id === id;
    if (isSel) return;                       // la selección manda: no la piso
    ud.ring.visible = false;
    ud.ring.material.opacity = 0;
    if (ud.dot) ud.dot.scale.setScalar(on ? ud.dotBase * 1.2 : ud.dotBase);
    // FIX: agrandar tarjeta en hover para ver mejor el preview
    if (ud.face && ud.baseFW && ud.baseFH) {
      const hoverBoost = on ? 1.15 : 1;  // +15% en hover
      ud.face.scale.set(ud.baseFW * hoverBoost, ud.baseFH * hoverBoost, 1);
    }
    // FIX: mostrar caption en hover incluso en modo puntos para identificar el documento
    if (ud.caption) {
      ud.caption.visible = on || !LOD_FAR || !!ud.forzarCaption;
      ud.caption.material.opacity = on ? 1 : (ud.forzarCaption ? 0.95 : 0.62);
    }
  }, [selectedNode]);

  // FIX: proyectar posición 3D del nodo a coordenadas de pantalla para el tooltip
  const projectNodeToScreen = useCallback((node) => {
    if (!node || !fgRef.current) return null;
    const fg = fgRef.current;
    const camera = fg.camera();
    const renderer = fg.renderer();
    if (!camera || !renderer) return null;
    
    const pos = new THREE.Vector3(node.x || 0, node.y || 0, node.z || 0);
    pos.project(camera);
    
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    
    // Convertir de coordenadas normalizadas (-1 a 1) a píxeles
    const x = (pos.x * 0.5 + 0.5) * rect.width;
    const y = (-pos.y * 0.5 + 0.5) * rect.height;
    
    // Solo mostrar si está frente a la cámara
    if (pos.z > 1) return null;
    
    return { x, y };
  }, []);

  // PERF: throttle del hover para reducir recálculos en mousemove
  // FIX: tooltip sigue al nodo (proyección 3D → 2D)
  const handleHoverRaw = useCallback((node) => {
    document.body.style.cursor = node ? (synthMode ? 'crosshair' : 'pointer') : 'default';
    const prev = hoverIdRef.current;
    const next = node?.id ?? null;
    if (prev !== next) {
      if (prev) paintHover(prev, false);
      if (next) paintHover(next, true);
      hoverIdRef.current = next;
      wakeRef.current();
      
      // FIX: tooltip anclado al nodo (proyección 3D)
      if (node && node.label) {
        const screenPos = projectNodeToScreen(node);
        if (screenPos) {
          setNodeTooltip({
            text: node.label,
            x: screenPos.x + 20,  // offset a la derecha del nodo
            y: screenPos.y - 10,  // ligeramente arriba
            nodeId: node.id,      // para actualizar posición en render
          });
        } else {
          setNodeTooltip({ text: node.label, x: 20, y: 20, nodeId: node.id });
        }
      } else {
        setNodeTooltip(null);
      }
    }
    if (onNodeHover) onNodeHover(node || null);
  }, [onNodeHover, synthMode, paintHover, projectNodeToScreen]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleHover = useMemo(() => throttle(handleHoverRaw, 32), [handleHoverRaw]);

  // PERF: throttle del hover de links para reducir recálculos
  const handleLinkHoverRaw = useCallback(link => {
    document.body.style.cursor = link ? 'pointer' : 'default';
    setHoverLink(link || null);
    wakeRef.current?.();
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleLinkHover = useMemo(() => throttle(handleLinkHoverRaw, 48), [handleLinkHoverRaw]);

  // PERF: skipea el recálculo de posiciones de etiquetas si no son visibles
  const handleEngineTick = useCallback(() => {
    wakeRef.current();  // mantiene el render vivo mientras la física corre
    // Skip cluster updates if no labels/hulls or labels are hidden
    if (!clusterLabelSprites.current.length && !clusterHulls.current.length) return;
    if (!SHOW_CLUSTER_LABELS && !clusterHulls.current.some(h => h.visible)) return;

    const clusterGroups = {};
    graphData.nodes.forEach(n => {
      const k = groupKey(n);
      if (k == null) return;
      (clusterGroups[k] ??= []).push(n);
    });
    clusterHulls.current.forEach(hull => {
      if (!hull.visible) return;
      const members = clusterGroups[hull.userData.cid];
      if (!members || !members.length) return;
      const cx = members.reduce((a, n) => a + (n.x || 0), 0) / members.length;
      const cy = members.reduce((a, n) => a + (n.y || 0), 0) / members.length;
      const cz = members.reduce((a, n) => a + (n.z || 0), 0) / members.length;
      hull.position.set(cx, cy, cz);
    });
    if (!SHOW_CLUSTER_LABELS) return;
    clusterLabelSprites.current.forEach(sprite => {
      if (!sprite.visible) return;
      const cid = sprite.userData.cid;
      const members = clusterGroups[cid];
      if (!members || !members.length) return;
      const cx = members.reduce((s, n) => s + (n.x || 0), 0) / members.length;
      const cz = members.reduce((s, n) => s + (n.z || 0), 0) / members.length;
      const maxY = members.reduce((max, n) => Math.max(max, n.y || 0), -Infinity);
      sprite.position.set(cx, maxY + 8, cz);
    });
  }, [graphData]);

  /* Grafo pesado = todos los nodos vienen con posicion fija del backend. Correr
     la simulacion de fuerzas sobre 4.488 nodos fijos es trabajo puro al pedo: cada
     tick recalcula fuerzas para moverlos a donde YA estan. Eso es lo que tildaba
     la maquina al entrar a Fragmentos. */
  const esPesado = graphData.nodes.length > 500;

  /* Retrocede la camara sobre su propio eje conservando el punto mirado. */
  const alejar = useCallback((factor) => {
    const fg = fgRef.current; if (!fg) return;
    const cam = fg.camera(); const ctr = fg.controls();
    const tgt = ctr?.target || { x: 0, y: 0, z: 0 };
    const dx = cam.position.x - tgt.x, dy = cam.position.y - tgt.y, dz = cam.position.z - tgt.z;
    fg.cameraPosition(
      { x: tgt.x + dx * factor, y: tgt.y + dy * factor, z: tgt.z + dz * factor }, tgt, 700);
    wakeRef.current();
  }, []);

  const handleEngineStop = useCallback(() => {
    // Encuadrar UNA sola vez, al asentarse la simulación, y solo si quedó pendiente (cambio
    // de modo / primera carga). En un refresh de datos NO se toca la cámara → no se viene
    // encima. zoomToFit se adapta al contenido → no queda "lejos" como la posición fija.
    if (fitPendingRef.current && !userInteracted.current) {
      fitPendingRef.current = false;
      // Un solo encuadre. Antes habia tres (700/1600/3000 ms) porque la fisica
      // seguia expandiendo el grafo despues del primero; ahora el layout llega ya
      // asentado desde warmupTicks, asi que reencuadrar de nuevo solo se veia como
      // una camara que no termina de decidirse.
      const margen = layoutMode === 'density' ? 20
                   : layoutMode === 'force'   ? 55
                   : 45;
      setTimeout(() => {
        if (userInteracted.current) return;
        fgRef.current?.zoomToFit(600, margen);
        wakeRef.current();
      }, layoutMode === 'force' ? 220 : 0);
    }
    wakeRef.current();  // render del frame final asentado (luego entra en idle)
  }, [layoutMode]);

  /* Zoom explícito: acerca o aleja la cámara sobre su propio eje, conservando el
     punto que estás mirando. La rueda existía, pero no había control visible. */
  const zoomBy = useCallback(factor => {
    const fg = fgRef.current;
    if (!fg) return;
    userInteracted.current = true;
    const cam = fg.camera();
    const ctr = fg.controls();
    const tgt = ctr?.target || { x: 0, y: 0, z: 0 };
    const dx = cam.position.x - tgt.x;
    const dy = cam.position.y - tgt.y;
    const dz = cam.position.z - tgt.z;
    const d  = Math.hypot(dx, dy, dz) || 1;
    const min = ctr?.minDistance ?? 8;
    const max = ctr?.maxDistance ?? 2600;
    const nd  = Math.max(min, Math.min(max, d * factor));
    const k   = nd / d;
    fg.cameraPosition(
      { x: tgt.x + dx * k, y: tgt.y + dy * k, z: tgt.z + dz * k },
      tgt,
      260
    );
    wakeRef.current();
  }, []);

  return (
    <div className="graph-stage" ref={stageRef}>
      <div className="zoom-controls" role="group" aria-label="Zoom del grafo">
        <button className="zoom-btn" onClick={() => zoomBy(0.72)}
                title="Acercar" aria-label="Acercar">+</button>
        <button className="zoom-btn" onClick={() => zoomBy(1.38)}
                title="Alejar" aria-label="Alejar">−</button>
        <button className="zoom-btn zoom-btn--fit"
                onClick={() => { userInteracted.current = false; fgRef.current?.zoomToFit(700, 70); wakeRef.current(); }}
                title="Encuadrar todo" aria-label="Encuadrar todo">⊡</button>
      </div>
      <ForceGraph3D
        ref={fgRef}
        width={stageSize.w || undefined}
        height={stageSize.h || undefined}
        graphData={graphData}
        controlType="orbit"
        /* enableNodeDrag viene en TRUE por defecto: cualquier arrastre que empiece
           sobre un nodo lo MUEVE en vez de orbitar la camara. Con las areas de
           impacto agrandadas, practicamente todo arrastre empezaba sobre algo y la
           rotacion se volvia imposible. Ademas, mover nodos a mano no tiene sentido
           aca: las posiciones las calcula UMAP/densidad, no el usuario.
           Con esto, arrastrar SIEMPRE gira; hacer clic sigue seleccionando. */
        enableNodeDrag={false}
        backgroundColor={NODE.bg}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        nodeVisibility={nodeVisibility}
        nodeLabel=""
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkCurvature={linkCurvature}
        linkOpacity={1}
        linkDirectionalParticles={0}
        onNodeClick={onNodeClick}
        onNodeHover={handleHover}
        onLinkClick={onLinkClick}
        /* FIX: área de detección más generosa para facilitar selección de aristas.
           Una línea de 1px es casi imposible de acertar. Aumentado a 35. */
        linkHoverPrecision={35}
        onLinkHover={handleLinkHover}
        onEngineTick={handleEngineTick}
        onEngineStop={handleEngineStop}
        showNavInfo={false}
        /* Relacional (force) convergía en ~9 s: demasiado para un cambio de vista.
           Se acelera el enfriado y se hace más warmup FUERA de pantalla, de modo que
           al aparecer el layout ya esté casi asentado en vez de reacomodarse a la vista. */
        d3AlphaDecay={layoutMode === 'force' ? 0.10 : 0.06}
        d3VelocityDecay={layoutMode === 'force' ? 0.55 : 0.6}
        warmupTicks={esPesado ? 0 : (layoutMode === 'force' ? 280 : 0)}
        cooldownTicks={esPesado ? 0 : (layoutMode === 'force' ? 30 : 6)}
        cooldownTime={esPesado ? 0 : (layoutMode === 'force' ? 800 : 600)}
      />
      
      {/* FIX: Tooltip con nombre completo del documento */}
      {nodeTooltip && (
        <div 
          className="graph-node-tooltip"
          style={{
            position: 'absolute',
            left: nodeTooltip.x,
            top: nodeTooltip.y,
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          {nodeTooltip.text}
        </div>
      )}
    </div>
  );
}
