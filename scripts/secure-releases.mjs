#!/usr/bin/env node
// One-off: moves release publishing to the PUBLIC releases repo,
// so only you can publish and collaborators on the code repo can't see the keys.
//
//   node scripts/secure-releases.mjs
//
// Run it where the .cerchio-secrets/ folder is (the keys that sign updates,
// created by `npm run setup`). Needs GitHub CLI, logged in.
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { releasesRepo, codeRepo } from './gh-repos.mjs';

const win = process.platform === 'win32';
const gh = (args, input) => {
  const r = spawnSync('gh', args, { encoding: 'utf8', input, shell: win });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
};
const ok = (s) => console.log(`  ✓ ${s}`);

const rel = releasesRepo();
const code = codeRepo();
console.log(`\nRelease in ${rel} (pubblico) · codice in ${code} (privato)\n`);

if (!existsSync('.cerchio-secrets/updater.key')) {
  console.error('Manca .cerchio-secrets/updater.key: lancia lo script sul PC dove hai fatto il setup');
  console.error('(o copia lì la cartella .cerchio-secrets).');
  process.exit(1);
}
const state = JSON.parse(readFileSync('.cerchio-secrets/state.json', 'utf8'));

// The "workflow" scope is needed to write the workflow file in the releases repo.
const status = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', shell: win });
if (!/workflow/.test(`${status.stdout}${status.stderr}`)) {
  console.log('  Serve un permesso in più (workflow): si apre il browser per confermarlo.');
  spawnSync('gh', ['auth', 'refresh', '-h', 'github.com', '-s', 'workflow'], { stdio: 'inherit', shell: win });
}

// 1. workflow in the releases repo
const path = '.github/workflows/release.yml';
const content = Buffer.from(readFileSync('releases-repo/release.yml', 'utf8')).toString('base64');
let sha = '';
try {
  sha = gh(['api', `repos/${rel}/contents/${path}`, '--jq', '.sha']);
} catch {
  /* doesn't exist yet */
}
gh(
  ['api', '-X', 'PUT', `repos/${rel}/contents/${path}`, '--input', '-'],
  JSON.stringify({ message: 'Workflow di release', content, ...(sha ? { sha } : {}) }),
);
ok('workflow di release caricato nel repo delle release');

// 2. secrets and variables in the releases repo
gh(['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY', '-R', rel], readFileSync('.cerchio-secrets/updater.key', 'utf8'));
gh(['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '-R', rel], state.keyPass ?? '');
gh(['secret', 'set', 'CODE_TOKEN', '-R', rel], gh(['auth', 'token']));
gh(['variable', 'set', 'CODE_REPO', '-R', rel, '--body', code]);
ok('chiavi e accesso al codice impostati (visibili solo a te)');

// 3. remove the keys from the code repo: collaborators can no longer use them
for (const s of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'RELEASES_TOKEN']) {
  try {
    gh(['secret', 'delete', s, '-R', code]);
  } catch {
    /* already gone */
  }
}
try {
  gh(['variable', 'delete', 'RELEASES_REPO', '-R', code]);
} catch {
  /* already gone */
}
ok('chiavi rimosse dal repo del codice');

// 4. the old release workflow in the code repo is no longer needed
if (existsSync('.github/workflows/release.yml')) {
  rmSync('.github/workflows/release.yml');
  ok('rimosso .github/workflows/release.yml dal repo del codice (ricordati il commit)');
}

console.log(`
Fatto. Da ora:
  - le release le pubblichi solo tu con:  npm run release -- X.Y.Z
  - i collaboratori possono pushare e aprire Pull Request, ma non pubblicare
  - i log delle build sono pubblici (in ${rel}), il codice resta privato
`);
