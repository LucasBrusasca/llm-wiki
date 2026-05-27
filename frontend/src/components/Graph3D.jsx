import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { forceCollide, forceRadial } from 'd3-force-3d';
import { clusterColor, ytId } from '../App.jsx';

const SZ     = 128;
const LABEL_H = 32;
const TOTAL_H = SZ + LABEL_H;
const CORNER  = 7;

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

function nodeColor(node) {
  if (node.is_issue) return '#ff3060';
  return clusterColor(node.cluster);
}

function drawLabel(ctx, node) {
  const col = nodeColor(node);
  ctx.fillStyle = 'rgba(4, 6, 18, 0.90)';
  ctx.fillRect(0, SZ, SZ, LABEL_H);
  ctx.fillStyle = col;
  ctx.font = `bold 15px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let label = node.label.trim();
  const maxW = SZ - 10;
  while (label.length > 1 && ctx.measureText(label).width > maxW) {
    label = label.slice(0, -1);
  }
  if (label !== node.label.trim()) label = label.slice(0, -1) + '…';
  ctx.fillText(label, SZ / 2, SZ + LABEL_H / 2);
}

function drawInitials(ctx, node) {
  const col = nodeColor(node);
  ctx.clearRect(0, 0, SZ, TOTAL_H);
  roundRect(ctx, 1, 1, SZ - 2, SZ - 2, CORNER);
  ctx.fillStyle = '#0a0e1e';
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = col;
  ctx.font = `bold ${Math.floor(SZ * 0.30)}px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ini = node.label.trim().split(/\s+/).slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '').join('') || '?';
  ctx.fillText(ini, SZ / 2, SZ / 2);
  drawLabel(ctx, node);
}

function drawThumb(ctx, img, node) {
  const col = nodeColor(node);
  ctx.clearRect(0, 0, SZ, TOTAL_H);
  ctx.save();
  roundRect(ctx, 1, 1, SZ - 2, SZ - 2, CORNER);
  ctx.clip();
  const ar = img.naturalWidth / img.naturalHeight;
  let sw = SZ, sh = SZ, sx = 0, sy = 0;
  if (ar > 1) { sh = SZ / ar; sy = (SZ - sh) / 2; }
  else        { sw = SZ * ar; sx = (SZ - sw) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh);
  ctx.restore();
  roundRect(ctx, 1, 1, SZ - 2, SZ - 2, CORNER);
  ctx.strokeStyle = col;
  ctx.lineWidth = 5;
  ctx.stroke();
  drawLabel(ctx, node);
}

function buildClusterTextSprite(text, color) {
  const W = 280, H = 42;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  roundRect(ctx, 1, 1, W - 2, H - 2, 6);
  ctx.fillStyle = 'rgba(3, 5, 16, 0.92)';
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

// Level → sprite world-unit width
const LEVEL_SCALE = [8, 6.5, 5, 4];

function spriteScales(node) {
  const scaleW = LEVEL_SCALE[(Math.min(Math.max(node.level || 3, 1), 4)) - 1];
  const scaleH = scaleW * TOTAL_H / SZ;
  return { scaleW, scaleH };
}

function drawIssue(ctx, node) {
  ctx.clearRect(0, 0, SZ, TOTAL_H);
  roundRect(ctx, 1, 1, SZ - 2, SZ - 2, CORNER);
  ctx.fillStyle = 'rgba(20, 4, 8, 0.95)';
  ctx.fill();
  ctx.strokeStyle = '#ff3060';
  ctx.lineWidth = 5;
  ctx.stroke();
  // warning symbol
  ctx.fillStyle = '#ff3060';
  ctx.font = `bold ${Math.floor(SZ * 0.40)}px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚠', SZ / 2, SZ / 2 - 4);
  drawLabel(ctx, node);
}

function buildSprite(node) {
  const canvas = document.createElement('canvas');
  canvas.width = SZ; canvas.height = TOTAL_H;
  const ctx = canvas.getContext('2d');
  if (node.is_issue) {
    drawIssue(ctx, node);
  } else {
    drawInitials(ctx, node);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  const { scaleW, scaleH } = spriteScales(node);
  sprite.scale.set(scaleW, scaleH, 1);
  sprite.userData = { scaleW, scaleH };

  let src = null;
  if (node.fuente === 'youtube' && node.fuente_url) {
    const vid = ytId(node.fuente_url);
    if (vid) src = `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
  } else if ((node.fuente === 'pdf' || node.fuente === 'tesis') && node.fuente_path) {
    src = `/thumbnail?p=${encodeURIComponent(node.fuente_path)}`;
  }
  if (src) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { drawThumb(ctx, img, node); texture.needsUpdate = true; };
    img.src = src;
  }
  return sprite;
}

