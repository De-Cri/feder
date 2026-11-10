<script lang="ts">
  import { app } from '../lib/state.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let {
    id,
    stream,
    hasVideo,
    rev,
    speaking,
    mirror = false,
    focused = false,
    connecting = false,
    screen = false,
    audioMuted = false,
    ontoggleaudio,
    ondblclick,
    oncontextmenu,
  }: {
    id: string;
    stream: MediaStream | null;
    hasVideo: boolean;
    rev: number;
    speaking: boolean;
    mirror?: boolean;
    focused?: boolean;
    connecting?: boolean;
    /** riquadro della condivisione schermo (separato da quello della persona) */
    screen?: boolean;
    /** solo riquadri schermo: audio della stream silenziato per te */
    audioMuted?: boolean;
    ontoggleaudio?: () => void;
    ondblclick?: () => void;
    oncontextmenu?: (e: MouseEvent) => void;
  } = $props();

  let video: HTMLVideoElement | undefined = $state();
  const p = $derived(app.presence[id]);

  $effect(() => {
    void rev;
    if (video && video.srcObject !== stream) video.srcObject = stream;
    video?.play().catch(() => {});
  });

  // Se il video è attivo ma non arriva nessuna immagine, lo diciamo invece di mostrare nero.
  let noFrames = $state(false);
  $effect(() => {
    noFrames = false;
    if (!hasVideo || !video) return;
    const v = video;
    const t = setInterval(() => (noFrames = v.videoWidth === 0 || v.readyState < 2), 4000);
    return () => clearInterval(t);
  });
</script>

<div class="tile" class:speaking class:focused class:screen role="presentation" {ondblclick} {oncontextmenu}>
  {#if hasVideo && stream}
    <video bind:this={video} autoplay playsinline muted class:mirror={mirror && !screen}></video>
    {#if noFrames}<div class="waiting">Nessuna immagine ricevuta…</div>{/if}
  {:else if screen}
    <div class="waiting">In attesa dello schermo…</div>
  {:else}
    <Avatar {id} size={focused ? 96 : 64} {speaking} />
  {/if}
  {#if screen && ontoggleaudio}
    <button
      class="audio-btn"
      class:muted={audioMuted}
      title={audioMuted ? 'Riattiva l’audio della stream' : 'Silenzia l’audio della stream (lui lo senti ancora)'}
      onclick={(e) => { e.stopPropagation(); ontoggleaudio(); }}
      ondblclick={(e) => e.stopPropagation()}
    >
      <Icon name={audioMuted ? 'headphones-off' : 'volume'} size={16} />
    </button>
  {/if}
  <div class="label">
    {#if screen}
      <Icon name="screen" size={13} />
      <span>Schermo di {app.name(id)}{id === app.me ? ' (tu)' : ''}</span>
      <span class="live">LIVE</span>
    {:else}
      {#if p && (!p.mic || app.voiceMutes[id])}<Icon name="mic-off" size={13} />{/if}
      {#if p?.deaf}<Icon name="headphones-off" size={13} />{/if}
      <span>{app.name(id)}{id === app.me ? ' (tu)' : ''}</span>
    {/if}
    {#if connecting}<span class="conn">connessione…</span>{/if}
  </div>
</div>

<style>
  .tile {
    position: relative;
    border-radius: var(--r-lg);
    background: var(--bg-tile);
    border: 1px solid var(--border-strong);
    display: grid;
    place-items: center;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    min-width: 0;
    transition: border-color 0.12s;
  }
  .tile.speaking { border-color: var(--green); }
  .tile.focused { aspect-ratio: auto; height: 100%; }
  video { width: 100%; height: 100%; object-fit: cover; background: #000; }
  .tile.focused video, .tile.screen video { object-fit: contain; }
  .waiting {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    background: rgba(0, 0, 0, 0.35);
  }
  video.mirror { transform: scaleX(-1); }
  .label {
    position: absolute;
    left: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 12px;
    font-weight: 500;
  }
  .conn { opacity: 0.7; font-weight: 400; }
  .audio-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .tile:hover .audio-btn, .audio-btn.muted { opacity: 1; }
  .live { font-size: 9px; font-weight: 700; background: var(--red); border-radius: 4px; padding: 1px 4px; }
</style>