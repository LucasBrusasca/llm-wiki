// Render de markdown para todo lo que se inyecta con dangerouslySetInnerHTML.
//
// `marked` deja pasar HTML crudo por diseño, y este texto no es de confianza: lo escribe
// el LLM a partir de PDFs y páginas web arbitrarias. Un documento con `<img onerror=...>`
// embebido llegaba al DOM tal cual. DOMPurify quita scripts y handlers y deja el formato.
//
// Un único lugar donde se hace, para que agregar un panel nuevo no reabra el agujero.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

export function renderMarkdown(texto) {
  return DOMPurify.sanitize(marked.parse(texto || ''));
}
