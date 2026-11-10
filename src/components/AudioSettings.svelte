<script lang="ts">
  import { onMount } from 'svelte';
  import { prefs, savePrefs, micOptions, type Prefs } from '../lib/prefs.svelte';
  import { voice } from '../lib/voice.svelte';
  import { MicPipeline, dbToMeter, type NoiseMode } from '../lib/audio';
  import { isElectron } from '../lib/platform';
  import { playSound, SOUND_LABELS, type SoundKind } from '../lib/sounds';
  import { SCREEN_OPTIONS, screenWarning } from '../lib/screenQuality';
  import Dropdown from './Dropdown.svelte';

  // spettatori: quelli nella tua chiamata, o 4 come stima se non sei in chiamata
  const viewers = $derived(voice.channelId !== null ? Math.max(1, Object.keys(voice.peers).length) : 4);
  const warning = $derived.by(() => {
    void prefs.screenHeight; void prefs.screenFps; void prefs.screenMode;
    return screenWarning(viewers);
  });
  function setQuality(height: number, fps: number) {
    prefs.screenHeight = height;
    prefs.screenFps = fps;
    savePrefs();
    voice.applyScreenSettings();
  }
  function setScreen<K extends 'screenHeight' | 'screenFps' | 'screenMode'>(k: K, v: (typeof prefs)[K]) {
    prefs[k] = v;
    savePrefs();
    voice.applyScreenSettings();
  }

  const soundKinds = Object.keys(SOUND_LABELS) as SoundKind[];
  function toggleSound(k: SoundKind, on: boolean) {
    prefs.sounds[k] = on;
    savePrefs();
    if (on) playSound(k, true);
  }

  let devices = $state<MediaDeviceInfo[]>([]);
  const mics = $derived(devices.filter((d) => d.kind === 'audioinput'));
  const cams = $derived(devices.filter((d) => d.kind === 'videoinput'));
  const speakers = $derived(devices.filter((d) => d.kind === 'audiooutput'));

  const micOpts = $derived([
    { value: '', label: 'Predefinito di sistema' },
    ...mics.map((d) => ({ value: d.deviceId, label: d.label || 'Microfono' })),
  ]);
  const speakerOpts = $derived([
    { value: '', label: 'Predefinita di sistema' },
    ...speakers.map((d) => ({ value: d.deviceId, label: d.label || 'Altoparlante' })),
  ]);
  const camOpts = $derived([
    { value: '', label: 'Predefinita di sistema' },
    ...cams.map((d) => ({ value: d.deviceId, label: d.label || 'Webcam' })),
  ]);

  // Test microfono: usa la catena della chiamata se sei in vocale, altrimenti una temporanea.
  let test = $state<MicPipeline | null>(null);
  let testing = $state(false);
  let hearMe = $state(false);
  let level = $state(0);
  let monitor: HTMLAudioElement | undefined = $state();
  let raf = 0;
  let activeMic = $state('');

  const inCall = $derived(voice.channelId !== null);
  const active = $derived(inCall || testing);

  async function refreshDevices() {
    try {
      // Chromium aggiunge le voci virtuali "Predefinito - …" e "Comunicazioni - …":
      // doppioni di "Predefinito di sistema" (e "Comunicazioni" manda le cuffie BT in vivavoce).
      devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.deviceId !== 'default' && d.deviceId !== 'communications',
      );
    } catch {
      devices = [];
    }
  }

  onMount(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    const loop = () => {
      const p = inCall ? voice.mic : test;
      level = p ? dbToMeter(p.levelDb()) : 0;
      activeMic = p?.deviceLabel ?? '';
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
      stopTest();
    };
  });

  async function startTest() {
    if (inCall) return;
    try {
      test = await MicPipeline.create(micOptions());
      testing = true;
      refreshDevices(); // dopo il permesso compaiono i nomi dei dispositivi
    } catch {
      testing = false;
    }
  }

  function stopTest() {
    test?.stop();
    test = null;
    testing = false;
    hearMe = false;
  }

  $effect(() => {
    if (!monitor) return;
    monitor.srcObject = hearMe && test ? test.stream : null;
    if (hearMe) monitor.play().catch(() => {});
  });

  $effect(() => {
    const sink = prefs.speakerId;
    const a = monitor as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | undefined;
    a?.setSinkId?.(sink || '').catch(() => {});
  });

  // Le uscite audio (e i nomi) compaiono solo dopo il permesso del microfono:
  // rileggi l'elenco quando parte la chiamata o il test.
  $effect(() => {
    if (active) refreshDevices();
  });

  // Le modifiche alla catena ricreano il microfono (debounce per gli slider).
  let timer: ReturnType<typeof setTimeout> | undefined;
  function rebuild() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (inCall) await voice.rebuildMic();
      if (testing) {
        const old = test;
        test = await MicPipeline.create(micOptions());
        old?.stop();
      }
    }, 250);
  }

  function set<K extends keyof Prefs>(k: K, v: Prefs[K], needsRebuild = false) {
    prefs[k] = v;
    savePrefs();
    if (needsRebuild) rebuild();
  }

  function setGain(v: number) {
    set('inputGain', v);
    voice.setInputGain(v);
    test?.setGain(v);
  }

  const noiseModes: { v: NoiseMode; label: string; hint: string }[] = [
    { v: 'off', label: 'Disattivata', hint: 'Audio grezzo' },
    { v: 'standard', label: 'Standard', hint: 'Quella del browser' },
    { v: 'ai', label: 'AI (RNNoise)', hint: 'Toglie tastiera, ventole, rumori' },
  ];

  const gatePos = $derived(dbToMeter(prefs.gateDb) * 100);
