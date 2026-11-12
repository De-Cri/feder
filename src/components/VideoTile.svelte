<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { isHidden, onHiddenChange } from '../lib/platform';
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
    locked = false,
    ontoggleaudio,
    onstopwatch,
    onclick,
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
    /** screen share tile (separate from the person's tile) */
    screen?: boolean;
    /** screen tiles only: stream audio muted for you */
    audioMuted?: boolean;
    /** other people's screen tiles only: not opened yet, shows "Click to watch" */
    locked?: boolean;
    ontoggleaudio?: () => void;
    onstopwatch?: () => void;
    onclick?: () => void;
    ondblclick?: () => void;
    oncontextmenu?: (e: MouseEvent) => void;
  } = $props();

  let video: HTMLVideoElement | undefined = $state();
  let tile: HTMLDivElement | undefined = $state();
  const p = $derived(app.presence[id]);

  // The video is attached only if someone can see it: minimized/hidden window
  // or tile out of view → srcObject = null, so the player frees its frames
  // and stops drawing. The tracks stay alive: audio keeps playing and
  // the others keep seeing your webcam/screen.
  let hidden = $state(isHidden());
  let inView = $state(true);
  const show = $derived(!hidden && inView);
  $effect(() => onHiddenChange((h) => (hidden = h)));
  $effect(() => {
    if (!tile || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => (inView = es[es.length - 1].isIntersecting), { rootMargin: '200px' });
    io.observe(tile);
    return () => io.disconnect();
  });

  $effect(() => {
    void rev;
    const v = video;
    if (!v) return;
    const src = show ? stream : null;
    if (v.srcObject !== src) v.srcObject = src;
    if (src) v.play().catch(() => {});
  });
  // When the <video> goes away (video off, tile closed) detach the stream
  // right away, instead of waiting for the garbage collector.
  $effect(() => {
    const v = video;
    if (!v) return;
    return () => {
      v.srcObject = null;
    };
  });

  // If the video is on but no frame arrives, say so instead of showing black.
  let noFrames = $state(false);
  $effect(() => {
    noFrames = false;
    if (!hasVideo || !video || !show) return;
    const v = video;
    const t = setInterval(() => (noFrames = v.videoWidth === 0 || v.readyState < 2), 4000);
    return () => clearInterval(t);
  });
</script>

<div bind:this={tile} class="tile" class:speaking class:focused class:screen class:locked role="presentation" {onclick} {ondblclick} {oncontextmenu}>
  {#if locked}
    <div class="waiting"><span class="watch"><Icon name="screen" size={16} /> Clicca per guardare</span></div>
  {:else if hasVideo && stream}
    <video bind:this={video} autoplay playsinline muted class:mirror={mirror && !screen}></video>
    {#if noFrames}<div class="waiting">Nessuna immagine ricevuta…</div>{/if}
  {:else if screen}
    <div class="waiting">In attesa dello schermo…</div>
  {:else}
    <Avatar {id} size={focused ? 96 : 64} {speaking} />
  {/if}
  {#if screen && !locked && (ontoggleaudio || onstopwatch)}
    <div class="tools">
      {#if ontoggleaudio}
        <button
          class="tool"
          class:muted={audioMuted}
          title={audioMuted ? 'Riattiva l’audio della stream' : 'Silenzia l’audio della stream (lui lo senti ancora)'}
          onclick={(e) => { e.stopPropagation(); ontoggleaudio(); }}
          ondblclick={(e) => e.stopPropagation()}
        >
          <Icon name={audioMuted ? 'headphones-off' : 'volume'} size={16} />
        </button>
      {/if}
      {#if onstopwatch}
        <button
          class="tool"
          title="Smetti di guardare"
          onclick={(e) => { e.stopPropagation(); onstopwatch(); }}
          ondblclick={(e) => e.stopPropagation()}
        >
          <Icon name="x" size={16} />
        </button>
      {/if}
    </div>
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
  .tile.locked { cursor: pointer; }
  .watch { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: rgba(0, 0, 0, 0.6); color: #fff; }
  .tile.locked:hover .watch { background: rgba(0, 0, 0, 0.8); }
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
  .tools { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; }
  .tool {
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
  .tile:hover .tool, .tool.muted { opacity: 1; }
  .live { font-size: 9px; font-weight: 700; background: var(--red); border-radius: 4px; padding: 1px 4px; }
</style>