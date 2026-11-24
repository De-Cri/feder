<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { voice } from '../lib/voice.svelte';
  import { prefs, savePrefs } from '../lib/prefs.svelte';
  import { dbToMeter } from '../lib/audio';
  import Icon from './Icon.svelte';
  import VolumeSlider from './VolumeSlider.svelte';
  import { t } from '../lib/i18n.svelte';

  // Right-click on the microphone icon: which microphone, input volume with live level,
  // output volume, shortcuts. Opens above the button (which sits at the bottom of the sidebar).
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

  // Microphones (names show up once the permission was granted, e.g. after a first call).
  let mics = $state<MediaDeviceInfo[]>([]);
  async function refreshMics() {
    try {
      // "default"/"communications" are Chromium's duplicates of the system default
      mics = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications',
      );
    } catch {
      mics = [];
    }
  }

  // Same as Settings → Audio: saved for this PC, and in a call the new microphone takes over right away.
  function pickMic(id: string) {
    if (prefs.micId === id) return;
    prefs.micId = id;
    savePrefs();
    void voice.rebuildMic();
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
    // The level is read only while the menu is open: no cost when it's closed.
    let raf = 0;
    const loop = () => {
      level = voice.mic && live ? dbToMeter(voice.mic.levelDb()) : 0;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    refreshMics();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('contextmenu', outside, true);
    return () => {
      cancelAnimationFrame(raf);
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshMics);
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
    <div class="title">{t('mic.title')}</div>
    {#if device}<div class="device" title={device}>{device}</div>{/if}
  </div>

  {#if mics.length > 1}
    <div class="devices" role="radiogroup" aria-label={t('mic.device')}>
      {#each [{ deviceId: '', label: t('audio.defaultMic') }, ...mics] as d (d.deviceId)}
        <button class="item dev" role="radio" aria-checked={prefs.micId === d.deviceId}
          title={d.label || t('mic.title')} onclick={() => pickMic(d.deviceId)}>
          <span class="dot" class:on={prefs.micId === d.deviceId}></span>
          <span class="dev-name">{d.label || t('mic.title')}</span>
        </button>
      {/each}
    </div>
    <div class="sep"></div>
  {/if}

  <VolumeSlider label={t('mic.input')} value={prefs.inputGain} onchange={setGain} />
  <div
    class="meter"
    class:idle={!live || !voice.mic}
    title={!voice.mic ? t('mic.levelInCall') : live ? t('mic.level') : t('mic.off')}
  >
    <div class="fill" style="transform:scaleX({level})"></div>
    {#if prefs.gateEnabled}<div class="gate" style="left:{gatePos}%"></div>{/if}
  </div>

  <VolumeSlider label={t('mic.output')} max={100} value={prefs.outputVolume} onchange={setOutput} />

  <div class="sep"></div>

  <button class="item" class:danger={live} disabled={voice.adminMuted} onclick={() => voice.toggleMic()}>
    <Icon name={live ? 'mic-off' : 'mic'} size={15} />
    {voice.adminMuted ? t('call.adminMuted') : live ? t('call.micOff') : t('call.micOn')}
  </button>
  <button class="item" onclick={openSettings}>
    <Icon name="settings" size={15} />
    {t('mic.settings')}
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

  /* Level bar aligned with the slider track above. */
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
  .devices { max-height: 180px; overflow-y: auto; }
  .dev { font-size: 12.5px; padding: 5px 8px; }
  .dev-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--text-3); }
  .dot.on { border-color: var(--accent); background: radial-gradient(var(--accent) 45%, transparent 50%); }
  .item:hover:not(:disabled) .dot { border-color: #fff; }
  .item:hover:not(:disabled) .dot.on { background: radial-gradient(#fff 45%, transparent 50%); }
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
