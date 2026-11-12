<script lang="ts">
  import { app, POKE_MAX } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  // "Poke" menu entry: for people with their audio off (like on TeamSpeak).
  let { id, onsent }: { id: string; onsent: () => void } = $props();

  let open = $state(false);
  let text = $state('');
  let err = $state<string | null>(null);

  function send() {
    if (app.poke(id, text)) onsent();
    else err = 'Aspetta un attimo prima di rifarlo.';
  }
</script>

{#if !open}
  <button class="item" onclick={() => (open = true)}>
    <Icon name="bell" size={15} /> Poke
  </button>
{:else}
  <form class="poke" onsubmit={(e) => { e.preventDefault(); send(); }}>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={text} maxlength={POKE_MAX} placeholder="Messaggio (facoltativo)" autofocus />
    <button class="btn" type="submit">Invia</button>
  </form>
  {#if err}<p class="err">{err}</p>{/if}
{/if}

<style>
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
  .item:hover { background: var(--accent); color: #fff; }
  .poke { display: flex; gap: 6px; padding: 4px 8px 6px; }
  .poke input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    background: var(--bg-input);
    color: var(--text);
    font-size: 13px;
  }
  .poke .btn { height: 30px; padding: 0 10px; font-size: 12px; }
  .err { margin: 0 8px 6px; font-size: 12px; color: var(--red); }
</style>
