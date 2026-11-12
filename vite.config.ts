import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI is built into dist/web and served by the Fastify server from the same origin.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:5056' },
  },
});
