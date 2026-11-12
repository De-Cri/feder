// Supabase limit: max 5 track() every 30 s per client; beyond that the server CLOSES the channel
// (ClientPresenceRateLimitReached) and the sidebar stops updating.
// The mock applies the same limit.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const open = async (u) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`[${u}] pageerror`, e.message));
    await p.goto(`http://localhost:5199/?u=${u}`);
    await p.waitForFunction(() => !!window.app);
    await p.evaluate(() => window.app.subscribe());
    return p;
  };
  const a = await open('a');
  const b2 = await open('b');
  await sleep(500);
  const seen = (p, who) => p.evaluate((w) => { const x = window.app.online[w]; return x ? `${x.voice}/${x.mic}` : 'assente'; }, who);
  const lobby = (p) => p.evaluate(() => { const l = window.app['lobby']; return { closed: !!l?.closedByServer, tracks: l?.trackCount ?? -1, joined: window.app['lobbyJoined'] }; });

  // 1. Join voice and toggle the microphone 10 times in 5 s (like someone fiddling).
  await a.evaluate(() => { window.app.myPresence.voice = 3; window.app.publishPresence(); });
  for (let i = 0; i < 10; i++) {
    await a.evaluate((on) => { window.app.myPresence.mic = on; window.app.publishPresence(); }, i % 2 === 1);
    await sleep(500);
  }
  let st = await lobby(a);
  assert(!st.closed, `raffica di aggiornamenti: il server NON chiude il canale (track: ${st.tracks})`);
  // the last state (mic on) arrives as soon as the limit allows
  let final = '';
  for (let i = 0; i < 80 && final !== '3/true'; i++) { await sleep(500); final = await seen(b2, 'a'); }
  assert(final === '3/true', `b vede lo stato finale di a (${final})`);

  // 2. Same person on two devices: one in a call, the other not.
  const a2 = await open('a');
  await sleep(1000);
  const t0 = (await lobby(a)).tracks + (await lobby(a2)).tracks;
  const samples = [];
  for (let i = 0; i < 16; i++) { await sleep(500); samples.push(await seen(b2, 'a')); }
  const t1 = (await lobby(a)).tracks + (await lobby(a2)).tracks;
  assert(samples.every((s) => s.startsWith('3/')), `due dispositivi: b vede sempre a in chiamata (${[...new Set(samples)].join(', ')})`);
  assert(t1 - t0 <= 2, `due dispositivi: niente ping-pong di aggiornamenti (${t1 - t0} in 8 s)`);
  assert(!(await lobby(a)).closed && !(await lobby(a2)).closed, 'due dispositivi: nessun canale chiuso dal server');
  await a2.close();
  await sleep(500);

  // 3. The server closes the channel (network, limit, etc.): the app reconnects by itself.
  await a.evaluate(() => window.app['lobby'].serverClose());
  await sleep(300);
  // (the closed a2 page doesn't send "leave" in the mock: b may still see its out-of-call state)
  assert(!(await seen(b2, 'a')).startsWith('3/'), 'canale chiuso: per b, a non è più in chiamata');
  await a.evaluate(() => { window.app.myPresence.voice = 4; window.app.publishPresence(); });
  let back = '';
  for (let i = 0; i < 80 && !back.startsWith('4/'); i++) { await sleep(500); back = await seen(b2, 'a'); }
  assert(back.startsWith('4/'), `dopo la chiusura a si ricollega e b lo vede nel canale 4 (${back})`);
  st = await lobby(a);
  assert(!st.closed && st.joined, 'a ha di nuovo un canale lobby attivo');

  await b.close();
  console.log('\nLIMITS PASSED');
})();
