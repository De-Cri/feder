#!/usr/bin/env node
// How much RAM Feder really uses, adding up ALL its processes (like Task Manager).
//
//   npm run mem                 samples every 2 s until you press Ctrl+C, then a summary
//   npm run mem -- --every 5    every 5 s
//   npm run mem -- --for 300    for 300 s, then it stops by itself
//   npm run mem -- --once       a single measurement
//   npm run mem -- --pid 1234   measures the process tree starting at that PID
//
// Linux (Electron): adds up each process's PRIVATE memory (USS, from /proc/<pid>/smaps_rollup),
//   plus PSS (private + share of the shared parts). `top`'s RSS counts libraries shared
//   between processes several times: that's why it looks higher.
// Windows (Tauri): Feder.exe + the msedgewebview2.exe processes it opens (page, GPU, audio, network…).
//   Shows the "private working set", the same number as Task Manager's Memory column.
//
// Also writes a CSV to mem-YYYY-MM-DD-hhmmss.csv to compare runs.
import { readFileSync, readdirSync, readlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MB = 1024 * 1024;
const NAMES = /^(feder|paper|cerchio)(\.exe)?$/i; // the app's names, including the old ones

/** Chromium process type from the command line (--type=…, --utility-sub-type=…). */
function kind(cmd) {
  const t = /--type=([\w-]+)/.exec(cmd)?.[1];
  if (!t) return 'principale';
  if (t === 'utility') {
    const sub = /--utility-sub-type=([\w.]+)/.exec(cmd)?.[1] ?? '';
    if (/audio/i.test(sub)) return 'audio';
    if (/video_capture/i.test(sub)) return 'webcam/schermo';
    if (/network/i.test(sub)) return 'rete';
    return 'utility';
  }
  if (t === 'renderer') return 'pagina';
  if (t === 'gpu-process') return 'gpu';
  if (t === 'zygote') return 'zygote';
  if (t === 'crashpad-handler') return 'crashpad';
  return t;
}

// ---- Linux -----------------------------------------------------------------
function linuxProcs() {
  const all = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
      let exe = '';
      try {
        exe = readlinkSync(`/proc/${d}/exe`);
      } catch {
        /* another user's process */
      }
      all.push({ pid: Number(d), ppid, cmd, exe });
    } catch {
      /* process just ended */
    }
  }
  return all;
}

function linuxMem(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(s)?.[1] ?? 0) * 1024;
    return { uss: kb('Private_Clean') + kb('Private_Dirty'), pss: kb('Pss') };
  } catch {
    return null;
  }
}

// ---- Windows ---------------------------------------------------------------
const PS = `
$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine
$w = @{}; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object { $w[[int]$_.IDProcess] = [int64]$_.WorkingSetPrivate }
$p | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; cmd=$_.CommandLine; priv=$w[[int]$_.ProcessId] } } | ConvertTo-Json -Compress`;

function windowsProcs() {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], {
    encoding: 'utf8',
    maxBuffer: 64 * MB,
    windowsHide: true,
  });
  return JSON.parse(out).map((p) => ({ pid: p.pid, ppid: p.ppid, cmd: p.cmd ?? p.name ?? '', exe: p.name ?? '', priv: p.priv ?? 0 }));
}

// ---- common ----------------------------------------------------------------
const win = process.platform === 'win32';

/** The roots: the app's main processes (or the given PID), then all descendants. */
function tree(all, rootPid) {
  const base = (p) => (p.exe || p.cmd.split(' ')[0]).split(/[\\/]/).pop();
  const roots = rootPid
    ? all.filter((p) => p.pid === rootPid)
    : all.filter((p) => NAMES.test(base(p)) && !all.some((q) => q.pid === p.ppid && NAMES.test(base(q))));
  const ids = new Set(roots.map((p) => p.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of all) if (!ids.has(p.pid) && ids.has(p.ppid)) (ids.add(p.pid), (grew = true));
  }
  return all.filter((p) => ids.has(p.pid));
}

/** `only`: keeps only processes whose command line matches (e.g. the test browser). */
export function measure(rootPid, only) {
  const procs = tree(win ? windowsProcs() : linuxProcs(), rootPid).filter((p) => !only || only.test(p.cmd));
  const rows = [];
  for (const p of procs) {
    const m = win ? { uss: p.priv, pss: p.priv } : linuxMem(p.pid);
    if (m) rows.push({ pid: p.pid, kind: kind(p.cmd), ...m });
  }
  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + r.uss;
  return {
    procs: rows.length,
    uss: rows.reduce((a, r) => a + r.uss, 0),
    pss: rows.reduce((a, r) => a + r.pss, 0),
    byKind,
  };
}

// ---- command line ----------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mem.mjs')) {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const every = Number(arg('--every') ?? 2) * 1000;
  const total = Number(arg('--for') ?? 0) * 1000;
  const once = process.argv.includes('--once');
  const rootPid = arg('--pid') ? Number(arg('--pid')) : undefined;
  const mb = (b) => (b / MB).toFixed(0).padStart(5);

  const first = measure(rootPid);
  if (!first.procs) {
    console.error('Feder non è in esecuzione (o --pid sbagliato).');
    process.exit(1);
  }
  const kinds = Object.keys(first.byKind).sort();
  const csv = `mem-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}.csv`;
  if (!once) writeFileSync(csv, ['ora', 'secondi', 'processi', 'privata_MB', 'pss_MB', ...kinds.map((k) => `${k}_MB`)].join(',') + '\n');

  const label = win ? 'privata (Task Manager)' : 'privata (USS)';
  console.log(`Feder — ${first.procs} processi. Colonne in MB. "${label}" è il numero da guardare.\n`);
  console.log(['  ora   ', '  privata', win ? '' : '    PSS', ...kinds.map((k) => k.slice(0, 14).padStart(15))].join(''));

  const start = Date.now();
  const samples = [];
  const tick = () => {
    const m = measure(rootPid);
    samples.push(m.uss);
    const now = new Date();
    const t = now.toTimeString().slice(0, 8);
    console.log([t, `   ${mb(m.uss)}`, win ? '' : `  ${mb(m.pss)}`, ...kinds.map((k) => mb(m.byKind[k] ?? 0).padStart(15))].join(''));
    if (!once)
      appendFileSync(
        csv,
        [now.toISOString(), ((Date.now() - start) / 1000).toFixed(0), m.procs, (m.uss / MB).toFixed(1), (m.pss / MB).toFixed(1), ...kinds.map((k) => ((m.byKind[k] ?? 0) / MB).toFixed(1))].join(',') + '\n',
      );
  };
  const summary = () => {
    if (samples.length > 1) {
      const min = Math.min(...samples), max = Math.max(...samples);
      const head = samples.slice(0, Math.max(1, samples.length >> 2));
      const tail = samples.slice(-Math.max(1, samples.length >> 2));
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const drift = avg(tail) - avg(head);
      console.log(`\n${samples.length} misure: min ${mb(min).trim()} MB, max ${mb(max).trim()} MB.`);
      console.log(`Differenza fra il primo e l'ultimo quarto: ${drift >= 0 ? '+' : ''}${(drift / MB).toFixed(0)} MB` +
        (drift > 30 * MB ? '  ← sale: possibile perdita di memoria, ripeti la stessa azione e guarda se continua a salire' : ''));
      console.log(`Dati salvati in ${csv}`);
    }
    process.exit(0);
  };
  tick();
  if (once) process.exit(0);
  const timer = setInterval(() => {
    tick();
    if (total && Date.now() - start >= total) (clearInterval(timer), summary());
  }, every);
  process.on('SIGINT', summary);
}
