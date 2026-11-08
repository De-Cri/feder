#!/usr/bin/env node
// Pubblica una nuova versione:  npm run release -- 0.2.0
// Aggiorna la versione ovunque, committa, crea il tag e fa push.
// GitHub Actions compila gli installer e gli utenti ricevono l'aggiornamento.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) {
  console.error('Uso: npm run release -- X.Y.Z');
  process.exit(1);
}
const json = (p, f) => {
  const o = JSON.parse(readFileSync(p, 'utf8'));
  f(o);
  writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
};
json('package.json', (o) => (o.version = v));
json('src-tauri/tauri.conf.json', (o) => (o.version = v));
const cargo = 'src-tauri/Cargo.toml';
writeFileSync(cargo, readFileSync(cargo, 'utf8').replace(/^version = ".*"$/m, `version = "${v}"`));

const run = (c) => execSync(c, { stdio: 'inherit' });
run('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml');
run(`git commit -m "release v${v}"`);
run(`git tag v${v}`);
run('git push');
run(`git push origin v${v}`);
console.log(`\nv${v} pubblicata: la build parte su GitHub Actions.`);
