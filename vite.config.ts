import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Never inline AudioWorklets as data: URLs (the CSP would block them).
    assetsInlineLimit: (file) => (file.endsWith('.js') || file.endsWith('.wasm') ? false : undefined),
  },
});
