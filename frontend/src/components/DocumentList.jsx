import React, { useState, useMemo } from 'react';
import { clusterColor, CLUSTER_PALETTE } from '../App.jsx';

const FUENTE_ICONS = {
  pdf: '⬛', tesis: '⬛', youtube: '▶', excel: '⊞', html: '⊡',
  word: '⬛', ppt: '◳', image: '▣', audio: '♫', video: '▶',
  concepto: '◈', script: '⚙',
};

const FUENTE_LABELS = {
  pdf: 'PDF', tesis: 'Tesis', youtube: 'Video', excel: 'Excel', html: 'Web',
  word: 'Word', ppt: 'Slides', image: 'Imagen', audio: 'Audio', video: 'Video',
  concepto: 'Nota', script: 'Script',
};

function groupKey(node) {
  const t = node.tema;
  if (t && t !== 'Sin clasificar') return 't:' + t;
  if (node.cluster != null && node.cluster >= 0) return 'c:' + node.cluster;
  return null;
}

function groupColor(key) {
  if (key == null) return '#565A78';
  if (key.startsWith('c:')) return clusterColor(parseInt(key.slice(2), 10));
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return CLUSTER_PALETTE[h % CLUSTER_PALETTE.length];
}

function groupLabel(key) {
  if (key == null) return 'Sin clasificar';
  if (key.startsWith('t:')) return key.slice(2);
  if (key.startsWith('c:')) return `Grupo ${key.slice(2)}`;
  return key;
}

function DocumentItem({ node, isSelected, isHighlighted, onClick, onFocus }) {
  const gk = groupKey(node);
  const color = groupColor(gk);
  const icon = FUENTE_ICONS[node.fuente] || '◈';
  const typeLabel = FUENTE_LABELS[node.fuente] || 'Doc';
  const isScript = node.fuente === 'script' || node.type === 'SCRIPT';

  return (
    <div
      className={`doclist-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`}
      onClick={onClick}
      style={{
        '--accent-color': color,
      }}
    >
      <div className="doclist-item-icon" style={{ color }}>
        {icon}
      </div>
      <div className="doclist-item-content">
        <div className="doclist-item-label">{node.label}</div>
        <div className="doclist-item-meta">
          <span className="doclist-item-type" style={{ borderColor: `${color}50` }}>
            {typeLabel}
          </span>
          {isScript && <span className="doclist-item-badge">⚙</span>}
          {node.is_hub && <span className="doclist-item-badge">★</span>}
        </div>
      </div>
      <button 
        className="doclist-item-focus" 
        onClick={(e) => { e.stopPropagation(); onFocus(); }}
        title="Enfocar en grafo"
      >
        ⌖
      </button>
    </div>
  );
}

