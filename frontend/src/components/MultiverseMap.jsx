import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSO — bloques de vidrio tallado

   Cada sección es un bloque de cristal con estructura de tesseract (cubo
   exterior + cubo interior + 8 diagonales vértice a vértice) y el grafo real
   de esa sección tallado adentro.

   La escena está armada como una FOTO de producto, no como un diagrama. Lo que
   separa "render de wireframes" de "objeto real":

   1. Profundidad de campo. Es la señal de realismo más fuerte que hay y la que
      faltaba: sin ella todo está igual de nítido y el ojo lee CGI. El BokehPass
      enfoca el bloque del frente; el resto se cae en bokeh.
   2. Biseles. Un cubo de aristas vivas nunca parece vidrio. RoundedBoxGeometry
      con radio chico da el chaflán que atrapa la luz y dibuja el borde
      brillante solo, sin necesidad de trazarlo.
   3. Piso espejado. Un objeto flotando en negro no tiene escala ni peso; el
      reflejo lo apoya en algún lado.
   4. Un solo protagonista. Seis cubos parejos en fila son un dashboard. Uno
      grande al frente y el resto cayéndose en el desenfoque es un retrato.

   Paleta cerrada a blanco + cyan frío, y bloom con tope duro 0.18: por encima
   de eso el bisel y el tallado se funden en una mancha.
   ══════════════════════════════════════════════════════════════════════════ */

const C = {
  etchInner: 0xd6f2ff,  // cubo interior tallado
  etchActive: 0xffffff, // idem, en la sección activa
  etchDiag: 0x7fc6de,   // diagonales
  node: 0xf2fdff,
  graphEdge: 0x5fa8c4,
  glassTint: 0x3fd2f5,
};

// TOPE DURO. Por encima de ~0.25 la geometría se convierte en mancha.
const BLOOM_STRENGTH = 0.18;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 0.86;

const CUBE = 3.0;
const INNER_RATIO = 0.34;
const FLOOR_Y = -CUBE * 0.5 - 0.02;
const MAX_NODES = 34;
const MAX_LINKS = 55;

const CUBE_V = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_E = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6],
  [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t) => t * t * t;

/* ── Estudio: los reflejos que convierten una caja en vidrio ────────────────
   Paneles chicos a propósito. Uno grande inunda las caras y el bloque pasa de
   cristal a plástico esmerilado; chicos dejan franjas de luz, como en la foto. */
function buildEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x03060a);

  const panel = (hex, gain, w, h, pos) => {
    const mat = new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide });
    mat.color.multiplyScalar(gain);            // > 1 = HDR; el PMREM es half-float
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
  };

  panel(0xffffff, 9.0, 4, 10, [10, 9, 5]);      // key: franja blanca dura
  panel(0x8fe9ff, 4.0, 2.5, 15, [-11, 4, -4]);  // rim cyan, vertical
  panel(0xffffff, 4.0, 14, 5, [-3, 13, -6]);    // cenital
  panel(0x163f55, 0.8, 40, 26, [-6, 2, 14]);    // ambiente ancho: el degradé
  panel(0x2b6d8a, 0.8, 30, 10, [0, -9, 10]);    // rebote del piso

  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  envScene.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
  });
  return rt;
}

/* ── Telón ──────────────────────────────────────────────────────────────────
   Opaco a propósito: entra en el transmission pass, así el vidrio tiene algo
   que refractar en vez de negro plano. */
