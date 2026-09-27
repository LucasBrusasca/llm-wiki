import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Maximize, Pin, PinOff, Link2, X, Expand } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import ColorPanel, { calcularLeyenda } from '@/app/ColorPanel';
import NodoTooltip from '@/app/NodoTooltip';
import Etiquetas3D from '@/app/Etiquetas3D';
import {
  TARJETA, estadoNodo, vecinosDe, claseDetalle, calcularHitos, colocarPiezas, radioPantalla, medirHud,
} from '@/lib/detalle';
import { aristasVisibles, estiloArista } from '@/lib/aristas';
import { resolverColor } from '@/lib/nodes';

/**
 * Vista "Explorar 3D": modo de impacto, nunca el home.
 *
 * - Posiciones FIJAS desde la proyección 3D del backend (embeddings → UMAP):
 *   no hay simulación corriendo, nada se mueve ni titila.
 * - Aristas quietas, con el mismo criterio y peso que el 2D (lib/aristas).
 * - El detalle depende de cuán cerca de la cámara está CADA nodo (no el centro de
 *   la nube): lejos es un punto; más cerca lleva un chip con su título; cerca, el
 *   nodo ES su tarjeta (miniatura + título) y la esfera desaparece. Las reglas, los
 *   topes y el anti-choque son los mismos que en el 2D (lib/detalle).
 * - Tarjetas y chips son HTML (Etiquetas3D sobre CSS2DRenderer). Hover sobre
 *   cualquier nodo, chip o tarjeta → tooltip con el título completo y sus aristas
 *   encendidas.
 * - Clic en un nodo → mismo Inspector. Clic en el vacío → suelta el pin.
 */

const ESCALA = 320;

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

// Una sola geometría de esfera (radio 1) para todos los nodos: el radio va en la escala.
const esferaGeo = new THREE.SphereGeometry(1, 20, 14);
const _p = new THREE.Vector3();

/** El raycast de three.js no mira `visible`: sin esto, lo oculto seguiría atrapando hover y clic. */
function raycastSiVisible(raycaster, intersects) {
  if (this.visible) Object.getPrototypeOf(this).raycast.call(this, raycaster, intersects);
}

/**
 * Hit-box de la tarjeta o del chip: no se dibuja, sólo recibe hover y clic. Gana
 * siempre, porque lo que se ve arriba es la pieza HTML aunque detrás haya una
 * esfera más cerca de la cámara.
 */
