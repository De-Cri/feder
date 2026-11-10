<script lang="ts">
  import { onMount } from 'svelte';
  import { RELEASES, markReleasesSeen } from '../lib/releases';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  onMount(() => {
    markReleasesSeen();
    app.releasesUnseen = false;
  });
</script>

<div class="channel">
  <header>
    <Icon name="megaphone" size={18} />
    <h2>novità</h2>
  </header>

  <div class="scroller">
    {#each RELEASES as r, i (r.version)}
      <article>
        <div class="head">
          <span class="ver">Feder {r.version}</span>
          {#if i === 0}<span class="tag">ultima</span>{/if}
          <span class="date">{r.date}</span>
        </div>
        <h3>Cosa c'è di nuovo</h3>
        <ul>
          {#each r.added as a}<li>{a}</li>{/each}
        </ul>
        <h3>Come provarlo</h3>
        <ul class="test">
          {#each r.test as t}<li>{t}</li>{/each}
        </ul>
      </article>
    {/each}
  </div>
</div>

<style>
  .channel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    height: 52px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    min-width: 0;
  }
  h2 { font-size: 15px; font-weight: 600; margin: 0; color: var(--text); }
  .scroller {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  article {
    max-width: 760px;
    padding: 18px 20px;
    border-radius: var(--r-lg);
    background: var(--bg-elev);
    border: 1px solid var(--border);
  }
  .head { display: flex; align-items: baseline; gap: 10px; }
  .ver { font-size: 17px; font-weight: 600; color: var(--text); }
  .tag {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .date { margin-left: auto; font-size: 12px; color: var(--text-3); }
  h3 {
    margin: 14px 0 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
  li { font-size: 14px; line-height: 1.45; color: var(--text-2); }
  .test li::marker { color: var(--accent); }
</style>
