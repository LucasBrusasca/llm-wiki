import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El proxy de Vite corre del lado del servidor (dentro del contenedor del frontend),
// por lo que NO debe apuntar a "localhost" en Docker: ahí localhost es el propio
// contenedor del frontend. En Docker se setea BACKEND_URL=http://backend:8000
// (nombre del servicio en docker-compose). En dev local sin Docker, el default
// http://localhost:8000 sigue funcionando.
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Docker/Windows: el file-watcher nativo no detecta cambios en bind-mounts,
    // así que HMR no se dispara. usePolling fuerza la detección por sondeo.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api':           BACKEND_URL,
      '/files':         BACKEND_URL,
      '/thumb':         BACKEND_URL,
      '/thumbnail':     BACKEND_URL,
      '/doc':           BACKEND_URL,
      '/excel-preview': BACKEND_URL,
    },
  },
});
