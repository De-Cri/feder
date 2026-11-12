<script lang="ts">
  // Sidebar on the private messages screen: your chats instead of the channels.
  import { app } from '../lib/state.svelte';
  import { dm } from '../lib/dm.svelte';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
</script>

<div class="head">
  <button class="icon-btn" title="Torna ai canali" onclick={() => dm.leave()}>
    <Icon name="arrow-left" size={17} />
  </button>
  <span class="title">Messaggi</span>
  <button class="icon-btn" class:on={dm.current === null} title="Nuova chat" onclick={() => (dm.current = null)}>
    <Icon name="plus" size={17} />
  </button>
</div>

{#each dm.conversations as c (c.peer)}
  <button class="nav-item conv" class:active={dm.current === c.peer} onclick={() => dm.enter(c.peer)}>
    <Avatar id={c.peer} size={24} status={app.presence[c.peer] ? 'online' : 'offline'} />
    <span class="name" class:unread={!!dm.unread[c.peer]}>{app.name(c.peer)}</span>
    {#if dm.unread[c.peer]}<span class="badge">{dm.unread[c.peer]}</span>{/if}
  </button>
{:else}
  <button class="nav-item start" onclick={() => (dm.current = null)}>
    <Icon name="plus" size={16} />
    <span class="name">Nuova chat</span>
  </button>
{/each}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 0 8px;
    margin-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .title { flex: 1; font-weight: 600; font-size: 15px; padding-left: 2px; }
  .conv { height: 40px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name.unread { color: var(--text); font-weight: 600; }
  .badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    display: grid;
    place-items: center;
  }
  .start { font-size: 14px; color: var(--text-3); }
</style>
