<script lang="ts">
  import { app, type Channel } from '../lib/state.svelte';
  import { social, FRIENDS_VIEW } from '../lib/social.svelte';
  import { voice } from '../lib/voice.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import MemberList from './MemberList.svelte';
  import ChatDialog from './ChatDialog.svelte';
  import { t } from '../lib/i18n.svelte';

  // Right column: friends & invites, your private chats, then the server's members.
  let dialog = $state<{ chat: Channel | null } | null>(null);

  function open(c: Channel) {
    app.view = c.id;
    if (c.kind === 'voice' && voice.channelId !== c.id) voice.join(c.id);
  }
</script>

<aside class="right">
  <div class="top">
    <button class="nav-item" class:active={app.view === FRIENDS_VIEW} onclick={() => (app.view = FRIENDS_VIEW)}>
      <Icon name="users" size={16} />
      <span class="name">{t('social.page')}</span>
      {#if social.pending}<span class="badge">{social.pending}</span>{/if}
    </button>

    <div class="head">
      <span>{t('chats.title')}</span>
      <button class="icon-btn" title={t('chats.new')} onclick={() => (dialog = { chat: null })}><Icon name="plus" size={16} /></button>
    </div>
    {#each app.chats as c (c.id)}
      <div class="chat" class:active={app.view === c.id}>
        <button class="nav-item" onclick={() => open(c)}>
          <Icon name={c.kind === 'voice' ? 'volume' : 'hash'} size={16} />
          <span class="name">{c.name}</span>
          {#if app.unread[c.id]}<span class="badge">{app.unread[c.id]}</span>{/if}
        </button>
        <button class="icon-btn more" title={t('chats.manage')} onclick={() => (dialog = { chat: c })}><Icon name="more" size={15} /></button>
      </div>
      {#if c.kind === 'voice'}
        {#each app.inVoice(c.id) as p (p.user_id)}
          <div class="participant">
            <Avatar id={p.user_id} size={18} />
            <span class="pname">{app.name(p.user_id)}</span>
            {#if p.screen}<span class="live">LIVE</span>{/if}
          </div>
        {/each}
      {/if}
    {:else}
      <p class="empty">{t('chats.empty')}</p>
    {/each}
  </div>

  <MemberList />
</aside>

{#if dialog}
  <!-- the chat may have been renamed or deleted meanwhile: use the current one -->
  <ChatDialog chat={dialog.chat ? app.chats.find((c) => c.id === dialog!.chat!.id) ?? null : null} onclose={() => (dialog = null)} />
{/if}

<style>
  .right {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
  }
  .top {
    flex: none;
    max-height: 50%;
    overflow-y: auto;
    padding: 10px 10px 8px;
    border-bottom: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 4px 4px 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .chat { position: relative; display: flex; align-items: center; }
  .chat .nav-item { flex: 1; min-width: 0; padding-right: 30px; }
  .chat.active .nav-item { background: var(--bg-active); color: var(--text); }
  .more { position: absolute; right: 4px; opacity: 0; }
  .chat:hover .more, .chat.active .more { opacity: 1; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
  .participant {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px 0 30px;
    color: var(--text-2);
    font-size: 12px;
  }
  .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .live { font-size: 9px; font-weight: 700; color: #fff; background: var(--red); border-radius: 4px; padding: 1px 4px; }
  .empty { margin: 4px 8px; font-size: 12px; color: var(--text-3); }
</style>
