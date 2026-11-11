<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { voice } from '../lib/voice.svelte';
  import { prefs, savePrefs } from '../lib/prefs.svelte';
  import { dbToMeter } from '../lib/audio';
  import Icon from './Icon.svelte';
  import VolumeSlider from './VolumeSlider.svelte';

  // Tasto destro sull'icona del microfono: volume di ingresso con livello in tempo reale,
  // volume di uscita, scorciatoie. Si apre sopra il pulsante (che sta in fondo alla sidebar).
  let { anchor, onclose }: { anchor: DOMRect; onclose: () => void } = $props();

  let panel: HTMLDivElement | undefined;
  let level = $state(0);

  const WIDTH = 270;
  const left = $derived(Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8)));
  const bottom = $derived(Math.max(8, window.innerHeight - anchor.top + 8));
  const gatePos = $derived(dbToMeter(prefs.gateDb) * 100);
  const live = $derived(voice.effectiveMic);
  const device = $derived(voice.mic?.deviceLabel ?? '');

  function setGain(v: number) {
    prefs.inputGain = v;
    savePrefs();
    voice.setInputGain(v);
  }

  function setOutput(v: number) {
    prefs.outputVolume = v;
    savePrefs();
  }

  function openSettings() {
    onclose();
    app.settingsTab = 'media';
    app.settingsOpen = true;
  }

  function outside(e: Event) {
    if (panel && e.target instanceof Node && panel.contains(e.target)) return;
    onclose();
  }

  onMount(() => {
    // Il livello si legge solo mentre il menu è aperto: nessun costo quando è chiuso.
    let raf = 0;
    const loop = () => {
      level = voice.mic && live ? dbToMeter(voice.mic.levelDb()) : 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('contextmenu', outside, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('contextmenu', outside, true);
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} onresize={onclose} />

<div
  class="menu"
  bind:this={panel}
  style="left:{left}px; bottom:{bottom}px; width:{WIDTH}px"
  role="menu"
  tabindex="-1"
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="head">
    <div class="title">Microfono</div>
    {#if device}<div class="device" title={device}>{device}</div>{/if}
  </div>

  <VolumeSlider label="Ingresso" value={prefs.inputGain} onchange={setGain} />
  <div class="meter" class:idle={!live} title={live ? 'Livello del microfono' : 'Microfono disattivato'}>
    <div class="fill" style="transform:scaleX({level})"></div>
    {#if prefs.gateEnabled}<div class="gate" style="left:{gatePos}%"></div>{/if}
  </div>

  <VolumeSlider label="Uscita" max={100} value={prefs.outputVolume} onchange={setOutput} />

  <div class="sep"></div>

  <button class="item" class:danger={live} disabled={voice.adminMuted} onclick={() => voice.toggleMic()}>
    <Icon name={live ? 'mic-off' : 'mic'} size={15} />
    {voice.adminMuted ? 'Silenziato dall’admin' : live ? 'Disattiva microfono' : 'Attiva microfono'}
  </button>
  <button class="item" onclick={openSettings}>
    <Icon name="settings" size={15} />
    Impostazioni voce
  </button>
</div>

<style>
  .menu {
    position: fixed;
    z-index: 41;
    padding: 6px;
    border-radius: var(--r);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    animation: pop 0.12s ease-out;
    transform-origin: bottom left;
  }
  @keyframes pop {
    from { opacity: 0; transform: translateY(4px) scale(0.98); }
  }
  .head { padding: 6px 8px 4px; min-width: 0; }
  .title { font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; }
  .device { font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }

  /* Barra del livello allineata alla traccia dello slider sopra. */
  .meter {
    position: relative;
    height: 4px;
    margin: 0 68px 6px 78px;
    border-radius: 2px;
    background: var(--border-strong);
    overflow: hidden;
  }
  .meter.idle { opacity: 0.4; }
  .fill {
    height: 100%;
    background: var(--green);
    transform-origin: left;
    transition: transform 0.06s linear;
  }
  .gate { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--orange); }

  .sep { height: 1px; background: var(--border); margin: 4px 0; }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    font-size: 13px;
    text-align: left;
  }
  .item:hover:not(:disabled) { background: var(--accent); color: #fff; }
  .item.danger { color: var(--red); }
  .item.danger:hover:not(:disabled) { background: var(--red); color: #fff; }
  .item:disabled { opacity: 0.5; cursor: default; }
</style>
