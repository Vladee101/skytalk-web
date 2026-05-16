import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point directly at core source so `vite dev` works without a prior core build
      '@skytalk/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api':    'http://localhost:3001',
      '/ws':     { target: 'ws://localhost:3001',  ws: true },
      '/peerjs': { target: 'http://localhost:9000', ws: true },
    },
  },
});