function GroupSection({ groupKey: gk, nodes, selectedNode, highlighted, onSelect, onFocus, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const color = groupColor(gk);
  const label = groupLabel(gk);

  return (
    <div className="doclist-group">
      <button 
        className="doclist-group-header"
        onClick={() => setExpanded(!expanded)}
        style={{ '--group-color': color }}
      >
        <span className="doclist-group-caret">{expanded ? '▾' : '▸'}</span>
        <span className="doclist-group-dot" style={{ background: color }} />
        <span className="doclist-group-label">{label}</span>
        <span className="doclist-group-count">{nodes.length}</span>
      </button>
      {expanded && (
        <div className="doclist-group-items">
          {nodes.map(node => (
            <DocumentItem
              key={node.id}
              node={node}
              isSelected={selectedNode?.id === node.id}
              isHighlighted={highlighted.has(node.id)}
              onClick={() => onSelect(node)}
              onFocus={() => onFocus(node)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocumentList({ 
  allNodes, 
  allLinks,
  selectedNode, 
  highlighted,
  onSelect, 
  onFocus,
  searchQuery,
  onSearchChange,
}) {
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('tema');

  const types = useMemo(() => {
    const t = new Set(allNodes.filter(n => !n.is_issue).map(n => n.fuente || 'concepto'));
    return ['all', ...Array.from(t).sort()];
  }, [allNodes]);

  const filteredAndGrouped = useMemo(() => {
    const q = (searchQuery || '').toLowerCase();
    
    let filtered = allNodes
      .filter(n => !n.is_issue)
      .filter(n => {
        if (filterType !== 'all' && (n.fuente || 'concepto') !== filterType) return false;
        if (!q) return true;
        return n.label.toLowerCase().includes(q) ||
          (n.desc || '').toLowerCase().includes(q) ||
          (n.tema || '').toLowerCase().includes(q) ||
          (n.conceptos || []).some(c => c.toLowerCase().includes(q));
      });

    if (sortBy === 'name') {
      return { 
        type: 'flat', 
        nodes: filtered.sort((a, b) => a.label.localeCompare(b.label)) 
      };
    }

    const groups = new Map();
    filtered.forEach(n => {
      const gk = groupKey(n) || '__none__';
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(n);
    });

    groups.forEach(nodes => nodes.sort((a, b) => a.label.localeCompare(b.label)));

    const sortedGroups = [...groups.entries()].sort((a, b) => {
      if (a[0] === '__none__') return 1;
      if (b[0] === '__none__') return -1;
      return b[1].length - a[1].length;
    });

    return { type: 'grouped', groups: sortedGroups };
  }, [allNodes, searchQuery, filterType, sortBy]);

  const stats = useMemo(() => {
    const docs = allNodes.filter(n => !n.is_issue);
    return {
      total: docs.length,
      links: allLinks.length,
      groups: new Set(docs.map(n => groupKey(n)).filter(Boolean)).size,
    };
  }, [allNodes, allLinks]);

  return (
    <div className="doclist">
      <div className="doclist-header">
        <div className="doclist-title">
          <span className="doclist-title-icon">⊞</span>
          <span>Biblioteca</span>
        </div>
        <div className="doclist-stats">
          {stats.total} docs · {stats.links} rel
        </div>
      </div>

      <div className="doclist-search">
        <input
          type="text"
          placeholder="Buscar documentos..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="doclist-search-input"
        />
      </div>

      <div className="doclist-filters">
        <div className="doclist-filter-row">
          {types.slice(0, 6).map(t => (
            <button
              key={t}
              className={`doclist-filter-btn ${filterType === t ? 'active' : ''}`}
              onClick={() => setFilterType(t)}
            >
              {t === 'all' ? 'Todo' : FUENTE_ICONS[t] || '◈'}
            </button>
          ))}
        </div>
        <div className="doclist-sort">
          <button
            className={`doclist-sort-btn ${sortBy === 'tema' ? 'active' : ''}`}
            onClick={() => setSortBy('tema')}
          >
            Por tema
          </button>
          <button
            className={`doclist-sort-btn ${sortBy === 'name' ? 'active' : ''}`}
            onClick={() => setSortBy('name')}
          >
            A-Z
          </button>
        </div>
      </div>

      <div className="doclist-content">
        {filteredAndGrouped.type === 'flat' ? (
          <div className="doclist-flat">
            {filteredAndGrouped.nodes.map(node => (
              <DocumentItem
                key={node.id}
                node={node}
                isSelected={selectedNode?.id === node.id}
                isHighlighted={highlighted.has(node.id)}
                onClick={() => onSelect(node)}
                onFocus={() => onFocus(node)}
              />
            ))}
          </div>
        ) : (
          filteredAndGrouped.groups.map(([gk, nodes]) => (
            <GroupSection
              key={gk}
              groupKey={gk === '__none__' ? null : gk}
              nodes={nodes}
              selectedNode={selectedNode}
              highlighted={highlighted}
              onSelect={onSelect}
              onFocus={onFocus}
              defaultExpanded={nodes.length <= 20}
            />
          ))
        )}
        {filteredAndGrouped.type === 'grouped' && filteredAndGrouped.groups.length === 0 && (
          <div className="doclist-empty">
            No hay documentos que coincidan
          </div>
        )}
      </div>
    </div>
  );
}
