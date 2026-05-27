import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api':           'http://localhost:8000',
      '/thumbnail':     'http://localhost:8000',
      '/doc':           'http://localhost:8000',
      '/excel-preview': 'http://localhost:8000',
    },
  },
});
