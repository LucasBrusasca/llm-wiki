import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { Maximize, Pin, X, RotateCcw } from 'lucide-react';
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
 * - Etiquetas persistentes sólo para el elegido, el extremo fijado y los
 *   vecinos (con tope); el resto aparece al pasar el mouse, con miniatura.
 * - Clic en un nodo → mismo Inspector. Clic en el vacío → suelta el pin.
 */

const ESCALA = 320;
const K_FUERTES = 2;
const MAX_ETIQUETAS = 12;

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
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const k = 0.16;
  sp.scale.set(w * k, h * k, 1);
  sp.renderOrder = 10;
  return sp;
}

/** Miniatura flotante del documento (sólo elegido / fijado: pocas texturas). */
const texCache = new Map();
function spriteMiniatura(id) {
  let tex = texCache.get(id);
  if (!tex) {
    tex = new THREE.TextureLoader().load(`/thumb/${encodeURIComponent(id)}`, undefined, undefined, () => { tex.userData.fallo = true; });
    tex.colorSpace = THREE.SRGBColorSpace;
    texCache.set(id, tex);
  }
  if (tex.userData?.fallo) return null;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(22, 28, 1);
  sp.renderOrder = 9;
  return sp;
}

function nombreSeguro(n) {
  return String(n || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export default function Graph3DView({
  nodes, edges, visibleIds, selectedId, highlightIds, onSelect, relIndex,
  pinnedEdge, onClearPin, colorMode, onColorMode, colorDe: colorVar, temas,
}) {
  const fgRef = useRef(null);
  const cajaRef = useRef(null);
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
        .slice(0, 6)
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
    const r = 2.2 + Math.sqrt(grado(d.id)) * 0.9 + (fuerte ? 1.5 : 0);
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
      opacity: estado === 'tenue' ? 0.05 : fuerte ? 0.9 : 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const hs = r * (fuerte ? 7 : 4.5);
    halo.scale.set(hs, hs, 1);
    g.add(halo);

    if (fuerte) {
      const mini = spriteMiniatura(d.id);
      if (mini) {
        mini.position.set(0, r + 20, 0);
        g.add(mini);
      }
    }
    if (etiquetados.has(d.id)) {
      const et = spriteEtiqueta(truncar(d.node.label, 38), {
        fuerte, acento: paleta.acento, fondo: paleta.superficie, tinta: paleta.tinta,
      });
      et.center.set(0, 0.5);
      et.position.set(r + 3, 0, 0);
      g.add(et);
    }
    return g;
  }, [estadoDe, colorDe, grado, etiquetados, paleta]);

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

  const nodeLabel = useCallback((d) => {
    const n = d.node;
    const origen = fuenteLabel(n) || '';
    return `<div style="display:flex;gap:8px;align-items:center;max-width:280px;padding:6px 8px;border-radius:6px;
      background:${rgba(paleta.superficie, 0.95)};border:1px solid ${rgba(paleta.tinta, 0.15)};font:12px Inter,system-ui,sans-serif;color:${paleta.tinta}">
      ${n.fuente_path || n.fuente_url ? `<img src="/thumb/${encodeURIComponent(n.id)}" onerror="this.remove()" style="width:30px;height:38px;object-fit:cover;object-position:top;border-radius:3px;flex:none"/>` : ''}
      <span style="min-width:0"><span style="display:block;font-weight:500">${nombreSeguro(truncar(n.label, 70))}</span>
      <span style="display:block;opacity:.6;font-size:11px">${nombreSeguro(origen)}${n.autor ? ' · ' + nombreSeguro(n.autor) : ''}</span></span></div>`;
  }, [paleta]);

  // Sólo en desarrollo: acceso a la instancia para depurar desde la consola.
  useEffect(() => { if (import.meta.env.DEV) window.__algedi3d = fgRef.current; });

  // Fondo + niebla leve (profundidad sin efectos animados).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene();
    scene.fog = new THREE.FogExp2(paleta.fondo, 0.0011);
  }, [paleta]);

  // Encuadre inicial y cuando cambia el conjunto visible.
  const firma = `${data.nodes.length}:${visibleIds.size}`;
  useEffect(() => {
    const t = setTimeout(() => fgRef.current?.zoomToFit(700, 60), 250);
    return () => clearTimeout(t);
  }, [firma]);

  // Volar al elegido (o al punto medio del vínculo fijado).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !selectedId) return;
    const byId = new Map(data.nodes.map((d) => [d.id, d]));
    const a = byId.get(selectedId);
    if (!a) return;
    const b = pinOtro ? byId.get(pinOtro) : null;
    const foco = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } : { x: a.x, y: a.y, z: a.z };
    const sep = b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
    const dist = Math.max(140, sep * 1.6);
    const len = Math.hypot(foco.x, foco.y, foco.z) || 1;
    fg.cameraPosition(
      { x: foco.x + (foco.x / len) * dist, y: foco.y + (foco.y / len) * dist, z: foco.z + (foco.z / len) * dist + 40 },
      foco,
      900,
    );
  }, [selectedId, pinOtro, data.nodes]);

  const leyenda = useMemo(() => calcularLeyenda(nodes, visibleIds, colorMode, temas), [nodes, visibleIds, colorMode, temas]);

  return (
    <div ref={cajaRef} className="relative size-full overflow-hidden" style={{ background: paleta.fondo }}>
      {!nodes.length && (
        <div className="absolute inset-0 grid place-items-center text-[12px] text-ink-dim">Sin nodos para graficar.</div>
      )}
      {tam.w > 0 && nodes.length > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={tam.w}
          height={tam.h}
          graphData={data}
          backgroundColor={paleta.fondo}
          showNavInfo={false}
          controlType="orbit"
          enableNodeDrag={false}
          cooldownTicks={1}
          warmupTicks={0}
          nodeThreeObject={nodeObject}
          nodeLabel={nodeLabel}
          linkVisibility={linkVisible}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={1}
          linkDirectionalParticles={0}
          onNodeClick={(d) => onSelect(d.id)}
          onBackgroundClick={() => pinnedEdge && onClearPin?.()}
        />
      )}

      <div className="pointer-events-none absolute left-3 right-3 top-3 flex items-start gap-2 text-[11px] text-ink-dim">
        <span className="rounded-xs border border-hair bg-surface/90 px-1.5 py-0.5">
          Explorar 3D · {data.nodes.length} nodos · arrastrá para orbitar, rueda para acercar
        </span>
        {pin && (
          <span className="pointer-events-auto flex items-center gap-1.5 rounded-xs border border-accent/50 bg-surface/95 px-1.5 py-0.5 text-ink">
            <Pin className="size-3 text-accent" />
            <span className="max-w-[220px] truncate">{data.nodes.find((d) => d.id === pinOtro)?.node.label}</span>
            <button type="button" onClick={onClearPin} className="text-ink-dim hover:text-ink" aria-label="Quitar pin"><X className="size-3" /></button>
          </span>
        )}
        <ColorPanel modo={colorMode} onModo={onColorMode} leyenda={leyenda} />
      </div>

      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-sm border border-hair bg-surface">
        <Hint texto="Encuadrar todo" side="right">
          <button type="button" aria-label="Encuadrar todo" onClick={() => fgRef.current?.zoomToFit(600, 60)} className="grid size-7 place-items-center text-ink-muted hover:bg-surface-2 hover:text-ink">
            <Maximize className="size-3.5" />
          </button>
        </Hint>
        <Hint texto="Vista inicial" side="right">
          <button
            type="button"
            aria-label="Vista inicial"
            onClick={() => fgRef.current?.cameraPosition({ x: 0, y: 0, z: 700 }, { x: 0, y: 0, z: 0 }, 700)}
            className="grid size-7 place-items-center text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </Hint>
      </div>
    </div>
  );
}