function makeClusterForce(nodes, strength = 0.015) {
  return alpha => {
    const centroids = {};
    nodes.forEach(n => {
      if (n.cluster == null || n.cluster < 0) return;
      const c = centroids[n.cluster] ??= { x: 0, y: 0, z: 0, count: 0 };
      c.x += n.x || 0; c.y += n.y || 0; c.z += n.z || 0; c.count++;
    });
    Object.values(centroids).forEach(c => {
      c.x /= c.count; c.y /= c.count; c.z /= c.count;
    });
    const k = strength * alpha;
    nodes.forEach(n => {
      if (n.cluster == null || n.cluster < 0) return;
      const c = centroids[n.cluster];
      if (!c) return;
      n.vx = (n.vx || 0) + (c.x - (n.x || 0)) * k;
      n.vy = (n.vy || 0) + (c.y - (n.y || 0)) * k;
      n.vz = (n.vz || 0) + (c.z - (n.z || 0)) * k;
    });
  };
}

// Pins nodes to pre-computed cluster ring positions (stable, no simulation drift)
function applyDensityLayout(nodes) {
  const NODE_FOOTPRINT = 12;
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
  const groupR = nGroups > 1 ? Math.max(50, maxGroupSize * NODE_FOOTPRINT * 0.8) : 0;

  allGroups.forEach((members, gi) => {
    const angle = nGroups > 1 ? (gi / nGroups) * Math.PI * 2 : 0;
    const cx = Math.cos(angle) * groupR;
    const cz = Math.sin(angle) * groupR;
    const circumference = members.length * NODE_FOOTPRINT;
    const nodeR = members.length > 1 ? Math.max(circumference / (2 * Math.PI), NODE_FOOTPRINT) : 0;
    members.forEach((n, i) => {
      const a2 = members.length > 1 ? (i / members.length) * Math.PI * 2 : 0;
      n.fx = cx + Math.cos(a2) * nodeR;
      n.fy = Math.floor(i / 6) * NODE_FOOTPRINT * 0.6 - (Math.floor(members.length / 6) * NODE_FOOTPRINT * 0.3);
      n.fz = cz + Math.sin(a2) * nodeR;
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
}) {
  const fgRef                 = useRef();
  const spriteMap             = useRef(new Map());
  const userInteracted        = useRef(false);
  const clusterLabelSprites   = useRef([]);

  const nodeThreeObject = useMemo(() => {
    spriteMap.current = new Map();
    return node => {
      const s = buildSprite(node);
      spriteMap.current.set(node.id, s);
      return s;
    };
  }, [graphData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graphData.nodes.length) return;

    const SCALE = 250;

    fg.d3Force('cluster', null);
    fg.d3Force('centroid', null);
    fg.d3Force('bound', null);
    fg.d3Force('collide', null);

    if (layoutMode === 'components') {
      // Use UMAP coords as starting positions but unpin so forces can separate overlaps
      graphData.nodes.forEach(n => {
        delete n.fx; delete n.fy; delete n.fz;
        n.x = (n.x3d ?? (Math.random() - 0.5) * 2) * SCALE;
        n.y = (n.y3d ?? (Math.random() - 0.5) * 2) * SCALE;
        n.z = (n.z3d ?? (Math.random() - 0.5) * 2) * SCALE;
        n.vx = 0; n.vy = 0; n.vz = 0;
      });
      // Fuerzas de repulsión mucho más realistas (el valor por defecto de D3 es -30)
      fg.d3Force('charge')?.strength(n => n.is_issue ? -250 : (n.cluster === -1 ? -50 : -100));
      fg.d3Force('link')?.distance(80).strength(0.5);
      fg.d3Force('cluster', makeClusterForce(graphData.nodes, 0.05));
      fg.d3Force('collide', forceCollide().radius(20).strength(1).iterations(3));
      fg.d3Force('radial', forceRadial(0, 0, 0, 0).strength(0.002)); // Evitar que los nodos sueltos se vayan al infinito, pero muy debil
    } else if (layoutMode === 'density') {
      applyDensityLayout(graphData.nodes);
      fg.d3Force('charge')?.strength(0);
      fg.d3Force('link')?.strength(0);
    } else if (layoutMode === 'centroid') {
      applyCentroidLayout(graphData.nodes);
      fg.d3Force('charge')?.strength(0);
      fg.d3Force('link')?.strength(0);
    }

    // Remove previous cluster label sprites
    const scene = fg.scene();
    clusterLabelSprites.current.forEach(s => scene.remove(s));
    clusterLabelSprites.current = [];

    // Ocultar etiquetas en modo centroid/UMAP porque los nodos pueden estar dispersos.
    // Solo las mostramos en Densidad, donde están estrictamente agrupados.
    if (layoutMode === 'density') {
      const clusterGroups = {};
      graphData.nodes.forEach(n => {
        if (n.cluster == null || n.cluster < 0) return;
        const c = String(n.cluster);
        (clusterGroups[c] ??= []).push(n);
      });
      
      Object.entries(clusterGroups).forEach(([cid, members]) => {
        const cx = members.reduce((s, n) => s + (n.fx || n.x || 0), 0) / members.length;
        const cz = members.reduce((s, n) => s + (n.fz || n.z || 0), 0) / members.length;
        const freq = {};
        members.forEach(n => (n.conceptos || []).forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
        const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
        const labelText = top.length ? top.join(' · ') : `Cluster ${cid}`;
        const color = clusterColor(parseInt(cid));
        const sprite = buildClusterTextSprite(labelText, color);
        sprite.userData = { cid };
        
        const maxY = members.reduce((max, n) => Math.max(max, n.fy || n.y || 0), -Infinity);
        sprite.position.set(cx, maxY + 20, cz);
        scene.add(sprite);
        clusterLabelSprites.current.push(sprite);
      });
    }

    fg.d3ReheatSimulation();
    userInteracted.current = false;

    if (layoutMode !== 'components') {
      const t = setTimeout(() => { if (!userInteracted.current) fgRef.current?.zoomToFit(800, 40); }, 80);
      return () => clearTimeout(t);
    }
  }, [graphData, layoutMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply highlight — opacity only, no scale jump (avoids flicker)
  useEffect(() => {
    spriteMap.current.forEach((sprite, id) => {
      sprite.material.opacity = (highlighted.size > 0 && !highlighted.has(id)) ? 0.45 : 1;
      sprite.material.needsUpdate = true;
    });
  }, [highlighted]);

  // Subtle scale bump and Camera Fly-To for the clicked node
  useEffect(() => {
    if (highlighted.size > 0) return;
    spriteMap.current.forEach((sprite, id) => {
      const { scaleW, scaleH } = sprite.userData;
      sprite.scale.set(
        selectedNode?.id === id ? scaleW * 1.12 : scaleW,
        selectedNode?.id === id ? scaleH * 1.12 : scaleH,
        1
      );
    });

    if (selectedNode && fgRef.current) {
      const target = graphData.nodes.find(n => n.id === selectedNode.id);
      if (target) {
        // Mover la cámara suavemente hacia el nodo seleccionado (desde la biblioteca o por click)
        const dist = 100; // Qué tan cerca hacer el zoom
        const dx = target.x || 0.1, dy = target.y || 0.1, dz = target.z || 0.1;
        const length = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const factor = (length + dist) / length;
        fgRef.current.cameraPosition({ x: dx * factor, y: dy * factor, z: dz * factor }, target, 1200);
      }
    }
  }, [selectedNode, highlighted, graphData.nodes]);

  // One-time scene setup
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.renderer()?.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = fg.scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const pl = new THREE.PointLight(0xf5a623, 1.5, 1000);
    pl.position.set(100, 80, 60);
    scene.add(pl);
    const controls = fg.controls();
    if (controls) {
      controls.zoomSpeed    = 0.4;
      controls.minDistance  = 50;
      controls.maxDistance  = 2800;
      controls.addEventListener('start', () => { userInteracted.current = true; });
    }
  }, []);


  const nodeVisibility = useCallback(node => {
    if (!filteredIds) return true;
    return filteredIds.has(node.id);
  }, [filteredIds]);

  const linkColor = useCallback(link => {
    const srcIsIssue = link.source?.is_issue;
    const tgtIsIssue = link.target?.is_issue;
    if (srcIsIssue || tgtIsIssue) {
      if (!selectedNode && !highlighted.size) return 'rgba(255,48,96,0.5)';
      const s = link.source?.id ?? link.source;
      const t = link.target?.id ?? link.target;
      return (s === selectedNode?.id || t === selectedNode?.id) ? '#ff3060' : 'rgba(255,48,96,0.12)';
    }
    // Default: soft silver-white on black
    if (!selectedNode && !highlighted.size) return 'rgba(200,208,220,0.18)';
    const s = link.source?.id ?? link.source;
    const t = link.target?.id ?? link.target;
    // Connected to hovered/selected node: light up bright
    return (s === selectedNode?.id || t === selectedNode?.id)
      ? 'rgba(230,235,245,0.85)'
      : 'rgba(150,160,180,0.04)';
  }, [selectedNode, highlighted]);

  const linkWidth = useCallback(() => 0.28, []);

  const handleHover = useCallback(node => {
    document.body.style.cursor = node ? (synthMode ? 'crosshair' : 'pointer') : 'default';
    if (onNodeHover) onNodeHover(node || null);
  }, [onNodeHover, synthMode]);

  const handleLinkHover = useCallback(link => {
    document.body.style.cursor = link ? 'pointer' : 'default';
  }, []);

  const handleEngineTick = useCallback(() => {
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
    if (!userInteracted.current && layoutMode === 'components') {
      // Force extreme close up
      fgRef.current?.cameraPosition({ x: 0, y: 0, z: 120 }, { x: 0, y: 0, z: 0 }, 800);
    }
  }, [layoutMode]);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        backgroundColor="#000000"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        nodeVisibility={nodeVisibility}
        nodeLabel=""
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.55}
        onNodeClick={onNodeClick}
        onNodeHover={handleHover}
        onLinkClick={onLinkClick}
        onLinkHover={handleLinkHover}
        onEngineTick={handleEngineTick}
        onEngineStop={handleEngineStop}
        showNavInfo={false}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.35}
        warmupTicks={80}
        cooldownTicks={200}
      />
    </div>
  );
}
