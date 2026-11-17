import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * The one-file verifier: every script, style and the secp256k1 WebAssembly end up inline in
 * dist-verifier/tambat-verify.html, so the file works from disk. Same input, same bytes (see tests/verifier-build.test.ts).
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'verifier'),
  base: './',
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: resolve(import.meta.dirname, 'dist-verifier'),
    emptyOutDir: true,
    sourcemap: false,
    // One file has nothing to preload.
    modulePreload: { polyfill: false },
    rollupOptions: { input: resolve(import.meta.dirname, 'verifier/tambat-verify.html') },
  },
});
