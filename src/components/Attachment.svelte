<script lang="ts">
  import { openExternal } from '../lib/platform';
  import { signedUrl, type Message } from '../lib/state.svelte';
  import { bytes } from '../lib/util';
  import Icon from './Icon.svelte';

  let { message }: { message: Message } = $props();
  const mime = $derived(message.attachment_mime ?? '');
  const kind = $derived(
    mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file',
  );

  let url = $state<string | null>(null);
  let zoom = $state(false);

  $effect(() => {
    if (kind !== 'file' && message.attachment_path) signedUrl(message.attachment_path).then((u) => (url = u));
  });

  async function download() {
    const u = await signedUrl(message.attachment_path!, message.attachment_name ?? 'file');
    if (u) openExternal(u);
  }
</script>

{#if kind === 'image'}
  <button class="media" onclick={() => (zoom = true)}>
    {#if url}<img src={url} alt={message.attachment_name} loading="lazy" draggable="false" />{:else}<div class="ph"></div>{/if}
  </button>
{:else if kind === 'video'}
  <div class="media">
    {#if url}<!-- svelte-ignore a11y_media_has_caption --><video src={url} controls preload="metadata"></video>{/if}
  </div>
{:else if kind === 'audio'}
  {#if url}<audio src={url} controls preload="metadata"></audio>{/if}
{:else}
  <div class="file">
    <Icon name="file" size={22} />
    <div class="info">
      <div class="fname">{message.attachment_name}</div>
      <div class="size">{bytes(message.attachment_size)}</div>
    </div>
    <button class="icon-btn" title="Scarica" onclick={download}><Icon name="download" size={17} /></button>
  </div>
{/if}

{#if zoom && url}
  <div class="lightbox" role="presentation" onclick={() => (zoom = false)}>
    <img src={url} alt={message.attachment_name} />
    <button class="dl btn" onclick={(e) => { e.stopPropagation(); download(); }}>
      <Icon name="download" size={15} /> Scarica
    </button>
  </div>
{/if}

<svelte:window onkeydown={(e) => e.key === 'Escape' && (zoom = false)} />

<style>
  .media {
    display: block;
    margin-top: 6px;
    max-width: min(420px, 100%);
    border-radius: var(--r);
    overflow: hidden;
    background: var(--bg-tile);
  }
  .media img, .media video { display: block; max-width: 100%; max-height: 320px; object-fit: contain; }
  .ph { width: 280px; height: 180px; }
  audio { margin-top: 6px; height: 36px; }
  .file {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 380px;
    padding: 10px 8px 10px 12px;
    border-radius: var(--r);
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-2);
  }
  .info { flex: 1; min-width: 0; }
  .fname { color: var(--text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .size { font-size: 12px; }
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(0, 0, 0, 0.82);
    display: grid;
    place-items: center;
    padding: 40px;
  }
  /* Misure sulla finestra (non sulla griglia): l'immagine si ridimensiona insieme alla finestra. */
  .lightbox img {
    max-width: calc(100vw - 80px);
    max-height: calc(100vh - 80px);
    object-fit: contain;
    border-radius: var(--r);
  }
  .dl { position: absolute; bottom: 20px; right: 20px; background: rgba(255,255,255,0.15); color: #fff; }
</style>
