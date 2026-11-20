import react from '@vitejs/plugin-react';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Media served as they are (the demo video and its poster, public/media) are copied next to the built app. */
const MEDIA = resolve(import.meta.dirname, 'public/media');
const copyMedia = (): Plugin => ({
  name: 'tambat-copy-media',
  apply: 'build',
  writeBundle(options) {
    if (existsSync(MEDIA)) cpSync(MEDIA, resolve(options.dir ?? 'dist/web', 'media'), { recursive: true });
  },
});

export default defineConfig({
  plugins: [react(), copyMedia()],
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
