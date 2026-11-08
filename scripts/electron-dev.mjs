// Avvia Vite e poi Electron puntato al dev server (hot reload dell'interfaccia).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });

const url = 'http://localhost:1420';
for (let i = 0; i < 100; i++) {
  try {
    await fetch(url);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}
const app = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, CERCHIO_DEV_URL: url } });
app.on('exit', () => {
  vite.kill();
  process.exit(0);
});
