import {
  FileText, Presentation, FileType2, Globe, CirclePlay, Table2, Image as ImageIcon,
  CircleAlert, FolderOpen, Terminal, StickyNote, AlignLeft, Search, Boxes,
} from 'lucide-react';

/**
 * Tipos de nodo del grafo. La UI no inventa tipos: son los que devuelve el
 * backend en `type` (DOCUMENTO, ISSUE, EXPEDIENTE, SCRIPT…).
 */
export const TIPOS = {
  DOCUMENTO:  { label: 'Documento',  plural: 'Documentos',  icon: FileText },
  NOTA:       { label: 'Nota',       plural: 'Notas',       icon: StickyNote },
  CHUNK:      { label: 'Fragmento',  plural: 'Fragmentos',  icon: AlignLeft },
  SCRIPT:     { label: 'Script',     plural: 'Scripts',     icon: Terminal },
  QUERY:      { label: 'Consulta',   plural: 'Consultas',   icon: Search },
  ISSUE:      { label: 'Issue',      plural: 'Issues',      icon: CircleAlert },
  EXPEDIENTE: { label: 'Expediente', plural: 'Expedientes', icon: FolderOpen },
};

/** Ícono por origen del archivo — más informativo que el tipo cuando todo es DOCUMENTO. */
const ICONO_FUENTE = {
  pdf: FileText,
  ppt: Presentation,
  pptx: Presentation,
  word: FileType2,
  docx: FileType2,
  excel: Table2,
  xlsx: Table2,
  imagen: ImageIcon,
  youtube: CirclePlay,
  url: Globe,
  web: Globe,
  script: Terminal,
  issue: CircleAlert,
  architect: FolderOpen,
};

export function tipoMeta(tipo) {
  return TIPOS[tipo] || { label: tipo || 'Nodo', plural: tipo || 'Nodos', icon: Boxes };
}

export function iconoDe(node) {
  if (!node) return Boxes;
  return ICONO_FUENTE[(node.fuente || '').toLowerCase()] || tipoMeta(node.type).icon;
}

export function fuenteLabel(node) {
  const f = (node?.fuente || '').toLowerCase();
  const nombres = {
    pdf: 'PDF', ppt: 'PPT', pptx: 'PPT', word: 'Word', docx: 'Word',
    excel: 'Excel', xlsx: 'Excel', youtube: 'YouTube', url: 'Web', web: 'Web',
    script: 'Script', issue: 'Issue', architect: 'Architect', imagen: 'Imagen',
  };
  return nombres[f] || (f ? f.toUpperCase() : null);
}

/** Relaciones: el backend usa constantes en mayúsculas; la UI las muestra en prosa. */
export const RELACIONES = {
  PROFUNDIZA_EN:            'profundiza en',
  COMPLEMENTA_A:            'complementa a',
  RELACIONADO_CON:          'relacionado con',
  SEMANTICAMENTE_SIMILAR_A: 'similar a',
  COMPARTE_CONCEPTOS_CON:   'comparte conceptos con',
};

export function relacionLabel(label) {
  return RELACIONES[label] || (label || '').toLowerCase().replace(/_/g, ' ');
}

/** Procedencia del vínculo: de dónde salió la arista. Es el dato auditable. */
export function procedenciaLabel(edge) {
  if (edge?.is_manual) return 'vínculo manual';
  const base = edge?.base_relacion;
  if (base === 'explicita') return 'conceptos explícitos';
  if (base === 'semantica') return 'similitud semántica';
  return edge?.metodo ? edge.metodo.replace(/_/g, ' ') : 'calculado';
}

/** Agrupadores disponibles en la biblioteca. `keyOf` devuelve el grupo de un nodo. */
export const AGRUPADORES = {
  tipo: {
    label: 'Tipo',
    keyOf: (n) => n.type || 'SIN_TIPO',
    titleOf: (k) => tipoMeta(k).plural,
  },
  fuente: {
    label: 'Origen',
    keyOf: (n) => (n.fuente || 'sin-origen').toLowerCase(),
    titleOf: (k) => (k === 'sin-origen' ? 'Sin origen' : (fuenteLabel({ fuente: k }) || k)),
  },
  tema: {
    label: 'Tema',
    keyOf: (n) => n.tema || (n.cluster != null && n.cluster >= 0 ? `Grupo ${n.cluster + 1}` : 'Sin clasificar'),
    titleOf: (k) => k,
  },
  autor: {
    label: 'Autor',
    keyOf: (n) => n.autor || 'Sin autor',
    titleOf: (k) => k,
  },
  ninguno: { label: 'Sin agrupar', keyOf: () => '', titleOf: () => '' },
};

/** Índice de relaciones por nodo: { id → [{ edge, otherId, dir }] } */
export function indexarRelaciones(edges) {
  const idx = new Map();
  const push = (id, item) => {
    if (!idx.has(id)) idx.set(id, []);
    idx.get(id).push(item);
  };
  for (const e of edges) {
    push(e.source, { edge: e, otherId: e.target, dir: 'out' });
    push(e.target, { edge: e, otherId: e.source, dir: 'in' });
  }
  for (const arr of idx.values()) arr.sort((a, b) => (b.edge.score || 0) - (a.edge.score || 0));
  return idx;
}
