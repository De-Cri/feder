#!/usr/bin/env node
// Publishes a new version:  npm run release -- 0.4.0
// 1. bumps the version everywhere, commits, tags and pushes to the code repo;
// 2. starts the build in the PUBLIC releases repo (where only you can do it).
// Users get the update as soon as the build finishes (~10 minutes).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { releasesRepo } from './gh-repos.mjs';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) {
  console.error('Uso: npm run release -- X.Y.Z');
  process.exit(1);
}
const rel = releasesRepo();

// Before touching anything: only whoever can write to the releases repo can publish.
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
