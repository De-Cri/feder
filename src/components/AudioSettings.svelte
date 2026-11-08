<script lang="ts">
  import { onMount } from 'svelte';
  import { prefs, savePrefs, micOptions, type Prefs } from '../lib/prefs.svelte';
  import { voice } from '../lib/voice.svelte';
  import { MicPipeline, dbToMeter, type NoiseMode } from '../lib/audio';
  import { isElectron } from '../lib/platform';
  import { playSound, SOUND_LABELS, type SoundKind } from '../lib/sounds';
  import { SCREEN_OPTIONS, screenWarning } from '../lib/screenQuality';

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
      devices = await navigator.mediaDevices.enumerateDevices();
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
    } catch (e) {
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

<h2>Voce e video</h2>

<h3>Dispositivi</h3>
<label class="label" for="mic">Microfono</label>
<select id="mic" class="field" value={prefs.micId} onchange={(e) => set('micId', e.currentTarget.value, true)}>
  <option value="">Predefinito di sistema</option>
  {#each mics as d}<option value={d.deviceId}>{d.label || 'Microfono'}</option>{/each}
</select>
{#if activeMic}<p class="hint">In uso: {activeMic}</p>{/if}
<label class="label" for="spk">Uscita audio</label>
<select id="spk" class="field" value={prefs.speakerId} onchange={(e) => set('speakerId', e.currentTarget.value)}>
  <option value="">Predefinita di sistema</option>
  {#each speakers as d}<option value={d.deviceId}>{d.label || 'Altoparlante'}</option>{/each}
</select>
<label class="label" for="cam">Webcam</label>
<select id="cam" class="field" value={prefs.camId} onchange={(e) => set('camId', e.currentTarget.value)}>
  <option value="">Predefinita di sistema</option>
  {#each cams as d}<option value={d.deviceId}>{d.label || 'Webcam'}</option>{/each}
</select>

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
<p class="hint">Il volume di ogni amico si regola col tasto destro sul suo riquadro in vocale.</p>

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
<div class="label">Soppressione del rumore</div>
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
<div class="label">Qualità</div>
<div class="seg">
  {#each SCREEN_OPTIONS as o}
    <button
      class:active={prefs.screenHeight === o.height && prefs.screenFps === o.fps}
      onclick={() => setQuality(o.height, o.fps)}>{o.label}</button
    >
  {/each}
</div>
<div class="label">Ottimizza per</div>
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

<style>
  .sounds { display: flex; flex-direction: column; margin-top: 4px; }
  .sound-row { display: flex; align-items: center; justify-content: space-between; }
  .check.inline { margin-top: 8px; }
  .play {
    width: 26px; height: 26px; margin-top: 8px; border-radius: 50%;
    display: grid; place-items: center; color: var(--text-2); background: var(--bg-active);
  }
  .play:hover { color: var(--text); background: var(--border-strong); }
  h2 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
  h3 { margin: 20px 0 4px; font-size: 13px; font-weight: 600; color: var(--text-2); }
  .label { margin-top: 8px; }
  select.field { appearance: auto; }
  .slider { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 13px; }
  .slider > span:first-child { width: 78px; color: var(--text-2); }
  .slider input { flex: 1; accent-color: var(--accent); }
  .pct { width: 52px; text-align: right; color: var(--text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
  .meter-row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
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
    padding: 2px;
    border-radius: var(--r-sm);
    background: var(--bg-active);
    margin-top: 4px;
  }
  .seg button {
    flex: 1;
    height: 28px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--text-2);
  }
  .seg button.active { background: var(--bg-elev); color: var(--text); font-weight: 500; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; }
  .hint { font-size: 12px; color: var(--text-3); margin: 6px 0 0; }
  .warning {
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    font-size: 12px;
    line-height: 1.45;
    background: var(--bg-active);
    color: var(--text-2);
  }
  .warning.warn { background: color-mix(in srgb, var(--orange) 14%, transparent); color: var(--text); }
  .warning.danger { background: color-mix(in srgb, var(--red) 14%, transparent); color: var(--text); }
</style>
