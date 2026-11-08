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
    ondblclick,
    oncontextmenu,
  }: {
    id: string;
    stream: MediaStream;
    hasVideo: boolean;
    rev: number;
    speaking: boolean;
    mirror?: boolean;
    focused?: boolean;
    connecting?: boolean;
    /** riquadro della condivisione schermo (separato da quello della persona) */
    screen?: boolean;
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
  {#if hasVideo}
    <video bind:this={video} autoplay playsinline muted class:mirror={mirror && !screen}></video>
    {#if noFrames}<div class="waiting">Nessuna immagine ricevuta…</div>{/if}
  {:else if screen}
    <div class="waiting">In attesa dello schermo…</div>
  {:else}
    <Avatar {id} size={focused ? 96 : 64} {speaking} />
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
    display: grid;
    place-items: center;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    min-width: 0;
    transition: box-shadow 0.12s;
  }
  .tile.speaking { box-shadow: inset 0 0 0 2px var(--green); }
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
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    backdrop-filter: blur(10px);
  }
  .conn { opacity: 0.7; font-weight: 400; }
  .live { font-size: 9px; font-weight: 700; background: var(--red); border-radius: 4px; padding: 1px 4px; }
</style>
