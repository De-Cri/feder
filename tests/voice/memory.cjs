// Memory-leak hunt: repeats screen and webcam N times (on/off, on both sides)
// and checks that nothing is left behind after each round: transceivers, AudioContexts,
// <video>/<audio>, DOM nodes, listeners, JS heap (after garbage collection) and process RAM.
//
//   npm run test:memory              10 rounds
//   npm run test:memory -- 30        30 rounds
// The test server starts by itself. Exits with an error (saying what grows) if it finds a leak.
const { chromium } = require('playwright');
const startServer = require('./server.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CYCLES = Number(process.argv[2] ?? 10);
const MB = 1024 * 1024;

// Counts live AudioContexts (created and not yet closed) and open media tracks.
const probe = () => {
  const AC = window.AudioContext;
  window.__ac = 0;
  window.AudioContext = class extends AC {
    constructor(...a) { super(...a); window.__ac++; }
    close() { if (this.state !== 'closed') window.__ac--; return super.close(); }
  };
};

(async () => {
  const stopServer = await startServer();
  const { measure } = await import('../../scripts/mem.mjs');
  const b = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--js-flags=--expose-gc'],
  });
  const ctx = await b.newContext({ permissions: ['microphone', 'camera'] });
  await ctx.addInitScript(probe);
  const pages = {};
  for (const u of ['a', 'b']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(u, 'pageerror', e.message));
    await p.goto(`http://localhost:5199/?u=${u}&ui=1`);
    await p.waitForFunction(() => !!window.voice);
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Performance.enable');
    pages[u] = { p, cdp };
  }
  for (const u of ['a', 'b']) await pages[u].p.evaluate(() => window.voice.join(3));
  await sleep(3000);
  // toggleScreen needs a user gesture: a button to click.
  for (const u of ['a', 'b'])
    await pages[u].p.evaluate(() => {
      const bt = document.createElement('button'); bt.id = 'scr'; bt.textContent = 'scr';
      bt.onclick = () => window.voice.toggleScreen(); document.body.prepend(bt);
    });

  const metrics = async (u) => {
    const { p, cdp } = pages[u];
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(200);
    const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const app = await p.evaluate(() => ({
      tx: Object.values(window.voice.peers).reduce((n, q) => n + q.pc.getTransceivers().length, 0),
      liveRecv: Object.values(window.voice.peers).reduce((n, q) => n + q.pc.getReceivers().filter((r) => r.track.readyState === 'live').length, 0),
      ac: window.__ac,
      video: document.querySelectorAll('video').length,
      audio: document.querySelectorAll('audio').length,
    }));
    return { heap: m.JSHeapUsedSize, nodes: m.Nodes, listeners: m.JSEventListeners, ...app };
  };
  const both = async () => ({ a: await metrics('a'), b: await metrics('b'), ram: measure(process.pid, /chrom|headless/i).uss });

  const cycle = async () => {
    for (const u of ['a', 'b']) {
      await pages[u].p.click('#scr'); await sleep(1500); // screen on, the other side receives it
      await pages[u].p.click('#scr'); await sleep(800);
      await pages[u].p.evaluate(() => window.voice.toggleCam()); await sleep(1500);
      await pages[u].p.evaluate(() => window.voice.toggleCam()); await sleep(800);
    }
  };

  // Two warm-up rounds (caches, codecs, first negotiation), then the baseline.
  await cycle(); await cycle(); await sleep(1500);
  const base = await both();
  const row = (i, s) =>
    console.log(
      `${String(i).padStart(4)}  ${(s.ram / MB).toFixed(0).padStart(5)} MB  ` +
        ['a', 'b'].map((u) => {
          const x = s[u];
          return `${u}: heap ${(x.heap / MB).toFixed(1)} MB, nodi ${x.nodes}, listener ${x.listeners}, tx ${x.tx}, ricev. ${x.liveRecv}, AudioContext ${x.ac}, video ${x.video}, audio ${x.audio}`;
        }).join(' | '),
    );
  console.log(`giro   RAM proc.  (dopo GC)`);
  row('base', base);
  let last = base;
  for (let i = 1; i <= CYCLES; i++) {
    await cycle(); await sleep(1500);
    last = await both();
    row(i, last);
  }

  // What counts as a leak: something that grows with the number of rounds.
  const fails = [];
  for (const u of ['a', 'b']) {
    const d = (k) => last[u][k] - base[u][k];
    if (d('tx') > 0) fails.push(`${u}: transceiver +${d('tx')}`);
    if (d('liveRecv') > 0) fails.push(`${u}: ricevitori vivi +${d('liveRecv')}`);
    if (d('ac') > 0) fails.push(`${u}: AudioContext +${d('ac')}`);
    if (d('video') > 0 || d('audio') > 0) fails.push(`${u}: elementi <video> +${d('video')}, <audio> +${d('audio')}`);
    if (d('nodes') > 300) fails.push(`${u}: nodi DOM +${d('nodes')}`);
    if (d('listeners') > 100) fails.push(`${u}: listener +${d('listeners')}`);
    if (d('heap') > 8 * MB) fails.push(`${u}: heap JS +${(d('heap') / MB).toFixed(1)} MB`);
  }
  const ram = (last.ram - base.ram) / MB;
  console.log(`\nRAM dei processi (browser di test, 2 utenti): ${ram >= 0 ? '+' : ''}${ram.toFixed(0)} MB in ${CYCLES} giri` +
    ' (indicativa: Chromium restituisce la memoria al sistema con calma)');
  await b.close();
  await stopServer();
  if (fails.length) {
    console.error('FAIL: cresce a ogni giro →\n  ' + fails.join('\n  '));
    process.exit(1);
  }
  console.log('ok - nessuna crescita dopo', CYCLES, 'giri');
})();
