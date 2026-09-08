import React, { useState, useEffect, useCallback, useMemo } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSE — Dashboard de Dimensiones
   
   Diseño de producto real: cards de dimensión con preview de contenido,
   navegación clara, funciona bien con 2+ secciones.
   ══════════════════════════════════════════════════════════════════════════ */

const DIMENSION_COLORS = [
  { primary: '#00D4FF', secondary: '#0090B0', gradient: 'linear-gradient(135deg, #00D4FF 0%, #0090B0 100%)' },
  { primary: '#2FE0C8', secondary: '#1A9080', gradient: 'linear-gradient(135deg, #2FE0C8 0%, #1A9080 100%)' },
  { primary: '#7B68EE', secondary: '#5040B0', gradient: 'linear-gradient(135deg, #7B68EE 0%, #5040B0 100%)' },
  { primary: '#FF6B9D', secondary: '#C04070', gradient: 'linear-gradient(135deg, #FF6B9D 0%, #C04070 100%)' },
  { primary: '#FFB84D', secondary: '#C08030', gradient: 'linear-gradient(135deg, #FFB84D 0%, #C08030 100%)' },
  { primary: '#A78BFA', secondary: '#7050C0', gradient: 'linear-gradient(135deg, #A78BFA 0%, #7050C0 100%)' },
];

function getDimensionColor(index) {
  return DIMENSION_COLORS[index % DIMENSION_COLORS.length];
}

