import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Files served as they are, such as the event deck (web/public/deck.pdf, made by tools/deck/build.ts).
  publicDir: 'web/public',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    sourcemap: false,
    // The app, and the badge page other sites frame at /embed/<id> (served by server/embed.ts).
    rollupOptions: { input: { app: resolve(import.meta.dirname, 'index.html'), embed: resolve(import.meta.dirname, 'web/embed.html') } },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8080', '/healthz': 'http://127.0.0.1:8080', '/embed.js': 'http://127.0.0.1:8080' },
  },
});
