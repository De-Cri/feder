<script lang="ts">
  import { app, signedUrl } from '../lib/state.svelte';
  import { avatarColor } from '../lib/util';

  let {
    id,
    size = 32,
    status = null,
    speaking = false,
  }: { id: string | null; size?: number; status?: 'online' | 'offline' | null; speaking?: boolean } = $props();

  const profile = $derived(id ? app.profiles[id] : null);
  const letter = $derived((profile?.username ?? '?').slice(0, 1).toUpperCase());
  let src = $state<string | null>(null);

  $effect(() => {
    const path = profile?.avatar_path;
    src = null;
    if (path) signedUrl(path).then((u) => (src = u));
  });
</script>

<span
  class="av"
  class:speaking
  style="--s:{size}px; --c:{id ? avatarColor(id) : '#8e8e93'}"
>
  {#if src}
    <img {src} alt="" draggable="false" />
  {:else}
    <span class="letter">{letter}</span>
  {/if}
  {#if status}
    <span class="dot" class:on={status === 'online'}></span>
  {/if}
</span>

<style>
  .av {
    position: relative;
    width: var(--s);
    height: var(--s);
    flex: none;
    border-radius: 50%;
    background: var(--c);
    display: inline-grid;
    place-items: center;
    color: #fff;
    font-weight: 600;
    font-size: calc(var(--s) * 0.42);
    transition: box-shadow 0.12s;
  }
  .av.speaking { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--green); }
  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: calc(var(--s) * 0.32);
    height: calc(var(--s) * 0.32);
    min-width: 9px;
    min-height: 9px;
    border-radius: 50%;
    background: var(--text-3);
    border: 2px solid var(--bg-sidebar);
  }
  .dot.on { background: var(--green); }
</style>