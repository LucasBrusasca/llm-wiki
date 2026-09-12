import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { nodeDotColor, aclarar, groupKey, sectionColors, BG_COLOR, NO_GROUP_COLOR } from '../nodeColor.js';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSO — campo profundo isoclínico

   No hay contenedores. No hay cubos, ni vidrio, ni una sola malla en la
   escena: lo único que existe son puntos y líneas de 1 px. Cada sección es su
   propia nube de nodos REALES —mismos colores, mismos tamaños, mismas aristas
   grises que el grafo de la app— suspendida en un sitio de una retícula de
   hipercubo que rota isoclínicamente en 4D.

   Cuatro decisiones cargan todo el peso:

   1. La cámara arranca DENTRO de la retícula, no afuera mirándola. Un
      hipercubo centrado con negro alrededor es un modelo matemático sobre una
      mesa; el tesseract de Interstellar es arquitectura que sigue más allá de
      los cuatro bordes del cuadro. Además la retícula se repite en tres
      cáscaras a escala φ, así que alejarse revela más estructura en vez de
      revelar el vacío.

   2. La rotación 4D es isoclínica pura, por multiplicación de cuaternión a
      izquierda. Bajo esa rotación |p′−p| = 2|p|·sin(θ/2) para todo punto, y
      los 16 vértices tienen |p| idéntico: todos se mueven a la misma velocidad
      en todo instante, ninguno frena. Eso es exactamente lo que el ojo lee
      como "la estructura se da vuelta sobre sí misma" en vez de "un objeto
      gira". Con tres ángulos tipo Euler unos sitios frenan y otros aceleran, y
      se lee como gimbal de visor 3D.

   3. Las secciones NO se normalizan al mismo tamaño. Una de 400 nodos es
      genuinamente enorme y una de 22 genuinamente diminuta. Normalizar para
      comparar es una convención de diagrama, y sin jerarquía de escala no hay
      sensación de lugar.

   4. Todo el trabajo por frame vive en el vertex shader. La CPU sube dos
      arrays de uniformes y nada más: cero uploads de buffers, cero objetos por
      sección, 4 draw calls en total. La versión de los cubos hacía 18 renders
      de escena por frame (transmission + Reflector + profundidad del bokeh) y
      medía 29 ms; acá hay 1 render.

   La profundidad de campo sale del vertex shader por el círculo de confusión
   de una lente delgada, no de un BokehPass — su pase de profundidad es un
   segundo render de escena completo, o sea medio presupuesto.
   ══════════════════════════════════════════════════════════════════════════ */

// ── Retícula ────────────────────────────────────────────────────────────────
const PHI = 1.6180339887;
const SHELLS = [1, PHI];                   // la misma retícula, repetida hacia afuera
const SHELL_ALPHA = [1.0, 0.5];
const D4 = 3.4;                            // punto de vista 4D: s = D/(D−w)
const K4 = 96;                             // unidades de mundo por unidad 4D
const MAX_SITES = 16;                      // los 16 vértices; el shader nunca recompila

// ── Nubes ───────────────────────────────────────────────────────────────────
// R = A·count^B con B < 0.5: crece de verdad con el tamaño de la sección, pero
// sublinealmente, así que una sección 20× más grande no tapa a todas las demás.
const R_A = 24;
const R_B = 0.38;
const R_MIN = 55;
const R_MAX = 250;
const GRAPH3D_SCALE = 30;                  // el fx = x3d·30 del layout 'components'

// ── Presupuesto ─────────────────────────────────────────────────────────────
const MAX_PTS = 20000;
const MAX_SEGS = 24000;
const PER_SECTION_NODES = 620;
const PER_SECTION_LINKS = 780;
const DUST_COUNT = 30;

// ── Cámara / entrada ────────────────────────────────────────────────────────
const FOV = 50;                            // el fov de Graph3D: el corte no cambia de lente
const ENTER_FAR = 3.2;                     // × radio de nube: empieza la aproximación
const ENTER_NEAR = 1.15;                   // × radio: umbral de commit (ya estás adentro)
const ENTER_REWIND = 1.8;                  // × radio: histéresis de cancelación
const ZOOM_INTENT_MS = 600;                // hay que estar acercándose a propósito

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};
const popcount = (v) => { let c = 0, t = v; while (t) { c += t & 1; t >>= 1; } return c; };

/* ── Los 16 vértices del 4-cubo y sus 32 aristas ──────────────────────────── */
const V4 = [];
for (let i = 0; i < 16; i++) {
  V4.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1, (i & 8) ? 1 : -1]);
}
const E4 = [];
for (let i = 0; i < 16; i++) {
  for (let k = 0; k < 4; k++) {
    const j = i ^ (1 << k);
    if (j > i) E4.push([i, j]);
  }
}

/* Orden de sitios por inserción de punto más lejano, con chequeo de rango afín.

   El chequeo no es adorno: {0000,1111,0011,1100} son coplanares en R⁴ y
   proyectan a una cruz plana, o sea que la cuarta dimensión desaparece justo
   cuando hay cuatro secciones. Rechazar al candidato que no sube el rango
   garantiza que a partir de cinco secciones el 4D sea visible. */
function affineRank(idx) {
  const basis = [];
  for (let n = 1; n < idx.length; n++) {
    const v = V4[idx[n]].map((x, k) => x - V4[idx[0]][k]);
    for (const b of basis) {
      const d = v.reduce((s, x, k) => s + x * b[k], 0);
      for (let k = 0; k < 4; k++) v[k] -= d * b[k];
    }
    const norm = Math.hypot(v[0], v[1], v[2], v[3]);
    if (norm > 1e-6) basis.push(v.map((x) => x / norm));
  }
  return basis.length;
}

function siteOrder() {
  const chosen = [0];
  const dist2 = (a, b) => {
    let s = 0;
    for (let k = 0; k < 4; k++) { const d = V4[a][k] - V4[b][k]; s += d * d; }
    return s;
  };
  while (chosen.length < 16) {
    const rest = [];
    for (let c = 0; c < 16; c++) {
      if (chosen.includes(c)) continue;
      let min = Infinity;
      let sum = 0;
      for (const s of chosen) { const d = dist2(c, s); min = Math.min(min, d); sum += d; }
      rest.push({ c, min, sum });
    }
    rest.sort((a, b) => b.min - a.min || b.sum - a.sum || a.c - b.c);
    const wantRank = Math.min(4, chosen.length);
    const better = rest.find((r) => affineRank([...chosen, r.c]) >= wantRank);
    chosen.push((better || rest[0]).c);
  }
  return chosen;
}
const SITE_ORDER = siteOrder();

