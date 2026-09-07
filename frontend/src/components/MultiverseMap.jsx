import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSE MAP — Mapa de Secciones/Dimensiones
   
   Cada sección del conocimiento se muestra como un cubo/nodo.
   Los puentes entre secciones muestran conexiones cross-dominio.
   Click en un cubo → entra a esa sección.
   ══════════════════════════════════════════════════════════════════════════ */

const CUBE_COLORS = [
  '#5AC8FA', // azul cielo
  '#2FE0C8', // turquesa
  '#7C8CFF', // índigo
  '#FF6B9D', // rosa
  '#FFB84D', // ámbar
  '#A78BFA', // violeta
  '#34D399', // esmeralda
  '#F472B6', // fucsia
];

function getCubeColor(index) {
  return CUBE_COLORS[index % CUBE_COLORS.length];
}

function buildCubeSprite(section, color, isHovered) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Fondo del cubo con gradiente
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, shadeColor(color, -30));
  
  // Cubo redondeado
  const pad = 8;
  const r = 16;
  ctx.beginPath();
  ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, r);
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Borde
  ctx.strokeStyle = isHovered ? '#FFFFFF' : shadeColor(color, 20);
  ctx.lineWidth = isHovered ? 4 : 2;
  ctx.stroke();
  
  // Glow si hover
  if (isHovered) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.stroke();
  }

  // Nombre de la sección
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const name = section.nombre.length > 12 
    ? section.nombre.slice(0, 11) + '…' 
    : section.nombre;
  ctx.fillText(name.charAt(0).toUpperCase() + name.slice(1), size / 2, size / 2 - 8);
  
  // Count de documentos
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`${section.count} docs`, size / 2, size / 2 + 12);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

export default function MultiverseMap({ 
  sections, 
  onSelectSection, 
  onClose,
  currentSection 
}) {
  const fgRef = useRef();
  const [hoveredNode, setHoveredNode] = useState(null);
  const [bridges, setBridges] = useState([]);
  const spriteCache = useRef(new Map());

  // Cargar puentes entre secciones
  useEffect(() => {
    fetch('/api/sections/bridges')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.bridges)) {
          setBridges(data.bridges);
        }
      })
      .catch(() => {
        // Si no hay endpoint, usar heurística simple basada en count
        // (secciones grandes probablemente tienen más conexiones)
        const heuristicBridges = [];
        const sorted = [...sections].sort((a, b) => b.count - a.count);
        for (let i = 0; i < sorted.length - 1 && i < 3; i++) {
          for (let j = i + 1; j < sorted.length && j < i + 3; j++) {
            if (sorted[i].count > 0 && sorted[j].count > 0) {
              heuristicBridges.push({
                source: sorted[i].nombre,
                target: sorted[j].nombre,
                weight: Math.min(sorted[i].count, sorted[j].count) * 0.1,
              });
            }
          }
        }
        setBridges(heuristicBridges);
      });
  }, [sections]);

  // Construir datos del grafo
  const graphData = useMemo(() => {
    const nodes = sections.map((s, i) => ({
      id: s.nombre,
      nombre: s.nombre,
      count: s.count,
      color: getCubeColor(i),
      isCurrent: s.nombre === currentSection,
    }));

    const nodeIds = new Set(nodes.map(n => n.id));
    const links = bridges
      .filter(b => nodeIds.has(b.source) && nodeIds.has(b.target))
      .map(b => ({
        source: b.source,
        target: b.target,
        weight: b.weight || 1,
      }));

    return { nodes, links };
  }, [sections, bridges, currentSection]);

  // Crear objeto 3D para cada nodo (cubo)
  const nodeThreeObject = useCallback((node) => {
    const isHovered = hoveredNode === node.id;
    const isCurrent = node.isCurrent;
    
    const group = new THREE.Group();
    
    // Cubo 3D
    const geometry = new THREE.BoxGeometry(8, 8, 8);
    const material = new THREE.MeshPhongMaterial({
      color: node.color,
      transparent: true,
      opacity: isCurrent ? 1 : 0.85,
      emissive: isHovered ? node.color : '#000000',
      emissiveIntensity: isHovered ? 0.3 : 0,
    });
    const cube = new THREE.Mesh(geometry, material);
    
    // Wireframe para dar profundidad
    const wireGeo = new THREE.EdgesGeometry(geometry);
    const wireMat = new THREE.LineBasicMaterial({ 
      color: isHovered ? '#FFFFFF' : shadeColor(node.color, 40),
      linewidth: 2,
    });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    
    group.add(cube);
    group.add(wireframe);
    
    // Anillo si es la sección actual
    if (isCurrent) {
      const ringGeo = new THREE.RingGeometry(6, 7, 32);
      const ringMat = new THREE.MeshBasicMaterial({ 
        color: '#FFFFFF', 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -5;
      group.add(ring);
    }
    
    // Label flotante
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayName = node.nombre.charAt(0).toUpperCase() + node.nombre.slice(1);
    ctx.fillText(displayName, 128, 24);
    
    ctx.font = '14px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${node.count} documentos`, 128, 46);
    
    const labelTex = new THREE.CanvasTexture(canvas);
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(16, 4, 1);
    label.position.y = 8;
    group.add(label);
    
    return group;
  }, [hoveredNode]);

  // Manejar click en nodo
  const handleNodeClick = useCallback((node) => {
    if (node && onSelectSection) {
      onSelectSection(node.nombre);
    }
  }, [onSelectSection]);

  // Manejar hover
  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node ? node.id : null);
    document.body.style.cursor = node ? 'pointer' : 'default';
  }, []);

  // Color de aristas
  const linkColor = useCallback((link) => {
    return 'rgba(90, 200, 250, 0.4)';
  }, []);

  // Ancho de aristas
  const linkWidth = useCallback((link) => {
    return Math.max(1, Math.min(3, link.weight || 1));
  }, []);

  // Encuadrar al montar
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(800, 100);
    }, 500);
    return () => clearTimeout(timer);
  }, [graphData]);

  return (
    <div className="multiverse-map">
      <div className="multiverse-header">
        <div className="multiverse-title">
          <span className="multiverse-icon">◈</span>
          <span>Multiverso</span>
        </div>
        <p className="multiverse-subtitle">
          Cada dimensión es un espacio de conocimiento. Click en un cubo para explorar.
        </p>
        <button className="multiverse-close" onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      
      <div className="multiverse-stage">
        <ForceGraph3D
          ref={fgRef}
          graphData={graphData}
          backgroundColor="#07080E"
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={0.6}
          linkCurvature={0.2}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          enableNodeDrag={false}
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.4}
          warmupTicks={100}
          cooldownTicks={50}
        />
      </div>
      
      <div className="multiverse-legend">
        <div className="multiverse-legend-item">
          <span className="multiverse-legend-cube" style={{ background: '#5AC8FA' }} />
          <span>Sección</span>
        </div>
        <div className="multiverse-legend-item">
          <span className="multiverse-legend-line" />
          <span>Puente (conexión cross-dominio)</span>
        </div>
        {currentSection && (
          <div className="multiverse-legend-item">
            <span className="multiverse-legend-ring" />
            <span>Sección actual: {currentSection}</span>
          </div>
        )}
      </div>
    </div>
  );
}
