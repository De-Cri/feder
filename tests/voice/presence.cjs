// Lobby presence: updates close together, duplicate states, "call" sound.
// Since 0009 the lobby (read by every member, public ones too) carries only online + mic/deaf:
// which call you're in comes from the room registry, visible only to who can see the room.
// The lobby mechanics are exercised by toggling "deaf".
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
  const seen = () => pages.b.evaluate(() => (window.app.online.a ? window.app.online.a.deaf : 'assente'));
  const setDeaf = (v) => pages.a.evaluate((v) => { window.app.myPresence.deaf = v; window.app.publishPresence(); }, v);
  assert((await seen()) === false, 'b vede a online, audio attivo');

  // a joins channel 3: the lobby doesn't say where, the registry does; for b (outside voice) it's a "call"
  await pages.a.evaluate(async () => {
    window.app.myPresence.voice = 3;
    window.app.publishPresence();
    await window.supabase.rpc('voice_join', { p_channel: 3 });
  });
  await sleep(400);
  const lobbyVoice = await pages.b.evaluate(() => window.app['lobby'].presenceState().a.map((m) => m.voice));
  assert(lobbyVoice.every((v) => v === null), 'la lobby non rivela in che canale è a');
  assert((await pages.b.evaluate(() => window.app.inVoice(3).some((p) => p.user_id === 'a'))), 'b vede a nel canale 3 (dal registro)');
  assert((await pages.b.evaluate(() => window.soundLog.includes('call'))), 'b sente il suono di chiamata');

  // a turns the webcam on: b sees it through the registry, not the lobby
  await pages.a.evaluate(() => { window.app.myPresence.cam = true; window.app.publishRoomState(); });
  await sleep(500);
  assert((await pages.b.evaluate(() => window.app.presence.a?.cam === true)), 'b vede la webcam di a (dal registro)');
  assert((await pages.b.evaluate(() => window.app['lobby'].presenceState().a.every((m) => !m.cam))), 'la lobby non rivela la webcam');

  // burst: true → false → true → false (like toggling quickly)
  await pages.a.evaluate(() => {
    const ap = window.app;
    for (const v of [true, false, true, false]) { ap.myPresence.deaf = v; ap.publishPresence(); }
  });
  await sleep(600);
  assert((await seen()) === false, 'dopo la raffica b vede lo stato finale di a (niente fantasma)');
  const metas = await pages.b.evaluate(() => window.app['lobby'].presenceState().a.length);
  assert(metas === 2, 'stati duplicati presenti nel mock (scenario reale riprodotto)');
  // The server "loses" a after updates too close together: a must reappear by itself.
  for (const u of ['a', 'b']) await pages[u].goto(`http://localhost:5199/?u=${u}&drop=1`);
  for (const u of ['a', 'b']) { await pages[u].waitForFunction(() => !!window.app); await pages[u].evaluate(() => window.app.subscribe()); }
  await sleep(500);
  await pages.a.evaluate(() => { const ap = window.app; ap.myPresence.deaf = true; ap.publishPresence(); setTimeout(() => { ap.myPresence.deaf = false; ap.myPresence.mic = false; ap.publishPresence(); }, 50); });
  await sleep(200);
  const lost = await pages.b.evaluate(() => !('a' in window.app['lobby'].presenceState()));
  assert(lost, 'scenario riprodotto: il server ha perso a');
  const selfMic = await pages.a.evaluate(() => window.app.online.a?.mic);
  assert(selfMic === false, 'a vede comunque il proprio stato giusto');
  await sleep(2000);
  assert((await pages.b.evaluate(() => window.app.online.a?.mic)) === false, 'a ricompare da solo per b, con lo stato giusto');
  // The server keeps a stale state (ignores the update): it must fix itself.
  for (const u of ['a', 'b']) await pages[u].goto(`http://localhost:5199/?u=${u}&stale=1`);
  for (const u of ['a', 'b']) { await pages[u].waitForFunction(() => !!window.app); await pages[u].evaluate(() => window.app.subscribe()); }
  await sleep(800);
  await setDeaf(true);
  await pages.a.evaluate(() => setTimeout(() => { window.app.myPresence.deaf = false; window.app.publishPresence(); }, 50));
  await sleep(250);
  assert((await seen()) === true, 'scenario riprodotto: per b a è rimasto nello stato vecchio');
  await sleep(2500);
  assert((await seen()) === false, 'lo stato vecchio si corregge da solo');
  await b.close();
  console.log('\nPRESENCE PASSED');
})();
