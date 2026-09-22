import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { Maximize, Pin, X } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import ColorPanel, { calcularLeyenda } from '@/app/ColorPanel';
import { resolverColor, fuenteLabel } from '@/lib/nodes';
import { truncar } from '@/lib/utils';

/**
 * Vista "Explorar 3D": modo de impacto, nunca el home.
 *
 * - Posiciones FIJAS desde la proyección 3D del backend (embeddings → UMAP):
 *   no hay simulación corriendo, nada se mueve ni titila.
 * - Aristas: líneas GL de 1px, quietas. Sólo la relación fijada se engrosa.
 * - Lejos: puntos livianos. Cerca, al pasar el mouse o al elegir: tarjeta con
 *   miniatura real + título (sólo los ~14 más cercanos, por rendimiento).
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

/** Etiqueta como sprite de canvas (sin dependencias extra). Tamaño constante en mundo. */
function spriteEtiqueta(texto, { fuerte, acento, fondo, tinta }) {
  const pad = 10;
  const fs = 26;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(texto).width) + pad * 2;
  const h = fs + pad * 1.4;
  c.width = w;
  c.height = h;
  g.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  g.fillStyle = rgba(fondo, 0.88);
  g.strokeStyle = fuerte ? acento : rgba(tinta, 0.25);
  g.lineWidth = 2;
  const r = 8;
  g.beginPath();
  g.moveTo(r, 1); g.lineTo(w - r, 1); g.quadraticCurveTo(w - 1, 1, w - 1, r);
  g.lineTo(w - 1, h - r); g.quadraticCurveTo(w - 1, h - 1, w - r, h - 1);
  g.lineTo(r, h - 1); g.quadraticCurveTo(1, h - 1, 1, h - r);
  g.lineTo(1, r); g.quadraticCurveTo(1, 1, r, 1);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = fuerte ? '#ffffff' : rgba(tinta, 0.9);
  g.textBaseline = 'middle';
  g.fillText(texto, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  // sizeAttenuation=false: la etiqueta mide lo mismo en pantalla a cualquier distancia.
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false,
  }));
  const alto = 0.022;                      // ≈ 2% del alto del lienzo
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
 * Tarjeta de previsualización del documento: miniatura real (/thumb/{id}) +
 * título corto + origen. Sprite con tamaño EN EL MUNDO: crece al acercarse,
 * que es justamente cuando aparece. Cacheada por nodo y estilo.
 */
const tarjetas = new Map();
function tarjetaDe(node, { borde, fondo, tinta, origen, fuerte }) {
  const clave = `${node.id}|${fuerte ? 'f' : borde}`;
  const hit = tarjetas.get(clave);
  if (hit) return hit;

  const W = 256; const H = 236; const TH = 164; const pad = 12;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;

  const pintarMarco = () => {
    g.clearRect(0, 0, W, H);
    rectRedondeado(g, 2, 2, W - 4, H - 4, 14);
    g.fillStyle = rgba(fondo, 0.95);
    g.fill();
  };
  const pintarPlaceholder = () => {
    g.save();
    rectRedondeado(g, 8, 8, W - 16, TH - 8, 9);
    g.clip();
    g.fillStyle = rgba(borde, 0.16);
    g.fillRect(8, 8, W - 16, TH - 8);
    g.fillStyle = rgba(borde, 0.9);
    g.font = '700 30px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(origen || 'DOC', W / 2, 8 + (TH - 8) / 2);
    g.restore();
  };
  const pintarTexto = () => {
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = '600 19px Inter, system-ui, sans-serif';
    g.fillStyle = rgba(tinta, 0.96);
    lineas(g, node.label, W - pad * 2, 2).forEach((l, i) => g.fillText(l, pad, TH + 10 + i * 24));
    // borde al final para que quede por encima de todo
    rectRedondeado(g, 2, 2, W - 4, H - 4, 14);
    g.lineWidth = fuerte ? 5 : 3;
    g.strokeStyle = fuerte ? borde : rgba(borde, 0.7);
    g.stroke();
    tex.needsUpdate = true;
  };

  pintarMarco();
  pintarPlaceholder();
  pintarTexto();

  if (node.fuente_path || node.fuente_url) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      pintarMarco();
      g.save();
      rectRedondeado(g, 8, 8, W - 16, TH - 8, 9);
      g.clip();
      g.fillStyle = '#ffffff';
      g.fillRect(8, 8, W - 16, TH - 8);
      // object-fit: cover, anclado arriba (la primera página/diapositiva manda)
      const esc = Math.max((W - 16) / img.width, (TH - 8) / img.height);
      g.drawImage(img, 8 + ((W - 16) - img.width * esc) / 2, 8, img.width * esc, img.height * esc);
      g.restore();
      pintarTexto();
    };
    img.src = `/thumb/${encodeURIComponent(node.id)}`;   // mismo origen: el canvas no queda "tainted"
  }

  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(64, 59, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 8;
  tarjetas.set(clave, sp);
  return sp;
}

