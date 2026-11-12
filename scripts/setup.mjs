#!/usr/bin/env node
// =============================================================================
// Feder — automatic setup (run once)
//
//   npm install
//   npm run setup
//
// Does everything by itself:
//   1. creates the Supabase project (Frankfurt region) or uses an existing one
//   2. applies the schema (tables, RLS, storage, realtime)
//   3. disables email confirmation (no emails to send)
//   4. creates your admin account and sets the server password
//   5. generates the keys for automatic updates
//   6. creates the public GitHub repo, sets the secrets and publishes v0.1.0
//
// Requires: Node 20+, git, GitHub CLI (after `gh auth login`), a Supabase account.
// Progress is saved in .cerchio-secrets/ (ignored by git): if something
// stops halfway, run it again and it resumes where it left off.
// =============================================================================
import { createInterface } from 'node:readline/promises';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { stdin, stdout, exit } from 'node:process';

const API = 'https://api.supabase.com/v1';
const SECRETS = '.cerchio-secrets';
const STATE_FILE = `${SECRETS}/state.json`;
const rl = createInterface({ input: stdin, output: stdout });

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, ok: (s) => `\x1b[32m${s}\x1b[0m`, err: (s) => `\x1b[31m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
const step = (s) => console.log(`\n${c.b('›')} ${s}`);
const done = (s) => console.log(`  ${c.ok('✓')} ${s}`);
const fail = (s) => {
  console.error(`\n${c.err('✗')} ${s}`);
  exit(1);
};

mkdirSync(SECRETS, { recursive: true });
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

async function ask(q, { def, secret = false, validate } = {}) {
  for (;;) {
    let ans;
    if (secret) {
      ans = await askHidden(`  ${q}${def ? c.dim(` (${def})`) : ''}: `);
    } else {
      ans = (await rl.question(`  ${q}${def ? c.dim(` (${def})`) : ''}: `)).trim();
    }
    if (!ans && def !== undefined) ans = def;
    const err = validate?.(ans);
    if (!err) return ans;
    console.log(`  ${c.err(err)}`);
  }
}

// Hidden input for passwords (no echo in the terminal).
async function askHidden(prompt) {
  stdout.write(prompt);
  const orig = rl._writeToOutput;
  rl._writeToOutput = (str) => {
    if (str.includes('\n') || str.includes('\r')) orig.call(rl, '\n');
  };
  try {
    return (await rl.question('')).trim();
  } finally {
    rl._writeToOutput = orig;
  }
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
}
function has(cmd) {
  return spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const e = new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

const query = (sql) => api('POST', `/projects/${state.ref}/database/query`, { query: sql });

// -----------------------------------------------------------------------------
console.log(c.b('\nPaper — setup\n'));

step('Controllo prerequisiti');
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) fail('Serve Node 20 o superiore.');
if (!has('git')) fail('git non trovato.');
if (!has('gh')) fail('GitHub CLI non trovata: installala da https://cli.github.com e fai `gh auth login`.');
try {
  sh('gh auth status');
} catch {
  fail('GitHub CLI non autenticata: esegui `gh auth login` e rilancia.');
}
state.ghUser ??= sh('gh api user --jq .login');
done(`GitHub: ${state.ghUser}`);

// If cerchio.config.json is already filled in, the Supabase backend is ready
// (schema, server password, email confirmation): go straight to GitHub.
const existingCfg = JSON.parse(readFileSync('cerchio.config.json', 'utf8'));
const preconfigured = Boolean(existingCfg.supabaseUrl && existingCfg.supabaseAnonKey);
if (preconfigured) {
  step('Supabase');
  done(`Già configurato: ${existingCfg.supabaseUrl}`);
} else {
// -----------------------------------------------------------------------------
step('Supabase');
if (!state.token) {
  console.log(c.dim('  Crea un access token su https://supabase.com/dashboard/account/tokens'));
  state.token = await ask('Supabase access token', { secret: true, validate: (v) => (v.startsWith('sbp_') ? null : 'Il token inizia con sbp_') });
  save();
}

if (!state.ref) {
  const existing = await ask('Ref di un progetto esistente (invio per crearne uno nuovo)', { def: '' });
  if (existing) {
    state.ref = existing;
  } else {
    const orgs = await api('GET', '/organizations');
    if (!orgs?.length) fail('Nessuna organizzazione Supabase trovata: creane una dalla dashboard.');
    let org = orgs[0];
    if (orgs.length > 1) {
      orgs.forEach((o, i) => console.log(`  ${i + 1}. ${o.name}`));
      const n = await ask('Organizzazione', { def: '1' });
      org = orgs[Number(n) - 1] ?? orgs[0];
    }
    state.dbPass = randomBytes(18).toString('base64url');
    const base = { name: 'cerchio', db_pass: state.dbPass, region: 'eu-central-1' };
    let project = null;
    for (const body of [
      { ...base, organization_id: org.id },
      { ...base, organization_slug: org.slug ?? org.id },
      { ...base, organization_slug: org.slug ?? org.id, region: undefined, region_selection: { type: 'specific', code: 'eu-central-1' } },
    ]) {
      try {
        project = await api('POST', '/projects', body);
        break;
      } catch (e) {
        console.log(c.dim(`  (${e.message.slice(0, 160)})`));
      }
    }
    if (project) {
      state.ref = project.id ?? project.ref;
    } else {
      console.log('  Creazione automatica non riuscita (es. limite di 2 progetti free).');
      console.log('  Crealo a mano su https://supabase.com/dashboard (region: Frankfurt) e incolla qui il ref.');
      state.ref = await ask('Ref del progetto (es. abcdefghijklmnop)', { validate: (v) => (/^[a-z0-9]{15,30}$/.test(v) ? null : 'Ref non valido') });
    }
  }
  save();
}
done(`Progetto: ${state.ref}`);

process.stdout.write('  Attendo che il database sia pronto');
for (let i = 0; ; i++) {
  const p = await api('GET', `/projects/${state.ref}`);
  if (p.status === 'ACTIVE_HEALTHY') break;
  if (i > 90) fail(`Il progetto non è pronto (stato: ${p.status}). Rilancia lo script tra qualche minuto.`);
  process.stdout.write('.');
  await sleep(5000);
}
// sometimes the SQL endpoint answers a bit after the "healthy" status
for (let i = 0; ; i++) {
  try {
    await query('select 1');
    break;
  } catch (e) {
    if (i > 24) throw e;
    process.stdout.write('.');
    await sleep(5000);
  }
}
console.log();
done('Database pronto');

if (!state.migrated) {
  const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8');
  await query(sql);
  state.migrated = true;
  save();
}
done('Schema applicato (tabelle, RLS, storage, realtime)');

if (!state.authConfigured) {
  await api('PATCH', `/projects/${state.ref}/config/auth`, {
    mailer_autoconfirm: true,
    disable_signup: false,
  });
  state.authConfigured = true;
  save();
}
done('Conferma email disattivata');

if (!state.anonKey || !state.serviceKey) {
  const keys = await api('GET', `/projects/${state.ref}/api-keys?reveal=true`);
  const find = (...names) => keys.find((k) => names.includes(k.name) || names.includes(k.type))?.api_key;
  state.anonKey = find('anon');
  state.serviceKey = find('service_role');
  if (!state.anonKey || !state.serviceKey) fail('Chiavi API non trovate nella risposta di Supabase.');
  save();
}
const url = `https://${state.ref}.supabase.co`;

