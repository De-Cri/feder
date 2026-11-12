// End-to-end test of the WebRTC mesh: 3 users in the same voice channel.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } else console.log('ok -', m); };

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const pages = {};
  for (const u of ['a', 'b', 'c']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`[${u}] pageerror`, e.message));
    p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(`[${u}] ${m.type()}`, m.text()); });
    await p.goto(`http://localhost:5199/?u=${u}`);
    await p.waitForFunction(() => !!window.voice);
    pages[u] = p;
  }
  for (const u of ['a', 'b', 'c']) await pages[u].evaluate(() => window.voice.join(3));

  const snap = (u) => pages[u].evaluate(() => window.snapshot());
  let s;
  for (let i = 0; i < 40; i++) {
    s = await Promise.all(['a', 'b', 'c'].map(snap));
    if (s.every((x) => Object.keys(x).length === 2 && Object.values(x).every((p) => p.conn === 'connected' && p.audio > 0))) break;
    await sleep(250);
  }
  console.log(JSON.stringify(s));
  assert(s.every((x) => Object.keys(x).length === 2), 'ognuno vede 2 peer');
  assert(s.every((x) => Object.values(x).every((p) => p.conn === 'connected')), 'tutte le connessioni P2P connesse');
  assert(s.every((x) => Object.values(x).every((p) => p.audio > 0)), 'audio ricevuto da tutti');
  const playing = await Promise.all(['a', 'b', 'c'].map((u) => pages[u].evaluate(() =>
    [...document.querySelectorAll('audio')].filter((el) => el.srcObject && !el.paused && el.srcObject.getAudioTracks().some((t) => t.readyState === 'live')).length)));
  assert(playing.every((n) => n === 2), `audio degli altri in riproduzione senza schermata vocale (${playing})`);
  const sounds = await pages.c.evaluate(() => [...window.soundLog]);
  console.log('suoni di c:', sounds.join(', '));
  assert(sounds.includes('selfJoin'), 'suono di ingresso nel vocale');

  const micInfo = await pages.a.evaluate(() => ({ ai: !window.voice.mic.aiFallback, db: window.voice.mic.levelDb(), label: window.voice.audioTrack.label }));
  console.log('mic pipeline', JSON.stringify(micInfo));
  assert(micInfo.ai, 'RNNoise (AI) caricato nella catena del microfono');
  await pages.a.evaluate(() => window.voice.setInputGain(0));
  await sleep(400);
  const silent = await pages.a.evaluate(() => window.voice.mic.levelDb());
  await pages.a.evaluate(() => window.voice.setInputGain(1));
  console.log('livello con gain 0:', silent.toFixed(1), 'dB');
  assert(silent < -60, 'gain di input a 0 silenzia il microfono');
  // settings change during the call: the chain is rebuilt and peers stay connected
  await pages.a.evaluate(async () => { window.prefs.noiseMode = 'standard'; window.prefs.gateEnabled = true; await window.voice.rebuildMic(); });
  await sleep(1500);
  const afterRebuild = await Promise.all(['b', 'c'].map(snap));
  assert(afterRebuild.every((x) => x.a?.conn === 'connected' && x.a?.audio > 0), 'rebuild del microfono senza disconnessioni');

  await pages.a.evaluate(() => window.voice.toggleCam());
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const [b, c] = await Promise.all([snap('b'), snap('c')]);
    ok = b.a?.hasVideo && c.a?.hasVideo;
    if (!ok) await sleep(250);
  }
  assert(ok, 'webcam di a visibile a b e c (rinegoziazione)');

  await pages.b.evaluate(() => window.voice.toggleCam());
  ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const [a, c] = await Promise.all([snap('a'), snap('c')]);
    ok = a.b?.hasVideo && c.b?.hasVideo && c.a?.hasVideo;
    if (!ok) await sleep(250);
  }
  assert(ok, 'due webcam contemporanee');

  await pages.a.evaluate(() => window.voice.stopVideo());
  ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const [b, c] = await Promise.all([snap('b'), snap('c')]);
    ok = b.a && !b.a.hasVideo && c.a && !c.a.hasVideo;
    if (!ok) await sleep(250);
  }
  assert(ok, 'webcam spenta: video sparisce dagli altri');
  await pages.a.evaluate(() => window.voice.toggleCam());
  ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const [b, c] = await Promise.all([snap('b'), snap('c')]);
    ok = b.a?.hasVideo && c.a?.hasVideo;
    if (!ok) await sleep(250);
  }
  assert(ok, 'webcam riaccesa dopo spegnimento');
  await pages.a.evaluate(() => window.voice.stopVideo());

  await pages.a.evaluate(() => window.voice.toggleMic());
  const enabled = await pages.a.evaluate(() => window.voice.audioTrack.enabled);
  assert(enabled === false, 'mute locale disattiva la traccia');

  await pages.c.evaluate(() => window.voice.leave());
  ok = false;
  for (let i = 0; i < 20 && !ok; i++) {
    const [a, b] = await Promise.all([snap('a'), snap('b')]);
    ok = !a.c && !b.c && a.b?.conn === 'connected';
    if (!ok) await sleep(250);
  }
  assert(ok, 'uscita di c: a e b chiudono la connessione con c e restano connessi');
  assert((await pages.a.evaluate(() => window.soundLog.includes('leave'))), 'a sente il suono di uscita di c');

  await pages.c.evaluate(() => window.voice.join(3));
  ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const s2 = await Promise.all(['a', 'b', 'c'].map(snap));
    ok = s2.every((x) => Object.keys(x).length === 2 && Object.values(x).every((p) => p.conn === 'connected'));
    if (!ok) await sleep(250);
  }
  if (!ok) console.log('REJOIN', JSON.stringify(await Promise.all(['a','b','c'].map(snap))));
  assert(ok, 'rientro di c: mesh ricostruita');
  ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const c = await snap('c');
    ok = c.b?.hasVideo;
    if (!ok) await sleep(250);
  }
  assert(ok, 'chi entra dopo vede subito la webcam già accesa di b');

  // Channel switch without hanging up: a moves from 3 to 4, then back to 3.
  await pages.a.evaluate(() => window.voice.join(4));
  ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map(snap));
    const ch = await pages.a.evaluate(() => window.voice.channelId);
    ok = ch === 4 && Object.keys(a).length === 0 && !b.a && !c.a && b.c?.conn === 'connected';
    if (!ok) await sleep(250);
  }
  assert(ok, 'cambio canale: a esce dal 3 (b e c lo chiudono) ed è solo nel 4');
  const pres = await pages.a.evaluate(() => window.app.myPresence.voice);
  assert(pres === 4, 'presenza pubblicata = nuovo canale');
  await pages.a.evaluate(() => window.voice.join(3));
  ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const s3 = await Promise.all(['a', 'b', 'c'].map(snap));
    ok = s3.every((x) => Object.keys(x).length === 2 && Object.values(x).every((p) => p.conn === 'connected'));
    if (!ok) await sleep(250);
  }
  if (!ok) console.log('RET', JSON.stringify(await Promise.all(['a','b','c'].map(snap))), await pages.a.evaluate(() => [window.voice.channelId, window.voice.joining, window.voice.error]));
  assert(ok, 'ritorno nel 3: mesh completa');
  await pages.a.evaluate(() => window.voice.leave());
  assert((await pages.a.evaluate(() => window.app.myPresence.voice)) === null, 'riagganciando la presenza torna a nessun canale');

  await browser.close();
  console.log('\nVOICE E2E PASSED');
})();
