#!/usr/bin/env node
// Una tantum: sposta la pubblicazione delle release nel repo PUBBLICO delle release,
// così solo tu puoi pubblicare e i collaboratori del repo del codice non vedono le chiavi.
//
//   node scripts/secure-releases.mjs
//
// Va lanciato dove c'è la cartella .cerchio-secrets/ (le chiavi per firmare gli
// aggiornamenti, create da `npm run setup`). Serve GitHub CLI con login fatto.
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

// Serve il permesso "workflow" per scrivere il file del workflow nel repo delle release.
const status = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', shell: win });
if (!/workflow/.test(`${status.stdout}${status.stderr}`)) {
  console.log('  Serve un permesso in più (workflow): si apre il browser per confermarlo.');
  spawnSync('gh', ['auth', 'refresh', '-h', 'github.com', '-s', 'workflow'], { stdio: 'inherit', shell: win });
}

// 1. workflow nel repo delle release
const path = '.github/workflows/release.yml';
const content = Buffer.from(readFileSync('releases-repo/release.yml', 'utf8')).toString('base64');
let sha = '';
try {
  sha = gh(['api', `repos/${rel}/contents/${path}`, '--jq', '.sha']);
} catch {
  /* non esiste ancora */
}
gh(
  ['api', '-X', 'PUT', `repos/${rel}/contents/${path}`, '--input', '-'],
  JSON.stringify({ message: 'Workflow di release', content, ...(sha ? { sha } : {}) }),
);
ok('workflow di release caricato nel repo delle release');

// 2. segreti e variabili nel repo delle release
gh(['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY', '-R', rel], readFileSync('.cerchio-secrets/updater.key', 'utf8'));
gh(['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '-R', rel], state.keyPass ?? '');
gh(['secret', 'set', 'CODE_TOKEN', '-R', rel], gh(['auth', 'token']));
gh(['variable', 'set', 'CODE_REPO', '-R', rel, '--body', code]);
ok('chiavi e accesso al codice impostati (visibili solo a te)');

// 3. via le chiavi dal repo del codice: i collaboratori non possono più usarle
for (const s of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'RELEASES_TOKEN']) {
  try {
    gh(['secret', 'delete', s, '-R', code]);
  } catch {
    /* già assente */
  }
}
try {
  gh(['variable', 'delete', 'RELEASES_REPO', '-R', code]);
} catch {
  /* già assente */
}
ok('chiavi rimosse dal repo del codice');

// 4. il vecchio workflow di release nel repo del codice non serve più
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
