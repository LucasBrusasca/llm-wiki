import { pedirSecreto, avisar } from './dialog.jsx';

// Clave de seguridad para las acciones que destruyen o reescriben el grafo.
//
// El backend acepta la acción sin clave cuando ALGEDI_ADMIN_PASSWORD está vacío
// (seguridad opt-in). El frontend consulta una sola vez si está configurada y recién
// entonces pregunta: si no lo hiciera, el usuario vería un prompt inútil en cada borrado.

let habilitada = null;   // null = todavía no se consultó

async function estaHabilitada() {
  if (habilitada !== null) return habilitada;
  try {
    const r = await fetch('/api/security');
    habilitada = !!(await r.json()).enabled;
  } catch {
    // Sin backend (demo estática) no hay nada que proteger.
    habilitada = false;
  }
  return habilitada;
}

/**
 * Pide la clave si hace falta.
 * @returns {Promise<{password: string|null}|null>} null si el usuario canceló.
 */
export async function pedirClave(accion) {
  if (!(await estaHabilitada())) return { password: null };
  // window.prompt lanza en navegadores embebidos, así que la acción moría acá.
  const password = await pedirSecreto(`Clave de seguridad para ${accion}`, {
    detalle: 'Esta acción reescribe el grafo.',
    confirmar: 'Continuar',
  });
  return password == null ? null : { password };
}

/** Mensaje uniforme cuando el backend rechaza la clave. */
export function avisarClaveIncorrecta() {
  avisar('Clave de seguridad incorrecta', { detalle: 'No se hizo ningún cambio.' });
}
