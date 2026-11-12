// Server-relayed signaling (#23, #24): forged room presence is ignored, pokes carry the real sender.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ permissions: ['microphone'] });
  const pages = {};
  for (const u of ['a', 'b', 'c']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`[${u}]`, e.message));
    await p.goto(`http://localhost:5199/?u=${u}`);
    await p.waitForFunction(() => !!window.voice);
    pages[u] = p;
  }
  for (const u of ['a', 'b']) await pages[u].evaluate(() => window.voice.join(3));
  const peers = (u) => pages[u].evaluate(() => Object.keys(window.voice.peers).sort().join(','));
  for (let i = 0; i < 40 && (await peers('a')) !== 'b'; i++) await sleep(250);
  assert((await peers('a')) === 'b', 'a and b connected through the relay');

  // c shows up in room 3's presence without registering on the server (voice_join)
  await pages.c.evaluate(async () => {
    const ch = window.supabase.channel('cerchio:voice:3', { config: { private: true, presence: { key: 'c' } } });
    ch.subscribe();
    await new Promise((r) => setTimeout(r, 50));
    await ch.track({ at: Date.now() });
  });
  await sleep(1500);
  assert((await peers('a')) === 'b' && (await peers('b')) === 'a', 'forged presence: nobody connects to c');
  assert(!(await pages.a.evaluate(() => window.app.room.ids.includes('c'))), 'forged presence: c is not shown in the room');

  // once c really joins, the server registry lets it in
  await pages.c.evaluate(() => window.voice.join(3));
  for (let i = 0; i < 40 && (await peers('a')) !== 'b,c'; i++) await sleep(250);
  assert((await peers('a')) === 'b,c', 'after voice_join c is accepted');

  // poke through the server: b receives it from a
  const sent = await pages.a.evaluate(() => window.app.poke('b', 'ciao'));
  assert(sent === null, 'poke sent');
  for (let i = 0; i < 20 && !(await pages.b.evaluate(() => window.app.pokes.length)); i++) await sleep(100);
  const got = await pages.b.evaluate(() => window.app.pokes[0]);
  assert(got && got.from === 'a' && got.text === 'ciao', 'b receives the poke from a');
  assert((await pages.a.evaluate(() => window.app.poke('b', 'again'))) === 'poke.wait', 'second poke within 3 s refused');

  await b.close();
})();
