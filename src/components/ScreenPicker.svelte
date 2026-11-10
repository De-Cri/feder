<script lang="ts">
  import { onMount } from 'svelte';
  import { onPickScreenSource, pickScreenSource, type ScreenSource } from '../lib/platform';

  // Selettore schermo/finestra per Electron su X11 (su Wayland usa quello di sistema).
  let sources = $state<ScreenSource[] | null>(null);
  const screens = $derived(sources?.filter((s) => s.id.startsWith('screen:')) ?? []);
  const windows = $derived(sources?.filter((s) => !s.id.startsWith('screen:')) ?? []);

  onMount(() => onPickScreenSource((list) => (sources = list)));

  function choose(id: string | null) {
    pickScreenSource(id);
    sources = null;
  }
</script>

<svelte:window onkeydown={(e) => sources && e.key === 'Escape' && choose(null)} />

{#if sources}
  <div class="bg" role="presentation" onclick={() => choose(null)}>
    <div class="panel" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h2>Cosa vuoi condividere?</h2>
      {#each [{ title: 'Schermi', list: screens }, { title: 'Finestre', list: windows }] as group}
        {#if group.list.length}
          <h3>{group.title}</h3>
          <div class="grid">
            {#each group.list as s (s.id)}
              <button class="src" onclick={() => choose(s.id)}>
                <img src={s.thumb || undefined} alt="" draggable="false" />
                <span>{s.name}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/each}
      <div class="row"><button class="btn" onclick={() => choose(null)}>Annulla</button></div>
    </div>
  </div>
{/if}

<style>
  .bg {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.4);
    display: grid;
    place-items: center;
  }
  .panel {
    width: min(760px, calc(100% - 40px));
    max-height: calc(100% - 60px);
    overflow-y: auto;
    padding: 22px 24px;
    border-radius: var(--r-lg);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  h2 { margin: 0 0 4px; font-size: 17px; font-weight: 600; }
  h3 { margin: 16px 0 8px; font-size: 12px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .src {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: var(--r);
    text-align: left;
  }
  .src:hover { background: var(--bg-hover); }
  .src img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    border-radius: var(--r-sm);
    background: var(--bg-tile);
  }
  .src span { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
