import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [
    svelte(),
    {
      name: 'mock-supabase',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './supabase' && importer?.includes('/src/lib/')) return resolve(__dirname, 'mock-supabase.ts');
      },
    },
  ],
  server: { port: 5199, strictPort: true, fs: { allow: [resolve(__dirname, '../..')] } },
});
