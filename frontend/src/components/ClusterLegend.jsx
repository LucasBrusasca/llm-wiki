import React, { useMemo } from 'react';
import { clusterColor } from '../App.jsx';

/* Leyenda 2D fija (HTML): muestra qué clasifica cada cluster (concepto top + conteo).
   No flota en el 3D ni se encima — se lee igual en todos los modos. Se oculta sola
   si no hay clusters formados (todos en cluster = -1). */
export default function ClusterLegend({ nodes, onHover }) {
  const clusters = useMemo(() => {
    const groups = {};
    (nodes || []).forEach(n => {
      if (n.cluster == null || n.cluster < 0) return;
      (groups[n.cluster] ??= []).push(n);
    });
    return Object.entries(groups).map(([cid, members]) => {
      const freq = {};
      members.forEach(n => (n.conceptos || []).forEach(c => { freq[c] = (freq[c] || 0) + 1; }));
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
      return {
        cid: Number(cid),
        label: top.join(' · ') || `Cluster ${cid}`,
        count: members.length,
        ids: members.map(m => m.id),
      };
    }).sort((a, b) => b.count - a.count);
  }, [nodes]);

  if (!clusters.length) return null;

  return (
    <div className="cluster-legend">
      <div className="cluster-legend-title">CLUSTERS · {clusters.length}</div>
      {clusters.map(c => (
        <div
          key={c.cid}
          className="cluster-legend-row"
          onMouseEnter={() => onHover?.(c.ids)}
          onMouseLeave={() => onHover?.(null)}
        >
          <span className="cluster-legend-dot" style={{ background: clusterColor(c.cid) }} />
          <span className="cluster-legend-label" title={c.label}>{c.label}</span>
          <span className="cluster-legend-count">{c.count}</span>
        </div>
      ))}
    </div>
  );
}
