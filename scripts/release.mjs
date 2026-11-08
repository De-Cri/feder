#!/usr/bin/env node
// Pubblica una nuova versione:  npm run release -- 0.4.0
// 1. aggiorna la versione ovunque, committa, crea il tag e fa push sul repo del codice;
// 2. avvia la build nel repo PUBBLICO delle release (dove solo tu puoi farlo).
// Gli utenti ricevono l'aggiornamento appena la build finisce (~10 minuti).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { releasesRepo } from './gh-repos.mjs';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) {
  console.error('Uso: npm run release -- X.Y.Z');
  process.exit(1);
}
const rel = releasesRepo();

// Prima di toccare qualcosa: solo chi può scrivere nel repo delle release può pubblicare.
const perm = spawnSync('gh', ['api', `repos/${rel}`, '--jq', '.permissions.push'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (perm.stdout.trim() !== 'true') {
  console.error(`Solo il proprietario di ${rel} può pubblicare una release.`);
  console.error('Apri una Pull Request: la release la fa lui.');
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
run(`gh workflow run release.yml -R ${rel} -f ref=v${v}`);
console.log(`\nv${v}: build avviata. La segui su https://github.com/${rel}/actions`);
