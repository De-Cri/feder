import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Mai inline gli AudioWorklet come data: URL (la CSP li bloccherebbe).
    assetsInlineLimit: (file) => (file.endsWith('.js') || file.endsWith('.wasm') ? false : undefined),
  },
});