</script>

<div class="audio">
  <h2>Voce e video</h2>

  <h3>Dispositivi</h3>
  <div class="field-label">Microfono</div>
  <Dropdown value={prefs.micId} options={micOpts} placeholder="Predefinito di sistema"
    onchange={(v) => set('micId', v, true)} />
  {#if activeMic}<p class="hint">In uso: {activeMic}</p>{/if}

  <div class="field-label">Uscita audio</div>
  <Dropdown value={prefs.speakerId} options={speakerOpts} placeholder="Predefinita di sistema"
    onchange={(v) => set('speakerId', v)} />

  <div class="field-label">Webcam</div>
  <Dropdown value={prefs.camId} options={camOpts} placeholder="Predefinita di sistema"
    onchange={(v) => set('camId', v)} />

  <h3>Volume</h3>
  <div class="slider">
    <span>Microfono</span>
    <input type="range" min="0" max="2" step="0.01" value={prefs.inputGain}
      oninput={(e) => setGain(Number(e.currentTarget.value))} />
    <span class="pct">{Math.round(prefs.inputGain * 100)}%</span>
  </div>
  <div class="slider">
    <span>Uscita</span>
    <input type="range" min="0" max="1" step="0.01" value={prefs.outputVolume}
      oninput={(e) => set('outputVolume', Number(e.currentTarget.value))} />
    <span class="pct">{Math.round(prefs.outputVolume * 100)}%</span>
  </div>
  <p class="hint">Il volume di ogni amico si regola col tasto destro sul suo nome o sul suo riquadro.</p>

  <div class="meter-row">
    <div class="meter" class:idle={!active}>
      <div class="fill" style="width:{level * 100}%"></div>
      {#if prefs.gateEnabled}<div class="gate" style="left:{gatePos}%"></div>{/if}
    </div>
    {#if !inCall}
      {#if testing}
        <label class="mini"><input type="checkbox" bind:checked={hearMe} /> Ascoltati</label>
        <button class="btn" onclick={stopTest}>Stop</button>
      {:else}
        <button class="btn" onclick={startTest}>Prova microfono</button>
      {/if}
    {/if}
  </div>
  {#if hearMe}<p class="hint">Usa le cuffie, altrimenti fa eco.</p>{/if}
  <audio bind:this={monitor} autoplay></audio>

  <h3>Elaborazione</h3>
  <div class="field-label">Soppressione del rumore</div>
  <div class="seg">
    {#each noiseModes as m}
      <button class:active={prefs.noiseMode === m.v} title={m.hint} onclick={() => set('noiseMode', m.v, true)}>
        {m.label}
      </button>
    {/each}
  </div>
  <label class="check">
    <input type="checkbox" checked={prefs.echoCancellation}
      onchange={(e) => set('echoCancellation', e.currentTarget.checked, true)} />
    Cancellazione dell’eco
  </label>
  <label class="check">
    <input type="checkbox" checked={prefs.autoGain} onchange={(e) => set('autoGain', e.currentTarget.checked, true)} />
    Regolazione automatica del volume del microfono
  </label>
  <label class="check">
    <input type="checkbox" checked={prefs.gateEnabled}
      onchange={(e) => set('gateEnabled', e.currentTarget.checked, true)} />
    Soglia di attivazione (trasmetti solo quando parli)
  </label>
  {#if prefs.gateEnabled}
    <div class="slider">
      <span>Soglia</span>
      <input type="range" min="-80" max="-10" step="1" value={prefs.gateDb}
        oninput={(e) => set('gateDb', Number(e.currentTarget.value), true)} />
      <span class="pct">{prefs.gateDb} dB</span>
    </div>
    <p class="hint">Parla e regola finché la barra supera la linea solo quando parli.</p>
  {/if}

  <h3>Condivisione schermo</h3>
  <div class="field-label">Qualità</div>
  <div class="seg">
    {#each SCREEN_OPTIONS as o}
      <button
        class:active={prefs.screenHeight === o.height && prefs.screenFps === o.fps}
        onclick={() => setQuality(o.height, o.fps)}>{o.label}</button
      >
    {/each}
  </div>
  <div class="field-label">Ottimizza per</div>
  <div class="seg">
    <button class:active={prefs.screenMode === 'motion'} onclick={() => setScreen('screenMode', 'motion')}>Movimento (giochi, video)</button>
    <button class:active={prefs.screenMode === 'detail'} onclick={() => setScreen('screenMode', 'detail')}>Testo e dettagli</button>
  </div>
  <div class="warning {warning.level}">
    {#if warning.level !== 'ok'}<strong>{warning.level === 'danger' ? 'Attenzione' : 'Nota'}:</strong>{/if}
    {warning.text}
  </div>
  <label class="check">
    <input type="checkbox" checked={prefs.screenAudio} onchange={(e) => set('screenAudio', e.currentTarget.checked)} />
    Condividi anche l’audio {isElectron ? '(non supportato su Linux)' : '(spunta “Condividi audio” nel selettore)'}
  </label>

  <h3>Suoni</h3>
  <div class="slider">
    <span>Volume</span>
    <input type="range" min="0" max="1" step="0.01" value={prefs.soundVolume}
      oninput={(e) => set('soundVolume', Number(e.currentTarget.value))}
      onchange={() => playSound('join', true)} />
    <span class="pct">{Math.round(prefs.soundVolume * 100)}%</span>
  </div>
  <div class="sounds">
    {#each soundKinds as k}
      <div class="sound-row">
        <label class="check inline">
          <input type="checkbox" checked={prefs.sounds[k]} onchange={(e) => toggleSound(k, e.currentTarget.checked)} />
          {SOUND_LABELS[k]}
        </label>
        <button class="play" title="Ascolta" onclick={() => playSound(k, true)} aria-label="Ascolta">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .audio { display: flex; flex-direction: column; }
  h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; color: var(--text); }
  h3 {
    margin: 36px 0 10px;
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  h2 + h3 { margin-top: 20px; }
  .field-label { margin: 14px 0 6px; font-size: 13px; font-weight: 500; color: var(--text-2); }
  .slider { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 13px; }
  .slider > span:first-child { width: 78px; color: var(--text-2); }
  .slider input { flex: 1; accent-color: var(--accent); }
  .pct { width: 52px; text-align: right; color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
  .hint { font-size: 12px; color: var(--text-3); margin: 8px 0 0; }
  .meter-row { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
  .meter {
    position: relative;
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: var(--bg-active);
    overflow: hidden;
  }
  .meter.idle { opacity: 0.5; }
  .fill { height: 100%; background: var(--green); border-radius: 4px; transition: width 0.05s linear; }
  .gate { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--orange); }
  .mini { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-2); }
  .seg {
    display: flex;
    padding: 3px;
    border-radius: var(--r-sm);
    background: var(--bg-input);
    gap: 2px;
  }
  .seg button {
    flex: 1;
    height: 30px;
    border-radius: var(--r-sm);
    font-size: 13px;
    color: var(--text-2);
  }
  .seg button:hover { color: var(--text); }
  .seg button.active { background: var(--bg-active); color: var(--text); font-weight: 500; }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 14px; }
  .warning {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: var(--r-sm);
    font-size: 13px;
    line-height: 1.45;
    background: var(--bg-active);
    color: var(--text-2);
  }
  .warning.warn { background: color-mix(in srgb, var(--orange) 14%, transparent); color: var(--text); }
  .warning.danger { background: color-mix(in srgb, var(--red) 14%, transparent); color: var(--text); }
  .sounds { display: flex; flex-direction: column; }
  .sound-row { display: flex; align-items: center; justify-content: space-between; }
  .check.inline { margin-top: 10px; }
  .play {
    width: 28px;
    height: 28px;
    margin-top: 10px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--text-2);
    background: var(--bg-active);
  }
  .play:hover { color: var(--text); background: var(--border-strong); }
</style>