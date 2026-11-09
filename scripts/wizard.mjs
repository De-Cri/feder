#!/usr/bin/env node
// =============================================================================
// Cerchio — wizard di installazione e build
//
// Windows: doppio clic su  Setup.cmd
// Linux:   ./setup.sh
//
// Controlla cosa manca (git, GitHub CLI, Rust, Visual Studio Build Tools,
// WebView2, rpm-build…), chiede il permesso e lo installa, poi crea gli
// installer. Due modalità:
//   1. Nel cloud (consigliata): GitHub Actions compila Windows + Linux.
//      Sul PC servono solo git e GitHub CLI.
//   2. Su questo PC: compila l'installer per il sistema che stai usando.
// =============================================================================
import { spawnSync, execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { stdin, stdout, exit, platform, env } from 'node:process';
import { fileURLToPath } from 'node:url';

const WIN = platform === 'win32';
const LINUX = platform === 'linux';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);
const OUT = join(ROOT, 'installer');
const DRY = process.argv.includes('--dry-run'); // mostra cosa farebbe senza installare

const rl = createInterface({ input: stdin, output: stdout });
let rlClosed = false;
rl.on('close', () => (rlClosed = true));
/** Come rl.question, ma se l'input è chiuso (es. pipe esaurita) usa la risposta predefinita. */
function ask(q) {
  if (rlClosed) return Promise.resolve('');
  return new Promise((resolve) => {
    const onClose = () => resolve('');
    rl.once('close', onClose);
    rl.question(q).then((a) => {
      rl.off('close', onClose);
      resolve(a);
    }, () => resolve(''));
  });
}
const tty = stdout.isTTY;
const c = {
  b: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  ok: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  warn: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
  err: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  acc: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
};
let stepN = 0;
const title = (s) => console.log(`\n${c.acc(`[${++stepN}]`)} ${c.b(s)}`);
const ok = (s) => console.log(`    ${c.ok('✓')} ${s}`);
const miss = (s) => console.log(`    ${c.warn('•')} ${s}`);
const info = (s) => console.log(`    ${c.dim(s)}`);
function die(s) {
  console.error(`\n${c.err('✗')} ${s}\n`);
  rl.close();
  exit(1);
}

async function yes(q, def = true) {
  const a = (await ask(`    ${q} ${c.dim(def ? '[S/n]' : '[s/N]')} `)).trim().toLowerCase();
  if (!a) return def;
  return a.startsWith('s') || a.startsWith('y');
}
async function choose(q, options) {
  options.forEach((o, i) => console.log(`    ${c.b(String(i + 1))}. ${o}`));
  for (;;) {
    const a = (await ask(`    ${q} ${c.dim('[1]')} `)).trim() || '1';
    const n = Number(a);
    if (n >= 1 && n <= options.length) return n - 1;
  }
}

/** Esegue un comando mostrando l'output. */
function run(cmd, args = [], opts = {}) {
  info(`$ ${cmd} ${args.join(' ')}`);
  if (DRY) return true;
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: WIN, ...opts });
  return r.status === 0;
}
/** Esegue e restituisce l'output (null se fallisce). */
function out(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: WIN, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}
const has = (cmd, args = ['--version']) => out(cmd, args) !== null;

/** Windows: dopo un'installazione il PATH del processo è vecchio, lo rileggiamo dal registro. */
function refreshPath() {
  if (WIN) {
    const p = out('powershell', [
      '-NoProfile',
      '-Command',
      "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
    ], { shell: false });
    if (p) env.Path = env.PATH = p;
  }
  const cargoBin = join(homedir(), '.cargo', 'bin');
  const sep = WIN ? ';' : ':';
  if (existsSync(cargoBin) && !(env.PATH ?? '').includes(cargoBin)) env.PATH = env.Path = `${cargoBin}${sep}${env.PATH}`;
}

