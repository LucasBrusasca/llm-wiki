import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSE MAP — Mapa de Dimensiones con Layout por Afinidad
   
   Inspiración visual: tesseract de cristal con bordes brillantes.
   Las secciones se posicionan según sus conexiones: dimensiones con más
   temas compartidos quedan más cerca. Los puentes visualizan la afinidad.
   ══════════════════════════════════════════════════════════════════════════ */

const DIMENSION_COLORS = [
  '#00D4FF', // cian brillante
  '#2FE0C8', // turquesa
  '#7B68EE', // índigo medio
  '#FF6B9D', // rosa
  '#FFB84D', // ámbar
  '#A78BFA', // violeta
  '#34D399', // esmeralda
  '#F472B6', // fucsia
  '#60A5FA', // azul
  '#FBBF24', // dorado
];

function getDimensionColor(index) {
  return DIMENSION_COLORS[index % DIMENSION_COLORS.length];
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 212, b: 255 };
}

export default function MultiverseMap({ 
  sections, 
  onSelectSection, 
  onClose,
  currentSection 
}) {
  const fgRef = useRef();
  const [hoveredNode, setHoveredNode] = useState(null);
  const [hoveredLink, setHoveredLink] = useState(null);
  const [bridges, setBridges] = useState([]);
  const [linkTooltip, setLinkTooltip] = useState(null);

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
        // Fallback: crear puentes heurísticos si no hay endpoint
        const heuristicBridges = [];
        if (sections.length >= 2) {
          for (let i = 0; i < sections.length - 1; i++) {
            for (let j = i + 1; j < sections.length; j++) {
              if (sections[i].count > 0 && sections[j].count > 0) {
                heuristicBridges.push({
                  source: sections[i].nombre,
                  target: sections[j].nombre,
                  weight: 1.5,
                  shared_themes: ['conocimiento compartido'],
                });
              }
            }
          }
        }
        setBridges(heuristicBridges);
      });
  }, [sections]);

  // Construir datos del grafo con posiciones iniciales estratégicas
  const graphData = useMemo(() => {
    const nodes = sections.map((s, i) => {
      // Posición inicial en esfera para layout 3D estable
      const phi = Math.acos(-1 + (2 * i + 1) / Math.max(sections.length, 1));
      const theta = Math.sqrt(Math.max(sections.length, 1) * Math.PI) * phi;
      const radius = 60;
      return {
        id: s.nombre,
        nombre: s.nombre,
        count: s.count,
        color: getDimensionColor(i),
        isCurrent: s.nombre === currentSection,
        x: Math.cos(theta) * Math.sin(phi) * radius,
        y: Math.sin(theta) * Math.sin(phi) * radius,
        z: Math.cos(phi) * radius,
      };
    });

    const nodeIds = new Set(nodes.map(n => n.id));
    const links = bridges
      .filter(b => nodeIds.has(b.source) && nodeIds.has(b.target))
      .map(b => ({
        source: b.source,
        target: b.target,
        weight: b.weight || 1,
        shared_themes: b.shared_themes || [],
      }));

    return { nodes, links };
  }, [sections, bridges, currentSection]);

  // Configurar simulación de fuerzas con atracción por afinidad
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Link force: atracción proporcional al peso del puente
    fg.d3Force('link')
      ?.distance(link => {
        const weight = link.weight || 1;
        // Puentes fuertes = más cerca (40-80 unidades)
        return Math.max(40, 120 - weight * 25);
      })
      .strength(link => {
        const weight = link.weight || 1;
        return Math.min(0.8, 0.2 + weight * 0.15);
      });

    // Charge: repulsión moderada pero visible
    fg.d3Force('charge')?.strength(-300);

    // Center: mantener centrado
    fg.d3Force('center')?.strength(0.03);

  }, [graphData]);

  // Crear cubo 3D tipo tesseract para cada dimensión
  const nodeThreeObject = useCallback((node) => {
    const isHovered = hoveredNode === node.id;
    const isCurrent = node.isCurrent;
    const color = new THREE.Color(node.color);
    const rgb = hexToRgb(node.color);
    
    const group = new THREE.Group();
    
    // Tamaño basado en documentos (mín 8, máx 16)
    const baseSize = Math.max(8, Math.min(16, 8 + Math.sqrt(node.count) * 1.2));
    const size = isHovered ? baseSize * 1.12 : baseSize;
    
    // ═══════════════════════════════════════════════════════════════════
    // CUBO INTERIOR — cristal semitransparente
    // ═══════════════════════════════════════════════════════════════════
    const innerGeo = new THREE.BoxGeometry(size * 0.85, size * 0.85, size * 0.85);
    const innerMat = new THREE.MeshPhongMaterial({
      color: color,
      transparent: true,
      opacity: isHovered ? 0.5 : 0.35,
      emissive: color,
      emissiveIntensity: isHovered ? 0.4 : 0.2,
      shininess: 150,
      specular: new THREE.Color(0x666666),
      side: THREE.DoubleSide,
    });
    const innerCube = new THREE.Mesh(innerGeo, innerMat);
    group.add(innerCube);
    
    // ═══════════════════════════════════════════════════════════════════
    // BORDES BRILLANTES — líneas neon estilo tesseract
    // ═══════════════════════════════════════════════════════════════════
    const edgeGeo = new THREE.BoxGeometry(size, size, size);
    const edges = new THREE.EdgesGeometry(edgeGeo);
    const edgeMat = new THREE.LineBasicMaterial({ 
      color: isHovered ? 0xFFFFFF : color.clone().multiplyScalar(1.8),
      linewidth: 3,
      transparent: true,
      opacity: isHovered ? 1 : 0.95,
    });
    const edgeLines = new THREE.LineSegments(edges, edgeMat);
    group.add(edgeLines);
    
    // Segundo set de bordes más interno para profundidad
    const innerEdgeGeo = new THREE.BoxGeometry(size * 0.7, size * 0.7, size * 0.7);
    const innerEdges = new THREE.EdgesGeometry(innerEdgeGeo);
    const innerEdgeMat = new THREE.LineBasicMaterial({ 
      color: color.clone().multiplyScalar(0.7),
      linewidth: 1,
      transparent: true,
      opacity: 0.6,
    });
    const innerEdgeLines = new THREE.LineSegments(innerEdges, innerEdgeMat);
    group.add(innerEdgeLines);
    
    // ═══════════════════════════════════════════════════════════════════
    // GLOW EXTERIOR — halo suave
    // ═══════════════════════════════════════════════════════════════════
    const glowSize = size * 1.5;
    const glowGeo = new THREE.BoxGeometry(glowSize, glowSize, glowSize);
    const glowMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: isHovered ? 0.18 : 0.08,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);
    
    // ═══════════════════════════════════════════════════════════════════
    // PUNTOS EN VÉRTICES — estrellas en las esquinas
    // ═══════════════════════════════════════════════════════════════════
    const vertices = [
      [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
      [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]
    ];
    const pointsGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(vertices.flat().map(v => v * size * 0.5));
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointsMat = new THREE.PointsMaterial({
      color: 0xFFFFFF,
      size: isHovered ? 3 : 2,
      transparent: true,
      opacity: isHovered ? 1 : 0.7,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(pointsGeo, pointsMat);
    group.add(points);
    
    // ═══════════════════════════════════════════════════════════════════
    // INDICADOR DE SECCIÓN ACTUAL — anillo orbital pulsante
    // ═══════════════════════════════════════════════════════════════════
    if (isCurrent) {
      const ringGeo = new THREE.TorusGeometry(size * 0.85, 0.5, 8, 48);
      const ringMat = new THREE.MeshBasicMaterial({ 
        color: 0x00FFFF,
        transparent: true,
        opacity: 0.9,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      
      // Segundo anillo perpendicular
      const ring2 = ring.clone();
      ring2.rotation.x = 0;
      ring2.rotation.y = Math.PI / 2;
      ring2.material = ring2.material.clone();
      ring2.material.opacity = 0.6;
      group.add(ring2);
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // LABEL FLOTANTE — nombre y count
    // ═══════════════════════════════════════════════════════════════════
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    
    // Fondo con gradiente sutil
    const gradient = ctx.createLinearGradient(0, 0, 0, 96);
    gradient.addColorStop(0, `rgba(${rgb.r * 0.15}, ${rgb.g * 0.15}, ${rgb.b * 0.15}, 0.95)`);
    gradient.addColorStop(1, `rgba(5, 8, 15, 0.95)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(8, 8, 304, 80, 10);
    ctx.fill();
    
    // Borde brillante
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = node.color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    // Nombre de la dimensión
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 24px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayName = node.nombre.charAt(0).toUpperCase() + node.nombre.slice(1);
    ctx.fillText(displayName, 160, 38);
    
    // Count de documentos
    ctx.font = '16px Inter, system-ui, sans-serif';
    ctx.fillStyle = node.color;
    ctx.fillText(`${node.count} documentos`, 160, 66);
    
    const labelTex = new THREE.CanvasTexture(canvas);
    labelTex.minFilter = THREE.LinearFilter;
    const labelMat = new THREE.SpriteMaterial({ 
      map: labelTex, 
      transparent: true,
      depthTest: false,
    });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(24, 7.2, 1);
    label.position.y = size * 0.75 + 8;
    group.add(label);
    
    return group;
  }, [hoveredNode]);

  // Manejar click en nodo
  const handleNodeClick = useCallback((node) => {
    if (node && onSelectSection) {
      onSelectSection(node.nombre);
    }
  }, [onSelectSection]);

  // Manejar hover en nodo
  const handleNodeHover = useCallback((node) => {
    setHoveredNode(node ? node.id : null);
    setLinkTooltip(null);
    document.body.style.cursor = node ? 'pointer' : 'default';
  }, []);

  // Manejar hover en link/puente
  const handleLinkHover = useCallback((link) => {
    setHoveredLink(link);
    if (link && link.shared_themes?.length > 0) {
      const sourceNode = typeof link.source === 'object' ? link.source : graphData.nodes.find(n => n.id === link.source);
      const targetNode = typeof link.target === 'object' ? link.target : graphData.nodes.find(n => n.id === link.target);
      setLinkTooltip({
        source: sourceNode?.nombre || link.source,
        target: targetNode?.nombre || link.target,
        themes: link.shared_themes,
        weight: link.weight,
      });
    } else {
      setLinkTooltip(null);
    }
    document.body.style.cursor = link ? 'pointer' : 'default';
  }, [graphData.nodes]);

  // Color de aristas/puentes — sutil, no neón agresivo
  const linkColor = useCallback((link) => {
    const isHovered = hoveredLink === link;
    const weight = link.weight || 1;
    const alpha = Math.min(0.7, 0.25 + weight * 0.12);
    if (isHovered) {
      return `rgba(150, 230, 255, ${Math.min(0.85, alpha + 0.3)})`;
    }
    return `rgba(100, 200, 250, ${alpha})`;
  }, [hoveredLink]);

  // Ancho de aristas — hover sutil
  const linkWidth = useCallback((link) => {
    const isHovered = hoveredLink === link;
    const weight = link.weight || 1;
    const base = Math.max(1, Math.min(2.5, 0.8 + weight * 0.5));
    return isHovered ? Math.min(base + 1.5, 4) : base;
  }, [hoveredLink]);

  // Partículas en puentes
  const linkDirectionalParticles = useCallback((link) => {
    const weight = link.weight || 1;
    return Math.max(2, Math.min(5, Math.floor(weight * 1.5)));
  }, []);

  // Encuadrar al montar
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(600, 100);
    }, 900);
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
          backgroundColor="rgba(0,0,0,0)"
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={1}
          linkCurvature={0.2}
          linkDirectionalParticles={linkDirectionalParticles}
          linkDirectionalParticleWidth={2.5}
          linkDirectionalParticleSpeed={0.005}
          linkDirectionalParticleColor={() => '#00E0FF'}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onLinkHover={handleLinkHover}
          linkHoverPrecision={10}
          enableNodeDrag={true}
          d3AlphaDecay={0.015}
          d3VelocityDecay={0.25}
          warmupTicks={180}
          cooldownTicks={120}
        />
      </div>
      
      {/* Tooltip de puente */}
      {linkTooltip && (
        <div className="multiverse-bridge-tooltip">
          <div className="multiverse-bridge-header">
            <span className="multiverse-bridge-from">{linkTooltip.source}</span>
            <span className="multiverse-bridge-arrow">⟷</span>
            <span className="multiverse-bridge-to">{linkTooltip.target}</span>
          </div>
          <div className="multiverse-bridge-label">Temas compartidos:</div>
          <div className="multiverse-bridge-themes">
            {linkTooltip.themes.slice(0, 5).map((theme, i) => (
              <span key={i} className="multiverse-theme-chip">{theme}</span>
            ))}
            {linkTooltip.themes.length > 5 && (
              <span className="multiverse-theme-chip multiverse-theme-more">
                +{linkTooltip.themes.length - 5} más
              </span>
            )}
          </div>
          <div className="multiverse-bridge-strength">
            Afinidad: {Math.round(Math.min(100, linkTooltip.weight * 30))}%
          </div>
        </div>
      )}
      
      <div className="multiverse-legend">
        <div className="multiverse-legend-item">
          <span className="multiverse-legend-cube" />
          <span>Dimensión</span>
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
      
      <div className="multiverse-hint">
        Arrastrá para rotar · Scroll para zoom · Click para entrar
      </div>
    </div>
  );
}