// Cuántas tarjetas como máximo al acercarse y desde qué distancia de cámara aparecen.
const UMBRAL_CERCA = 360;
const MAX_TARJETAS = 14;


export default function Graph3DView({
  nodes, edges, visibleIds, selectedId, highlightIds, onSelect, relIndex,
  pinnedEdge, onClearPin, colorMode, onColorMode, colorDe: colorVar, temas, compacto,
}) {
  const fgRef = useRef(null);
  const cajaRef = useRef(null);
  const objs = useRef(new Map());      // id → { g, r, et, estado, fuerte, node, color, tarjeta }
  const hoverRef = useRef(null);
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
    () => (selectedId ? new Set((relIndex.get(selectedId) || []).map((r) => r.otherId)) : null),
    [selectedId, relIndex],
  );
  const grado = useCallback((id) => relIndex.get(id)?.length || 0, [relIndex]);

  // Datos del grafo: posiciones fijas. Se recrean sólo cuando cambia el conjunto visible.
  const data = useMemo(() => {
    const vis = nodes.filter((n) => visibleIds.has(n.id));
    const ns = vis.map((n) => {
      const x = (n.x3d ?? 0) * ESCALA;
      const y = (n.y3d ?? 0) * ESCALA;
      const z = (n.z3d ?? 0) * ESCALA;
      return { id: n.id, node: n, x, y, z, fx: x, fy: y, fz: z };
    });
    const ve = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    const fuertes = new Set(podar(ve, K_FUERTES));
    const links = ve.map((e) => ({
      source: e.source, target: e.target, label: e.label, score: e.score, fuerte: fuertes.has(e),
    }));
    return { nodes: ns, links };
  }, [nodes, edges, visibleIds]);

  // Qué nodos llevan etiqueta persistente.
  const etiquetados = useMemo(() => {
    const out = new Set();
    if (selectedId) out.add(selectedId);
    if (pinOtro) out.add(pinOtro);
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
  }, [selectedId, pinOtro, highlightIds, relIndex, visibleIds]);

  const estadoDe = useCallback((id) => {
    if (!selectedId) return 'normal';
    if (id === selectedId) return 'sel';
    if (pinOtro) return id === pinOtro ? 'pin' : 'tenue';
    return vecinos?.has(id) ? 'vecino' : 'tenue';
  }, [selectedId, pinOtro, vecinos]);

  const nodeObject = useCallback((d) => {
    const estado = estadoDe(d.id);
    const fuerte = estado === 'sel' || estado === 'pin';
    const color = new THREE.Color(colorDe(d.node));
    const r = 4.5 + Math.sqrt(grado(d.id)) * 1.6 + (fuerte ? 3 : 0);
    const alpha = estado === 'tenue' ? 0.18 : 1;

    const g = new THREE.Group();
    const esfera = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 14),
      new THREE.MeshBasicMaterial({ color, transparent: alpha < 1, opacity: alpha }),
    );
    g.add(esfera);

    // Halo suave (additive). Más intenso en el elegido; apagado en los tenues.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texturaHalo(),
      color: fuerte ? new THREE.Color(paleta.acento) : color,
      transparent: true,
      opacity: estado === 'tenue' ? 0.06 : fuerte ? 0.95 : 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const hs = r * (fuerte ? 8 : 5.5);
    halo.scale.set(hs, hs, 1);
    g.add(halo);

    let et = null;
    if (etiquetados.has(d.id)) {
      et = spriteEtiqueta(truncar(d.node.label, 38), {
        fuerte, acento: paleta.acento, fondo: paleta.superficie, tinta: paleta.tinta,
      });
      et.center.set(-0.06, 0.5);   // un poco a la derecha del nodo, en unidades de pantalla
      et.position.set(r * 1.3, 0, 0);
      g.add(et);
    }
    objs.current.set(d.id, { g, r, et, estado, fuerte, node: d.node, color: `#${color.getHexString()}` });
    return g;
  }, [estadoDe, colorDe, grado, etiquetados, paleta]);

  // ── Tarjetas de previsualización (LOD por cercanía + hover + selección) ──
  const actualizarTarjetas = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera().position;
    const forzados = new Set([selectedId, pinOtro, hoverRef.current].filter(Boolean));
    const cerca = [];
    for (const [id, o] of objs.current) {
      if (!o.g.parent) { objs.current.delete(id); continue; }   // objeto viejo, ya fuera de escena
      if (forzados.has(id) || o.estado === 'tenue') continue;
      const dist = cam.distanceTo(o.g.position);
      if (dist < UMBRAL_CERCA) cerca.push([dist, id]);
    }
    cerca.sort((x, y) => x[0] - y[0]);
    const mostrar = new Set([...forzados, ...cerca.slice(0, MAX_TARJETAS).map((x) => x[1])]);
    for (const [id, o] of objs.current) {
      const ver = mostrar.has(id);
      if (ver) {
        const t = tarjetaDe(o.node, {
          borde: o.fuerte ? paleta.acento : o.color,
          fondo: paleta.superficie,
          tinta: paleta.tinta,
          origen: fuenteLabel(o.node),
          fuerte: o.fuerte,
        });
        if (o.tarjeta && o.tarjeta !== t) o.tarjeta.visible = false;
        if (t.parent !== o.g) o.g.add(t);
        t.position.set(0, o.r * 1.25, 0);
        t.visible = true;
        o.tarjeta = t;
        if (o.et) o.et.visible = false;          // la tarjeta ya lleva el título
      } else {
        if (o.tarjeta) o.tarjeta.visible = false;
        if (o.et) o.et.visible = true;
      }
    }
  }, [selectedId, pinOtro, paleta]);

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
    return l.fuerte;
  }, [selectedId]);

  const linkColor = useCallback((l) => {
    const s = l.source?.id ?? l.source;
    const t = l.target?.id ?? l.target;
    const propia = selectedId && (s === selectedId || t === selectedId);
    if (esPin(l)) return rgba(paleta.acento, 1);
    if (pin) return rgba(paleta.arista, propia ? 0.25 : 0.08);
    if (propia) return rgba(paleta.acento, 0.65);
    return rgba(paleta.arista, selectedId ? 0.15 : 0.55);
  }, [selectedId, pin, esPin, paleta]);

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
      if (!selectedId) { encuadrar(800); return; }
      const byId = new Map(data.nodes.map((d) => [d.id, d]));
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
  }, [listo, firma, selectedId, pinOtro]); // eslint-disable-line react-hooks/exhaustive-deps

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
            programar();
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
          Explorar 3D · {data.nodes.length} nodos · arrastrá para orbitar · acercate para ver los documentos
        </span>
        {pin && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Pin className="size-3 text-accent" />
            <span className="max-w-[220px] truncate">{data.nodes.find((d) => d.id === pinOtro)?.node.label}</span>
            <button type="button" onClick={onClearPin} className="text-ink-dim hover:text-ink" aria-label="Quitar pin"><X className="size-3" /></button>
          </span>
        )}
        <ColorPanel modo={colorMode} onModo={onColorMode} leyenda={leyenda} compacto={compacto} />
      </div>

      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
        <Hint texto="Encuadrar todo" side="right">
          <button type="button" aria-label="Encuadrar todo" onClick={() => encuadrar(600)} className="grid size-7 place-items-center text-ink-muted hover:bg-surface-2 hover:text-ink">
            <Maximize className="size-3.5" />
          </button>
        </Hint>
      </div>
    </div>
  );
}