function buildBackdrop() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x070e18) },
      bottom: { value: new THREE.Color(0x010306) },
      haze: { value: new THREE.Color(0x113c52) },
    },
    vertexShader: [
      'varying vec3 vDir;',
      'void main() {',
      '  vDir = normalize(position);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 top; uniform vec3 bottom; uniform vec3 haze;',
      'varying vec3 vDir;',
      'void main() {',
      '  float h = vDir.y * 0.5 + 0.5;',
      '  vec3 c = mix(bottom, top, smoothstep(0.0, 1.0, h));',
      '  c += haze * (1.0 - smoothstep(0.0, 0.30, abs(vDir.y))) * 0.6;',
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(260, 32, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

/* ── Piso espejado ──────────────────────────────────────────────────────────
   Reflector con shader propio: el de fábrica devuelve un espejo duro de borde
   a borde. Éste apaga el reflejo con la distancia, que es lo que hace una
   superficie pulida real bajo luz dura. */
function buildFloor() {
  const floor = new Reflector(new THREE.PlaneGeometry(300, 300), {
    textureWidth: 512,
    textureHeight: 512,
    multisample: 2,
    clipBias: 0.003,
    shader: {
      uniforms: {
        color: { value: new THREE.Color(0xffffff) },
        tDiffuse: { value: null },
        textureMatrix: { value: new THREE.Matrix4() },
      },
      vertexShader: [
        'uniform mat4 textureMatrix;',
        'varying vec4 vUv;',
        'varying vec2 vLocal;',
        'void main() {',
        '  vLocal = position.xy;',
        '  vUv = textureMatrix * vec4(position, 1.0);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tDiffuse;',
        'varying vec4 vUv;',
        'varying vec2 vLocal;',
        // Un espejo nítido devuelve las aristas del bloque como dos patas
        // verticales. Cinco muestras lo vuelven un reflejo pulido, que es lo
        // que hace una superficie real.
        'vec3 tap(vec2 o) { return texture2DProj(tDiffuse, vUv + vec4(o, 0.0, 0.0)).rgb; }',
        'void main() {',
        '  float k = 0.012 * vUv.w;',
        '  vec3 refl = tap(vec2(0.0)) * 0.36',
        '    + tap(vec2(k, 0.0)) * 0.16 + tap(vec2(-k, 0.0)) * 0.16',
        '    + tap(vec2(0.0, k)) * 0.16 + tap(vec2(0.0, -k)) * 0.16;',
        '  float fade = 1.0 - smoothstep(10.0, 60.0, length(vLocal));',
        '  gl_FragColor = vec4(refl * 0.3 * fade, 1.0);',
        '}',
      ].join('\n'),
    },
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  return floor;
}

/* ── Bokeh de fondo: los círculos desenfocados de la referencia ───────────── */
function buildBokehLights() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(150,225,255,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);

  const group = new THREE.Group();
  let s = 20250909;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: rnd() < 0.35 ? 0xffffff : 0x63d6ff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.1 + rnd() * 0.18,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    const a = rnd() * Math.PI * 2;
    const r = 55 + rnd() * 35;
    sp.position.set(Math.cos(a) * r, -6 + rnd() * 30, Math.sin(a) * r);
    const k = 4 + rnd() * 9;
    sp.scale.set(k, k, 1);
    group.add(sp);
  }
  group.userData.texture = tex;
  return group;
}

/* ── Line2 helper ─────────────────────────────────────────────────────────── */
function makeLines(flatPositions, color, widthPx, registry) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(flatPositions);
  const mat = new LineMaterial({
    color,
    linewidth: widthPx,
    worldUnits: false,
    // Opaco: lo transparente no entra en el transmission pass y desaparecería
    // detrás del vidrio. El atenuado va por color, no por alpha.
    transparent: false,
    depthTest: true,
  });
  registry.push(mat);
  const seg = new LineSegments2(geo, mat);
  seg.frustumCulled = false;
  return seg;
}

function boxEdgePositions(half) {
  const out = [];
  for (const [a, b] of CUBE_E) {
    out.push(CUBE_V[a][0] * half, CUBE_V[a][1] * half, CUBE_V[a][2] * half);
    out.push(CUBE_V[b][0] * half, CUBE_V[b][1] * half, CUBE_V[b][2] * half);
  }
  return out;
}

/* ── Datos ──────────────────────────────────────────────────────────────────
   Se quedan los nodos de mayor grado y sólo las aristas entre ellos: un
   muestreo al azar produce polvo desconectado; esto produce algo que se lee
   como grafo. */
function sampleGraph(json) {
  const nodes = (json.nodos || []).filter((n) => !n.is_issue && !n.is_centroid);
  const rels = json.relaciones || [];
  const deg = new Map();
  for (const r of rels) {
    deg.set(r.source, (deg.get(r.source) || 0) + 1);
    deg.set(r.target, (deg.get(r.target) || 0) + 1);
  }
  const picked = [...nodes]
    .sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0))
    .slice(0, MAX_NODES);
  const ids = new Set(picked.map((n) => n.id));
  const links = rels
    .filter((r) => ids.has(r.source) && ids.has(r.target))
    .slice(0, MAX_LINKS);
  return {
    total: nodes.length,
    totalLinks: rels.length,
    nodes: picked.map((n) => ({
      id: n.id,
      p: new THREE.Vector3(n.x3d ?? 0, n.y3d ?? 0, n.z3d ?? 0),
      deg: deg.get(n.id) || 0,
    })),
    links,
  };
}