/* ── Rotación isoclínica: p′ = q ⊗ p ──────────────────────────────────────── */
function qmul(a, b, out) {
  out[0] = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3];
  out[1] = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2];
  out[2] = a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1];
  out[3] = a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0];
  return out;
}
/* q0 genérico. Sin él la rotación pasa por la orientación canónica, y ahí las
   32 aristas proyectan a cuadrados alineados con los ejes: literalmente "un
   cubo dentro de otro", que es lo que hay que evitar. Con q0 la retícula queda
   siempre oblicua y lo que se ve son hebras, no cajas. */
const Q0 = (() => {
  const ax = [0.31, 0.72, 0.62];
  const nrm = Math.hypot(ax[0], ax[1], ax[2]);
  const ang = 0.41 * Math.PI;
  const s = Math.sin(ang / 2);
  return new Float32Array([Math.cos(ang / 2), (ax[0] / nrm) * s, (ax[1] / nrm) * s, (ax[2] / nrm) * s]);
})();
const U_HAT = 1 / Math.sqrt(3);

/* ── Muestreo del grafo ─────────────────────────────────────────────────────
   Se quedan los nodos de mayor grado y sólo las aristas entre ellos: un
   muestreo al azar produce polvo desconectado; esto conserva los hubs, o sea
   la silueta reconocible de la sección. */
function sampleGraph(json) {
  const nodes = (json.nodos || []).filter((n) => !n.is_issue && !n.is_centroid);
  const rels = json.relaciones || [];
  const deg = new Map();
  for (const r of rels) {
    deg.set(r.source, (deg.get(r.source) || 0) + 1);
    deg.set(r.target, (deg.get(r.target) || 0) + 1);
  }
  const picked = nodes.length <= PER_SECTION_NODES
    ? nodes
    : [...nodes].sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0)).slice(0, PER_SECTION_NODES);
  const ids = new Set(picked.map((n) => n.id));
  const links = rels.filter((r) => ids.has(r.source) && ids.has(r.target)).slice(0, PER_SECTION_LINKS);
  let maxDeg = 0;
  picked.forEach((n) => { maxDeg = Math.max(maxDeg, deg.get(n.id) || 0); });
  return { total: nodes.length, totalLinks: rels.length, nodes: picked, links, deg, maxDeg };
}

/* Posiciones locales: se PRESERVA la forma real del grafo. Re-esferizar (lo que
   hacía la versión de los cubos) destruye la estructura de clusters, que es
   justo lo único que hay para ver desde lejos. */
