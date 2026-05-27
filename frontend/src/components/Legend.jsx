import React from 'react';

const SOURCES = [
  { key: 'pdf',      label: 'PDF',      color: '#f5a623' },
  { key: 'youtube',  label: 'YouTube',  color: '#e05c5c' },
  { key: 'audio',    label: 'Audio',    color: '#7eb8f7' },
  { key: 'excel',    label: 'Excel',    color: '#6fcf97' },
  { key: 'html',     label: 'HTML',     color: '#bb86fc' },
  { key: 'tesis',    label: 'Tesis',    color: '#f5a623' },
  { key: 'concepto', label: 'Concepto', color: '#8a8d9a' },
];

export default function Legend({ open, onToggle }) {
  return (
    <>
      {/* Hamburger / legend toggle on mobile */}
      <button className="legend-toggle" onClick={onToggle} aria-label="Leyenda">
        {open ? '✕' : '☰'}
      </button>

      <aside className={`legend-panel${open ? ' open' : ''}`}>
        <div className="legend-title">FUENTES</div>
        <ul className="legend-list">
          {SOURCES.map(s => (
            <li key={s.key} className="legend-item">
              <span className="legend-dot" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
