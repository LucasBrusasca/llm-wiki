import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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

const GLYPHS = {
  pdf: 'PDF', tesis: 'PDF', excel: 'XLS', audio: '♫', html: '◍', word: 'DOC',
  youtube: '▶', image: '▣', video: '▶', concepto: '◇',
};

// Tarjeta neutra (sin miniatura): rectángulo oscuro + borde fino + glyph del tipo.
function makeNeutralCardTexture(node) {
  const cw = 128, ch = 96;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = NODE.card; ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = NODE.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, cw - 1.5, ch - 1.5);
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
function makeThumbCardTexture(img) {
  const ar = (img.naturalWidth / img.naturalHeight) || 1;
  const M = 128; let w, h;
  if (ar >= 1) { w = M; h = Math.max(8, Math.round(M / ar)); }
  else { h = M; w = Math.max(8, Math.round(M * ar)); }
  const pad = 3, cw = w + pad * 2, ch = h + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0c1118'; ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, pad, pad, w, h);
  ctx.fillStyle = 'rgba(8,10,14,0.12)'; ctx.fillRect(pad, pad, w, h); // dim sutil
  ctx.strokeStyle = NODE.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, cw - 1.5, ch - 1.5);
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

// ¿El nodo puede tener miniatura real? (pdf/imagen/youtube/video)
const THUMB_FUENTES = new Set(['pdf', 'tesis', 'youtube', 'image', 'video']);
function hasThumb(node) {
  if (node.is_issue) return false;
  if (node.thumb_data) return true; // miniatura incrustada (demo estático sin backend)
  const f = (node.fuente || '').toLowerCase();
  if (THUMB_FUENTES.has(f)) return true;
  return /\.(pdf|png|jpe?g|gif|webp|bmp|mp4|webm|mov|m4v)$/i.test(node.fuente_path || '');
}

/* ── Nodo = tarjeta rectangular plana con la miniatura del archivo ──
   Sin anillo de mira, sin glow fuerte. Tarjeta neutra para nodos sin miniatura. */
function buildNode(node, degree, maxDegree, texReg) {
  const group = new THREE.Group();
  const faceH = cardHeight(degree, maxDegree);

  // Cara inicial: tarjeta neutra (se reemplaza por la miniatura si carga).
  const { tex, aspect } = makeNeutralCardTexture(node);
  const faceMat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true, toneMapped: true,
  });
  const face = new THREE.Sprite(faceMat);
  let fw = faceH * aspect, fh = faceH;
  face.scale.set(fw, fh, 1);
  face.renderOrder = 2;
  group.add(face);
  if (texReg) { texReg.add(tex); texReg.add(faceMat); }

  // Caption: etiqueta chica debajo de la tarjeta.
  const caption = buildCaption(node.label);
  caption.position.set(0, -(fh / 2) - caption.userData.worldH / 2 - 0.8, 0);
  group.add(caption);
  if (texReg) { texReg.add(caption.material.map); texReg.add(caption.material); }

  group.userData = { face, caption, baseFW: fw, baseFH: fh };

  // ── Miniatura real (lazy-load): reemplaza la tarjeta neutra al cargar ──
  if (hasThumb(node)) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const { tex: ttex, aspect: tar } = makeThumbCardTexture(img);
        const old = faceMat.map;
        faceMat.map = ttex; faceMat.needsUpdate = true;
        fw = faceH * tar; fh = faceH;
        face.scale.set(fw, fh, 1);
        group.userData.baseFW = fw; group.userData.baseFH = fh;
        caption.position.y = -(fh / 2) - caption.userData.worldH / 2 - 0.8;
        if (texReg) { texReg.add(ttex); if (old) texReg.delete(old); }
        if (old) old.dispose?.();
      } catch { /* mantiene la tarjeta neutra */ }
    };
    img.onerror = () => {};                             // 404 → tarjeta neutra
    img.src = node.thumb_data || `/thumb/${encodeURIComponent(node.id)}`;
  }

  return group;
}

function buildClusterTextSprite(text, color) {
  const W = 280, H = 42;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  roundRect(ctx, 1, 1, W - 2, H - 2, 6);
  ctx.fillStyle = 'rgba(6, 11, 22, 0.92)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = "bold 13px 'Courier New', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const display = text.length > 32 ? text.slice(0, 31) + '…' : text;
  ctx.fillText(display, W / 2, H / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(18, 18 * H / W, 1);
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
    const c = (n.cluster != null && n.cluster >= 0) ? String(n.cluster) : '-1';
    (clusters[c] ??= []).push(n);
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
  projectRef,
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

    // Etiquetas de cluster 3D REMOVIDAS: flotaban en el vacío (el centroide de un
    // cluster disperso cae entre nodos) y se encimaban con los captions. La identidad
    // de cada grupo se mostrará, si se desea, con una leyenda 2D fija (HTML).
    const scene = fg.scene();
    clusterLabelSprites.current.forEach(s => scene.remove(s));
    clusterLabelSprites.current = [];

    fg.d3ReheatSimulation();
    wakeRef.current();  // el reheat reinicia ticks → mantener el render vivo
    userInteracted.current = false;

    if (layoutMode === 'components' || layoutMode === 'pca') {
      const t1 = setTimeout(() => { if (!userInteracted.current) fgRef.current?.zoomToFit(700, 80); }, 200);
      const t2 = setTimeout(() => { if (!userInteracted.current) fgRef.current?.zoomToFit(1000, 60); }, 1500);
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
    });
    wakeRef.current();  // renderizar el cambio de highlight/selección (luego idle)
  }, [highlighted, selectedNode]);

  // (Sin fly-to de cámara al seleccionar: clickear un nodo NO mueve el grafo;
  //  abre el panel y resalta, pero la cámara queda donde el usuario la dejó.)

  // One-time scene setup
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (sceneReady.current) return; // idempotente: no duplicar bloom/backdrop en StrictMode
    sceneReady.current = true;
    // Cap de pixelRatio: descarga la GPU integrada sin verse pixelado.
    fg.renderer()?.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));

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
      if (n.cluster == null || n.cluster < 0) return;
      const c = String(n.cluster);
      (clusterGroups[c] ??= []).push(n);
    });
    clusterLabelSprites.current.forEach(sprite => {
      const cid = sprite.userData.cid;
      const members = clusterGroups[cid];
      if (!members || !members.length) return;
      const cx = members.reduce((s, n) => s + (n.x || 0), 0) / members.length;
      const cz = members.reduce((s, n) => s + (n.z || 0), 0) / members.length;
      const maxY = members.reduce((max, n) => Math.max(max, n.y || 0), -Infinity);
      sprite.position.set(cx, maxY + 25, cz);
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