// ---- gestori di pacchetti -----------------------------------------------------
function linuxDistro() {
  try {
    const os = readFileSync('/etc/os-release', 'utf8');
    const id = (os.match(/^ID=(.*)$/m)?.[1] ?? '').replace(/"/g, '');
    const like = (os.match(/^ID_LIKE=(.*)$/m)?.[1] ?? '').replace(/"/g, '');
    const all = `${id} ${like}`;
    if (/fedora|rhel|centos/.test(all)) return 'fedora';
    if (/debian|ubuntu/.test(all)) return 'debian';
    if (/arch/.test(all)) return 'arch';
  } catch {
    /* */
  }
  return 'other';
}
const DISTRO = LINUX ? linuxDistro() : null;

function pkgInstall(pkgs) {
  if (WIN) {
    for (const [id, extra] of pkgs) {
      const args = ['install', '-e', '--id', id, '--accept-source-agreements', '--accept-package-agreements'];
      if (extra) args.push(...extra);
      if (!run('winget', args)) return false;
    }
    refreshPath();
    return true;
  }
  const names = pkgs.map((p) => p[0]);
  if (DISTRO === 'fedora') return run('sudo', ['dnf', 'install', '-y', ...names]);
  if (DISTRO === 'debian') return run('sudo', ['apt-get', 'install', '-y', ...names]);
  if (DISTRO === 'arch') return run('sudo', ['pacman', '-S', '--needed', '--noconfirm', ...names]);
  return false;
}

/**
 * Requisito: controlla, e se manca spiega, chiede il permesso e installa.
 * @param {{name:string, why:string, size?:string, check:()=>boolean, pkgs?:Array<[string, string[]?]>, install?:()=>boolean, manual?:string}} r
 */
async function need(r) {
  if (r.check()) return ok(r.name);
  miss(`${c.b(r.name)} non trovato — ${r.why}${r.size ? c.dim(` (${r.size})`) : ''}`);
  const canAuto = r.install || (r.pkgs && (WIN ? has('winget', ['--version']) : DISTRO !== 'other'));
  if (!canAuto) die(`Installa ${r.name} a mano: ${r.manual ?? ''}\n  Poi rilancia il wizard.`);
  if (!(await yes(`Lo installo io?`))) die(`${r.name} serve per continuare. ${r.manual ? `Link: ${r.manual}` : ''}`);
  const done = r.install ? r.install() : pkgInstall(r.pkgs);
  refreshPath();
  if (DRY) return ok(`${r.name} (dry-run)`);
  if (!done || !r.check()) {
    die(
      `Installazione di ${r.name} non riuscita.${WIN ? ' Se è appena finita, chiudi questa finestra e rilancia Setup.cmd (serve un terminale nuovo).' : ''}${r.manual ? `\n  Manuale: ${r.manual}` : ''}`,
    );
  }
  ok(`${r.name} installato`);
}

// ---- requisiti ----------------------------------------------------------------
const REQ = {
  git: {
    name: 'git',
    why: 'serve per pubblicare il progetto su GitHub',
    check: () => has('git'),
    pkgs: WIN ? [['Git.Git']] : [['git']],
    manual: 'https://git-scm.com/downloads',
  },
  gh: {
    name: 'GitHub CLI',
    why: 'crea il repo e avvia la build nel cloud',
    check: () => has('gh'),
    pkgs: WIN ? [['GitHub.cli']] : [['gh']],
    manual: 'https://cli.github.com',
  },
  rust: {
    name: 'Rust',
    why: 'compila l’app Windows (Tauri)',
    size: '~1 GB',
    check: () => has('cargo') && has('rustc'),
    // rustup da winget, poi la toolchain stabile (senza, cargo non parte).
    install: () => pkgInstall([['Rustlang.Rustup']]) && (refreshPath(), run('rustup', ['default', 'stable-msvc'])),
    manual: 'https://rustup.rs',
  },
  msvc: {
    name: 'Visual Studio Build Tools (C++)',
    why: 'il compilatore C++ che serve a Rust su Windows',
    size: '~3–6 GB, chiede i permessi di amministratore',
    check: () => {
      const vswhere = join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
      if (!existsSync(vswhere)) return false;
      const r = out(`"${vswhere}"`, ['-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
      return !!r;
    },
    pkgs: [
      [
        'Microsoft.VisualStudio.2022.BuildTools',
        ['--override', '"--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'],
      ],
    ],
    manual: 'https://visualstudio.microsoft.com/visual-cpp-build-tools/ (spunta “Sviluppo di applicazioni desktop con C++”)',
  },
  webview2: {
    name: 'WebView2 Runtime',
    why: 'il motore che mostra l’interfaccia su Windows',
    check: () => {
      const keys = [
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      ];
      return keys.some((k) => out('reg', ['query', k, '/v', 'pv']) !== null);
    },
    pkgs: [['Microsoft.EdgeWebView2Runtime']],
    manual: 'https://developer.microsoft.com/microsoft-edge/webview2/',
  },
  rpmbuild: {
    name: 'rpm-build',
    why: 'crea il pacchetto .rpm per Fedora',
    check: () => has('rpmbuild'),
    pkgs: [[DISTRO === 'fedora' ? 'rpm-build' : 'rpm']],
  },
};

// ---- passi ------------------------------------------------------------------
async function ghLogin() {
  if (out('gh', ['auth', 'status']) !== null) {
    // Serve il permesso "workflow" per caricare le GitHub Actions.
    const scopes = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', shell: WIN });
    if (!/workflow/.test(`${scopes.stdout}${scopes.stderr}`)) {
      info('Serve un permesso in più su GitHub (workflow): si apre il browser per confermarlo.');
      run('gh', ['auth', 'refresh', '-h', 'github.com', '-s', 'workflow']);
    }
    ok(`GitHub: ${out('gh', ['api', 'user', '--jq', '.login']) ?? 'collegato'}`);
    return;
  }
  miss('Non sei collegato a GitHub.');
  info('Si apre il browser: accedi e conferma il codice che compare qui.');
  if (!(await yes('Procedo con il login?'))) die('Il login a GitHub serve per la build nel cloud.');
  if (!run('gh', ['auth', 'login', '--web', '--git-protocol', 'https', '-h', 'github.com', '--scopes', 'workflow'])) die('Login a GitHub non riuscito.');
  run('gh', ['auth', 'setup-git']);
}

function npmInstall(skipElectron) {
  const e = { ...env };
  if (skipElectron) e.ELECTRON_SKIP_BINARY_DOWNLOAD = '1';
  const cmd = existsSync('package-lock.json') ? 'ci' : 'install';
  if (!run('npm', [cmd, '--no-audit', '--no-fund'], { env: e })) die('npm install non riuscito.');
}

function collect(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => join(dir, f));
}

function openFolder(dir) {
  if (DRY) return;
  if (WIN) spawnSync('explorer', [dir], { stdio: 'ignore' });
  else if (LINUX) spawnSync('xdg-open', [dir], { stdio: 'ignore' });
}

async function buildWindowsHere() {
  title('Strumenti per compilare su Windows');
  await need(REQ.webview2);
  await need(REQ.msvc);
  await need(REQ.rust);

  title('Dipendenze del progetto');
  npmInstall(true);
  ok('Dipendenze installate');

  title('Compilazione (la prima volta ~5–10 minuti)');
  // Con le chiavi dell'updater (create da `npm run setup`) firmiamo anche l'aggiornamento;
  // senza, si crea solo l'installer.
  const key = join('.cerchio-secrets', 'updater.key');
  const localConf = join(ROOT, 'src-tauri', 'tauri.local.conf.json');
  const e = { ...env };
  const extra = ['--bundles', 'nsis'];
  const state = existsSync('.cerchio-secrets/state.json') ? JSON.parse(readFileSync('.cerchio-secrets/state.json', 'utf8')) : {};
  if (existsSync(key) && state.keyPass) {
    e.TAURI_SIGNING_PRIVATE_KEY = readFileSync(key, 'utf8');
    e.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = state.keyPass;
  } else {
    writeFileSync(localConf, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
    extra.push('--config', `"${localConf}"`);
    info('Chiavi dell’updater non trovate: creo l’installer senza aggiornamenti automatici.');
  }
  const okBuild = run('npx', ['tauri', 'build', ...extra], { env: e });
  rmSync(localConf, { force: true });
  if (!okBuild) die('Compilazione non riuscita: guarda l’errore qui sopra.');
  return collect(join('src-tauri', 'target', 'release', 'bundle', 'nsis'), ['-setup.exe']);
}

async function buildLinuxHere() {
  title('Strumenti per compilare su Linux');
  if (DISTRO === 'fedora') await need(REQ.rpmbuild);
  else ok('Niente da installare');
  title('Dipendenze del progetto');
  npmInstall(false);
  ok('Dipendenze installate');
  title('Compilazione (~2–4 minuti)');
  const targets = ['AppImage'];
  if (DISTRO === 'fedora') targets.push('rpm');
  if (DISTRO === 'debian') targets.push('deb');
  if (!run('npm', ['run', 'build'])) die('Build dell’interfaccia non riuscita.');
  if (!run('npx', ['electron-builder', '--linux', ...targets, '--publish', 'never'])) die('Compilazione non riuscita.');
  return collect('release', ['.AppImage', '.rpm', '.deb']);
}

async function buildInCloud() {
  title('Strumenti');
  await need(REQ.git);
  await need(REQ.gh);
  await ghLogin();

  title('Dipendenze del progetto');
  npmInstall(true);
  ok('Dipendenze installate');

  title('Pubblicazione su GitHub');
  if (!run('node', ['scripts/setup.mjs'])) die('Setup non riuscito: guarda l’errore qui sopra e rilancia.');
  if (DRY) return [];

  const state = JSON.parse(readFileSync('.cerchio-secrets/state.json', 'utf8'));
  const repo = `${state.ghUser}/${state.repo}`;
  const rel = `${state.ghUser}/${state.releasesRepo}`;
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

  title('Compilazione nel cloud (Windows + Linux, ~10 minuti)');
  info(`Segui anche da qui: https://github.com/${rel}/actions`);
  let runId = null;
  for (let i = 0; i < 30 && !runId && !DRY; i++) {
    runId = out('gh', ['run', 'list', '-R', rel, '--workflow', 'release.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId']);
    if (!runId) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!DRY && !runId) die('Non trovo la build su GitHub Actions. Controlla il link qui sopra.');
  if (!run('gh', ['run', 'watch', String(runId), '-R', rel, '--exit-status', '--interval', '15'])) {
    die(`La build nel cloud è fallita: apri https://github.com/${rel}/actions per vedere l’errore.`);
  }
  ok('Build completata');

  mkdirSync(OUT, { recursive: true });
  run('gh', ['release', 'download', `v${version}`, '-R', rel, '--dir', OUT, '--clobber', '--pattern', '*-setup.exe', '--pattern', '*.AppImage', '--pattern', '*.rpm', '--pattern', '*.deb']);
  console.log(`\n    Link da mandare ai tuoi amici: ${c.b(`https://github.com/${rel}/releases/latest`)}`);
  return collect(OUT, ['.exe', '.AppImage', '.rpm', '.deb']);
}

// ---- main -------------------------------------------------------------------
console.log(c.b('\n  Paper — installazione guidata'));
console.log(c.dim(`  Sistema: ${WIN ? 'Windows' : LINUX ? `Linux (${DISTRO})` : platform}${DRY ? ' · DRY-RUN' : ''}`));

const cfg = JSON.parse(readFileSync('cerchio.config.json', 'utf8'));
if (!cfg.supabaseUrl) info('Supabase non ancora configurato: lo farà la modalità cloud (`npm run setup`).');

title('Come vuoi creare l’installer?');
const here = WIN ? 'l’.exe per Windows' : 'AppImage + ' + (DISTRO === 'fedora' ? '.rpm' : DISTRO === 'debian' ? '.deb' : 'pacchetto') + ' per Linux';
const mode = await choose('Scelta', [
  `${c.b('Nel cloud')} (consigliato) — GitHub compila Windows e Linux, sul PC servono solo git e GitHub CLI. Crea anche il link per gli amici e gli aggiornamenti automatici.`,
  `${c.b('Su questo PC')} — crea ${here}.${WIN ? ' Installa Rust e Visual Studio Build Tools (diversi GB).' : ''}`,
]);

let files = [];
if (mode === 0) files = await buildInCloud();
else if (WIN) files = await buildWindowsHere();
else if (LINUX) files = await buildLinuxHere();
else die('Su questo sistema usa la modalità cloud.');

if (mode === 1) {
  mkdirSync(OUT, { recursive: true });
  for (const f of files) if (!DRY) copyFileSync(f, join(OUT, basename(f)));
}
const final = DRY ? files : collect(OUT, ['.exe', '.AppImage', '.rpm', '.deb']);

title('Fatto');
if (final.length) {
  for (const f of final) ok(basename(f));
  console.log(`\n    Li trovi nella cartella ${c.b(OUT)}`);
  if (WIN) console.log(c.dim('    Al primo avvio SmartScreen può avvisare: “Ulteriori informazioni” → “Esegui comunque”.'));
  if (await yes('Apro la cartella?')) openFolder(OUT);
} else if (!DRY) {
  miss('Nessun file trovato nella cartella installer.');
}
rl.close();