// -----------------------------------------------------------------------------
step('Account admin e password del server');
if (!state.adminId) {
  const email = await ask('La tua email (per il login)', { validate: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'Email non valida') });
  const username = await ask('Il tuo username', {
    def: 'samu',
    validate: (v) => (/^[a-z0-9_.]{3,20}$/.test(v) ? null : '3–20 caratteri: minuscole, numeri, _ e .'),
  });
  const password = await ask('La tua password di login', { secret: true, validate: (v) => (v.length >= 6 ? null : 'Almeno 6 caratteri') });
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: state.serviceKey, Authorization: `Bearer ${state.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username } }),
  });
  const body = await res.json();
  if (!res.ok) fail(`Creazione admin fallita: ${JSON.stringify(body)}`);
  state.adminId = body.id;
  save();
}
if (!state.serverConfigured) {
  const serverPass = await ask('Password del server (da dare ai tuoi amici)', {
    secret: true,
    validate: (v) => (v.length >= 6 ? null : 'Almeno 6 caratteri'),
  });
  await query(`select private.configure_server(${sqlStr(serverPass)}, ${sqlStr(state.adminId)}::uuid);`);
  state.serverConfigured = true;
  save();
}
done('Admin creato e password del server impostata');

writeFileSync('cerchio.config.json', JSON.stringify({ supabaseUrl: url, supabaseAnonKey: state.anonKey, turn: false }, null, 2) + '\n');
done('cerchio.config.json scritto');
}

// -----------------------------------------------------------------------------
step('Chiavi per gli aggiornamenti automatici');
const keyPath = `${SECRETS}/updater.key`;
if (!existsSync(keyPath)) {
  state.keyPass ??= randomBytes(24).toString('base64url');
  save();
  sh(`npx --yes tauri signer generate --ci -f -w "${keyPath}" -p "${state.keyPass}"`, { stdio: 'pipe' });
}
const pubkey = readFileSync(`${keyPath}.pub`, 'utf8').trim();
state.repo ??= await ask('Nome del repo GitHub (privato, con il codice)', { def: 'cerchio' });
// The code stays private; installers go to a second, public repo that only holds
// releases (no code), so friends and updates can download them without logging in.
state.releasesRepo ??= `${state.repo}-releases`;
save();
const rel = `${state.ghUser}/${state.releasesRepo}`;
const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
conf.plugins.updater.pubkey = pubkey;
conf.plugins.updater.endpoints = [`https://github.com/${rel}/releases/latest/download/latest.json`];
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');
// Linux (Electron): updates from the same public releases repo.
writeFileSync(
  'electron-builder.yml',
  readFileSync('electron-builder.yml', 'utf8')
    .replace(/^(\s*owner:).*$/m, `$1 ${state.ghUser}`)
    .replace(/^(\s*repo:).*$/m, `$1 ${state.releasesRepo}`),
);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.repository = { type: 'git', url: `https://github.com/${state.ghUser}/${state.repo}.git` };
pkg.homepage = `https://github.com/${state.ghUser}/${state.repo}`;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
done('Updater configurato (Windows + Linux)');