export default function MultiverseMap({ 
  sections, 
  onSelectSection, 
  onClose,
  currentSection 
}) {
  const [bridges, setBridges] = useState([]);
  const [sectionStats, setSectionStats] = useState({});
  const [hoveredSection, setHoveredSection] = useState(null);
  const [hoveredBridge, setHoveredBridge] = useState(null);
  const [loading, setLoading] = useState(true);

  // Cargar puentes y estadísticas de cada sección
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      
      // Cargar puentes
      try {
        const r = await fetch('/api/sections/bridges');
        const data = await r.json();
        if (Array.isArray(data.bridges)) {
          setBridges(data.bridges);
        }
      } catch {
        // Fallback: crear puentes heurísticos
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
      }

      // Cargar estadísticas de cada sección (top themes, relation count)
      const stats = {};
      for (const s of sections) {
        try {
          const r = await fetch(`/api/graph?seccion=${encodeURIComponent(s.nombre)}`);
          const data = await r.json();
          const nodes = data.nodos || [];
          const links = data.relaciones || [];
          
          // Extraer top themes
          const themeCounts = {};
          nodes.forEach(n => {
            if (n.group_label) {
              themeCounts[n.group_label] = (themeCounts[n.group_label] || 0) + 1;
            }
          });
          const topThemes = Object.entries(themeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([theme]) => theme);

          // Tipos de nodos
          const typeCounts = {};
          nodes.forEach(n => {
            const t = n.tipo || 'documento';
            typeCounts[t] = (typeCounts[t] || 0) + 1;
          });

          stats[s.nombre] = {
            nodeCount: nodes.length,
            linkCount: links.length,
            topThemes,
            typeCounts,
            density: links.length / Math.max(1, nodes.length),
          };
        } catch {
          stats[s.nombre] = {
            nodeCount: s.count || 0,
            linkCount: 0,
            topThemes: [],
            typeCounts: {},
            density: 0,
          };
        }
      }
      setSectionStats(stats);
      setLoading(false);
    };

    loadData();
  }, [sections]);

  // Encontrar puente entre dos secciones
  const getBridge = useCallback((s1, s2) => {
    return bridges.find(b => 
      (b.source === s1 && b.target === s2) || 
      (b.source === s2 && b.target === s1)
    );
  }, [bridges]);

  // Dimensiones con datos enriquecidos
  const dimensions = useMemo(() => {
    return sections.map((s, i) => ({
      ...s,
      color: getDimensionColor(i),
      stats: sectionStats[s.nombre] || { nodeCount: s.count, linkCount: 0, topThemes: [], density: 0 },
      isCurrent: s.nombre === currentSection,
    }));
  }, [sections, sectionStats, currentSection]);

  // Click en dimensión
  const handleDimensionClick = useCallback((nombre) => {
    if (onSelectSection) {
      onSelectSection(nombre);
    }
  }, [onSelectSection]);

  // Render de mini-grafo sparkline (densidad visual)
  const renderDensitySparkline = (density, color) => {
    const bars = 8;
    const maxHeight = 24;
    return (
      <div className="mv-density-spark">
        {Array.from({ length: bars }).map((_, i) => {
          const h = Math.max(4, Math.min(maxHeight, (density * 20 + Math.random() * 8) * (1 - i * 0.08)));
          return (
            <div 
              key={i} 
              className="mv-density-bar"
              style={{ 
                height: h, 
                background: `linear-gradient(180deg, ${color.primary} 0%, ${color.secondary} 100%)`,
                opacity: 0.6 + Math.random() * 0.4,
              }} 
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="multiverse-dashboard">
      {/* Header */}
      <header className="mv-header">
        <div className="mv-header-left">
          <span className="mv-header-icon">◈</span>
          <h1 className="mv-header-title">Multiverso</h1>
          <span className="mv-header-count">{sections.length} dimensiones</span>
        </div>
        <div className="mv-header-right">
          <button className="mv-close-btn" onClick={onClose} title="Cerrar">
            ✕
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="mv-main">
        {/* Sidebar: lista de dimensiones */}
        <aside className="mv-sidebar">
          <div className="mv-sidebar-header">
            <span className="mv-sidebar-title">Dimensiones</span>
            <span className="mv-sidebar-hint">Click para explorar</span>
          </div>
          
          <div className="mv-dimension-list">
            {dimensions.map((dim, i) => (
              <button
                key={dim.nombre}
                className={`mv-dimension-card ${dim.isCurrent ? 'mv-dimension-card--current' : ''} ${hoveredSection === dim.nombre ? 'mv-dimension-card--hover' : ''}`}
                onClick={() => handleDimensionClick(dim.nombre)}
                onMouseEnter={() => setHoveredSection(dim.nombre)}
                onMouseLeave={() => setHoveredSection(null)}
                style={{ '--dim-color': dim.color.primary, '--dim-gradient': dim.color.gradient }}
              >
                {/* Indicador de color */}
                <div className="mv-dim-indicator" />
                
                {/* Info principal */}
                <div className="mv-dim-main">
                  <div className="mv-dim-name">
                    {dim.nombre.charAt(0).toUpperCase() + dim.nombre.slice(1)}
                    {dim.isCurrent && <span className="mv-dim-current-badge">Actual</span>}
                  </div>
                  <div className="mv-dim-stats">
                    <span className="mv-dim-stat">
                      <span className="mv-dim-stat-value">{dim.stats.nodeCount}</span>
                      <span className="mv-dim-stat-label">docs</span>
                    </span>
                    <span className="mv-dim-stat">
                      <span className="mv-dim-stat-value">{dim.stats.linkCount}</span>
                      <span className="mv-dim-stat-label">relaciones</span>
                    </span>
                  </div>
                </div>

                {/* Densidad visual */}
                {renderDensitySparkline(dim.stats.density, dim.color)}

                {/* Themes */}
                {dim.stats.topThemes.length > 0 && (
                  <div className="mv-dim-themes">
                    {dim.stats.topThemes.map((theme, j) => (
                      <span key={j} className="mv-dim-theme">{theme}</span>
                    ))}
                  </div>
                )}

                {/* Flecha de entrada */}
                <div className="mv-dim-arrow">→</div>
              </button>
            ))}
          </div>

          {/* Puentes/conexiones */}
          {bridges.length > 0 && (
            <div className="mv-bridges-section">
              <div className="mv-sidebar-title">Conexiones cross-dominio</div>
              <div className="mv-bridges-list">
                {bridges.map((bridge, i) => (
                  <div 
                    key={i} 
                    className={`mv-bridge-card ${hoveredBridge === i ? 'mv-bridge-card--hover' : ''}`}
                    onMouseEnter={() => setHoveredBridge(i)}
                    onMouseLeave={() => setHoveredBridge(null)}
                  >
                    <div className="mv-bridge-ends">
                      <span className="mv-bridge-end">{bridge.source}</span>
                      <span className="mv-bridge-connector">⟷</span>
                      <span className="mv-bridge-end">{bridge.target}</span>
                    </div>
                    <div className="mv-bridge-info">
                      <span className="mv-bridge-affinity">
                        {Math.round(Math.min(100, bridge.weight * 30))}% afinidad
                      </span>
                      {bridge.shared_themes?.length > 0 && (
                        <span className="mv-bridge-themes-count">
                          {bridge.shared_themes.length} temas
                        </span>
                      )}
                    </div>
                    {hoveredBridge === i && bridge.shared_themes?.length > 0 && (
                      <div className="mv-bridge-themes-detail">
                        {bridge.shared_themes.slice(0, 5).map((t, j) => (
                          <span key={j} className="mv-bridge-theme">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Vista central: mapa visual de dimensiones */}
        <main className="mv-canvas">
          {loading ? (
            <div className="mv-loading">
              <div className="mv-loading-spinner" />
              <span>Cargando dimensiones...</span>
            </div>
          ) : (
            <div className="mv-visual-map">
              {/* Grid de dimensiones como cubos/cards 3D */}
              <div className="mv-cubes-grid">
                {dimensions.map((dim, i) => {
                  // Calcular posición en grid adaptativo
                  const total = dimensions.length;
                  const cols = total <= 2 ? 2 : (total <= 4 ? 2 : 3);
                  const row = Math.floor(i / cols);
                  const col = i % cols;
                  const offsetX = (col - (cols - 1) / 2) * 280;
                  const offsetY = (row - (Math.ceil(total / cols) - 1) / 2) * 220;

                  return (
                    <div
                      key={dim.nombre}
                      className={`mv-cube ${dim.isCurrent ? 'mv-cube--current' : ''} ${hoveredSection === dim.nombre ? 'mv-cube--hover' : ''}`}
                      style={{
                        '--cube-color': dim.color.primary,
                        '--cube-gradient': dim.color.gradient,
                        transform: `translate(${offsetX}px, ${offsetY}px)`,
                      }}
                      onClick={() => handleDimensionClick(dim.nombre)}
                      onMouseEnter={() => setHoveredSection(dim.nombre)}
                      onMouseLeave={() => setHoveredSection(null)}
                    >
                      {/* Cara del cubo */}
                      <div className="mv-cube-face">
                        <div className="mv-cube-glow" />
                        <div className="mv-cube-content">
                          <div className="mv-cube-icon">◈</div>
                          <div className="mv-cube-name">
                            {dim.nombre.charAt(0).toUpperCase() + dim.nombre.slice(1)}
                          </div>
                          <div className="mv-cube-metrics">
                            <div className="mv-cube-metric">
                              <span className="mv-cube-metric-val">{dim.stats.nodeCount}</span>
                              <span className="mv-cube-metric-lbl">documentos</span>
                            </div>
                            <div className="mv-cube-metric">
                              <span className="mv-cube-metric-val">{dim.stats.linkCount}</span>
                              <span className="mv-cube-metric-lbl">relaciones</span>
                            </div>
                          </div>
                          {dim.stats.topThemes.length > 0 && (
                            <div className="mv-cube-themes">
                              {dim.stats.topThemes.slice(0, 2).map((t, j) => (
                                <span key={j} className="mv-cube-theme">{t}</span>
                              ))}
                            </div>
                          )}
                          <div className="mv-cube-cta">
                            Click para explorar →
                          </div>
                        </div>
                        {dim.isCurrent && <div className="mv-cube-current-ring" />}
                      </div>
                      
                      {/* Bordes 3D */}
                      <div className="mv-cube-edge mv-cube-edge--top" />
                      <div className="mv-cube-edge mv-cube-edge--right" />
                    </div>
                  );
                })}

                {/* Líneas de conexión entre dimensiones */}
                <svg className="mv-connections-svg" viewBox="-500 -400 1000 800">
                  {bridges.map((bridge, i) => {
                    const sourceIdx = dimensions.findIndex(d => d.nombre === bridge.source);
                    const targetIdx = dimensions.findIndex(d => d.nombre === bridge.target);
                    if (sourceIdx < 0 || targetIdx < 0) return null;

                    const total = dimensions.length;
                    const cols = total <= 2 ? 2 : (total <= 4 ? 2 : 3);
                    
                    const getPos = (idx) => {
                      const row = Math.floor(idx / cols);
                      const col = idx % cols;
                      return {
                        x: (col - (cols - 1) / 2) * 280,
                        y: (row - (Math.ceil(total / cols) - 1) / 2) * 220,
                      };
                    };

                    const p1 = getPos(sourceIdx);
                    const p2 = getPos(targetIdx);
                    const isHovered = hoveredBridge === i || 
                      hoveredSection === bridge.source || 
                      hoveredSection === bridge.target;

                    return (
                      <g key={i} className={`mv-connection ${isHovered ? 'mv-connection--hover' : ''}`}>
                        <line
                          x1={p1.x} y1={p1.y}
                          x2={p2.x} y2={p2.y}
                          stroke={isHovered ? 'rgba(0, 212, 255, 0.6)' : 'rgba(100, 180, 220, 0.25)'}
                          strokeWidth={isHovered ? 3 : 2}
                          strokeDasharray={isHovered ? 'none' : '8 4'}
                        />
                        {/* Punto medio con label */}
                        <circle
                          cx={(p1.x + p2.x) / 2}
                          cy={(p1.y + p2.y) / 2}
                          r={isHovered ? 8 : 5}
                          fill={isHovered ? 'rgba(0, 212, 255, 0.8)' : 'rgba(100, 180, 220, 0.4)'}
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Mensaje cuando hay pocas dimensiones */}
              {dimensions.length <= 2 && (
                <div className="mv-hint-banner">
                  <span className="mv-hint-icon">💡</span>
                  <span>
                    Tus {dimensions.length} dimensiones están conectadas por temas compartidos. 
                    Agregá más documentos o secciones para expandir tu multiverso.
                  </span>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Footer con leyenda */}
      <footer className="mv-footer">
        <div className="mv-legend">
          <div className="mv-legend-item">
            <span className="mv-legend-cube" />
            <span>Dimensión</span>
          </div>
          <div className="mv-legend-item">
            <span className="mv-legend-line" />
            <span>Puente (conexión cross-dominio)</span>
          </div>
          <div className="mv-legend-item">
            <span className="mv-legend-current" />
            <span>Sección actual: {currentSection}</span>
          </div>
        </div>
        <div className="mv-controls-hint">
          Click en una dimensión para explorar su grafo de conocimiento
        </div>
      </footer>
    </div>
  );
}
