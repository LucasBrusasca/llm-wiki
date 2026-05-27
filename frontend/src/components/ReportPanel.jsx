import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import { clusterColor } from '../App.jsx';

marked.setOptions({ breaks: true, gfm: true });

export default function ReportPanel({ node, onClose }) {
  const color = clusterColor(node.cluster);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setContent('');
    fetch(`/api/node/${encodeURIComponent(node.id)}/report`)
      .then(r => r.text())
      .then(text => { setContent(text); setLoading(false); })
      .catch(() => { setContent('Error al cargar el reporte.'); setLoading(false); });
  }, [node.id]);

  return (
    <aside className="side-panel agent-panel">
      <div className="agent-header">
        <span style={{ color }}>⬡ Relaciones · {node.label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn-secondary"
            style={{ padding: '2px 10px', fontSize: 10, minHeight: 0 }}
            onClick={() => {
              const a = document.createElement('a');
              a.href = `/api/node/${encodeURIComponent(node.id)}/report`;
              a.download = `reporte-${node.id}.md`;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
            }}
          >↓ .md</button>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="agent-messages">
        {loading
          ? <div className="preview-loading" style={{ padding: 20 }}>Cargando relaciones…</div>
          : <div
              className="agent-msg assistant"
              style={{ maxWidth: '100%', alignSelf: 'stretch' }}
              dangerouslySetInnerHTML={{ __html: marked.parse(content) }}
            />
        }
      </div>
    </aside>
  );
}
