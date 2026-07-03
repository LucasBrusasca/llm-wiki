import React from 'react';

const TIPO_META = {
  puente:  { label: 'PUENTE',  color: '#5b9bd5', glyph: '⤳' },
  silo:    { label: 'SILO',    color: '#e87a6e', glyph: '▣' },
  hueco:   { label: 'HUECO',   color: '#e8c35a', glyph: '○' },
  aislado: { label: 'AISLADO', color: '#8a93a6', glyph: '◌' },
};

export default function DiscoveriesPanel({ discoveries, onHighlight, onClose }) {
  return (
    <div className="disc-panel">
      <div className="disc-header">
        <span className="disc-title">◎ DESCUBRIMIENTOS</span>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>
      <div className="disc-sub">
        {discoveries.length} hallazgo{discoveries.length === 1 ? '' : 's'} · sin IA, sobre tus datos
      </div>

      <div className="disc-list">
        {discoveries.length === 0 ? (
          <div className="disc-empty">
            Nada por ahora — el corpus es chico o muy homogéneo.
            Cargá más documentos y volvé a abrir.
          </div>
        ) : discoveries.map((d, i) => {
          const m = TIPO_META[d.tipo] || TIPO_META.aislado;
          const clickable = d.nodeIds && d.nodeIds.length > 0;
          return (
            <div
              key={i}
              className={`disc-card${clickable ? ' disc-card--click' : ''}`}
              style={{ borderLeftColor: m.color }}
              onClick={clickable ? () => onHighlight(d.nodeIds) : undefined}
            >
              <div className="disc-card-head">
                <span className="disc-badge" style={{ color: m.color, borderColor: m.color }}>
                  {m.glyph} {m.label}
                </span>
                <span className="disc-conf">{Math.round(d.confianza * 100)}% · {d.mecanismo}</span>
              </div>
              <div className="disc-card-title" style={{ color: m.color }}>{d.titulo}</div>
              <div className="disc-card-text">{d.texto}</div>
              {clickable && <div className="disc-card-cta">⊙ Ver en el grafo</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