/* Cáscara entre el cubo interior y las caras: ni apelmazado en el núcleo ni
   atravesando el vidrio. */
function layoutNodes(nodes) {
  const centroid = new THREE.Vector3();
  nodes.forEach((n) => centroid.add(n.p));
  centroid.divideScalar(Math.max(1, nodes.length));

  let maxR = 1e-6;
  const rel = nodes.map((n) => {
    const v = n.p.clone().sub(centroid);
    maxR = Math.max(maxR, v.length());
    return v;
  });

  const rIn = CUBE * 0.24;
  const rOut = CUBE * 0.43;
  return rel.map((v, i) => {
    const dir = v.lengthSq() > 1e-9
      ? v.clone().normalize()
      : new THREE.Vector3(Math.sin(i * 2.4), Math.cos(i * 1.7), Math.sin(i * 3.1)).normalize();
    return dir.multiplyScalar(rIn + (rOut - rIn) * Math.pow(v.length() / maxR, 0.7));
  });
}

/* ── Un bloque ────────────────────────────────────────────────────────────── */
function buildCell({ name, position, graph, isCurrent, lineMats, disposables, lineObjects }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.userData.sectionName = name;

  const half = CUBE / 2;
  const innerHalf = (CUBE * INNER_RATIO) / 2;

  // Bloque de cristal biselado. El chaflán es lo que dibuja el borde brillante.
  const glassGeo = new RoundedBoxGeometry(CUBE, CUBE, CUBE, 6, CUBE * 0.075);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.0,
    transmission: 0.94,
    thickness: 5.5,
    ior: 1.5,
    attenuationColor: new THREE.Color(C.glassTint),
    attenuationDistance: 14.0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    reflectivity: 0.7,
    iridescence: 0,               // explícito: nada de rainbow
    envMapIntensity: 1.5,
    side: THREE.FrontSide,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 20;
  group.add(glass);
  group.userData.glassMat = glassMat;
  disposables.push(glassGeo, glassMat);

  // El filo NO se traza. El chaflán de la geometría atrapa la luz del panel key
  // y dibuja la arista brillante solo; una línea encima la convertiría otra vez
  // en un wireframe dibujado sobre una caja.

  // Tallado interno: cubo interior + 8 diagonales. La firma del tesseract.
  // La sección activa se distingue por un tallado más brillante, no por una
  // chapita de UI: dentro de la foto, todo tiene que ser materia.
  const etched = new THREE.Group();
  const innerCube = makeLines(
    boxEdgePositions(innerHalf),
    isCurrent ? C.etchActive : C.etchInner,
    isCurrent ? 1.8 : 1.5,
    lineMats,
  );
  etched.add(innerCube);
  lineObjects.push(innerCube);

  const diagPts = [];
  for (const v of CUBE_V) {
    diagPts.push(v[0] * half, v[1] * half, v[2] * half);
    diagPts.push(v[0] * innerHalf, v[1] * innerHalf, v[2] * innerHalf);
  }
  const diags = makeLines(diagPts, C.etchDiag, 1.1, lineMats);
  etched.add(diags);
  lineObjects.push(diags);

  // Grafo real de la sección, tallado adentro.
  if (graph && graph.nodes.length > 0) {
    const pts = layoutNodes(graph.nodes);
    const byId = new Map(graph.nodes.map((n, i) => [n.id, pts[i]]));

    const edgePts = [];
    for (const l of graph.links) {
      const a = byId.get(l.source);
      const b = byId.get(l.target);
      if (a && b) edgePts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    if (edgePts.length) {
      const ge = makeLines(edgePts, C.graphEdge, 1.2, lineMats);
      etched.add(ge);
      lineObjects.push(ge);
    }

    const nodeGeo = new THREE.SphereGeometry(CUBE * 0.0125, 10, 8);
    const nodeMat = new THREE.MeshBasicMaterial({ color: C.node });
    const mesh = new THREE.InstancedMesh(nodeGeo, nodeMat, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      // Techo bajo a propósito: por encima de ~2x los clusters densos se funden
      // en una mancha blanca.
      const s = 0.8 + Math.min(1.0, (graph.nodes[i].deg || 0) * 0.1);
      m.makeScale(s, s, s);
      m.setPosition(p);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    etched.add(mesh);
    disposables.push(nodeGeo, nodeMat);
  }

  group.add(etched);
  group.userData.etched = etched;

  // Blanco de picking: no dibuja nada, pero sigue en el raycast.
  const pickGeo = new THREE.BoxGeometry(CUBE * 1.06, CUBE * 1.06, CUBE * 1.06);
  const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const pick = new THREE.Mesh(pickGeo, pickMat);
  pick.renderOrder = -50;
  pick.userData.sectionName = name;
  group.add(pick);
  disposables.push(pickGeo, pickMat);

  group.userData.pick = pick;
  return group;
}

/* ══════════════════════════════════════════════════════════════════════════ */

export default function MultiverseMap({ sections, onSelectSection, onClose, currentSection }) {
  const containerRef = useRef(null);
  const labelRefs = useRef({});
  const veilRef = useRef(null);
  const apiRef = useRef(null);
  const selectRef = useRef(onSelectSection);
  selectRef.current = onSelectSection;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const [graphs, setGraphs] = useState(null);
  const [hero, setHero] = useState(currentSection);
  const [entering, setEntering] = useState(false);

  const key = sections.map((s) => s.nombre).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const names = useMemo(() => key.split('|').filter(Boolean), [key]);

  /* ── Datos: se reutiliza /api/graph?seccion=… tal cual ──────────────────── */
  useEffect(() => {
    let alive = true;
    setGraphs(null);

    (async () => {
      const out = {};
      // De a 4: el payload de /api/graph incluye embeddings, y disparar todas
      // las secciones en paralelo ahoga al backend.
      for (let i = 0; i < names.length; i += 4) {
        const batch = names.slice(i, i + 4);
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(batch.map(async (n) => {
          try {
            const r = await fetch(`/api/graph?seccion=${encodeURIComponent(n)}`);
            out[n] = sampleGraph(await r.json());
          } catch {
            out[n] = { total: 0, totalLinks: 0, nodes: [], links: [] };
          }
        }));
        if (!alive) return;
      }
      if (alive) setGraphs(out);
    })();

    return () => { alive = false; };
  }, [names]);

  /* ── Escena ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !graphs || names.length === 0) return undefined;

    let w = container.clientWidth || 1;
    let h = container.clientHeight || 1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 700);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    container.appendChild(renderer.domElement);

    const envRT = buildEnvironment(renderer);
    scene.environment = envRT.texture;

    const backdrop = buildBackdrop();
    scene.add(backdrop);
    const bokehLights = buildBokehLights();
    scene.add(bokehLights);
    const floor = buildFloor();
    scene.add(floor);

    scene.add(new THREE.AmbientLight(0x1a2a38, 1.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(10, 11, 6);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x7ae0ff, 1.0);
    rimLight.position.set(-11, 2, -7);
    scene.add(rimLight);

    // ── Bloques en anillo ───────────────────────────────────────────────────
    const lineMats = [];
    const disposables = [];
    const lineObjects = [];
    const cells = [];
    const picks = [];

    const n = names.length;
    const ringRadius = n <= 1 ? 0 : Math.max(CUBE * 2.0, (n * CUBE * 3.6) / (2 * Math.PI));
    const positions = n <= 1
      ? [new THREE.Vector3(0, 0, 0)]
      : Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * ringRadius, 0, Math.sin(a) * ringRadius);
      });

    names.forEach((name, i) => {
      const cell = buildCell({
        name,
        position: positions[i],
        graph: graphs[name],
        isCurrent: name === currentSection,
        lineMats,
        disposables,
        lineObjects,
      });
      scene.add(cell);
      cells.push(cell);
      picks.push(cell.userData.pick);
    });

    // Sin cables entre bloques: una poligonal en el piso devuelve la escena al
    // territorio del diagrama. La continuidad la cuentan el carrusel y el
    // reflejo, no una línea dibujada.

    // ── Composer: DOF antes que bloom, como en una lente real ───────────────
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bokeh = new BokehPass(scene, camera, {
      focus: CUBE * 3.0, aperture: 0.0046, maxblur: 0.012,
    });
    // El pase de profundidad pisa todos los materiales con MeshDepthMaterial y
    // Line2 no sobrevive a eso (su geometría es instanciada: el `position` es
    // el quad plantilla, no la línea en mundo) — escupiría basura en el origen.
    // Se ocultan: dentro del bloque el vidrio ya aporta la profundidad correcta
    // para esos píxeles.
    const bokehRender = bokeh.render.bind(bokeh);
    bokeh.render = (r, write, read, dt, mask) => {
      lineObjects.forEach((o) => { o.visible = false; });
      bokehRender(r, write, read, dt, mask);
      lineObjects.forEach((o) => { o.visible = true; });
    };
    composer.addPass(bokeh);

    composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(w, h), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD,
    ));

    const vignette = new ShaderPass(VignetteShader);
    // Ojo: el shader mezcla hacia vec3(1.0 - darkness). Con darkness > 1 el
    // color se va a negativo y la conversión a sRGB devuelve NaN: la pantalla
    // entera se tiñe de sepia. 1.0 = negro puro, que es el máximo útil.
    vignette.uniforms.offset.value = 1.15;
    vignette.uniforms.darkness.value = 1.0;
    composer.addPass(vignette);
    composer.addPass(new OutputPass());

    // El Reflector no trae guarda de recursión: su onBeforeRender también se
    // dispara dentro del transmission pass y del pase de profundidad, o sea
    // tres re-renders de escena por frame. Se resuelve una sola vez por frame.
    let frameId = 0;
    let reflectedFrame = -1;
    const floorOBR = floor.onBeforeRender;
    floor.onBeforeRender = function reflectOnce(r, s, cam) {
      if (frameId - reflectedFrame < 2) return;
      reflectedFrame = frameId;
      floorOBR.call(this, r, s, cam);
    };

    // ── Controles ───────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = CUBE * 1.55;
    controls.maxDistance = CUBE * 5.5 + ringRadius;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = Math.PI * 0.5;    // no bajar del piso
    controls.autoRotate = false;

    // ── Cámara: retrato del bloque del frente ───────────────────────────────
    let heroIndex = Math.max(0, names.indexOf(currentSection));

    const heroCamPos = (idx) => {
      const p = positions[idx];
      // Desde afuera del anillo mirando hacia adentro: los demás bloques quedan
      // detrás del héroe, cayéndose en el bokeh.
      const outward = ringRadius > 0
        ? new THREE.Vector3(p.x, 0, p.z).normalize()
        : new THREE.Vector3(0.72, 0, 0.69);
      const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
      return p.clone()
        .addScaledVector(outward, CUBE * 2.9)
        .addScaledVector(tangent, CUBE * 0.55)
        .add(new THREE.Vector3(0, CUBE * 0.85, 0));
    };

    camera.position.copy(heroCamPos(heroIndex));
    controls.target.copy(positions[heroIndex]);
    setHero(names[heroIndex]);

    // Progreso contra reloj absoluto, no contra dt acumulado: con la pestaña
    // en segundo plano o en una máquina lenta, rAF entrega frames espaciados y
    // una animación por dt se arrastra durante segundos.
    const anim = {
      on: false, start: 0, dur: 1000,
      fromP: new THREE.Vector3(), toP: new THREE.Vector3(),
      fromT: new THREE.Vector3(), toT: new THREE.Vector3(),
    };
    const flyTo = (toPos, toTarget, durMs = 1000) => {
      anim.fromP.copy(camera.position);
      anim.fromT.copy(controls.target);
      anim.toP.copy(toPos);
      anim.toT.copy(toTarget);
      anim.start = performance.now();
      anim.dur = durMs;
      anim.on = true;
    };

    const setHeroIndex = (idx) => {
      heroIndex = ((idx % n) + n) % n;
      setHero(names[heroIndex]);
      flyTo(heroCamPos(heroIndex), positions[heroIndex], 1150);
    };

    // ── Entrar: atravesar el vidrio y quedar dentro del grafo ───────────────
    const dive = { on: false, start: 0, dur: 1300, cell: null, name: null };
    const enterCell = (idx) => {
      if (dive.on) return;
      dive.on = true;
      dive.start = performance.now();
      dive.cell = cells[idx];
      dive.name = names[idx];
      controls.enabled = false;
      anim.on = false;
      setEntering(true);
    };

    // ── Picking ─────────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pickAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(picks, false);
      return hits.length ? hits[0].object.userData.sectionName : null;
    };

    let down = null;
    const onPointerDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onPointerUp = (e) => {
      if (!down || dive.on) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5) return;                     // fue un drag de órbita
      const name = pickAt(e.clientX, e.clientY);
      if (!name) return;
      const idx = names.indexOf(name);
      // Click en el bloque del frente = entrar. Click en otro = traerlo al frente.
      if (idx === heroIndex) enterCell(idx);
      else setHeroIndex(idx);
    };
    const onPointerMove = (e) => {
      if (dive.on) return;
      renderer.domElement.style.cursor = pickAt(e.clientX, e.clientY) ? 'pointer' : 'grab';
    };

    const el = renderer.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointermove', onPointerMove);

    apiRef.current = {
      prev: () => setHeroIndex(heroIndex - 1),
      next: () => setHeroIndex(heroIndex + 1),
      enter: () => enterCell(heroIndex),
    };

    // ── Labels ──────────────────────────────────────────────────────────────
    const projected = new THREE.Vector3();
    const updateLabels = () => {
      const rect = container.getBoundingClientRect();
      cells.forEach((cell, i) => {
        const node = labelRefs.current[cell.userData.sectionName];
        if (!node) return;
        if (dive.on) { node.style.opacity = '0'; return; }
        projected.copy(cell.position);
        projected.y += CUBE * 0.72;
        projected.project(camera);
        if (projected.z >= 1) { node.style.opacity = '0'; return; }
        const x = (projected.x * 0.5 + 0.5) * rect.width;
        const y = (-projected.y * 0.5 + 0.5) * rect.height;
        node.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
        // Los bloques fuera de foco se apagan con el bokeh: el texto también.
        const isHero = i === heroIndex;
        node.style.opacity = isHero ? '1' : '0.3';
        node.style.filter = isHero ? 'none' : 'blur(1.6px)';
      });
    };

    // ── Loop ────────────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      frameId++;
      const now = performance.now();
      const dt = Math.min(clock.getDelta(), 0.05);

      if (dive.on) {
        const p = Math.min(1, (now - dive.start) / dive.dur);
        const k = easeIn(p);
        const center = dive.cell.position;

        // La cámara cae al centro del bloque y lo atraviesa.
        camera.position.lerp(center, 1 - Math.pow(1 - k, 1.7));
        controls.target.copy(center);
        camera.lookAt(center);

        // El vidrio se desvanece y el tallado crece hasta envolver a la cámara:
        // la sensación es de entrar, no de cambiar de pantalla.
        const gm = dive.cell.userData.glassMat;
        gm.transparent = true;
        gm.opacity = 1 - k;
        dive.cell.userData.etched.scale.setScalar(1 + 9 * k);

        if (veilRef.current) {
          veilRef.current.style.opacity = String(
            THREE.MathUtils.clamp((p - 0.62) / 0.38, 0, 1),
          );
        }
        if (p >= 1) {
          dive.on = false;
          selectRef.current?.(dive.name);
        }
      } else {
        controls.update();
        if (anim.on) {
          const p = Math.min(1, (now - anim.start) / anim.dur);
          const k = easeInOut(p);
          camera.position.lerpVectors(anim.fromP, anim.toP, k);
          controls.target.lerpVectors(anim.fromT, anim.toT, k);
          camera.lookAt(controls.target);
          if (p >= 1) anim.on = false;
        }
        cells.forEach((c) => { c.rotation.y += dt * 0.055; });
        // El foco persigue al héroe: es lo que mantiene la foto viva al orbitar.
        const d = camera.position.distanceTo(positions[heroIndex]);
        bokeh.uniforms.focus.value += (d - bokeh.uniforms.focus.value) * Math.min(1, dt * 5);
      }

      updateLabels();
      composer.render();
    };
    tick();

    // ── Resize ──────────────────────────────────────────────────────────────
    const onResize = () => {
      w = container.clientWidth || 1;
      h = container.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bokeh.uniforms.aspect.value = camera.aspect;
      lineMats.forEach((m) => m.resolution.set(w, h));
    };
    window.addEventListener('resize', onResize);
    onResize();

    const onKey = (e) => {
      if (dive.on) return;
      if (e.key === 'Escape') closeRef.current?.();
      else if (e.key === 'Enter') enterCell(heroIndex);
      else if (e.key === 'ArrowLeft') setHeroIndex(heroIndex - 1);
      else if (e.key === 'ArrowRight') setHeroIndex(heroIndex + 1);
    };
    window.addEventListener('keydown', onKey);

    // ── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointermove', onPointerMove);
      apiRef.current = null;

      controls.dispose();
      scene.traverse((o) => {
        if (o.isLineSegments2 && o.geometry) o.geometry.dispose();
      });
      lineMats.forEach((m) => m.dispose());
      disposables.forEach((d) => d.dispose());
      bokehLights.traverse((o) => { if (o.isSprite) o.material.dispose(); });
      bokehLights.userData.texture.dispose();
      floor.dispose?.();
      floor.geometry.dispose();
      floor.material.dispose();
      backdrop.geometry.dispose();
      backdrop.material.dispose();
      envRT.dispose();
      composer.dispose();
      renderer.dispose();
      if (el.parentNode === container) container.removeChild(el);
    };
  }, [graphs, names, currentSection]);

  const heroGraph = hero ? graphs?.[hero] : null;

  return (
    <div className="mv-tesseract">
      <header className="mv-tesseract-header">
        <div className="mv-tesseract-title">
          <span className="mv-tesseract-icon">◈</span>
          <span>Multiverso</span>
          <span className="mv-tesseract-count">
            {sections.length} {sections.length === 1 ? 'dimensión' : 'dimensiones'}
          </span>
        </div>
        <button className="mv-tesseract-close" onClick={onClose} title="Cerrar (Esc)">✕</button>
      </header>

      <div className="mv-tesseract-scene" ref={containerRef}>
        {!graphs && (
          <div className="mv-tesseract-loading">
            <div className="mv-tesseract-spinner" />
            <span>Tallando el multiverso…</span>
          </div>
        )}

        {graphs && sections.map((s) => (
          <div
            key={s.nombre}
            ref={(node) => { labelRefs.current[s.nombre] = node; }}
            className={
              'mv-tesseract-label'
              + (s.nombre === currentSection ? ' mv-tesseract-label--current' : '')
            }
          >
            <span className="mv-tesseract-label-name">{s.nombre}</span>
          </div>
        ))}

        {graphs && sections.length > 1 && !entering && (
          <>
            <button
              className="mv-nav mv-nav--prev"
              onClick={() => apiRef.current?.prev()}
              title="Dimensión anterior (←)"
            >‹</button>
            <button
              className="mv-nav mv-nav--next"
              onClick={() => apiRef.current?.next()}
              title="Dimensión siguiente (→)"
            >›</button>
          </>
        )}

        {graphs && hero && !entering && (
          <div className="mv-hero">
            <div className="mv-hero-meta">
              {heroGraph
                ? `${heroGraph.total} nodos · ${heroGraph.totalLinks} relaciones`
                : 'sin datos'}
              {hero === currentSection ? ' · sección activa' : ''}
            </div>
            <button className="mv-hero-enter" onClick={() => apiRef.current?.enter()}>
              Entrar a {hero} →
            </button>
          </div>
        )}

        {/* Velo del clavado: tapa el corte contra la vista de grafo real */}
        <div className="mv-veil" ref={veilRef} />
      </div>

      <footer className="mv-tesseract-footer">
        <span>
          {entering
            ? 'Entrando…'
            : 'Arrastrá para orbitar · ← → para cambiar de dimensión · click en el bloque del frente para entrar'}
        </span>
      </footer>
    </div>
  );
}
