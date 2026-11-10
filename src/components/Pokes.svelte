<script lang="ts">
  import { app } from '../lib/state.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
</script>

{#if app.pokes.length}
  <div class="pokes">
    {#each app.pokes as p (p.key)}
      <div class="poke" role="alert">
        <Avatar id={p.from} size={32} />
        <div class="body">
          <div class="who">{app.name(p.from)} ti ha fatto un poke</div>
          {#if p.text}<div class="msg selectable">{p.text}</div>{/if}
        </div>
        <button class="icon-btn" title="Chiudi" onclick={() => app.closePoke(p.key)}><Icon name="x" size={16} /></button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .pokes {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(380px, calc(100vw - 32px));
  }
  .poke {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 8px 10px 12px;
    border-radius: var(--r);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    border-left: 3px solid var(--accent);
  }
  .body { flex: 1; min-width: 0; }
  .who { font-weight: 600; font-size: 13px; }
  .msg { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
</style>
