import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Plus, Minus, Maximize, Undo2, Loader2, Play, Pause } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { fetchDimensiones } from '@/lib/api';
import { resolverColor, colorFuente, colorSeccion, fuenteLabel } from '@/lib/nodes';
import { podar } from '@/lib/aristas';

/**
 * Vista 4D: la cuarta dimensión son las secciones unidas.
 *
 * Todo el conocimiento es UN teseracto —un hipercubo de cuatro dimensiones— y cada
 * sección (en una empresa, un sector o una gerencia) es una de sus celdas: una
 * habitación pegada a las otras, pared con pared. Proyectado en 3D se ve como el
 * teseracto de Interstellar: un cubo dentro de otro, unidos por seis habitaciones.
 * Adentro de cada habitación está el grafo real de su sección, y las relaciones entre
 * secciones cruzan las paredes como puertas.
 *
 * - Zoom continuo: con la rueda te acercás (hacia donde apuntás) y entrás a una
 *   habitación sin clics ni cortes; adentro aparecen los títulos de lo que tenés cerca.
 * - Girar en la cuarta dimensión: el control de abajo rota el hipercubo y las
 *   habitaciones fluyen unas en otras. Quieto por defecto, para poder leer.
 * - Clic en un documento → el inspector (cambia de sección si hace falta). Clic en el
 *   rótulo de una sección → volar hasta su habitación.
 */

const FONDO = 0x05060c;
const ACENTO = 0x22d3ee;
const D4 = 2.6;        // distancia del observador en la cuarta dimensión
const ESCALA = 1000;   // unidades de escena por unidad del hipercubo
const MARGEN = 0.84;   // el grafo no toca las paredes de su habitación

// ── El teseracto ─────────────────────────────────────────────────────────────
const V4 = Array.from({ length: 16 }, (_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
const A4 = [];
for (let i = 0; i < 16; i++) {
  for (let b = 0; b < 4; b++) {
    const j = i ^ (1 << b);
    if (i < j) A4.push([i, j]);
  }
}

// Las 8 celdas del teseracto son los cubos con una coordenada fija en ±1. La w=+1 es
// la más cercana al observador 4D: proyectada envuelve a todas (es la cáscara), así
// que no lleva sección. La w=−1 es la habitación del centro y las otras seis la
// rodean, pared con pared.
const CELDAS = [
  { eje: 3, signo: -1 },
  { eje: 0, signo: 1 }, { eje: 0, signo: -1 },
  { eje: 1, signo: 1 }, { eje: 1, signo: -1 },
  { eje: 2, signo: 1 }, { eje: 2, signo: -1 },
];

/** Una habitación por sección: la del centro y las seis de alrededor. Si hay más de
 *  siete secciones, las celdas de alrededor se parten a lo largo de la cuarta
 *  dimensión, en partes contiguas (siguen pared con pared). */
function habitaciones(n) {
  const out = [CELDAS[0]];
  const resto = Math.max(0, n - 1);
  CELDAS.slice(1).forEach((c, j) => {
    const partes = Math.floor(resto / 6) + (j < resto % 6 ? 1 : 0);
    for (let k = 0; k < partes; k++) {
      out.push(partes === 1 ? c : { ...c, w: [-1 + (2 * k) / partes, -1 + (2 * (k + 1)) / partes] });
    }
  });
  return out.slice(0, n);
}

/** Un punto de la habitación (u, v, t ∈ [−1, 1]) en coordenadas 4D. Con m = 1 llega a
 *  las paredes; con el margen, el grafo queda adentro. */
function a4D(h, u, v, t, m = MARGEN) {
  const p = [0, 0, 0, 0];
  p[h.eje] = h.signo;
  const libres = [u, v, t];
  let i = 0;
  for (let k = 0; k < 4; k++) {
    if (k === h.eje) continue;
    const [lo, hi] = k === 3 && h.w ? h.w : [-1, 1];
    p[k] = (lo + hi) / 2 + ((hi - lo) / 2) * libres[i++] * m;
  }
  return p;
}

/** Rotación en el plano XW (la cuarta dimensión) y proyección en perspectiva a 3D. */
function proyectar(p, giro, out, o) {
  const ca = Math.cos(giro);
  const sa = Math.sin(giro);
  const x = p[0] * ca - p[3] * sa;
  const w = p[0] * sa + p[3] * ca;
  const k = (D4 / (D4 - w)) * ESCALA;
  out[o] = x * k;
  out[o + 1] = p[1] * k;
  out[o + 2] = p[2] * k;
}

/**
 * ¿En qué celda del hipercubo cae un punto de la escena? Se sigue el rayo del
 * observador 4D que se proyecta en ese punto: entra al hipercubo por una celda y sale
 * por otra. La de salida es la habitación que se ve ahí; la de entrada es la cáscara,
 * salvo cuando el giro trae otra habitación adelante. null si el punto está afuera.
 */
function celdasEn(q, giro) {
  const ca = Math.cos(giro);
  const sa = Math.sin(giro);
  // El rayo, en coordenadas del hipercubo: p(s) = a + b·s.
  const a = [D4 * sa, 0, 0, D4 * ca];
  const b = [(q.x * ca) / ESCALA - D4 * sa, q.y / ESCALA, q.z / ESCALA, (-q.x * sa) / ESCALA - D4 * ca];
  let sIn = 0;
  let sOut = Infinity;
  let entra = null;
  let sale = null;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(b[i]) < 1e-9) {
      if (Math.abs(a[i]) > 1) return null;
      continue;
    }
    const s1 = (-1 - a[i]) / b[i];
    const s2 = (1 - a[i]) / b[i];
    const signo = b[i] > 0 ? 1 : -1;   // por qué cara sale en este eje
    if (Math.min(s1, s2) > sIn) { sIn = Math.min(s1, s2); entra = { eje: i, signo: -signo }; }
    if (Math.max(s1, s2) < sOut) { sOut = Math.max(s1, s2); sale = { eje: i, signo }; }
  }
  if (!(sIn < sOut) || !sale) return null;
  if (entra) entra.w = a[3] + b[3] * sIn;
  sale.w = a[3] + b[3] * sOut;
  return { entra, sale };
}

