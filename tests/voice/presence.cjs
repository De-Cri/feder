// Presenza nella lobby: aggiornamenti ravvicinati, stati duplicati, suono "chiamata".
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const pages = {};
  for (const u of ['a', 'b']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`[${u}]`, e.message));
    await p.goto(`http://localhost:5199/?u=${u}&dup=1`);
    await p.waitForFunction(() => !!window.app);
    await p.evaluate(() => window.app.subscribe());
    pages[u] = p;
  }
  await sleep(500);
  const seen = () => pages.b.evaluate(() => (window.app.online.a ? window.app.online.a.voice : 'assente'));
  assert((await seen()) === null, 'b vede a online, non in vocale');

  // a entra nel canale 3: per b (fuori dal vocale) è una "chiamata"
  await pages.a.evaluate(() => { window.app.myPresence.voice = 3; window.app.publishPresence(); });
  await sleep(400);
  assert((await seen()) === 3, 'b vede a nel canale 3');
  assert((await pages.b.evaluate(() => window.soundLog.includes('call'))), 'b sente il suono di chiamata');

  // raffica: 3 → null → 4 → null (come cambiare canale e riagganciare)
  await pages.a.evaluate(() => {
    const ap = window.app;
    for (const v of [null, 4, null]) { ap.myPresence.voice = v; ap.publishPresence(); }
  });
  await sleep(600);
  assert((await seen()) === null, 'dopo la raffica b vede a fuori dal vocale (niente fantasma)');
  const metas = await pages.b.evaluate(() => window.app['lobby'].presenceState().a.length);
  assert(metas === 2, 'stati duplicati presenti nel mock (scenario reale riprodotto)');
  // Il server "perde" a dopo aggiornamenti troppo ravvicinati: a deve ricomparire da solo.
  for (const u of ['a', 'b']) await pages[u].goto(`http://localhost:5199/?u=${u}&drop=1`);
  for (const u of ['a', 'b']) { await pages[u].waitForFunction(() => !!window.app); await pages[u].evaluate(() => window.app.subscribe()); }
  await sleep(500);
  await pages.a.evaluate(() => { const ap = window.app; ap.myPresence.voice = 3; ap.publishPresence(); setTimeout(() => { ap.myPresence.voice = 4; ap.publishPresence(); }, 50); });
  await sleep(200);
  const lost = await pages.b.evaluate(() => !('a' in window.app['lobby'].presenceState()));
  assert(lost, 'scenario riprodotto: il server ha perso a');
  const selfVoice = await pages.a.evaluate(() => window.app.online.a?.voice);
  assert(selfVoice === 4, 'a vede comunque se stesso nel canale giusto');
  await sleep(2000);
  assert((await seen()) === 4, 'a ricompare da solo per b, nel canale 4');
  // Il server tiene uno stato vecchio (ignora l'aggiornamento): deve correggersi da solo.
  for (const u of ['a', 'b']) await pages[u].goto(`http://localhost:5199/?u=${u}&stale=1`);
  for (const u of ['a', 'b']) { await pages[u].waitForFunction(() => !!window.app); await pages[u].evaluate(() => window.app.subscribe()); }
  await sleep(800);
  await pages.a.evaluate(() => { const ap = window.app; ap.myPresence.voice = 3; ap.publishPresence(); setTimeout(() => { ap.myPresence.voice = 4; ap.publishPresence(); }, 50); });
  await sleep(250);
  assert((await seen()) === 3, 'scenario riprodotto: per b a è rimasto nel canale vecchio');
  assert((await pages.a.evaluate(() => window.app.inVoice(4).some((p) => p.user_id === 'a'))), 'a si vede subito nel canale giusto');
  await sleep(2500);
  assert((await seen()) === 4, 'lo stato vecchio si corregge da solo');
  await b.close();
  console.log('\nPRESENCE PASSED');
})();