function raycastPieza(raycaster, intersects) {
  if (!this.visible) return;
  const antes = intersects.length;
  THREE.Sprite.prototype.raycast.call(this, raycaster, intersects);
  for (let i = antes; i < intersects.length; i++) intersects[i].distance -= 1e6;
}

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
  const objs = useRef(new Map());      // id → { g, esfera, halo, blanco, r, hs, estado, fuerte, node, modo, dim, sep }
  const piezas = useRef(new Map());    // `${tipo}:${id}` → CSS2DObject (tarjeta o chip), reusados entre frames
  const capaRef = useRef(null);        // grupo en la escena raíz con las piezas HTML
  const etiquetasRef = useRef(null);   // API de <Etiquetas3D>
  const firmaRef = useRef('');
  const hudRef = useRef({ t: -Infinity, rects: [] });
  const hoverRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, ancho: 0, alto: 0 });
  // El motor sigue haciendo raycast en la última posición conocida del puntero aunque
  // el mouse ya esté en la lista o el panel: al volar la cámara, un nodo que "pasa por
  // debajo" disparaba un tooltip fantasma. Sólo cuenta el hover con el puntero adentro.
  const adentroRef = useRef(false);
  const [hover, setHover] = useState(null);
  const [aire, setAire] = useState(0);   // índice en NIVELES_AIRE
  const rafRef = useRef(0);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  // Renderer HTML encima del WebGL: prop de inicio, se crea una sola vez.
  const extraRenderers = useMemo(() => [new CSS2DRenderer()], []);

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
    arista: resolverColor('var(--arista)', '#6b79b8'),
  }), []);

  const colorDe = useCallback((n) => resolverColor(colorVar(n)), [colorVar]);

  const pin = pinnedEdge && selectedId
    && (pinnedEdge.source === selectedId || pinnedEdge.target === selectedId)
    && visibleIds.has(pinnedEdge.source) && visibleIds.has(pinnedEdge.target)
    ? pinnedEdge : null;
  const pinOtro = pin ? (pin.source === selectedId ? pin.target : pin.source) : null;

  const vecinos = useMemo(() => vecinosDe({ selectedId, ego, relIndex }), [selectedId, relIndex, ego]);
  const grado = useCallback((id) => relIndex.get(id)?.length || 0, [relIndex]);
  // Nodo bajo el puntero: enciende sus aristas (como en el 2D). Aparte del estado del
  // tooltip, que cambia con cada movimiento del mouse.
  const [hoverId, setHoverId] = useState(null);

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
    // Las mismas relaciones y el mismo corte de "fuertes" que el 2D.
    const links = aristasVisibles(edges, visibleIds).map((e) => ({
      source: e.source, target: e.target, label: e.label, score: e.score, fuerte: e.fuerte,
    }));
    return { nodes: ns, links };
  }, [nodes, edges, visibleIds, aire, ego]);

  const hitos = useMemo(
    () => calcularHitos({ selectedId, ego, relIndex, visibleIds }),
    [selectedId, ego, relIndex, visibleIds],
  );

  const estadoDe = useCallback(
    (id) => estadoNodo(id, { selectedId, pinOtro, vecinos, ego }),
    [selectedId, pinOtro, vecinos, ego],
  );

  const claseDe = useCallback(
    (id, estado) => claseDetalle(estado, { destacado: highlightIds.has(id), hito: hitos.has(id) }),
    [highlightIds, hitos],
  );

  const nodeObject = useCallback((d) => {
    const estado = estadoDe(d.id);
    const fuerte = estado === 'sel' || estado === 'pin';
    const color = new THREE.Color(colorDe(d.node));
    const r = 3 + Math.sqrt(grado(d.id)) * 1.1 + (fuerte ? 2 : 0);
    const alpha = estado === 'tenue' ? 0.28 : 1;   // contexto visible, no negro

    const g = new THREE.Group();
    const esfera = new THREE.Mesh(
      esferaGeo,
      new THREE.MeshBasicMaterial({ color, transparent: alpha < 1, opacity: alpha }),
    );
    esfera.scale.setScalar(r);
    esfera.raycast = raycastSiVisible;
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
    halo.raycast = raycastSiVisible;
    g.add(halo);

    // Hit-box de la tarjeta o el chip: tamaño fijo en pantalla, no se dibuja.
    const blanco = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, visible: false }));
    blanco.visible = false;
    blanco.raycast = raycastPieza;
    g.add(blanco);

    objs.current.set(d.id, { g, esfera, halo, blanco, r, hs, estado, fuerte, node: d.node, modo: null });
    return g;
  }, [estadoDe, colorDe, grado, paleta]);

  // Paneles del lienzo (color, pin, vecindario, controles): nada se dibuja debajo.
  // Se miden cada tanto, no en cada frame.
  const rectsHud = useCallback(() => {
    const h = hudRef.current;
    const ahora = performance.now();
    if (ahora - h.t >= 400) { h.rects = medirHud(cajaRef.current); h.t = ahora; }
    return h.rects;
  }, []);

  // ── Detalle por nodo: punto → chip → tarjeta (reglas en lib/detalle) ──
  const actualizarDetalle = useCallback(() => {
    const fg = fgRef.current;
    const capa = capaRef.current;
    const W = tam.w;
    const H = tam.h;
    if (!fg || !capa || !W || !H) return;
    const cam = fg.camera();
    cam.updateMatrixWorld();   // el evento 'change' llega antes del render que la actualiza
    const focal = (H / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);

    // 1) Cada nodo: esfera acotada en pantalla y, si le corresponde, candidato a detalle.
    const cands = [];
    for (const [id, o] of objs.current) {
      if (!o.g.parent) { objs.current.delete(id); continue; }   // objeto viejo, fuera de escena
      o.modo = null;
      o.g.getWorldPosition(_p);
      const dist = Math.max(1, cam.position.distanceTo(_p));
      const pxu = focal / dist;   // px de pantalla por unidad de escena en ESTE nodo
      o.rpx = radioPantalla(o.r, pxu, o.fuerte);
      const k = o.rpx / (o.r * pxu);
      o.esfera.scale.setScalar(o.r * k);
      o.halo.scale.set(o.hs * k, o.hs * k, 1);

      const clase = claseDe(id, o.estado);
      if (!clase) continue;
      _p.project(cam);
      if (_p.z < -1 || _p.z > 1) continue;                     // detrás de la cámara
      const x = (_p.x * 0.5 + 0.5) * W;
      const y = (-_p.y * 0.5 + 0.5) * H;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      // Entre pares, primero lo más cercano y más al centro de la vista.
      const alCentro = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2));
      cands.push({ id, x, y, clase, escala: pxu, rpx: o.rpx, label: o.node.label, orden: dist * (1 + 0.6 * alCentro) });
    }

    // 2) Por prioridad: tarjeta si está cerca y entra; si no, chip; si no, punto.
    const puestas = colocarPiezas(cands, { W, H, ocupadas: rectsHud() });
    for (const [id, p] of puestas) Object.assign(objs.current.get(id), p);

    // 3) Aplicar. La tarjeta reemplaza a la esfera; el hit-box copia lo que se ve.
    const items = [];
    const usadas = new Set();
    for (const [id, o] of objs.current) {
      const tarjeta = o.modo === 'tarjeta';
      o.esfera.visible = !tarjeta;
      o.halo.visible = !tarjeta;
      o.blanco.visible = !!o.modo;
      if (!o.modo) continue;
      o.blanco.scale.set(o.dim.w / focal, o.dim.h / focal, 1);   // sizeAttenuation=false: escala = px / focal
      o.blanco.center.set(tarjeta ? 0.5 : -o.sep / o.dim.w, 0.5);

      const clave = `${o.modo}:${id}`;
      usadas.add(clave);
      let pieza = piezas.current.get(clave);
      if (!pieza) {
        pieza = new CSS2DObject(document.createElement('div'));
        pieza.element.style.pointerEvents = 'none';
        pieza.center.set(tarjeta ? 0.5 : 0, 0.5);   // tarjeta centrada en el nodo; chip a su derecha
        piezas.current.set(clave, pieza);
      }
      o.g.getWorldPosition(pieza.position);
      if (pieza.parent !== capa) capa.add(pieza);
      if (!tarjeta && pieza.sep !== o.sep) {
        pieza.sep = o.sep;
        pieza.element.style.setProperty('--sep', `${o.sep}px`);
      }
      items.push({
        clave, id, tipo: o.modo, el: pieza.element, node: o.node, estado: o.estado,
        color: colorVar(o.node), grande: o.dim === TARJETA.grande, medida: tarjeta ? null : o.dim,
        marcado: highlightIds.has(id),
      });
    }
    // Lo que dejó de verse sale de la capa (el CSS2DObject saca su elemento del DOM).
    for (const [clave, pieza] of piezas.current) {
      if (!usadas.has(clave) && pieza.parent) pieza.parent.remove(pieza);
    }
    const firma = items.map((it) => `${it.clave}|${it.estado}|${it.color}|${it.marcado}`).join(',');
    if (firma !== firmaRef.current) {
      firmaRef.current = firma;
      etiquetasRef.current?.mostrar(items);
    }
  }, [tam.w, tam.h, claseDe, colorVar, rectsHud, highlightIds]);

  // Recalcular como mucho una vez por frame.
  const programar = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      actualizarDetalle();
    });
  }, [actualizarDetalle]);
  // Al desmontar (o en el doble montaje de StrictMode) hay que soltar también la marca:
  // si queda puesta, programar() cree que hay un frame pendiente y no agenda nunca más.
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }, []);

  // Qué arista se ve y cómo: el mismo criterio que el 2D (lib/aristas).
  const estiloDe = useCallback(
    (l) => estiloArista(l, { selectedId, pin, ego, hoverId }),
    [selectedId, pin, ego, hoverId],
  );
  const linkVisible = useCallback((l) => estiloDe(l).visible, [estiloDe]);
  const linkColor = useCallback((l) => {
    const e = estiloDe(l);
    return rgba(e.acento ? paleta.acento : paleta.arista, e.alfa);
  }, [estiloDe, paleta]);
  // Con `width = 0` three.js dibuja una línea de UN píxel: a distancia, con niebla y
  // sobre fondo oscuro, desaparece. Dándole grosor real la arista es un cilindro que
  // se ve desde el encuadre inicial. El grosor sigue al score (lib/aristas).
  const linkWidth = useCallback((l) => {
    const e = estiloArista(l, { pin });   // el grosor no depende del hover
    return e.fijada ? 1.4 : e.grosor * 0.55;
  }, [pin]);


  // Sólo en desarrollo: acceso a la instancia para depurar desde la consola.
  useEffect(() => { if (import.meta.env.DEV) window.__algedi3d = fgRef.current; });

  // Fondo + niebla leve (profundidad sin efectos animados).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene();
    scene.fog = new THREE.FogExp2(paleta.fondo, 0.00030);
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

  // Capa de piezas HTML: un grupo propio en la escena raíz, así sobrevive a que el
  // motor recree los objetos de nodo en cada cambio de selección.
  useEffect(() => {
    const fg = fgRef.current;
    if (!listo || !fg) return undefined;
    const capa = new THREE.Group();
    fg.scene().add(capa);
    capaRef.current = capa;
    const mapa = piezas.current;
    return () => {
      // Sacar cada pieza de a una: el evento 'removed' es el que quita su elemento del DOM.
      [...capa.children].forEach((p) => capa.remove(p));
      fg.scene().remove(capa);
      capaRef.current = null;
      mapa.clear();
      firmaRef.current = '';
      etiquetasRef.current?.mostrar([]);
    };
  }, [listo]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!listo || !fg) return undefined;
    const ctr = fg.controls();
    ctr.addEventListener('change', programar);
    programar();                                   // objetos recién creados: esconder esferas bajo tarjetas ya
    const t = setTimeout(programar, 120);          // después de que el motor ubicó los objetos
    const t2 = setTimeout(programar, 1100);        // y al terminar el vuelo de cámara
    return () => { ctr.removeEventListener('change', programar); clearTimeout(t); clearTimeout(t2); };
  }, [listo, programar, nodeObject, data]);

  const leyenda = useMemo(() => calcularLeyenda(nodes, visibleIds, colorMode, temas), [nodes, visibleIds, colorMode, temas]);
  const pinLabel = pin ? data.nodes.find((d) => d.id === pinOtro)?.node.label : null;
  const egoLabel = ego ? data.nodes.find((d) => d.id === ego.origen)?.node.label : null;

  return (
    <div
      ref={cajaRef}
      onMouseMove={(e) => {
        adentroRef.current = true;
        const r = cajaRef.current.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top, ancho: r.width, alto: r.height };
        if (hoverRef.current) setHover((h) => (h ? { ...h, ...mouseRef.current } : h));
      }}
      onMouseLeave={() => {
        adentroRef.current = false;
        hoverRef.current = null;
        setHover(null);
        setHoverId(null);
        etiquetasRef.current?.resaltar(null);
        if (cajaRef.current) cajaRef.current.style.cursor = '';
      }}
      onPointerDown={() => setHover(null)}
      className="fondo-grafo relative size-full overflow-hidden"
    >
      {!nodes.length && (
        <div className="absolute inset-0 grid place-items-center text-[12px] text-ink-dim">Sin nodos para graficar.</div>
      )}
      {tam.w > 0 && nodes.length > 0 && (
        // `isolate`: los z-index que el renderer HTML pone a cada pieza quedan acá
        // adentro y nunca pasan por encima de los paneles del lienzo.
        <div className="absolute inset-0 isolate">
          <ForceGraph3D
            ref={fgRef}
            width={tam.w}
            height={tam.h}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            showNavInfo={false}
            controlType="orbit"
            extraRenderers={extraRenderers}
            enableNodeDrag={false}
            cooldownTicks={1}
            warmupTicks={0}
            nodeThreeObject={nodeObject}
            onNodeHover={(n) => {
              const d = adentroRef.current ? n : null;
              hoverRef.current = d?.id || null;
              if (cajaRef.current) cajaRef.current.style.cursor = d ? 'pointer' : '';
              setHover(d ? { node: d.node, ...mouseRef.current } : null);
              setHoverId(d?.id || null);
              etiquetasRef.current?.resaltar(d?.id || null);
            }}
            linkVisibility={linkVisible}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkOpacity={1}
            linkDirectionalParticles={0}
            onNodeClick={(d) => onSelect(d.id)}
            onBackgroundClick={() => pinnedEdge && onClearPin?.()}
          />
        </div>
      )}
      <Etiquetas3D ref={etiquetasRef} />

      <div className="pointer-events-none absolute left-3 right-3 top-3 flex flex-wrap items-start gap-2 text-[11px] text-ink-dim">
        {pin && (
          <span data-hud className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Link2 className="size-3 text-accent" />
            <span className="max-w-[220px] truncate" title={pinLabel || undefined}>{pinLabel}</span>
            <button type="button" onClick={onClearPin} className="text-ink-dim hover:text-ink" aria-label="Soltar vínculo"><X className="size-3" /></button>
          </span>
        )}
        {ego && (
          <span data-hud className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Pin className="size-3 text-accent" />
            <span className="max-w-[220px] truncate" title={egoLabel ? `Vecindario de ${egoLabel}` : undefined}>Vecindario de {egoLabel}</span>
            <span className="text-ink-dim">{ego.ids.size}</span>
            <button type="button" onClick={onFijar} className="text-ink-dim hover:text-ink" aria-label="Desfijar vecindario"><X className="size-3" /></button>
          </span>
        )}
        <ColorPanel modo={colorMode} onModo={onColorMode} leyenda={leyenda} compacto={compacto} />
      </div>

      {hover && <NodoTooltip node={hover.node} x={hover.x} y={hover.y} ancho={hover.ancho} alto={hover.alto} temas={temas} />}

      <div data-hud className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
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