const suave = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const cuantil = (orden, q) => orden[Math.round(q * (orden.length - 1))];
/** Lineal hasta 0.8 y después se aplasta contra 1: los documentos alejados quedan
 *  junto a la pared en vez de achicar a todos los demás. */
const blando = (u) => {
  const a = Math.abs(u);
  return Math.sign(u) * (a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
};
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
const escapar = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function texturaBrillo() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.22, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Estrellas de fondo: lejísimos, quietas (determinísticas). */
function estrellas(n = 1800) {
  let s = 1234567;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = 14000 + rnd() * 14000;
    const q = Math.sqrt(1 - u * u);
    pos.set([r * q * Math.cos(th), r * u, r * q * Math.sin(th)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x9fb4ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
  }));
}

// Las seis caras de una habitación: dos por cada eje libre, cada una en dos triángulos.
const CUADRO = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const TRIANGULOS = [0, 1, 2, 0, 2, 3];

function Boton({ texto, onClick, children }) {
  return (
    <Hint texto={texto} side="right">
      <button type="button" onClick={onClick} aria-label={texto}
        className="grid size-7 place-items-center text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5">
        {children}
      </button>
    </Hint>
  );
}

export default function Vista4D({ selectedId, onElegir }) {
  const cajaRef = useRef(null);
  const apiRef = useRef(null);
  const selRef = useRef(selectedId);
  const elegirRef = useRef(onElegir);
  const giroRef = useRef(0);
  const girandoRef = useRef(false);
  selRef.current = selectedId;
  elegirRef.current = onElegir;
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [dentro, setDentro] = useState(null);
  const [tip, setTip] = useState(null);
  const [ayuda, setAyuda] = useState(true);
  const [giro, setGiro] = useState(0);          // grados, para el control
  const [girando, setGirando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchDimensiones().then((d) => vivo && setDatos(d)).catch((e) => vivo && setError(e.message));
    return () => { vivo = false; };
  }, []);
  useEffect(() => { const t = setTimeout(() => setAyuda(false), 10000); return () => clearTimeout(t); }, []);
  useEffect(() => { girandoRef.current = girando; }, [girando]);

  useEffect(() => {
    const caja = cajaRef.current;
    if (!datos || !caja) return undefined;
    let W = caja.clientWidth || 800;
    let H = caja.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // Con placa integrada cada píxel cuesta: más de 1.5× no se nota y pesa el doble.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(W, H);
    renderer.setClearColor(FONDO);
    caja.appendChild(renderer.domElement);
    const capa = new CSS2DRenderer();
    capa.setSize(W, H);
    capa.domElement.className = 'etiquetas-4d';
    caja.appendChild(capa.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(FONDO, 0.00004);
    const camara = new THREE.PerspectiveCamera(55, W / H, 1, 80000);
    const controles = new OrbitControls(camara, renderer.domElement);
    controles.enableDamping = true;
    controles.dampingFactor = 0.12;
    controles.zoomToCursor = true;      // la rueda va hacia donde apuntás
    controles.screenSpacePanning = true;
    controles.minDistance = 6;
    controles.maxDistance = 30000;
    controles.rotateSpeed = 0.55;
    // Se dibuja sólo cuando algo cambia (cámara, giro, hover, títulos…): quieta, la
    // vista no gasta placa de video ni le quita máquina al resto.
    let sucio = true;
    controles.addEventListener('change', () => { sucio = true; });

    const desechar = [];
    const fondo = estrellas();
    scene.add(fondo);
    desechar.push(fondo.geometry, fondo.material);
    const brillo = texturaBrillo();
    desechar.push(brillo);

    // ── Las secciones, cada una en su habitación del hipercubo ──
    const porSeccion = new Map();
    for (const n of datos.nodos) {
      if (!porSeccion.has(n.dominio)) porSeccion.set(n.dominio, []);
      porSeccion.get(n.dominio).push(n);
    }
    const colorDe = new Map(datos.secciones.map((s, i) => [s.nombre, new THREE.Color(resolverColor(colorSeccion(i), '#22d3ee'))]));
    const orden = [...datos.secciones].sort((a, b) => (porSeccion.get(b.nombre)?.length || 0) - (porSeccion.get(a.nombre)?.length || 0)
      || a.nombre.localeCompare(b.nombre));
    const huecos = habitaciones(orden.length);
    const salas = orden.map((sec, i) => ({
      nombre: sec.nombre, h: huecos[i], color: colorDe.get(sec.nombre), docs: porSeccion.get(sec.nombre) || [],
      centro: new THREE.Vector3(), radio: 1, k: 0, hover: false,
    }));
    const salaDe = (c) => c && salas.find((s) => s.h.eje === c.eje && s.h.signo === c.signo
      && (!s.h.w || (c.w >= s.h.w[0] - 1e-6 && c.w <= s.h.w[1] + 1e-6)));

    // Cada documento en 4D, con la forma de su proyección semántica dentro de su habitación.
    const nodos = [];
    for (const s of salas) {
      // Escala robusta (del 5 % al 95 % de cada eje): el grueso del grafo llena su
      // habitación aunque haya documentos sueltos muy lejos.
      const conPos = s.docs.filter((n) => n.x != null && n.y != null && n.z != null);
      const ejes = [0, 1, 2].map((k) => conPos.map((n) => [n.x, n.y, n.z][k]).sort((a, b) => a - b));
      const c = ejes.map((e) => (e.length ? (cuantil(e, 0.05) + cuantil(e, 0.95)) / 2 : 0));
      const ext = Math.max(...ejes.map((e) => (e.length ? (cuantil(e, 0.95) - cuantil(e, 0.05)) / 2 : 0)), 1e-6);
      for (const n of s.docs) {
        let u; let v; let t;
        if (n.x != null && n.y != null && n.z != null) {
          [u, v, t] = [blando((n.x - c[0]) / ext), blando((n.y - c[1]) / ext), blando((n.z - c[2]) / ext)];
        } else {   // sin proyección todavía: cerca del centro de su habitación, siempre igual
          const hh = hash(n.id);
          [u, v, t] = [((hh & 255) / 255 - 0.5) * 0.3, (((hh >> 8) & 255) / 255 - 0.5) * 0.3, (((hh >> 16) & 255) / 255 - 0.5) * 0.3];
        }
        nodos.push({ n, sala: s, p4: a4D(s.h, u, v, t) });
      }
    }
    const indice = new Map(nodos.map((x, i) => [x.n.id, i]));

    const pos = new Float32Array(Math.max(nodos.length, 1) * 3);
    const col = new Float32Array(Math.max(nodos.length, 1) * 3);
    nodos.forEach((x, i) => {
      const cc = new THREE.Color(resolverColor(colorFuente(x.n), '#8a9099'));
      col.set([cc.r, cc.g, cc.b], i * 3);
    });
    const gp = new THREE.BufferGeometry();
    gp.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gp.setAttribute('color', new THREE.BufferAttribute(col, 3));
    gp.setDrawRange(0, nodos.length);
    const mp = new THREE.PointsMaterial({
      size: 46, sizeAttenuation: true, map: brillo, vertexColors: true, transparent: true,
      opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // Tope de tamaño en pantalla: un documento pegado a la cámara no tapa todo.
    mp.onBeforeCompile = (sh) => {
      const fin = sh.vertexShader.lastIndexOf('}');
      sh.vertexShader = `${sh.vertexShader.slice(0, fin)}\tgl_PointSize = clamp(gl_PointSize, 2.0, ${(24 * renderer.getPixelRatio()).toFixed(1)});\n${sh.vertexShader.slice(fin)}`;
    };
    const puntos = new THREE.Points(gp, mp);
    scene.add(puntos);
    desechar.push(gp, mp);

    // Relaciones: las fuertes de cada documento y TODAS las que cruzan de una sección
    // a otra (las puertas entre habitaciones), en el acento.
    const todas = datos.aristas
      .filter((a) => indice.has(a.s) && indice.has(a.t))
      .map((a) => ({ source: a.s, target: a.t, score: a.score }));
    const seccionDe = (id) => nodos[indice.get(id)].sala.nombre;
    const fuertes = new Set(podar(todas, 2));
    const dibujadas = todas.filter((a) => fuertes.has(a) || seccionDe(a.source) !== seccionDe(a.target));
    const pa = new Float32Array(Math.max(dibujadas.length, 1) * 6);
    const ca = new Float32Array(Math.max(dibujadas.length, 1) * 6);
    const cIntra = new THREE.Color(0x6b79b8);
    const cPuerta = new THREE.Color(ACENTO);
    dibujadas.forEach((a, k) => {
      const c = seccionDe(a.source) !== seccionDe(a.target) ? cPuerta : cIntra;
      ca.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
    });
    const ga = new THREE.BufferGeometry();
    ga.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    ga.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    ga.setDrawRange(0, dibujadas.length * 2);
    const ma = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const aristas = new THREE.LineSegments(ga, ma);
    aristas.frustumCulled = false;
    scene.add(aristas);
    desechar.push(ga, ma);

    // El hipercubo: sus 32 aristas son las paredes de todas las habitaciones.
    const arrMarco = new Float32Array(32 * 6);
    const gm = new LineSegmentsGeometry();
    gm.setPositions(arrMarco);
    const mm = new LineMaterial({
      color: 0x7fe3f5, linewidth: 1.1, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    mm.resolution.set(W, H);
    const marco = new LineSegments2(gm, mm);
    marco.frustumCulled = false;
    scene.add(marco);
    desechar.push(gm, mm);

    // Cada habitación: paredes apenas teñidas del color de su sección (donde dos
    // secciones se tocan, la pared lleva los dos colores) y su rótulo.
    for (const s of salas) {
      const gw = new THREE.BufferGeometry();
      gw.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36 * 3), 3));
      const mw = new THREE.MeshBasicMaterial({
        color: s.color, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const paredes = new THREE.Mesh(gw, mw);
      paredes.frustumCulled = false;
      scene.add(paredes);
      desechar.push(gw, mw);
      const div = document.createElement('div');
      div.className = 'sala-4d';
      div.style.setProperty('--c', `#${s.color.getHexString()}`);
      div.innerHTML = `<div><b>${escapar(s.nombre)}</b><span>${s.docs.length ? `${s.docs.length} documentos` : 'vacía'}</span></div>`;
      div.addEventListener('click', () => apiRef.current?.volarASala(s.nombre));
      div.addEventListener('mouseenter', () => { s.hover = true; });
      div.addEventListener('mouseleave', () => { s.hover = false; });
      const rotulo = new CSS2DObject(div);
      scene.add(rotulo);
      Object.assign(s, { paredes, rotulo });
    }

    // El documento elegido (halo) y las relaciones del que está bajo el mouse.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: brillo, color: ACENTO, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.visible = false;
    scene.add(halo);
    desechar.push(halo.material);
    const gHover = new THREE.BufferGeometry();
    const lHover = new THREE.LineSegments(gHover, new THREE.LineBasicMaterial({
      color: ACENTO, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    lHover.frustumCulled = false;
    scene.add(lHover);
    desechar.push(gHover, lHover.material);
    const vecinos = new Map();
    for (const a of todas) {
      if (!vecinos.has(a.source)) vecinos.set(a.source, []);
      if (!vecinos.has(a.target)) vecinos.set(a.target, []);
      vecinos.get(a.source).push(a.target);
      vecinos.get(a.target).push(a.source);
    }
    let hoverId = null;

    const titulos = Array.from({ length: 14 }, () => {
      const d = document.createElement('div');
      d.className = 'nodo-4d';
      d.innerHTML = '<span></span>';
      const o = new CSS2DObject(d);
      o.visible = false;
      scene.add(o);
      return o;
    });

    const posicion = (i, v = new THREE.Vector3()) => v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const mostrarRelaciones = (id) => {
      const i = indice.get(id);
      const otros = (vecinos.get(id) || []).map((v) => indice.get(v));
      const arr = new Float32Array(Math.max(otros.length, 1) * 6);
      otros.forEach((j, k) => arr.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], k * 6));
      gHover.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      gHover.setDrawRange(0, otros.length * 2);
      sucio = true;
    };

    // ── Proyectar todo con el giro actual en la cuarta dimensión ──
    const tmp3 = new Float32Array(3);
    const reproyectar = (g) => {
      nodos.forEach((x, i) => proyectar(x.p4, g, pos, i * 3));
      gp.attributes.position.needsUpdate = true;
      gp.computeBoundingSphere();
      dibujadas.forEach((a, k) => {
        const i = indice.get(a.source);
        const j = indice.get(a.target);
        pa.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], k * 6);
      });
      ga.attributes.position.needsUpdate = true;
      // El marco escribe directo en el buffer de la geometría (setPositions no copia).
      A4.forEach(([i, j], s) => {
        proyectar(V4[i], g, arrMarco, s * 6);
        proyectar(V4[j], g, arrMarco, s * 6 + 3);
      });
      gm.attributes.instanceStart.data.needsUpdate = true;
      for (const s of salas) {
        proyectar(a4D(s.h, 0, 0, 0), g, tmp3, 0);
        s.centro.set(tmp3[0], tmp3[1], tmp3[2]);
        let r = 0;
        for (const u of [-1, 1]) for (const v of [-1, 1]) for (const t of [-1, 1]) {
          proyectar(a4D(s.h, u, v, t, 1), g, tmp3, 0);
          r = Math.max(r, Math.hypot(tmp3[0] - s.centro.x, tmp3[1] - s.centro.y, tmp3[2] - s.centro.z));
        }
        s.radio = r;
        const arr = s.paredes.geometry.attributes.position.array;
        let o = 0;
        for (let j = 0; j < 3; j++) {
          for (const lado of [-1, 1]) {
            const esq = CUADRO.map(([e1, e2]) => {
              const l = [0, 0, 0];
              l[j] = lado;
              l[(j + 1) % 3] = e1;
              l[(j + 2) % 3] = e2;
              return a4D(s.h, l[0], l[1], l[2], 1);
            });
            for (const t of TRIANGULOS) { proyectar(esq[t], g, arr, o); o += 3; }
          }
        }
        s.paredes.geometry.attributes.position.needsUpdate = true;
        s.rotulo.position.set(s.centro.x, s.centro.y + r * 0.25, s.centro.z);
      }
      if (hoverId) mostrarRelaciones(hoverId);
      sucio = true;
    };
    reproyectar(0);
    let giroProyectado = 0;

    // ── Encuadres y vuelos ──
    const cascara = ESCALA * (D4 / (D4 - 1)) * Math.sqrt(3);   // radio del cubo de afuera
    // Todo el teseracto a la vista, en el lado más angosto del lienzo.
    const vistaGeneral = () => {
      const mitadV = THREE.MathUtils.degToRad(camara.fov / 2);
      const mitad = Math.min(mitadV, Math.atan(Math.tan(mitadV) * camara.aspect));
      return {
        target: new THREE.Vector3(0, 0, 0),
        pos: new THREE.Vector3(0.85, 0.62, 1.5).normalize().multiplyScalar((cascara / Math.sin(mitad)) * 1.02),
      };
    };
    let vuelo = null;
    const volar = (destino, target, dur = 1400) => {
      vuelo = { t0: performance.now(), dur, dp: camara.position.clone(), hp: destino, dt: controles.target.clone(), ht: target };
    };
    // Llegada: desde lejos, hasta tener todo el teseracto a la vista.
    const inicio = vistaGeneral();
    camara.position.copy(inicio.pos).multiplyScalar(1.8);
    controles.target.copy(inicio.target);
    volar(inicio.pos, inicio.target, 1800);

    apiRef.current = {
      volarASala(nombre) {
        const s = salas.find((x) => x.nombre === nombre);
        if (!s) return;
        const dir = camara.position.clone().sub(s.centro).normalize();
        if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
        volar(s.centro.clone().add(dir.multiplyScalar(s.radio * 0.9)), s.centro.clone());
      },
      volarA(id) {
        const i = indice.get(id);
        if (i == null) return;
        const p = posicion(i);
        const dir = camara.position.clone().sub(p).normalize();
        volar(p.clone().add(dir.multiplyScalar(160)), p.clone(), 1100);
      },
      salir() { const v = vistaGeneral(); volar(v.pos, v.target); },
      zoom(f) {
        const dir = camara.position.clone().sub(controles.target);
        volar(controles.target.clone().add(dir.multiplyScalar(f)), controles.target.clone(), 450);
      },
    };

    // ── Mouse: hover, clic, doble clic ──
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let quiereElegir = false;
    let abajo = null;
    const aNdc = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      return r;
    };
    const elegirBajo = () => {
      ray.params.Points.threshold = Math.max(5, camara.position.distanceTo(controles.target) * 0.012);
      ray.setFromCamera(mouse, camara);
      const h = ray.intersectObject(puntos, false).sort((a, b) => a.distanceToRay - b.distanceToRay || a.distance - b.distance)[0];
      return h ? nodos[h.index]?.n : null;
    };
    const onMove = (e) => {
      const r = aNdc(e);
      quiereElegir = { x: e.clientX - r.left, y: e.clientY - r.top, ancho: r.width };
    };
    const onLeave = () => { quiereElegir = false; hoverId = null; setTip(null); gHover.setDrawRange(0, 0); sucio = true; };
    const onDown = (e) => { abajo = { x: e.clientX, y: e.clientY }; setAyuda(false); };
    const onUp = (e) => {
      if (!abajo || Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) > 5) return;
      aNdc(e);
      const n = elegirBajo();
      if (n) elegirRef.current?.(n.id, n.dominio);
    };
    // Doble clic: sobre un documento, ir hasta él; en cualquier otro lado, acercarte ahí.
    const onDbl = (e) => {
      aNdc(e);
      const n = elegirBajo();
      if (n) { apiRef.current.volarA(n.id); return; }
      ray.setFromCamera(mouse, camara);
      const p = ray.ray.at(camara.position.distanceTo(controles.target), new THREE.Vector3());
      volar(camara.position.clone().lerp(p, 0.6), p, 900);
    };
    const lienzo = renderer.domElement;
    lienzo.addEventListener('pointermove', onMove);
    lienzo.addEventListener('pointerleave', onLeave);
    lienzo.addEventListener('pointerdown', onDown);
    lienzo.addEventListener('pointerup', onUp);
    lienzo.addEventListener('dblclick', onDbl);
    controles.addEventListener('start', () => { vuelo = null; });

    const ro = new ResizeObserver(() => {
      W = caja.clientWidth || W;
      H = caja.clientHeight || H;
      renderer.setSize(W, H);
      capa.setSize(W, H);
      camara.aspect = W / H;
      camara.updateProjectionMatrix();
      mm.resolution.set(W, H);
      sucio = true;
    });
    ro.observe(caja);

    // ── Cada cuadro ──
    let raf = 0;
    let antes = performance.now();
    let ultimoTitulo = 0;
    let ultimoGiroUI = 0;
    let ultimoPulso = 0;
    let dentroActual = null;
    let selPrevio = null;
    let tSel = 0;
    const tmp = new THREE.Vector3();
    const cuadro = (ahora) => {
      raf = requestAnimationFrame(cuadro);
      const dt = Math.min(0.05, (ahora - antes) / 1000);
      antes = ahora;

      if (vuelo) {
        const k = easeInOut(Math.min(1, (ahora - vuelo.t0) / vuelo.dur));
        camara.position.lerpVectors(vuelo.dp, vuelo.hp, k);
        controles.target.lerpVectors(vuelo.dt, vuelo.ht, k);
        if (k >= 1) vuelo = null;
        sucio = true;
      }
      controles.update();

      // Girar en la cuarta dimensión.
      if (girandoRef.current) {
        giroRef.current = (giroRef.current + dt * 0.22) % (Math.PI * 2);
        if (ahora - ultimoGiroUI > 120) { ultimoGiroUI = ahora; setGiro(Math.round((giroRef.current * 180) / Math.PI)); }
      }
      if (Math.abs(giroRef.current - giroProyectado) > 1e-4) {
        giroProyectado = giroRef.current;
        reproyectar(giroProyectado);
      }

      // ¿Dónde estás? En la habitación del punto que mirás, cuando estás cerca de él.
      const foco = celdasEn(controles.target, giroProyectado);
      let aqui = foco ? (salaDe(foco.sale) || salaDe(foco.entra)) : null;
      if (aqui && camara.position.distanceTo(controles.target) > aqui.radio * 1.05) aqui = null;
      const nuevo = aqui ? aqui.nombre : null;
      if (nuevo !== dentroActual) { dentroActual = nuevo; setDentro(nuevo); }

      // Adentro de la estructura el marco se aquieta; el rótulo de la habitación en la
      // que estás se apaga para no tapar su grafo (las de al lado se siguen viendo).
      const dEst = camara.position.length() / cascara;
      const opMarco = 0.13 + 0.19 * suave(0.35, 1.1, dEst);
      const opAristas = 0.14 + 0.14 * (1 - suave(0.4, 1.3, dEst));
      if (Math.abs(opMarco - mm.opacity) > 1e-3 || Math.abs(opAristas - ma.opacity) > 1e-3) {
        mm.opacity = opMarco;
        ma.opacity = opAristas;
        sucio = true;
      }
      for (const s of salas) {
        const meta = s === aqui ? 1 : 0;
        s.k = Math.abs(meta - s.k) > 0.003 ? s.k + (meta - s.k) * Math.min(1, dt * 4) : meta;
        const op = (s.hover ? 0.11 : 0.045) * (s.docs.length ? 1 : 0.55);
        if (op !== s.paredes.material.opacity) { s.paredes.material.opacity = op; sucio = true; }
        const opRotulo = (1 - s.k * 0.85).toFixed(2);   // es DOM: no hace falta redibujar
        if (opRotulo !== s.opRotulo) { s.opRotulo = opRotulo; s.rotulo.element.style.opacity = opRotulo; }
      }

      // Títulos: los documentos más cercanos a vos, sin pisarse.
      if (ahora - ultimoTitulo > 250) {
        ultimoTitulo = ahora;
        const cerca = [];
        for (let i = 0; i < nodos.length; i++) {
          const p = posicion(i);
          const d = p.distanceTo(camara.position);
          if (d > ESCALA * 0.75) continue;
          tmp.copy(p).project(camara);
          if (tmp.z < -1 || tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) continue;
          cerca.push({ x: nodos[i], p, d, sx: tmp.x, sy: tmp.y });
        }
        cerca.sort((a, b) => a.d - b.d);
        const elegidos = [];
        const ocupadas = [];
        for (const c of cerca) {
          if (elegidos.length >= titulos.length) break;
          const x = ((c.sx + 1) / 2) * W;
          const y = ((1 - c.sy) / 2) * H - 15;
          const w = Math.min(230, c.x.n.label.length * 6.6) + 10;
          const r = [x - w / 2, y - 10, x + w / 2, y + 10];
          if (ocupadas.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) continue;
          ocupadas.push(r);
          elegidos.push(c);
        }
        titulos.forEach((o, k) => {
          const c = elegidos[k];
          if (!c) {
            if (o.visible) { o.visible = false; sucio = true; }
            return;
          }
          if (!o.visible || o.userData.id !== c.x.n.id) {
            o.visible = true;
            o.userData.id = c.x.n.id;
            o.element.firstChild.textContent = c.x.n.label;
            sucio = true;
          }
          o.position.copy(c.p);
          const op = (1 - suave(ESCALA * 0.35, ESCALA * 0.75, c.d)).toFixed(2);
          if (op !== o.userData.op) { o.userData.op = op; o.element.style.opacity = op; }
        });
      }

      // Hover.
      if (quiereElegir) {
        const q = quiereElegir;
        quiereElegir = false;
        const n = elegirBajo();
        const id = n?.id || null;
        if (id !== hoverId) {
          hoverId = id;
          if (id) mostrarRelaciones(id); else gHover.setDrawRange(0, 0);
          sucio = true;
        }
        setTip(n ? { label: n.label, seccion: n.dominio, fuente: fuenteLabel(n), x: q.x, y: q.y, ancho: q.ancho } : null);
      }

      // El elegido: late unos segundos para encontrarlo y después queda quieto.
      const iSel = selRef.current != null ? (indice.get(selRef.current) ?? null) : null;
      if (iSel !== selPrevio) { selPrevio = iSel; tSel = ahora; sucio = true; }
      halo.visible = iSel != null;
      if (iSel != null) {
        const pulso = 0.15 * Math.max(0, 1 - (ahora - tSel) / 4000);
        if (pulso > 0 && ahora - ultimoPulso > 40) { ultimoPulso = ahora; sucio = true; }
        if (sucio) {
          posicion(iSel, halo.position);
          halo.scale.setScalar(Math.max(2, camara.position.distanceTo(halo.position) * 0.045) * (1 + pulso * Math.sin(ahora / 300)));
        }
      }

      if (sucio) {
        renderer.render(scene, camara);
        capa.render(scene, camara);
        sucio = false;
      }
    };
    raf = requestAnimationFrame(cuadro);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      lienzo.removeEventListener('pointermove', onMove);
      lienzo.removeEventListener('pointerleave', onLeave);
      lienzo.removeEventListener('pointerdown', onDown);
      lienzo.removeEventListener('pointerup', onUp);
      lienzo.removeEventListener('dblclick', onDbl);
      controles.dispose();
      desechar.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      capa.domElement.remove();
      apiRef.current = null;
    };
  }, [datos]);

  const secciones = datos?.secciones || [];
  const cambiarGiro = (grados) => {
    setGiro(grados);
    giroRef.current = (grados * Math.PI) / 180;
  };
  return (
    <div ref={cajaRef} className="relative size-full overflow-hidden bg-[#05060c]">
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex flex-wrap items-start gap-2 text-[11px] text-ink-dim">
        <span className="pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-xs border border-hair bg-surface/90 px-1.5 py-0.5">
          <span className="font-medium text-ink">4D</span>
          <span>· {dentro ? <>adentro de <b className="font-medium capitalize text-ink">{dentro}</b></> : 'tus secciones, unidas en un teseracto'}</span>
          {dentro && (
            <button type="button" onClick={() => apiRef.current?.salir()} className="ml-1 flex items-center gap-0.5 text-accent-soft hover:text-accent">
              <Undo2 className="size-3" /> salir
            </button>
          )}
        </span>
      </div>

      {secciones.length > 0 && (
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-0.5 rounded-sm border border-hair bg-surface/90 p-1.5 text-[11.5px]">
          <span className="px-1 pb-0.5 text-[10px] uppercase tracking-[0.08em] text-ink-dim">Habitaciones</span>
          {secciones.map((s, i) => (
            <button
              key={s.nombre}
              type="button"
              onClick={() => apiRef.current?.volarASala(s.nombre)}
              className={`flex items-center gap-2 rounded-xs px-1 py-0.5 text-left hover:bg-surface-2 hover:text-ink ${
                dentro === s.nombre ? 'bg-surface-2 text-ink' : 'text-ink-muted'}`}
            >
              <span className="size-2 rounded-[2px] dot-cat" style={{ '--c': colorSeccion(i) }} />
              <span className="capitalize">{s.nombre}</span>
              <span className="ml-auto pl-3 tabular-nums text-ink-dim">{s.count}</span>
            </button>
          ))}
        </div>
      )}

      {!datos && !error && (
        <p className="absolute inset-0 grid place-items-center text-[12px] text-ink-dim">
          <span className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Abriendo la cuarta dimensión…</span>
        </p>
      )}
      {error && <p className="absolute inset-0 grid place-items-center text-[12px] text-danger">No se pudo abrir el espacio: {error}</p>}

      {tip && (
        <div
          className="pointer-events-none absolute z-20 max-w-[280px] rounded-sm border border-hair-strong bg-surface/95 px-2.5 py-1.5 text-[11.5px] shadow-lg"
          style={{ left: Math.min(tip.x + 14, tip.ancho - 290), top: tip.y + 14 }}
        >
          <p className="text-ink">{tip.label}</p>
          <p className="text-ink-dim"><span className="capitalize">{tip.seccion}</span>{tip.fuente ? ` · ${tip.fuente}` : ''} · clic para abrirlo</p>
        </div>
      )}

      {datos && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
          {ayuda && (
            <p className="pointer-events-none whitespace-nowrap rounded-xs border border-hair bg-surface/90 px-2.5 py-1 text-[11.5px] text-ink-muted">
              Rueda: acercarte hacia donde apuntás · arrastrá: mirar alrededor · doble clic: ir ahí
            </p>
          )}
          <div className="flex items-center gap-2 rounded-sm border border-hair bg-surface/90 px-2 py-1 text-[11px] text-ink-dim">
            <button
              type="button"
              onClick={() => setGirando((g) => !g)}
              className="grid size-6 place-items-center rounded-xs text-ink-muted hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5"
              aria-label={girando ? 'Detener el giro' : 'Girar en la cuarta dimensión'}
              title={girando ? 'Detener el giro' : 'Girar en la cuarta dimensión'}
            >
              {girando ? <Pause /> : <Play />}
            </button>
            <span className="whitespace-nowrap">Girar en la 4ª dimensión</span>
            <input
              type="range" min={0} max={359} value={giro}
              onChange={(e) => { setGirando(false); cambiarGiro(Number(e.target.value)); }}
              className="w-40 accent-[var(--color-accent)]"
              aria-label="Girar en la cuarta dimensión"
            />
            <span className="w-8 text-right tabular-nums">{giro}°</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-3 z-10 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
        <Boton texto="Acercar" onClick={() => apiRef.current?.zoom(0.6)}><Plus /></Boton>
        <Boton texto="Alejar" onClick={() => apiRef.current?.zoom(1.6)}><Minus /></Boton>
        <Boton texto="Ver todo el teseracto" onClick={() => apiRef.current?.salir()}><Maximize /></Boton>
      </div>
    </div>
  );
}
