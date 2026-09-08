import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSE — Vista Espacial de Dimensiones con Previews Reales
   
   Cada dimensión muestra un preview REAL de su grafo de conocimiento.
   El usuario puede VER lo que hay adentro antes de entrar.
   ══════════════════════════════════════════════════════════════════════════ */

const DIMENSION_COLORS = [
  '#00D4FF', '#2FE0C8', '#7B68EE', '#FF6B9D', '#FFB84D', '#A78BFA',
];

export default function MultiverseMap({ 
  sections, 
  onSelectSection, 
  onClose,
  currentSection 
}) {
  const [dimensionData, setDimensionData] = useState({});
  const [loading, setLoading] = useState(true);
  const [hoveredDim, setHoveredDim] = useState(null);

  // Cargar datos REALES del grafo de cada sección
  useEffect(() => {
    const loadAllDimensions = async () => {
      setLoading(true);
      const data = {};
      
      for (const section of sections) {
        try {
          const r = await fetch(`/api/graph?seccion=${encodeURIComponent(section.nombre)}`);
          const json = await r.json();
          const nodes = (json.nodos || []).map(n => ({
            id: n.id,
            label: n.label || n.nombre || 'Sin nombre',
            tipo: n.tipo || 'documento',
            group: n.group_label || 'general',
            x: n.x3d ?? (Math.random() - 0.5) * 100,
            y: n.y3d ?? (Math.random() - 0.5) * 100,
            z: n.z3d ?? (Math.random() - 0.5) * 100,
          }));
          const links = (json.relaciones || []).map(r => ({
            source: r.origen,
            target: r.destino,
          }));
          
          // Documentos recientes (últimos 5 por label)
          const recentDocs = nodes
            .filter(n => n.tipo === 'documento' || n.tipo === 'Documento')
            .slice(0, 6);

          data[section.nombre] = {
            nodes,
            links,
            recentDocs,
            nodeCount: nodes.length,
            linkCount: links.length,
          };
        } catch {
          data[section.nombre] = {
            nodes: [],
            links: [],
            recentDocs: [],
            nodeCount: section.count || 0,
            linkCount: 0,
          };
        }
      }
      
      setDimensionData(data);
      setLoading(false);
    };

    loadAllDimensions();
  }, [sections]);

  const handleEnterDimension = useCallback((nombre) => {
    if (onSelectSection) {
      onSelectSection(nombre);
    }
  }, [onSelectSection]);

  // Calcular layout de dimensiones
  const dimensionLayout = useMemo(() => {
    const count = sections.length;
    if (count === 0) return [];
    
    // Para 2 secciones: lado a lado
    // Para 3+: grid o layout espacial
    const layouts = [];
    const spacing = count <= 2 ? 50 : 40;
    
    sections.forEach((s, i) => {
      let x, y;
      if (count <= 2) {
        x = (i - (count - 1) / 2) * spacing;
        y = 0;
      } else if (count <= 4) {
        x = (i % 2 - 0.5) * spacing;
        y = (Math.floor(i / 2) - 0.5) * spacing;
      } else {
        const angle = (2 * Math.PI * i) / count;
        x = Math.cos(angle) * spacing;
        y = Math.sin(angle) * spacing;
      }
      
      layouts.push({
        ...s,
        x,
        y,
        color: DIMENSION_COLORS[i % DIMENSION_COLORS.length],
        isCurrent: s.nombre === currentSection,
        data: dimensionData[s.nombre],
      });
    });
    
    return layouts;
  }, [sections, currentSection, dimensionData]);

  return (
    <div className="mv-spatial">
      {/* Header minimalista */}
      <header className="mv-spatial-header">
        <div className="mv-spatial-title">
          <span className="mv-spatial-icon">◈</span>
          <span>Multiverso</span>
          <span className="mv-spatial-subtitle">· {sections.length} dimensiones</span>
        </div>
        <button className="mv-spatial-close" onClick={onClose}>✕</button>
      </header>

      {/* Contenedor principal */}
      <div className="mv-spatial-container">
        {loading ? (
          <div className="mv-spatial-loading">
            <div className="mv-spatial-spinner" />
            <span>Cargando dimensiones...</span>
          </div>
        ) : (
          <div className="mv-dimensions-grid">
            {dimensionLayout.map((dim, i) => (
              <DimensionPortal
                key={dim.nombre}
                dimension={dim}
                isHovered={hoveredDim === dim.nombre}
                onHover={() => setHoveredDim(dim.nombre)}
                onLeave={() => setHoveredDim(null)}
                onEnter={() => handleEnterDimension(dim.nombre)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer con hint */}
      <footer className="mv-spatial-footer">
        <span>Click en una dimensión para explorar su grafo de conocimiento</span>
      </footer>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DIMENSION PORTAL — Preview real del grafo de una sección
   ══════════════════════════════════════════════════════════════════════════ */
function DimensionPortal({ dimension, isHovered, onHover, onLeave, onEnter }) {
  const graphRef = useRef();
  const containerRef = useRef();
  const { nombre, color, isCurrent, data } = dimension;
  
  const hasData = data && data.nodes && data.nodes.length > 0;

  // Configurar cámara del mini-grafo
  useEffect(() => {
    if (!graphRef.current || !hasData) return;
    const timer = setTimeout(() => {
      graphRef.current?.zoomToFit(300, 30);
    }, 500);
    return () => clearTimeout(timer);
  }, [hasData]);

  // Crear nodos simplificados para el mini-grafo
  const nodeThreeObject = useCallback((node) => {
    const size = 2;
    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.85,
    });
    const sphere = new THREE.Mesh(geometry, material);
    
    // Glow sutil
    const glowGeo = new THREE.SphereGeometry(size * 1.5, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    sphere.add(glow);
    
    return sphere;
  }, [color]);

  // GraphData para el mini-preview
  const graphData = useMemo(() => {
    if (!hasData) return { nodes: [], links: [] };
    
    // Limitar nodos para performance
    const maxNodes = 50;
    const nodes = data.nodes.slice(0, maxNodes);
    const nodeIds = new Set(nodes.map(n => n.id));
    const links = data.links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));
    
    return { nodes, links };
  }, [data, hasData]);

  return (
    <div 
      className={`mv-portal ${isCurrent ? 'mv-portal--current' : ''} ${isHovered ? 'mv-portal--hover' : ''}`}
      style={{ '--portal-color': color }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onEnter}
      ref={containerRef}
    >
      {/* Marco del portal */}
      <div className="mv-portal-frame">
        {/* Preview del grafo REAL */}
        <div className="mv-portal-graph">
          {hasData ? (
            <ForceGraph3D
              ref={graphRef}
              graphData={graphData}
              width={280}
              height={200}
              backgroundColor="rgba(0,0,0,0)"
              nodeThreeObject={nodeThreeObject}
              nodeThreeObjectExtend={false}
              linkColor={() => `rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.3)`}
              linkWidth={0.5}
              linkOpacity={0.4}
              enableNodeDrag={false}
              enableNavigationControls={false}
              enablePointerInteraction={false}
              showNavInfo={false}
              d3AlphaDecay={0.1}
              d3VelocityDecay={0.5}
              warmupTicks={50}
              cooldownTicks={0}
            />
          ) : (
            <div className="mv-portal-empty">
              <span className="mv-portal-empty-icon">○</span>
              <span>Vacía</span>
            </div>
          )}
        </div>

        {/* Overlay con info */}
        <div className="mv-portal-overlay">
          {/* Header del portal */}
          <div className="mv-portal-header">
            <span className="mv-portal-name">
              {nombre.charAt(0).toUpperCase() + nombre.slice(1)}
            </span>
            {isCurrent && <span className="mv-portal-badge">Actual</span>}
          </div>

          {/* Métricas */}
          <div className="mv-portal-metrics">
            <span className="mv-portal-metric">
              <strong>{data?.nodeCount || 0}</strong> nodos
            </span>
            <span className="mv-portal-metric">
              <strong>{data?.linkCount || 0}</strong> conexiones
            </span>
          </div>
        </div>

        {/* Documentos recientes (chips) */}
        {data?.recentDocs?.length > 0 && (
          <div className="mv-portal-docs">
            {data.recentDocs.slice(0, 4).map((doc, i) => (
              <span key={doc.id || i} className="mv-doc-chip" title={doc.label}>
                {truncate(doc.label, 20)}
              </span>
            ))}
            {data.recentDocs.length > 4 && (
              <span className="mv-doc-chip mv-doc-more">
                +{data.nodeCount - 4}
              </span>
            )}
          </div>
        )}

        {/* CTA al hover */}
        <div className="mv-portal-cta">
          <span>Explorar →</span>
        </div>

        {/* Indicador de sección actual */}
        {isCurrent && <div className="mv-portal-current-indicator" />}
      </div>

      {/* Glow exterior */}
      <div className="mv-portal-glow" />
    </div>
  );
}

function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '…';
}