function layoutCloud(g) {
  const n = g.nodes.length || 1;
  let cx = 0, cy = 0, cz = 0;
  g.nodes.forEach((nd) => { cx += nd.x3d ?? 0; cy += nd.y3d ?? 0; cz += nd.z3d ?? 0; });
  cx /= n; cy /= n; cz /= n;

  const rel = g.nodes.map((nd) => [(nd.x3d ?? 0) - cx, (nd.y3d ?? 0) - cy, (nd.z3d ?? 0) - cz]);
  // rms, no max: un solo outlier no tiene que encoger la nube entera.
  let sum = 0;
  rel.forEach((v) => { sum += v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; });
  const rms = Math.sqrt(sum / n) || 1;

  const R = Math.min(R_MAX, Math.max(R_MIN, R_A * Math.pow(Math.max(1, g.total), R_B)));
  const k = R / rms;
  const soft = 2.6 * R;
  const pos = rel.map((v) => {
    let x = v[0] * k, y = v[1] * k, z = v[2] * k;
    const r = Math.hypot(x, y, z);
    if (r > 1e-6) {
      const s = (soft * Math.tanh(r / soft)) / r;   // clamp suave del outlier
      x *= s; y *= s; z *= s;
    }
    return [x, y, z];
  });
  // La escala del morph al entrar: en w=1 la nube tiene que ser byte-idéntica
  // al layout 'components' de Graph3D, que fija fx = x3d · 30.
  return { pos, R, toGraph3D: GRAPH3D_SCALE / k };
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [0.5, 0.5, 0.5];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/* ══════════════════════════════════════════════════════════════════════════ */

export default function MultiverseMap({ sections, onSelectSection, onClose, currentSection }) {
  const containerRef = useRef(null);
  const labelRefs = useRef({});
  const apiRef = useRef(null);
  const selectRef = useRef(onSelectSection);
  selectRef.current = onSelectSection;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const [ready, setReady] = useState(0);
  const [candidate, setCandidate] = useState(null);
  const [approach, setApproach] = useState(0);
  const [inside, setInside] = useState(null);   // en qué dimensión estás, si estás en alguna
  const [depth, setDepth] = useState(0);        // 0 = espacio dimensional, 1 = grafo

  const key = sections.map((s) => s.nombre).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => key.split('|').filter(Boolean), [key]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || names.length === 0) return undefined;

    let alive = true;
    let w = container.clientWidth || 1;
    let h = container.clientHeight || 1;

    const scene = new THREE.Scene();
    // El fondo va en la ESCENA, no en setClearColor. setClearColor fija el valor
    // convertido al espacio de salida vigente en ese momento —sRGB, porque
    // todavía no hay render target—, y después el clear() del RenderPass lo
    // escribe crudo en el buffer lineal del composer: OutputPass lo vuelve a
    // codificar y el negro #030508 sale gris #1c2632. scene.background se
    // resuelve por frame con el target ya activo, así que da el color correcto.
    scene.background = new THREE.Color(BG_COLOR);
    const camera = new THREE.PerspectiveCamera(FOV, w / h, 1, 12000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // pixelRatio 1 igual que Graph3D: si el Multiverso rindiera a 2 habría un
    // salto de nitidez justo en el corte hacia el grafo.
    renderer.setPixelRatio(1);
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.NoToneMapping;      // Graph3D tampoco tonemapea
    container.appendChild(renderer.domElement);

    // Único post-proceso, con los parámetros exactos de Graph3D: bloom a media
    // resolución, strength 0.05. Casi gratis, y evita que los núcleos cambien
    // de brillo al cruzar a la otra vista.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2))),
      0.05, 0.3, 0.92,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.14;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 1.05;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 30;
    /* El tope de alejamiento lo fija el CONTENIDO, no la retícula. Con un tope
       fijo y una sola sección, alejarse mostraba una jaula enorme y vacía con
       una manchita de puntos adentro: el anti-ejemplo del wireframe flojo,
       exacto. Atado al contenido, con una sección el tope es ~1.5 radios de esa
       nube (la nube llena el cuadro y la retícula se sale por los bordes), y
       con seis se abre solo hasta ver todo el anillo.
       Se calcula sobre la proyección 4D MÁXIMA, no la del frame: si dependiera
       de la rotación, el tope latiría 4× y el zoom daría tirones. */
    const S_MAX = D4 / (D4 - 2);
    const recomputeMaxDistance = () => {
      let contentR = 0;
      occupied.forEach((v) => {
        const p = V4[v];
        const spread = occupied.size > 1
          ? Math.hypot(p[0], p[1], p[2]) * K4 * S_MAX
          : 0;
        contentR = Math.max(contentR, spread + siteRadius[v]);
      });
      controls.maxDistance = Math.max(200, contentR * 1.5);
    };
    controls.maxDistance = 950;

    // ── Uniformes compartidos ─────────────────────────────────────────────
    const uSite = new Float32Array(MAX_SITES * 4);      // xyz = posición, w = escala interna
    const uSiteMod = new Float32Array(MAX_SITES * 4);   // x = alfa, y = distancia, z = resolución
    /* El tinte es lo que distingue el ESPACIO DIMENSIONAL del espacio del grafo.
       De lejos, toda la nube se pinta del color de identidad de su sección: la
       dimensión se lee como UN objeto y se distingue de un vistazo de las
       demás. Al acercarte, `resolución` va de 0 a 1 y el color se disuelve en
       los colores reales de cluster de cada nodo: ahí ya estás en el grafo. La
       frontera entre los dos espacios es un degradé, no un cambio de pantalla. */
    const uSiteTint = new Float32Array(MAX_SITES * 3);
    const uV4 = new Float32Array(16 * 3);               // vértices ya proyectados

    const common = {
      uSite: { value: uSite },
      uSiteMod: { value: uSiteMod },
      uSiteTint: { value: uSiteTint },
      uH: { value: h },
      uTanHalfFov: { value: Math.tan((FOV * Math.PI) / 360) },
      uFog: { value: 0.00115 },
      uFocus: { value: 500 },
      uCocK: { value: 1.4 },
      uLightDir: { value: new THREE.Vector3(0.48, 0.62, 0.62).normalize() },
      uTime: { value: 0 },
    };

    const SITE_DECL = `
      uniform vec4 uSite[${MAX_SITES}];
      uniform vec4 uSiteMod[${MAX_SITES}];
      uniform vec3 uSiteTint[${MAX_SITES}];
      uniform float uH, uTanHalfFov, uFog, uFocus, uCocK;
      uniform vec3 uLightDir;
    `;

    // ── OBJETO 1: puntos (nodos de todas las secciones + chispas de junta) ──
    const ptGeo = new THREE.BufferGeometry();
    const ptPos = new Float32Array(MAX_PTS * 3);        // offset LOCAL dentro de la nube
    const ptCol = new Float32Array(MAX_PTS * 3);
    const ptSite = new Float32Array(MAX_PTS);
    const ptSize = new Float32Array(MAX_PTS);
    ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
    ptGeo.setAttribute('aColor', new THREE.BufferAttribute(ptCol, 3));
    ptGeo.setAttribute('aSite', new THREE.BufferAttribute(ptSite, 1));
    ptGeo.setAttribute('aSize', new THREE.BufferAttribute(ptSize, 1));
    ptGeo.setDrawRange(0, 0);

    const ptMat = new THREE.ShaderMaterial({
      uniforms: common,
      transparent: true,
      // Oclusión real. Las versiones anteriores tenían depthWrite:false en todo,
      // así que nada tapaba nada nunca: ése es el tell inconfundible de
      // holograma. Escribiendo profundidad, una nube cercana se come las hebras
      // que pasan por detrás, y esa es la señal que convierte un scatter en un
      // lugar. El descarte por alfa bajo evita que la cola del halo escriba.
      depthWrite: true,
      depthTest: true,
      blending: THREE.NormalBlending,
      vertexShader: `
        ${SITE_DECL}
        attribute vec3 aColor;
        attribute float aSite;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSharp;
        void main() {
          int i = int(aSite + 0.5);
          vec4 st = uSite[i];
          vec4 md = uSiteMod[i];
          vec4 mv = modelViewMatrix * vec4(st.xyz + st.w * position, 1.0);
          float z = max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;

          // Tamaño en pantalla: la fórmula literal del far-LOD de Graph3D
          // (dotScale = clamp(d*0.02, 2.5, 7)). Copiarla es lo que hace que el
          // punto no cambie de tamaño en el corte.
          float S = min(7.0, max(2.5, md.y * 0.02)) * (0.5 + 0.5 * aSize);
          float want = S * (uH * 0.5) / (z * uTanHalfFov);

          // Círculo de confusión de lente delgada: crece más rápido hacia la
          // cámara que hacia el fondo, igual que una lente real. Es la
          // profundidad de campo, y sale gratis acá en lugar de costar un pase.
          float coc = uCocK * abs(uFocus / z - 1.0);
          float px = want * (1.0 + coc);

          // Piso sub-píxel. Por debajo de ~1.5 px un punto titila entre frames
          // y el conjunto se lee como polvo sucio; lo que se le saca al tamaño
          // se le devuelve al alfa para no falsear la densidad.
          float sub = min(1.0, (px / 1.5) * (px / 1.5));
          gl_PointSize = max(px, 1.5);

          // Conservación de energía del desenfoque: disco más grande, más tenue.
          float aCoc = 1.0 / (1.0 + coc * coc * 1.7);

          // Dirección de luz. Todo lo demás es emisivo y simétrico; un solo
          // producto punto le da volumen a la nube y la saca de scatter plano.
          float lam = 0.60 + 0.40 * dot(normalize(position + vec3(1e-4)), uLightDir);

          float fz = uFog * z;
          vColor = mix(uSiteTint[i], aColor, md.z) * mix(0.80, 1.08, lam);
          vAlpha = 0.88 * md.x * sub * aCoc * exp(-fz * fz);
          vSharp = 1.0 - min(1.0, coc * 0.75);
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSharp;
        void main() {
          float u = length(gl_PointCoord - 0.5) * 2.0;
          // Reproduce analíticamente los dos gradientes del DOT_TEX de Graph3D
          // (núcleo duro + anillo tenue) sin costar un fetch de textura.
          float core = 1.0 - smoothstep(0.39, 0.56, u);
          float ring = max(0.0, 0.08 * (1.0 - abs(u - 0.76) / 0.20));
          float soft = pow(max(0.0, 1.0 - u), 1.7);
          float a = mix(soft, core + ring, vSharp) * vAlpha;
          if (a < 0.08) discard;   // la cola del halo no escribe profundidad
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    const points = new THREE.Points(ptGeo, ptMat);
    points.frustumCulled = false;
    points.renderOrder = 0;
    scene.add(points);

    // ── OBJETO 2: aristas intra-nube ───────────────────────────────────────
    const lnGeo = new THREE.BufferGeometry();
    const lnPos = new Float32Array(MAX_SEGS * 2 * 3);
    const lnSite = new Float32Array(MAX_SEGS * 2);
    const lnAlpha = new Float32Array(MAX_SEGS * 2);
    lnGeo.setAttribute('position', new THREE.BufferAttribute(lnPos, 3));
    lnGeo.setAttribute('aSite', new THREE.BufferAttribute(lnSite, 1));
    lnGeo.setAttribute('aAlpha', new THREE.BufferAttribute(lnAlpha, 1));
    lnGeo.setDrawRange(0, 0);

    const lnMat = new THREE.ShaderMaterial({
      uniforms: common,
      transparent: true,
      depthWrite: false,
      depthTest: true,     // las nubes tapan sus propias aristas: eso es volumen
      blending: THREE.NormalBlending,
      vertexShader: `
        ${SITE_DECL}
        attribute float aSite;
        attribute float aAlpha;
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          int i = int(aSite + 0.5);
          vec4 st = uSite[i];
          vec4 md = uSiteMod[i];
          vec4 mv = modelViewMatrix * vec4(st.xyz + st.w * position, 1.0);
          float z = max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
          float fz = uFog * z;
          // LINK_ALPHA_MULT de Graph3D: las aristas casi desaparecen de lejos y
          // sólo recuperan presencia cuando ya estás encima de la nube.
          // Las aristas pertenecen al espacio del GRAFO: en el dimensional casi
          // no existen. Sin esto, a media distancia todas las secciones suman
          // sus aristas y la pantalla se vuelve una maraña gris.
          vAlpha = aAlpha * md.x * mix(0.06, 1.0, md.z) * exp(-fz * fz);
          vTint = mix(uSiteTint[i], vec3(0.470, 0.529, 0.627), md.z);
        }`,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vTint;
        void main() {
          if (vAlpha < 0.004) discard;
          gl_FragColor = vec4(vTint, vAlpha);
        }`,
    });
    const links = new THREE.LineSegments(lnGeo, lnMat);
    links.frustumCulled = false;
    links.renderOrder = 1;
    scene.add(links);

    // ── OBJETO 3: hebras de la retícula, en tres cáscaras φ ────────────────
    const SUB = 14;
    const segTotal = E4.length * SUB * SHELLS.length;
    const stGeo = new THREE.BufferGeometry();
    const stPos = new Float32Array(segTotal * 2 * 3);     // placeholder: no se usa
    const stA = new Float32Array(segTotal * 2);
    const stB = new Float32Array(segTotal * 2);
    const stT = new Float32Array(segTotal * 2);
    const stPhase = new Float32Array(segTotal * 2);
    const stShell = new Float32Array(segTotal * 2);
    const stRel = new Float32Array(segTotal * 2);
    {
      let o = 0;
      for (let sh = 0; sh < SHELLS.length; sh++) {
        for (let e = 0; e < E4.length; e++) {
          const [a, b] = E4[e];
          const phase = ((a * 37 + b * 91 + sh * 13) % 100) / 100;
          for (let s = 0; s < SUB; s++) {
            for (const t of [s / SUB, (s + 1) / SUB]) {
              stA[o] = a; stB[o] = b; stT[o] = t; stPhase[o] = phase; stShell[o] = sh;
              o++;
            }
          }
        }
      }
    }
    stGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
    stGeo.setAttribute('aA', new THREE.BufferAttribute(stA, 1));
    stGeo.setAttribute('aB', new THREE.BufferAttribute(stB, 1));
    stGeo.setAttribute('aT', new THREE.BufferAttribute(stT, 1));
    stGeo.setAttribute('aPhase', new THREE.BufferAttribute(stPhase, 1));
    stGeo.setAttribute('aShell', new THREE.BufferAttribute(stShell, 1));
    stGeo.setAttribute('aRel', new THREE.BufferAttribute(stRel, 1));

    const stUniforms = {
      uV4: { value: uV4 },
      uShellScale: { value: new Float32Array(SHELLS) },
      uShellAlpha: { value: new Float32Array(SHELL_ALPHA) },
      uStrand: { value: 1 },
      uTime: common.uTime,
      uFog: common.uFog,
    };
    const stMat = new THREE.ShaderMaterial({
      uniforms: stUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      vertexShader: `
        uniform vec3 uV4[16];
        uniform float uShellScale[${SHELLS.length}];
        uniform float uShellAlpha[${SHELLS.length}];
        uniform float uTime, uFog, uStrand;
        attribute float aA;
        attribute float aB;
        attribute float aT;
        attribute float aPhase;
        attribute float aShell;
        attribute float aRel;
        varying float vAlpha;
        void main() {
          int ia = int(aA + 0.5);
          int ib = int(aB + 0.5);
          int ish = int(aShell + 0.5);
          vec3 p = mix(uV4[ia], uV4[ib], aT) * uShellScale[ish];
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float z = max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;

          // Un pulso que recorre la hebra. Es lo que mantiene la retícula viva
          // con dos secciones, sin subir el brillo base y volverla un wireframe.
          float head = fract(uTime * 0.055 + aPhase);
          float d = abs(aT - head);
          d = min(d, 1.0 - d);
          float pulse = exp(-d * d * 260.0);

          float fz = uFog * z * 0.5;
          vAlpha = (0.010 + 0.17 * aRel + 0.40 * pulse * aRel)
                 * uShellAlpha[ish] * uStrand * exp(-fz * fz);
        }`,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.004) discard;
          gl_FragColor = vec4(0.478, 0.588, 0.698, vAlpha);
        }`,
    });
    const strands = new THREE.LineSegments(stGeo, stMat);
    strands.frustumCulled = false;
    strands.renderOrder = 2;
    scene.add(strands);

    // ── OBJETO 4: polvo de campo cercano ───────────────────────────────────
    // Sin nada en el primer plano el cuadro se lee como render. Estas motas
    // viven cerca de la cámara, muy desenfocadas y cortadas por los bordes: es
    // el movimiento que más rápido dice "hay algo más allá del borde".
    const duGeo = new THREE.BufferGeometry();
    const duPos = new Float32Array(DUST_COUNT * 3);
    {
      let s = 991;
      const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
      for (let i = 0; i < DUST_COUNT; i++) {
        const r = 40 + rnd() * 200;
        const th = rnd() * Math.PI * 2;
        const ph = Math.acos(2 * rnd() - 1);
        duPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        duPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
        duPos[i * 3 + 2] = r * Math.cos(ph);
      }
    }
    duGeo.setAttribute('position', new THREE.BufferAttribute(duPos, 3));
    const duMat = new THREE.ShaderMaterial({
      uniforms: { uDust: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float z = max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(2400.0 / z, 8.0, 56.0);
          vAlpha = 0.016 * smoothstep(420.0, 80.0, z);
        }`,
      fragmentShader: `
        uniform float uDust;
        varying float vAlpha;
        void main() {
          float u = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - u), 2.2) * vAlpha * uDust;
          if (a < 0.002) discard;
          gl_FragColor = vec4(0.62, 0.74, 0.86, a);
        }`,
    });
    const dust = new THREE.Points(duGeo, duMat);
    dust.frustumCulled = false;
    dust.renderOrder = 3;
    scene.add(dust);
    const dustAnchor = new THREE.Vector3(1e9, 0, 0);

    // ── Asignación de sitios ───────────────────────────────────────────────
    const siteOfSection = new Map();
    names.forEach((nm, i) => siteOfSection.set(nm, SITE_ORDER[i % 16]));
    const sectionOfSite = new Map();
    siteOfSection.forEach((si, nm) => sectionOfSite.set(si, nm));
    const occupied = new Set(siteOfSection.values());
    const secColor = sectionColors(names);
    siteOfSection.forEach((si, nm) => {
      const c = hexToRgb(aclarar(secColor.get(nm) || NO_GROUP_COLOR, 0.10));
      uSiteTint[si * 3] = c[0];
      uSiteTint[si * 3 + 1] = c[1];
      uSiteTint[si * 3 + 2] = c[2];
    });

    // Relevancia de cada arista: brilla si conecta dos sitios ocupados, se apaga
    // —pero no desaparece— si no. La retícula existe siempre; lo que cambia es
    // cuánta luz corre por ella. Con dos secciones antipodales se ilumina la
    // geodésica que las une, en vez de dejar el andamio muerto.
    {
      const occ = [...occupied];
      let o = 0;
      for (let sh = 0; sh < SHELLS.length; sh++) {
        for (let e = 0; e < E4.length; e++) {
          const [a, b] = E4[e];
          const both = occupied.has(a) && occupied.has(b);
          const one = occupied.has(a) || occupied.has(b);
          let geo = false;
          if (!both && occ.length > 1) {
            for (let x = 0; x < occ.length && !geo; x++) {
              for (let y = 0; y < occ.length && !geo; y++) {
                if (x === y) continue;
                if (popcount(occ[x] ^ a) + 1 + popcount(b ^ occ[y]) === popcount(occ[x] ^ occ[y])) geo = true;
              }
            }
          }
          const rel = both ? 1.0 : geo ? 0.55 : one ? 0.30 : 0.02;
          for (let s = 0; s < SUB * 2; s++) stRel[o++] = rel;
        }
      }
      stGeo.getAttribute('aRel').needsUpdate = true;
    }

    const siteData = new Array(MAX_SITES).fill(null);
    const sitePos = Array.from({ length: MAX_SITES }, () => new THREE.Vector3());
    const siteScale4D = new Float32Array(MAX_SITES).fill(1);
    const siteRadius = new Float32Array(MAX_SITES).fill(55);
    const siteToG3D = new Float32Array(MAX_SITES).fill(1);
    let ptUsed = 0;
    let lnUsed = 0;

    // Chispa de junta en cada vértice desocupado: la retícula tiene esquinas
    // sin que exista ninguna caja.
    const sparkOf = new Int32Array(MAX_SITES).fill(-1);
    {
      const c = hexToRgb(aclarar(NO_GROUP_COLOR, 0.14));
      for (let v = 0; v < 16; v++) {
        ptCol[ptUsed * 3] = c[0]; ptCol[ptUsed * 3 + 1] = c[1]; ptCol[ptUsed * 3 + 2] = c[2];
        ptSite[ptUsed] = v;
        ptSize[ptUsed] = occupied.has(v) ? 0.0 : 0.32;
        sparkOf[v] = ptUsed;
        ptUsed++;
      }
    }
    recomputeMaxDistance();

    const pushPoints = () => {
      ptGeo.setDrawRange(0, ptUsed);
      ['position', 'aColor', 'aSite', 'aSize'].forEach((a) => { ptGeo.getAttribute(a).needsUpdate = true; });
    };
    pushPoints();

    /* Carga progresiva. La retícula aparece en el primer frame y cada nube se
       materializa cuando llega su fetch: el usuario nunca mira una pantalla en
       blanco, que era la otra mitad de "es re lento". */
    const ingest = (name, json) => {
      if (!alive) return;
      const si = siteOfSection.get(name);
      if (si === undefined) return;
      const g = sampleGraph(json);
      setReady((r) => r + 1);
      if (!g.nodes.length) { siteData[si] = g; return; }

      const lay = layoutCloud(g);
      const idxOf = new Map();
      const kindOf = new Map();

      for (let i = 0; i < g.nodes.length && ptUsed < MAX_PTS; i++) {
        const nd = g.nodes[i];
        const p = lay.pos[i];
        const col = hexToRgb(aclarar(nodeDotColor(nd), 0.14));
        // Canal de centralidad de Graph3D: (deg/maxDeg)^0.7.
        const dn = g.maxDeg > 0 ? Math.pow((g.deg.get(nd.id) || 0) / g.maxDeg, 0.7) : 0;
        ptPos[ptUsed * 3] = p[0]; ptPos[ptUsed * 3 + 1] = p[1]; ptPos[ptUsed * 3 + 2] = p[2];
        ptCol[ptUsed * 3] = col[0]; ptCol[ptUsed * 3 + 1] = col[1]; ptCol[ptUsed * 3 + 2] = col[2];
        ptSite[ptUsed] = si;
        ptSize[ptUsed] = dn;
        idxOf.set(nd.id, ptUsed);
        kindOf.set(nd.id, groupKey(nd));
        ptUsed++;
      }

      for (const l of g.links) {
        if (lnUsed >= MAX_SEGS) break;
        const a = idxOf.get(l.source);
        const b = idxOf.get(l.target);
        if (a === undefined || b === undefined) continue;
        // Alfa exacta de Graph3D: mismo grupo 0.28, grupos distintos 0.18.
        const ka = kindOf.get(l.source);
        const al = ka && ka === kindOf.get(l.target) ? 0.28 : 0.18;
        [a, b].forEach((src, j) => {
          const o = lnUsed * 2 + j;
          lnPos[o * 3] = ptPos[src * 3];
          lnPos[o * 3 + 1] = ptPos[src * 3 + 1];
          lnPos[o * 3 + 2] = ptPos[src * 3 + 2];
          lnSite[o] = si;
          lnAlpha[o] = al;
        });
        lnUsed++;
      }

      siteData[si] = g;
      siteRadius[si] = lay.R;
      siteToG3D[si] = lay.toGraph3D;
      recomputeMaxDistance();   // el radio real de la nube recién se conoce acá
      if (sparkOf[si] >= 0) ptSize[sparkOf[si]] = 0;

      pushPoints();
      lnGeo.setDrawRange(0, lnUsed * 2);
      ['position', 'aSite', 'aAlpha'].forEach((a) => { lnGeo.getAttribute(a).needsUpdate = true; });
    };

    (async () => {
      // Concurrencia 2: el payload de /api/graph incluye embeddings y viene
      // pesado. De a dos, el hilo principal respira entre JSON.parse en vez de
      // congelarse con todas a la vez.
      const queue = [...names];
      const worker = async () => {
        while (queue.length && alive) {
          const nm = queue.shift();
          try {
            const r = await fetch(`/api/graph?seccion=${encodeURIComponent(nm)}`);
            ingest(nm, await r.json());
          } catch {
            ingest(nm, { nodos: [], relaciones: [] });
          }
        }
      };
      await Promise.all([worker(), worker()]);
    })();

    // ── Cámara: arranca DENTRO de la retícula ──────────────────────────────
    camera.position.set(140, 110, 400);
    controls.target.set(0, 0, 0);

    // ── Estado de navegación ───────────────────────────────────────────────
    let theta = 0;
    let thetaAuto = true;
    let lastThetaInput = -1e9;
    let lastZoomIn = -1e9;
    let dragging = false;
    let candIdx = -1;
    let insideIdx = -1;
    let insideRes = 0;
    let wRamp = 0;
    let prevDist = Infinity;
    let committed = false;
    const qp = new Float32Array(4);
    const qt = new Float32Array(4);
    const rotq = new Float32Array(4);
    const qout = new Float32Array(4);
    const tmp = new THREE.Vector3();

    const camAnim = {
      on: false, start: 0, dur: 900,
      fromP: new THREE.Vector3(), toP: new THREE.Vector3(),
      fromT: new THREE.Vector3(), toT: new THREE.Vector3(),
    };
    const flyTo = (p, t, dur = 900) => {
      camAnim.fromP.copy(camera.position); camAnim.fromT.copy(controls.target);
      camAnim.toP.copy(p); camAnim.toT.copy(t);
      camAnim.start = performance.now(); camAnim.dur = dur; camAnim.on = true;
    };
    const goToSite = (si) => {
      if (si === undefined || si < 0) return;
      const dir = tmp.copy(camera.position).sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.3, 1);
      dir.normalize();
      flyTo(sitePos[si].clone().addScaledVector(dir, siteRadius[si] * 5.5), sitePos[si].clone(), 1000);
    };

    // ── Loop ───────────────────────────────────────────────────────────────
    const t0 = performance.now();
    let raf = 0;
    let lastUi = 0;

    let framed = false;
    let lastFrame = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const time = (now - t0) / 1000;
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;

      // 1) Rotación isoclínica: 16 productos de cuaternión, una vez por frame.
      if (thetaAuto && now - lastThetaInput > 3000) theta += 0.075 / 60;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      qt[0] = ct; qt[1] = st * U_HAT; qt[2] = st * U_HAT; qt[3] = st * U_HAT;
      qmul(Q0, qt, rotq);

      for (let v = 0; v < 16; v++) {
        const p = V4[v];
        qp[0] = p[0]; qp[1] = p[1]; qp[2] = p[2]; qp[3] = p[3];
        qmul(rotq, qp, qout);
        // Proyección central 4D→3D desde w = D. Al ser proyectiva las rectas van
        // a rectas: las aristas del 4-cubo siguen siendo segmentos, no curvas.
        const s = D4 / (D4 - qout[3]);
        uV4[v * 3] = K4 * s * qout[0];
        uV4[v * 3 + 1] = K4 * s * qout[1];
        uV4[v * 3 + 2] = K4 * s * qout[2];
        sitePos[v].set(uV4[v * 3], uV4[v * 3 + 1], uV4[v * 3 + 2]);
        // Exponente 0.85: la nube se infla al venir hacia vos por la cuarta
        // dimensión, pero conserva estructura interna legible en vez de
        // aplastarse cuando se va al fondo.
        siteScale4D[v] = Math.pow(s, 0.85);
      }

      // Encuadre inicial: la sección activa al frente. Se hace en el primer
      // frame porque las posiciones dependen de la rotación 4D.
      if (!framed) {
        framed = true;
        const hs = siteOfSection.get(currentSection);
        if (hs !== undefined) {
          controls.target.copy(sitePos[hs]);
          camera.position.copy(sitePos[hs]).add(new THREE.Vector3(180, 130, 330));
        }
      }

      // 2) Candidato: el más cercano, penalizado por estar fuera del centro.
      let best = -1;
      let bestScore = Infinity;
      for (let v = 0; v < 16; v++) {
        if (!sectionOfSite.has(v)) continue;
        const d = camera.position.distanceTo(sitePos[v]);
        tmp.copy(sitePos[v]).project(camera);
        const score = d * (1 + 3 * Math.hypot(tmp.x, tmp.y));
        if (score < bestScore) { bestScore = score; best = v; }
      }
      let dCand = Infinity;
      if (best >= 0) {
        dCand = camera.position.distanceTo(sitePos[best]);
        const R = siteRadius[best];
        if (best !== candIdx) { candIdx = best; wRamp = 0; }
        const target = smoothstep(ENTER_FAR * R, ENTER_NEAR * R, dCand);
        // Histéresis: pasado el radio de rebobinado la rampa vuelve a cero, así
        // que orbitar cerca no deja la interfaz a medio camino de entrar.
        wRamp += ((dCand > ENTER_REWIND * R ? 0 : target) - wRamp) * 0.12;
      }

      // 3) Uniformes por sitio.
      insideIdx = -1;
      insideRes = 0;
      for (let v = 0; v < 16; v++) {
        const isCand = v === candIdx;
        const morph = isCand ? wRamp : 0;
        const dv = camera.position.distanceTo(sitePos[v]);
        const Rv = siteRadius[v];
        // Resolución: 0 = espacio dimensional (la sección es un objeto de un
        // color), 1 = espacio del grafo (colores de cluster, aristas, detalle).
        const res = sectionOfSite.has(v)
          ? smoothstep(ENTER_FAR * Rv, ENTER_NEAR * Rv * 0.85, dv)
          : 0;
        uSiteMod[v * 4 + 2] = res;
        if (res > insideRes) { insideRes = res; insideIdx = v; }
        // Al aproximarse, la nube candidata deja de ser arrastrada por la
        // rotación 4D y su escala interna converge al ×30 exacto de Graph3D: en
        // w = 1 la nube ya ES el layout de destino, así que no hay salto.
        const scale = siteScale4D[v] * (1 - morph) + morph * siteToG3D[v];
        uSite[v * 4] = sitePos[v].x;
        uSite[v * 4 + 1] = sitePos[v].y;
        uSite[v * 4 + 2] = sitePos[v].z;
        uSite[v * 4 + 3] = scale;
        // Atenuar las otras dimensiones, pero NUNCA apagarlas: si desaparecen,
        // el usuario pierde el mapa justo cuando más lo necesita para volver.
        uSiteMod[v * 4] = isCand ? 1 : 1 - 0.45 * wRamp;
        uSiteMod[v * 4 + 1] = dv;
      }

      // 4) El andamio se retira mientras entrás y la niebla se abre: el último
      //    frame del Multiverso tiene que ser ya el primero del grafo.
      stUniforms.uStrand.value = 1 - wRamp;
      duMat.uniforms.uDust.value = 1 - wRamp;
      common.uFog.value = 0.00115 * (1 - wRamp);
      common.uFocus.value += ((best >= 0 ? dCand : 500) - common.uFocus.value) * 0.08;
      common.uCocK.value = 1.4 * (1 - 0.85 * wRamp);
      common.uTime.value = time;

      // 5) Cámara. Sin esto, acercarse con la rueda te lleva al centro del
      //    anillo y nunca llegás a ninguna nube: el centro de órbita migra
      //    hacia la dimensión candidata a medida que te acercás, así que
      //    seguir acercándote te mete adentro. Es la "gravedad" de la
      //    dimensión, y es lo que hace que el ingreso sea continuo en vez de
      //    un botón disfrazado.
      //    La atracción sólo actúa MIENTRAS estás acercándote a propósito. Sin
      //    esa condición se realimenta sola —el centro se acerca a la nube, lo
      //    que sube la atracción, que acerca más el centro— y la cámara se mete
      //    adentro de una dimensión sin que el usuario toque nada.
      if (candIdx >= 0 && !camAnim.on && now - lastZoomIn < 900) {
        const R = siteRadius[candIdx];
        const pull = smoothstep(ENTER_FAR * R * 2.2, ENTER_NEAR * R, dCand);
        // Factor independiente del framerate. Con un lerp de paso fijo, una
        // rueda rápida —o unos frames largos— dollyan más rápido de lo que
        // converge el centro, y la cámara pasa de largo al costado de la nube
        // sin llegar a entrar nunca.
        if (pull > 0.001) {
          const k = 1 - Math.pow(0.0001, Math.min(dt, 0.1));
          controls.target.lerp(sitePos[candIdx], Math.min(0.6, pull * k * 1.6));
        }
      }
      if (camAnim.on) {
        const p = Math.min(1, (now - camAnim.start) / camAnim.dur);
        camera.position.lerpVectors(camAnim.fromP, camAnim.toP, easeInOut(p));
        controls.target.lerpVectors(camAnim.fromT, camAnim.toT, easeInOut(p));
        if (p >= 1) camAnim.on = false;
      }
      controls.update();

      // El polvo se re-ancla cuando la cámara se aleja: siempre hay primer
      // plano, pero dentro de un movimiento hay paralaje real.
      if (camera.position.distanceTo(dustAnchor) > 240) {
        dustAnchor.copy(camera.position);
        dust.position.copy(dustAnchor);
      }

      // No hay commit, ni velo, ni cambio de pantalla. Acercarse no te "mete"
      // a ningún lado: simplemente resolvés más detalle de esa dimensión, y
      // alejarte te devuelve al espacio dimensional. Que la transición fuera
      // modal era lo que la volvía irreversible y lo que obligaba a anunciar
      // "entrando", que es justo lo que no tiene que pasar.
      prevDist = dCand;

      // 7) Etiquetas a ~20 Hz: no hace falta tocar el DOM en cada frame.
      if (now - lastUi > 50) {
        lastUi = now;
        const rect = container.getBoundingClientRect();
        siteOfSection.forEach((si, nm) => {
          const el = labelRefs.current[nm];
          if (!el) return;
          tmp.copy(sitePos[si]);
          tmp.y += siteRadius[si] * 1.2;
          tmp.project(camera);
          if (tmp.z >= 1) { el.style.opacity = '0'; return; }
          const x = (tmp.x * 0.5 + 0.5) * rect.width;
          const y = (-tmp.y * 0.5 + 0.5) * rect.height;
          el.style.transform = `translate(-50%,-100%) translate(${x}px,${y}px)`;
          el.style.opacity = String(si === candIdx ? 1 : 0.34 * (1 - wRamp));
        });
        setCandidate(candIdx >= 0 ? (sectionOfSite.get(candIdx) ?? null) : null);
        setApproach(wRamp);
        setInside(insideRes > 0.55 ? (sectionOfSite.get(insideIdx) ?? null) : null);
        setDepth(insideRes);
      }

      composer.render();
    };
    tick();

    // ── Entrada ────────────────────────────────────────────────────────────
    const el = renderer.domElement;
    const onWheel = (e) => { if (e.deltaY < 0) lastZoomIn = performance.now(); };
    const onDown = () => { dragging = true; };
    const onUp = () => { dragging = false; };
    const onTouch = (e) => { if (e.touches && e.touches.length === 2) lastZoomIn = performance.now(); };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('touchmove', onTouch, { passive: true });

    // Shift + arrastre horizontal = manejar la cuarta dimensión a mano.
    let shiftX = null;
    const onMove = (e) => {
      if (e.shiftKey && e.buttons === 1) {
        if (shiftX !== null) {
          theta += (e.clientX - shiftX) * 0.004;
          lastThetaInput = performance.now();
        }
        shiftX = e.clientX;
        controls.enabled = false;
      } else if (shiftX !== null) {
        shiftX = null;
        controls.enabled = true;
      }
    };
    el.addEventListener('pointermove', onMove);

    const occList = () => [...siteOfSection.values()];
    const step = (d) => {
      const occ = occList();
      if (!occ.length) return;
      const cur = occ.indexOf(candIdx);
      goToSite(occ[((cur + d) % occ.length + occ.length) % occ.length]);
    };
    const goOverview = () => {
      const c = new THREE.Vector3();
      let k = 0;
      occupied.forEach((v) => { c.add(sitePos[v]); k++; });
      if (k) c.divideScalar(k);
      const dir = tmp.copy(camera.position).sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0.4, 0.3, 1);
      flyTo(c.clone().addScaledVector(dir.normalize(), controls.maxDistance * 0.92), c, 900);
    };
    const onKey = (e) => {
      // Esc devuelve primero al espacio dimensional y sólo cierra si ya estabas
      // ahí: cerrar de una era perder el lugar sin querer.
      if (e.key === 'Escape') { if (insideRes > 0.2) goOverview(); else closeRef.current?.(); }
      else if (e.key === '[') { theta -= 0.06; lastThetaInput = performance.now(); }
      else if (e.key === ']') { theta += 0.06; lastThetaInput = performance.now(); }
      else if (e.key === ' ') { thetaAuto = !thetaAuto; e.preventDefault(); }
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);

    apiRef.current = {
      next: () => step(1),
      prev: () => step(-1),
      overview: goOverview,
      goTo: (nm) => goToSite(siteOfSection.get(nm)),
    };

    // ── Resize ─────────────────────────────────────────────────────────────
    const onResize = () => {
      w = container.clientWidth || 1;
      h = container.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.setSize(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2)));
      common.uH.value = h;
    };
    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('touchmove', onTouch);
      apiRef.current = null;
      controls.dispose();
      [ptGeo, lnGeo, stGeo, duGeo].forEach((g) => g.dispose());
      [ptMat, lnMat, stMat, duMat].forEach((m) => m.dispose());
      composer.dispose();
      renderer.dispose();
      if (el.parentNode === container) container.removeChild(el);
    };
  }, [names, currentSection]);

  const secColors = useMemo(() => sectionColors(sections.map((x) => x.nombre)), [sections]);
  const here = sections.find((x) => x.nombre === inside);
  const nearName = inside || candidate;

  return (
    <div className="mv-field">
      {/* Riel de dimensiones: SIEMPRE visible. Que las opciones desaparecieran
          al navegar era el problema central — te quedabas sin mapa justo
          cuando más lo necesitabas. */}
      <nav className="mv-rail">
        <div className="mv-rail-head">
          <span className="mv-rail-title">Dimensiones</span>
          <button className="mv-rail-all" onClick={() => apiRef.current?.overview()}
            title="Ver todo el espacio dimensional (Esc)">⊡</button>
        </div>
        <ul className="mv-rail-list">
          {sections.map((sec) => (
            <li key={sec.nombre}>
              <button
                className={
                  'mv-rail-item'
                  + (sec.nombre === inside ? ' mv-rail-item--here' : '')
                  + (sec.nombre === currentSection ? ' mv-rail-item--active' : '')
                }
                onClick={() => apiRef.current?.goTo(sec.nombre)}
                title={`Ir a ${sec.nombre}`}
              >
                <span className="mv-rail-dot" style={{ background: secColors.get(sec.nombre) }} />
                <span className="mv-rail-name">{sec.nombre}</span>
                <span className="mv-rail-count">{sec.count}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mv-rail-foot">
          {ready < sections.length ? `cargando ${ready}/${sections.length}` : `${sections.length} en total`}
        </div>
      </nav>

      <button className="mv-close" onClick={onClose} title="Cerrar el Multiverso">✕</button>

      {/* Migaja: dice dónde estás, no qué está por pasar. */}
      <div className="mv-where">
        <span className={'mv-where-scope' + (depth > 0.55 ? ' mv-where-scope--dim' : '')}>Multiverso</span>
        {nearName && (
          <>
            <span className="mv-where-sep">/</span>
            <span
              className={'mv-where-here' + (depth > 0.55 ? ' mv-where-here--on' : '')}
              style={depth > 0.55 ? { color: secColors.get(nearName) } : undefined}
            >
              {nearName}
            </span>
            {here && depth > 0.55 && <span className="mv-where-n">{here.count} nodos</span>}
          </>
        )}
      </div>

      <div className="mv-field-scene" ref={containerRef}>
        {sections.map((sec) => (
          <div
            key={sec.nombre}
            ref={(node) => { labelRefs.current[sec.nombre] = node; }}
            className={
              'mv-field-label'
              + (sec.nombre === currentSection ? ' mv-field-label--current' : '')
              + (sec.nombre === candidate ? ' mv-field-label--cand' : '')
            }
          >
            <span className="mv-field-label-name" style={{ color: secColors.get(sec.nombre) }}>
              {sec.nombre}
            </span>
          </div>
        ))}
      </div>

      {/* Única acción que sale del Multiverso, y es explícita y opcional. */}
      {inside && (
        <div className="mv-actions">
          <button className="mv-act mv-act--back" onClick={() => apiRef.current?.overview()}>
            ← Volver al espacio
          </button>
          <button className="mv-act mv-act--open" onClick={() => onSelectSection?.(inside)}>
            Abrir {inside} en el grafo completo →
          </button>
        </div>
      )}

      <footer className="mv-field-footer">
        <span>
          Arrastrá para orbitar · botón derecho para desplazarte · rueda para acercarte y alejarte
          {' · '}Esc para volver al espacio{' · '}[ ] girar la 4ª
        </span>
      </footer>
    </div>
  );
}
