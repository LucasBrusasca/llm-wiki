import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSE MAP — Mapa de Dimensiones con Layout por Afinidad
   
   Las secciones se posicionan según sus conexiones: dimensiones con más
   temas compartidos quedan más cerca. Los puentes visualizan la afinidad.
   ══════════════════════════════════════════════════════════════════════════ */

const DIMENSION_COLORS = [
  '#5AC8FA', // azul cielo
  '#2FE0C8', // turquesa
  '#7C8CFF', // índigo
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
  } : { r: 90, g: 200, b: 250 };
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
                  weight: 1,
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
      // Posición inicial en círculo para layout estable
      const angle = (2 * Math.PI * i) / Math.max(sections.length, 1);
      const radius = 50;
      return {
        id: s.nombre,
        nombre: s.nombre,
        count: s.count,
        color: getDimensionColor(i),
        isCurrent: s.nombre === currentSection,
        // Posición inicial
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        z: (Math.random() - 0.5) * 20,
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
        // Puentes más fuertes = dimensiones más cerca
        const weight = link.weight || 1;
        return Math.max(30, 100 - weight * 20);
      })
      .strength(link => {
        const weight = link.weight || 1;
        return Math.min(1, 0.3 + weight * 0.2);
      });

    // Charge: repulsión moderada para espaciar
    fg.d3Force('charge')?.strength(-200);

    // Center: mantener centrado
    fg.d3Force('center')?.strength(0.05);

  }, [graphData]);

  // Crear cubo 3D premium para cada dimensión
  const nodeThreeObject = useCallback((node) => {
    const isHovered = hoveredNode === node.id;
    const isCurrent = node.isCurrent;
    const color = new THREE.Color(node.color);
    const rgb = hexToRgb(node.color);
    
    const group = new THREE.Group();
    
    // Tamaño basado en documentos (mín 6, máx 14)
    const baseSize = Math.max(6, Math.min(14, 6 + Math.sqrt(node.count) * 1.5));
    const size = isHovered ? baseSize * 1.15 : baseSize;
    
    // Cubo principal con material premium
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshPhongMaterial({
      color: color,
      transparent: true,
      opacity: 0.85,
      emissive: color,
      emissiveIntensity: isHovered ? 0.5 : (isCurrent ? 0.35 : 0.2),
      shininess: 100,
      specular: new THREE.Color(0x444444),
    });
    const cube = new THREE.Mesh(geometry, material);
    group.add(cube);
    
    // Wireframe brillante
    const wireGeo = new THREE.EdgesGeometry(geometry);
    const wireMat = new THREE.LineBasicMaterial({ 
      color: isHovered ? 0xFFFFFF : new THREE.Color(node.color).multiplyScalar(1.5),
      linewidth: 2,
      transparent: true,
      opacity: isHovered ? 1 : 0.8,
    });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    group.add(wireframe);
    
    // Glow exterior (halo)
    const glowSize = size * 1.4;
    const glowGeo = new THREE.BoxGeometry(glowSize, glowSize, glowSize);
    const glowMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: isHovered ? 0.25 : 0.12,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    group.add(glow);
    
    // Indicador de sección actual (anillo orbital)
    if (isCurrent) {
      const ringGeo = new THREE.TorusGeometry(size * 0.9, 0.4, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({ 
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.7,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }
    
    // Label flotante con nombre y count
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    
    // Fondo del label
    ctx.fillStyle = `rgba(${rgb.r * 0.2}, ${rgb.g * 0.2}, ${rgb.b * 0.2}, 0.9)`;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 64, 8);
    ctx.fill();
    
    // Borde del color de la dimensión
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Nombre de la dimensión
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayName = node.nombre.charAt(0).toUpperCase() + node.nombre.slice(1);
    ctx.fillText(displayName, 128, 32);
    
    // Count de documentos
    ctx.font = '14px Inter, system-ui, sans-serif';
    ctx.fillStyle = node.color;
    ctx.fillText(`${node.count} documentos`, 128, 54);
    
    const labelTex = new THREE.CanvasTexture(canvas);
    const labelMat = new THREE.SpriteMaterial({ 
      map: labelTex, 
      transparent: true,
      depthTest: false,
    });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(20, 6.25, 1);
    label.position.y = size * 0.8 + 5;
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
  const handleLinkHover = useCallback((link, event) => {
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

  // Color de aristas/puentes
  const linkColor = useCallback((link) => {
    const isHovered = hoveredLink === link;
    if (isHovered) {
      return 'rgba(255, 255, 255, 0.95)';
    }
    // Color basado en peso: más fuerte = más brillante
    const weight = link.weight || 1;
    const alpha = Math.min(0.8, 0.3 + weight * 0.15);
    return `rgba(90, 200, 250, ${alpha})`;
  }, [hoveredLink]);

  // Ancho de aristas proporcional al peso
  const linkWidth = useCallback((link) => {
    const isHovered = hoveredLink === link;
    const weight = link.weight || 1;
    const base = Math.max(1, Math.min(4, weight * 1.5));
    return isHovered ? base * 2 : base;
  }, [hoveredLink]);

  // Partículas en los puentes para visualizar flujo
  const linkDirectionalParticles = useCallback((link) => {
    const weight = link.weight || 1;
    return Math.max(2, Math.min(6, Math.floor(weight * 2)));
  }, []);

  // Encuadrar al montar
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(600, 80);
    }, 800);
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
          Las dimensiones cercanas comparten más conocimiento. Click en un cubo para explorar.
        </p>
        <button className="multiverse-close" onClick={onClose} title="Cerrar">
          ✕
        </button>
      </div>
      
      <div className="multiverse-stage">
        <ForceGraph3D
          ref={fgRef}
          graphData={graphData}
          backgroundColor="#050508"
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={1}
          linkCurvature={0.15}
          linkDirectionalParticles={linkDirectionalParticles}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleColor={() => '#5AC8FA'}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onLinkHover={handleLinkHover}
          linkHoverPrecision={8}
          enableNodeDrag={true}
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
          warmupTicks={150}
          cooldownTicks={100}
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
            {linkTooltip.themes.map((theme, i) => (
              <span key={i} className="multiverse-theme-chip">{theme}</span>
            ))}
          </div>
          <div className="multiverse-bridge-strength">
            Afinidad: {Math.round(linkTooltip.weight * 33)}%
          </div>
        </div>
      )}
      
      <div className="multiverse-legend">
        <div className="multiverse-legend-item">
          <span className="multiverse-legend-cube" style={{ background: '#5AC8FA' }} />
          <span>Dimensión</span>
        </div>
        <div className="multiverse-legend-item">
          <span className="multiverse-legend-line" />
          <span>Puente (afinidad)</span>
        </div>
        {currentSection && (
          <div className="multiverse-legend-item">
            <span className="multiverse-legend-ring" />
            <span>Actual: {currentSection}</span>
          </div>
        )}
      </div>
      
      <div className="multiverse-hint">
        Arrastrá para rotar · Scroll para zoom · Click para entrar
      </div>
    </div>
  );
}
