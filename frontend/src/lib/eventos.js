/**
 * Pedidos que cruzan la app sin pasar props por cinco componentes: el inspector, el
 * panel izquierdo o la consola piden abrir el explorador de datos y App lo abre.
 */
const EXPLORAR = 'algedi:explorar';

/** Abrir el explorador sobre un nodo de datos (opcional: la tabla a desplegar, o la
 *  definición de un reporte para seguir trabajándolo). */
export function abrirExplorador(nodo, tabla, inicial) {
  window.dispatchEvent(new CustomEvent(EXPLORAR, { detail: { nodo: { id: nodo.id, label: nodo.label }, tabla, inicial } }));
}

export function alPedirExplorar(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener(EXPLORAR, h);
  return () => window.removeEventListener(EXPLORAR, h);
}
