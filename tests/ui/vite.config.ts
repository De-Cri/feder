import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
export default defineConfig({
  root,
  plugins: [
    svelte(),
    {
      name: 'mock',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source.endsWith('/supabase') && importer?.includes('/src/')) return resolve(__dirname, 'mock-supabase.ts');
        if (source.endsWith('/lib/config')) return resolve(__dirname, 'mock-config.ts');
      },
    },
  ],
  server: { port: 5198, strictPort: true },
});
