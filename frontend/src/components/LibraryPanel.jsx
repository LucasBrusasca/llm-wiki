import React, { useState, useMemo } from 'react';
import { clusterColor } from '../App.jsx';
import IngestPanel from './IngestPanel.jsx';

const FUENTE_ICON = {
  youtube: '▶', pdf: '⬛', tesis: '⬛', excel: '⊞', html: '⊡',
  word: '⬛', ppt: '◳', image: '▣', audio: '♫', video: '▶', concepto: '◈',
};

function fechaCorta(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' });
}

function ConnectionCount({ nodeId, allLinks }) {
  const count = allLinks.filter(l => {
    const s = l.source?.id ?? l.source;
    const t = l.target?.id ?? l.target;
    return s === nodeId || t === nodeId;
  }).length;
  return <span className="lib-conn-count">{count} {count === 1 ? 'conexión' : 'conexiones'}</span>;
}

function NodeRow({ node, allNodes, allLinks, onNavigate, onDelete, onRename, onRefresh }) {
  const [editing, setEditing]   = useState(false);
  const [label, setLabel]       = useState(node.label);
  const [expanded, setExpanded] = useState(false);
  const [newTag, setNewTag]     = useState('');
  const col = clusterColor(node.cluster);

  const connected = useMemo(() => {
    return allLinks
      .filter(l => {
        const s = l.source?.id ?? l.source;
        const t = l.target?.id ?? l.target;
        return s === node.id || t === node.id;
      })
      .map(l => {
        const s = l.source?.id ?? l.source;
        const otherId = s === node.id ? (l.target?.id ?? l.target) : s;
        return allNodes.find(n => n.id === otherId);
      }).filter(Boolean);
  }, [node.id, allNodes, allLinks]);

  async function saveRename() {
    if (!label.trim() || label === node.label) { setEditing(false); setLabel(node.label); return; }
    await fetch(`/api/node/${encodeURIComponent(node.id)}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim() }),
    });
    onRename();
    setEditing(false);
  }

  async function addTag() {
    if (!newTag.trim()) return;
    const currentTags = node.tags || [];
    if (currentTags.includes(newTag.trim())) { setNewTag(''); return; }
    
    await fetch(`/api/node/${encodeURIComponent(node.id)}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [...currentTags, newTag.trim()] })
    });
    setNewTag('');
    if (onRefresh) onRefresh();
  }

  async function removeTag(tagToRemove) {
    const currentTags = node.tags || [];
    const updated = currentTags.filter(t => t !== tagToRemove);
    await fetch(`/api/node/${encodeURIComponent(node.id)}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: updated })
    });
    if (onRefresh) onRefresh();
  }

  return (
    <div className="lib-row">
      <div className="lib-row-main">
        <span className="lib-type-icon" style={{ color: col }}>
          {FUENTE_ICON[node.fuente] || '◈'}
        </span>

        <div className="lib-row-info" onClick={() => setExpanded(e => !e)}>
          {editing ? (
            <input
              className="lib-rename-input"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setEditing(false); setLabel(node.label); } }}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="lib-label" style={{ color: col }}>{node.label}</span>
          )}
          
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="lib-fuente-tag">{(node.fuente || 'concepto').toUpperCase()}</span>
            {(node.tags || []).map(t => (
              <span key={t} style={{ fontSize: 9, background: 'rgba(0,212,255,0.2)', color: '#00d4ff', padding: '2px 6px', borderRadius: 10, letterSpacing: 0.5 }}>
                {t}
              </span>
            ))}
          </div>

          <ConnectionCount nodeId={node.id} allLinks={allLinks} />
          {node.created_at && <span className="lib-fecha">⏱ {fechaCorta(node.created_at)}</span>}
        </div>

        <div className="lib-row-actions">
          {(node.fuente_path || node.fuente_url) && (
            <button className="lib-btn" title="Abrir documento"
              onClick={() => {
                const url = node.fuente_url || `/files/${encodeURIComponent(node.id)}`;
                window.open(url, '_blank');
              }}>⤢</button>
          )}
          <button className="lib-btn" title="Ver en grafo" onClick={() => onNavigate(node)}>⊙</button>
          {editing
            ? <button className="lib-btn lib-btn--ok" onClick={saveRename}>✓</button>
            : <button className="lib-btn" title="Renombrar" onClick={() => setEditing(true)}>✎</button>
          }
          <button className="lib-btn lib-btn--del" title="Eliminar"
            onClick={() => { if (window.confirm(`¿Eliminar "${node.label}"?`)) onDelete(node.id); }}>
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div className="lib-row-detail">
          {node.desc && <p className="lib-desc">{node.desc}</p>}
          
          {/* SECCIÓN DE ETIQUETAS */}
          <div className="lib-connections" style={{ marginTop: 12 }}>
            <span className="lib-detail-label">ETIQUETAS / PROYECTOS:</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {(node.tags || []).map(t => (
                <span key={t} className="lib-conn-tag" style={{ borderColor: 'rgba(0,212,255,0.4)', color: '#00d4ff', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {t}
                  <button onClick={() => removeTag(t)} style={{ background: 'none', border: 'none', color: '#00d4ff', cursor: 'pointer', padding: 0, fontSize: 10 }}>✕</button>
                </span>
              ))}
              <input 
                placeholder="+ Nueva etiqueta..." 
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 11, padding: '4px 8px', borderRadius: 4, outline: 'none' }}
              />
            </div>
          </div>

          {connected.length > 0 && (
            <div className="lib-connections">
              <span className="lib-detail-label">CONECTADO CON:</span>
              <div className="lib-conn-tags">
                {connected.map(c => (
                  <span key={c.id} className="lib-conn-tag"
                    style={{ borderColor: clusterColor(c.cluster) + '55', color: clusterColor(c.cluster) }}
                    onClick={() => onNavigate(c)}>
                    {c.label.length > 28 ? c.label.slice(0, 27) + '…' : c.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {node.conceptos?.length > 0 && (
            <div className="lib-connections">
              <span className="lib-detail-label">CONCEPTOS:</span>
              <div className="lib-conn-tags">
                {node.conceptos.slice(0, 6).map(c => (
                  <span key={c} className="lib-conn-tag" style={{ borderColor: '#333', color: '#888' }}>{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SORTS = [
  { key: 'label',       label: 'Nombre' },
  { key: 'fuente',      label: 'Tipo' },
  { key: 'connections', label: 'Conexiones' },
  { key: 'cluster',     label: 'Cluster AI' },
  { key: 'fecha',       label: 'Más viejo' },
];

export default function LibraryPanel({ allNodes, allLinks, onClose, onNavigate, onDelete, onRename, onRefresh }) {
  const [search, setSearch]   = useState('');
  const [sortBy, setSortBy]   = useState('label');
  const [filterType, setFilterType] = useState('all');
  const [filterTag, setFilterTag]   = useState('all');

  const types = useMemo(() => {
    const t = new Set(allNodes.map(n => n.fuente || 'concepto'));
    return ['all', ...Array.from(t)];
  }, [allNodes]);

  const allTags = useMemo(() => {
    const tags = new Set();
    allNodes.forEach(n => (n.tags || []).forEach(t => tags.add(t)));
    return ['all', ...Array.from(tags).sort()];
  }, [allNodes]);

  const connMap = useMemo(() => {
    const m = {};
    allLinks.forEach(l => {
      const s = l.source?.id ?? l.source;
      const t = l.target?.id ?? l.target;
      m[s] = (m[s] || 0) + 1;
      m[t] = (m[t] || 0) + 1;
    });
    return m;
  }, [allLinks]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allNodes
      .filter(n => !n.is_issue)
      .filter(n => {
        if (filterType !== 'all' && (n.fuente || 'concepto') !== filterType) return false;
        if (filterTag !== 'all' && !(n.tags || []).includes(filterTag)) return false;
        if (!q) return true;
        return n.label.toLowerCase().includes(q)
          || (n.desc || '').toLowerCase().includes(q)
          || (n.autor || '').toLowerCase().includes(q);   // buscar también por autor/canal
      })
      .sort((a, b) => {
        if (sortBy === 'cluster') {
          const ca = a.cluster == null || a.cluster < 0 ? 9999 : a.cluster;
          const cb = b.cluster == null || b.cluster < 0 ? 9999 : b.cluster;
          if (ca !== cb) return ca - cb;
          return a.label.localeCompare(b.label);
        }
        if (sortBy === 'connections') return (connMap[b.id] || 0) - (connMap[a.id] || 0);
        if (sortBy === 'fuente') return (a.fuente || '').localeCompare(b.fuente || '');
        if (sortBy === 'fecha') return new Date(a.created_at || 0) - new Date(b.created_at || 0); // más viejo primero
        return a.label.localeCompare(b.label);
      });
  }, [allNodes, allLinks, search, sortBy, filterType, filterTag, connMap]);

  return (
    <div className="library-overlay">
      <div className="library-panel" style={{ width: 'min(1000px, 95vw)' }}>
        <div className="library-header">
          <span className="library-title">⊞ Biblioteca · {allNodes.length} nodos · {allLinks.length} relaciones</span>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>

        <div className="library-ingest">
          <IngestPanel onRefresh={onRefresh} inline={true} />
        </div>

        <div className="library-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <input
              className="lib-search"
              placeholder="Buscar documentos..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            
            {allTags.length > 1 && (
              <select 
                value={filterTag} 
                onChange={e => setFilterTag(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--gold)', borderRadius: 6, padding: '0 12px', outline: 'none' }}
              >
                <option value="all">Todas las etiquetas</option>
                {allTags.filter(t => t !== 'all').map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <div className="lib-toolbar-group">
              {types.map(t => (
                <button key={t}
                  className={`lib-filter-btn${filterType === t ? ' active' : ''}`}
                  onClick={() => setFilterType(t)}>
                  {t === 'all' ? 'Todos' : t.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="lib-toolbar-group">
              <span className="lib-sort-label">Ordenar:</span>
              {SORTS.map(s => (
                <button key={s.key}
                  className={`lib-filter-btn${sortBy === s.key ? ' active' : ''}`}
                  onClick={() => setSortBy(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="library-list">
          {filtered.length === 0
            ? <div className="lib-empty">Sin resultados</div>
            : filtered.map((node, i) => {
                const prev = i > 0 ? filtered[i - 1] : null;
                const showHeader = sortBy === 'cluster' && (!prev || prev.cluster !== node.cluster);
                const isNoise = node.cluster == null || node.cluster < 0;
                let clusterName = 'Sin Agrupar';
                if (!isNoise) {
                  const freq = {};
                  filtered.forEach(n => {
                    if (n.cluster === node.cluster) {
                      (n.conceptos || []).forEach(c => freq[c] = (freq[c] || 0) + 1);
                    }
                  });
                  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
                  clusterName = top.length > 0 ? top.join(' · ') : `Grupo ${node.cluster}`;
                }

                return (
                  <React.Fragment key={node.id}>
                    {showHeader && (
                      <div style={{ padding: '12px 12px 6px', marginTop: i > 0 ? 10 : 0, color: clusterColor(node.cluster), fontSize: 10, letterSpacing: 1.5, borderBottom: `1px solid ${clusterColor(node.cluster)}44`, textTransform: 'uppercase' }}>
                        {clusterName}
                      </div>
                    )}
                    <NodeRow
                      node={node}
                      allNodes={allNodes}
                      allLinks={allLinks}
                      onNavigate={n => { onNavigate(n); onClose(); }}
                      onDelete={onDelete}
                      onRename={onRename}
                      onRefresh={onRefresh}
                    />
                  </React.Fragment>
                );
              })
          }
        </div>
      </div>
    </div>
  );
}
