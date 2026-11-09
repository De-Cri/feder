// Un lato ricrea la connessione (presenza persa per un attimo), l'altro tiene la vecchia.
// Entrambi devono tornare "connected" (prima: uno restava su "connessione…").
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const pages = {};
  for (const u of ['a', 'b']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`[${u}] pageerror`, e.message));
    await p.goto(`http://localhost:5199/?u=${u}`);
    await p.waitForFunction(() => !!window.voice);
    pages[u] = p;
  }
  for (const u of ['a', 'b']) await pages[u].evaluate(() => window.voice.join(3));
  const conn = (u, other) => pages[u].evaluate((o) => window.voice.peers[o]?.connection ?? 'none', other);
  const bothOk = async () => (await conn('a', 'b')) === 'connected' && (await conn('b', 'a')) === 'connected';
  const waitOk = async (ms) => { for (let i = 0; i < ms / 250; i++) { if (await bothOk()) return true; await sleep(250); } return false; };
  assert(await waitOk(15000), 'connessi all\'inizio');

  for (const [who, other] of [['a', 'b'], ['b', 'a']]) {
    const sidBefore = await pages[other].evaluate((w) => window.voice.peers[w].sid, who);
    await pages[who].evaluate((o) => { window.voice.drop(o); window.voice['peer'](o); }, other);
    const ok = await waitOk(20000);
    console.log(`  a→b: ${await conn('a', 'b')}  b→a: ${await conn('b', 'a')}`);
    assert(ok, `${who} ricrea la connessione: entrambi tornano connessi`);
    const sidAfter = await pages[other].evaluate((w) => window.voice.peers[w].sid, who);
    assert(sidAfter !== sidBefore, `${other} ha ricreato anche la sua`);
    const audio = await pages[other].evaluate((w) => window.voice.peers[w].stream.getAudioTracks().filter((t) => t.readyState === 'live').length, who);
    assert(audio > 0, `${other} riceve di nuovo l'audio di ${who}`);
  }

  // Segnali persi: a ricrea ma offerta/candidati non arrivano (come un broadcast perso).
  for (const [who, other] of [['a', 'b'], ['b', 'a']]) {
    await pages[who].evaluate((o) => {
      const v = window.voice; const send = v.send.bind(v);
      v.send = () => {}; setTimeout(() => (v.send = send), 4000);
      v.drop(o); v['peer'](o);
    }, other);
    await sleep(6000);
    const stuckWho = await conn(who, other), stuckOther = await conn(other, who);
    console.log(`  dopo 6 s: ${who}→${other}: ${stuckWho}  ${other}→${who}: ${stuckOther}`);
    assert(stuckWho !== 'connected', `scenario riprodotto: ${who} resta su "connessione…"`);
    const ok = await waitOk(40000);
    console.log(`  a→b: ${await conn('a', 'b')}  b→a: ${await conn('b', 'a')}`);
    assert(ok, `segnale perso (${who}): si ricollegano da soli`);
  }
  await browser.close();
  console.log('\nRECREATE PASSED');
})();
