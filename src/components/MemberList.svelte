<script lang="ts">
  import { app } from '../lib/state.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import UserMenu from './UserMenu.svelte';
  import UserConfirm from './UserConfirm.svelte';

  const sorted = $derived(
    [...app.members].sort((a, b) => app.name(a.user_id).localeCompare(app.name(b.user_id))),
  );
  const online = $derived(sorted.filter((m) => app.presence[m.user_id]));
  const offline = $derived(sorted.filter((m) => !app.presence[m.user_id]));

  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  let confirm = $state<{ id: string; action: 'kick' | 'ban' } | null>(null);

  function openMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    menu = { id, x: e.clientX, y: e.clientY };
  }
</script>

<aside class="side">
  {#snippet row(id: string, role: string, contributor: boolean, isOnline: boolean)}
    <button
      class="member"
      class:off={!isOnline}
      onclick={(e) => openMenu(e, id)}
      oncontextmenu={(e) => openMenu(e, id)}
    >
      <Avatar {id} size={30} status={isOnline ? 'online' : 'offline'} />
      <span class="name">{app.name(id)}</span>
      {#if role === 'admin'}<span class="badge admin" data-tip="Admin" aria-label="Admin"><Icon name="shield" size={13} /></span>{/if}
      {#if contributor}<span class="badge contrib" data-tip="Contributor" aria-label="Contributor"><Icon name="code" size={13} /></span>{/if}
      {#if app.voiceMutes[id]}<span class="muted-ic" title="Silenziato dall’admin"><Icon name="mic-off" size={13} /></span>{/if}
      {#if app.presence[id]?.voice}<span class="in-voice" title="In vocale"><Icon name="volume" size={13} /></span>{/if}
    </button>
  {/snippet}

  <div class="section">Online — {online.length}</div>
  {#each online as m (m.user_id)}{@render row(m.user_id, m.role, !!m.contributor, true)}{/each}
  {#if offline.length}
    <div class="section">Offline — {offline.length}</div>
    {#each offline as m (m.user_id)}{@render row(m.user_id, m.role, !!m.contributor, false)}{/each}
  {/if}
</aside>

{#if menu}
  <UserMenu
    id={menu.id}
    x={menu.x}
    y={menu.y}
    onclose={() => (menu = null)}
    onconfirm={(action) => {
      confirm = { id: menu!.id, action };
      menu = null;
    }}
  />
{/if}

{#if confirm}
  <UserConfirm id={confirm.id} action={confirm.action} onclose={() => (confirm = null)} />
{/if}

<style>
  aside {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    overflow-y: auto;
    padding: 4px 10px 12px;
  }
  .section {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 16px 8px 6px;
  }
  .section:first-child { padding-top: 4px; }
  .member {
    width: 100%;
    height: 42px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .member:hover { background: var(--bg-hover); }
  .member.off { opacity: 0.5; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
  .admin { color: var(--orange); display: flex; }
  .contrib { color: var(--accent); display: flex; }
  /* Tooltip immediato sui badge (il title nativo arriva in ritardo o non compare). */
  .badge { position: relative; }
  .badge:hover::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 6px);
    right: -6px;
    padding: 3px 8px;
    border-radius: 4px;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    z-index: 5;
  }
  .muted-ic { color: var(--red); display: flex; }
  .in-voice { color: var(--green); display: flex; }
</style>