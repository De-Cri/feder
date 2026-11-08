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
    ondblclick?: () => void;
    oncontextmenu?: (e: MouseEvent) => void;
  } = $props();

  let video: HTMLVideoElement | undefined = $state();
  const p = $derived(app.online[id]);

  $effect(() => {
    void rev;
    if (video && video.srcObject !== stream) video.srcObject = stream;
    video?.play().catch(() => {});
  });
</script>

<div class="tile" class:speaking class:focused role="presentation" {ondblclick} {oncontextmenu}>
  {#if hasVideo}
    <video bind:this={video} autoplay playsinline muted class:mirror={mirror && !p?.screen}></video>
  {:else}
    <Avatar {id} size={focused ? 96 : 64} {speaking} />
  {/if}
  <div class="label">
    {#if p && (!p.mic || app.voiceMutes[id])}<Icon name="mic-off" size={13} />{/if}
    {#if p?.deaf}<Icon name="headphones-off" size={13} />{/if}
    <span>{app.name(id)}{id === app.me ? ' (tu)' : ''}</span>
    {#if p?.screen}<span class="live">LIVE</span>{/if}
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
  .tile.focused video { object-fit: contain; }
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
