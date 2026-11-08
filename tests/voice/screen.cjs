const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--auto-select-desktop-capture-source=Entire screen'] });
  const ctx = await b.newContext({ permissions: ['microphone', 'camera'], viewport: { width: 900, height: 600 } });
  const pages = {};
  for (const u of ['a', 'b']) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(u, e.message));
    await p.goto(`http://localhost:5199/?u=${u}`); await p.waitForFunction(() => !!window.voice);
    pages[u] = p;
  }
  for (const u of ['a', 'b']) await pages[u].evaluate(() => window.voice.join(3));
  await sleep(3000);
  await pages.a.evaluate(() => { const bt = document.createElement('button'); bt.id = 's'; bt.textContent = 'share'; bt.onclick = () => window.voice.toggleScreen(); document.body.appendChild(bt); });
  await pages.a.click('#s');
  await sleep(4000);
  const local = await pages.a.evaluate(() => ({ kind: window.voice.videoKind, label: window.voice.videoTrack?.label, settings: window.voice.videoTrack?.getSettings() }));
  console.log('sender', JSON.stringify(local));
  const rx = await pages.b.evaluate(async () => {
    const p = window.voice.peers.a;
    const st = await p.pc.getStats();
    const out = { hasVideo: p.hasVideo, tracks: p.stream.getTracks().map((t) => `${t.kind}:${t.readyState}:${t.muted}`) };
    st.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') Object.assign(out, { framesDecoded: r.framesDecoded, w: r.frameWidth, h: r.frameHeight, fps: r.framesPerSecond }); });
    return out;
  });
  console.log('receiver', JSON.stringify(rx));
  const tx = await pages.a.evaluate(async () => {
    const p = window.voice.peers.b; const st = await p.pc.getStats(); const o = {};
    st.forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'video') Object.assign(o, { framesEncoded: r.framesEncoded, w: r.frameWidth, h: r.frameHeight, limit: r.qualityLimitationReason }); });
    return o;
  });
  console.log('sender stats', JSON.stringify(tx));
  await b.close();
})();
