// Screen + webcam together, off/on: viewers must always receive frames (never black).
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok -', m); };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'] });
  const ctx = await b.newContext({ permissions: ['microphone', 'camera'] });
  const pages = {};
  for (const u of ['a', 'b']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(u, e.message));
    await p.goto(`http://localhost:5199/?u=${u}`); await p.waitForFunction(() => !!window.voice);
    pages[u] = p;
  }
  for (const u of ['a', 'b']) await pages[u].evaluate(() => window.voice.join(3));
  await sleep(2500);
  await pages.a.evaluate(() => {
    for (const [id, fn] of [['scr', () => window.voice.toggleScreen()], ['cam', () => window.voice.toggleCam()]]) {
      const bt = document.createElement('button'); bt.id = id; bt.textContent = id; bt.onclick = fn; document.body.appendChild(bt);
    }
  });
  // b "watches": counts the frames really drawn in a <video> for the given view
  const watch = (which) => pages.b.evaluate(async (which) => {
    const p = window.voice.peers.a;
    const view = which === 'screen' ? p.screenView : p.camView;
    if (!view) return { ok: false, why: 'nessuna vista' };
    const v = document.createElement('video'); v.muted = true; v.srcObject = view; document.body.appendChild(v);
    await v.play().catch(() => {});
    let frames = 0;
    const cb = () => { frames++; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
    await new Promise((r) => setTimeout(r, 2000));
    const out = { ok: frames > 5 && v.videoWidth > 0, frames, w: v.videoWidth, cam: p.hasCam, screen: p.hasScreen };
    v.remove();
    return out;
  }, which);
  const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
  const st = () => pages.b.evaluate(() => ({ cam: window.voice.peers.a.hasCam, screen: window.voice.peers.a.hasScreen }));

  await pages.a.click('#scr');
  assert(await until(async () => (await st()).screen), 'b riceve lo schermo');
  // b hasn't clicked: a must not send them the stream (no wasted encoding/bandwidth)
  const active = () => pages.a.evaluate(() => window.voice.peers.b.screenSender?.getParameters().encodings?.[0]?.active);
  const setWatch = (on) => pages.b.evaluate((on) => { if (on) window.voice.watching.a = true; else delete window.voice.watching.a; }, on);
  assert(await until(async () => (await active()) === false), 'b non guarda: stream verso b in pausa');
  await setWatch(true);
  assert(await until(async () => (await active()) === true && (await st()).screen), 'b clicca: la stream riparte');
  let w = await watch('screen'); console.log('   ', JSON.stringify(w));
  assert(w.ok && !w.cam, 'lo schermo si vede (riquadro schermo, non webcam)');

  // separate volume: muting the stream doesn't mute the voice
  const vols = () => pages.b.evaluate(() => {
    const p = window.voice.peers.a;
    return [...document.querySelectorAll('audio')].filter((el) => el.srcObject).map((el) => {
      const a = p.audioStreams.find((x) => x.stream === el.srcObject);
      return { screen: a ? p.isScreenAudio(a.key) : null, vol: el.volume };
    });
  });
  await sleep(500);
  let v = await vols(); console.log('   ', JSON.stringify(v));
  assert(v.some((x) => x.screen === true) && v.some((x) => x.screen === false), 'audio della stream e voce riprodotti separatamente');
  await pages.b.evaluate(() => { window.prefs.screenVolumes.a = 0; });
  await sleep(300);
  v = await vols();
  assert(v.find((x) => x.screen).vol === 0 && v.find((x) => x.screen === false).vol === 1, 'stream silenziata, voce ancora al 100%');
  await pages.b.evaluate(() => { window.prefs.screenVolumes.a = 1; });

  await pages.a.click('#cam');
  assert(await until(async () => { const s = await st(); return s.cam && s.screen; }), 'webcam + schermo insieme');
  w = await watch('screen'); assert(w.ok, `lo schermo continua mentre la webcam è accesa (${w.frames} fotogrammi)`);
  w = await watch('cam'); assert(w.ok, `la webcam si vede nel suo riquadro (${w.frames} fotogrammi)`);

  await pages.a.click('#cam'); // turns the webcam off
  assert(await until(async () => !(await st()).cam), 'webcam spenta');
  w = await watch('screen'); assert(w.ok, 'lo schermo continua dopo aver spento la webcam');

  await pages.a.click('#scr'); // stops the screen
  assert(await until(async () => !(await st()).screen), 'condivisione fermata');
  await pages.a.click('#scr'); // and restarts it
  assert(await until(async () => (await st()).screen), 'condivisione riavviata');
  await setWatch(true);
  assert(await until(async () => (await active()) === true && (await st()).screen), 'b riapre lo schermo riavviato');
  w = await watch('screen'); console.log('   ', JSON.stringify(w));
  assert(w.ok, 'dopo il riavvio lo schermo si vede (niente nero)');

  await pages.a.click('#cam');
  assert(await until(async () => (await st()).cam), 'webcam riaccesa');
  w = await watch('cam'); assert(w.ok, 'la webcam riaccesa si vede (niente nero)');
  w = await watch('screen'); assert(w.ok, 'e lo schermo continua');
  await setWatch(false);
  assert(await until(async () => (await active()) === false), 'b smette di guardare: stream verso b di nuovo in pausa');
  await b.close();
  console.log('\nSCREEN PASSED');
})();