// -----------------------------------------------------------------------------
step('GitHub');
if (!existsSync('.git')) sh('git init -b main');
sh('git add -A');
try {
  sh('git commit -m "Cerchio: setup iniziale"');
} catch {
  /* nothing to commit */
}
let hasRemote = true;
try {
  sh('git remote get-url origin');
} catch {
  hasRemote = false;
}
const full = `${state.ghUser}/${state.repo}`;
const ghq = (args) => spawnSync('gh', args, { encoding: 'utf8', shell: process.platform === 'win32' });
let forcePush = false;
const view = ghq(['repo', 'view', full, '--json', 'visibility,isEmpty']);
if (view.status === 0) {
  // The repo already exists: reuse it.
  const info = JSON.parse(view.stdout);
  if (info.visibility !== 'PRIVATE') {
    console.log(`  Il repo ${full} esiste ed è ${info.visibility.toLowerCase()}: il codice sarebbe visibile a tutti.`);
    if (!/^[sy]/i.test((await ask('Lo rendo privato? (s/n)', { def: 's' })) || 's')) fail('Il repo del codice deve essere privato.');
    if (ghq(['repo', 'edit', full, '--visibility', 'private', '--accept-visibility-change-consequences']).status !== 0) {
      fail(`Non riesco a renderlo privato: fallo da https://github.com/${full}/settings`);
    }
  }
  if (!info.isEmpty) {
    console.log(`  Il repo ${full} contiene già dei file (es. un README creato da GitHub).`);
    const a = await ask('Li sostituisco con il progetto Cerchio? (s/n)', { def: 'n' });
    if (!/^[sy]/i.test(a)) fail(`Rinomina o cancella ${full}, oppure rilancia e scegli un altro nome.`);
    forcePush = true;
  }
  if (!hasRemote) sh(`git remote add origin https://github.com/${full}.git`);
  done(`Uso il repo esistente ${full} (privato)`);
} else if (!hasRemote) {
  sh(`gh repo create ${state.repo} --private --source . --remote origin --description "Cerchio — chat e vocale privati"`);
}
// Public repo for installers only (no code).
if (spawnSync('gh', ['repo', 'view', rel], { stdio: 'ignore', shell: process.platform === 'win32' }).status !== 0) {
  sh(`gh repo create ${rel} --public --add-readme --description "Cerchio — download"`);
}
sh(`git push -u origin main${forcePush ? ' --force' : ''}`);
const version = conf.version;
try {
  sh(`git tag v${version}`);
} catch {
  /* tag already exists */
}
sh(`git push origin v${version}`);
done('Codice caricato nel repo privato');

// The keys and the build live in the public releases repo: only you can publish.
{
  const r = spawnSync('node', ['scripts/secure-releases.mjs'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail('Configurazione del repo delle release non riuscita.');
}
sh(`gh workflow run release.yml -R ${rel} -f ref=v${version}`);
done(`Build della v${version} avviata`);

rl.close();
console.log(`
${c.ok('Fatto!')}

  Build in corso (~10 min):  https://github.com/${rel}/actions
  Link per i tuoi amici:     https://github.com/${rel}/releases/latest

  Loro: scaricano l'installer → si registrano → inseriscono la password del server.
  Tu: accedi con la tua email (sei già admin).

  ${c.dim(`I file in ${SECRETS}/ contengono chiavi private: non condividerli e fanne un backup.`)}
`);
