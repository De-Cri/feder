<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { social } from '../lib/social.svelte';
  import { dm } from '../lib/dm.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';

  // Friends & invites: add people, answer requests and chat invites, manage friends.
  let username = $state('');
  let msg = $state<{ text: string; ok: boolean } | null>(null);
  let busy = $state(false);

  const byName = (a: string, b: string) => app.name(a).localeCompare(app.name(b));
  const friends = $derived([...social.friends].sort(byName));

  async function run(fn: () => Promise<string | null>, ok?: string) {
    busy = true;
    const err = await fn();
    busy = false;
    msg = err ? { text: err, ok: false } : ok ? { text: ok, ok: true } : null;
    return err;
  }

  async function add() {
    const err = await run(() => social.requestByName(username), t('social.requestSent'));
    if (!err) username = '';
  }
</script>

<div class="page">
  <header><Icon name="users" size={18} /><h2>{t('social.page')}</h2></header>

  <div class="content">
    <h3>{t('social.add')}</h3>
    <form class="inline" onsubmit={(e) => { e.preventDefault(); add(); }}>
      <input class="field" placeholder={t('social.addPlaceholder')} bind:value={username} />
      <button class="btn primary" disabled={busy || !username.trim()}>{t('social.addFriend')}</button>
    </form>
    {#if msg}<p class:err={!msg.ok} class:ok={msg.ok}>{msg.text}</p>{/if}

    {#if social.incomingInvites.length}
      <h3>{t('social.invites')}</h3>
      {#each social.incomingInvites as i (i.id)}
        <div class="row">
          <Avatar id={i.inviter} size={32} />
          <span class="who">
            <Icon name={i.kind === 'voice' ? 'volume' : 'hash'} size={14} />
            {t('social.invitedYou', { name: app.name(i.inviter), chat: i.channel_name })}
          </span>
          <button class="btn primary small" disabled={busy} onclick={() => run(() => social.respondInvite(i, true))}>{t('social.accept')}</button>
          <button class="btn small" disabled={busy} onclick={() => run(() => social.respondInvite(i, false))}>{t('social.decline')}</button>
        </div>
      {/each}
    {/if}

    {#if social.incomingRequests.length}
      <h3>{t('social.requests')}</h3>
      {#each social.incomingRequests as id (id)}
        <div class="row">
          <Avatar {id} size={32} status={app.presence[id] ? 'online' : 'offline'} />
          <span class="who">{app.name(id)}</span>
          <button class="btn primary small" disabled={busy} onclick={() => run(() => social.respond(id, true))}>{t('social.accept')}</button>
          <button class="btn small" disabled={busy} onclick={() => run(() => social.respond(id, false))}>{t('social.decline')}</button>
        </div>
      {/each}
    {/if}

    {#if social.outgoingRequests.length || social.outgoingInvites.length}
      <h3>{t('social.sent')}</h3>
      {#each social.outgoingRequests as id (id)}
        <div class="row off">
          <Avatar {id} size={32} />
          <span class="who">{app.name(id)} · {t('social.pendingRequest')}</span>
          <button class="btn small" disabled={busy} onclick={() => run(() => social.remove(id))}>{t('common.cancel')}</button>
        </div>
      {/each}
      {#each social.outgoingInvites as i (i.id)}
        <div class="row off">
          <Avatar id={i.invitee} size={32} />
          <span class="who">{t('social.sentInvite', { chat: i.channel_name, name: app.name(i.invitee) })}</span>
          <button class="btn small" disabled={busy} onclick={() => run(() => social.cancelInvite(i))}>{t('common.cancel')}</button>
        </div>
      {/each}
    {/if}

    <h3>{t('social.friends')} — {friends.length}</h3>
    {#each friends as id (id)}
      <div class="row">
        <Avatar {id} size={32} status={app.presence[id] ? 'online' : 'offline'} />
        <span class="who">{app.name(id)}</span>
        {#if dm.status !== 'off'}
          <button class="icon-btn" title={t('menu.privateMessage')} onclick={() => dm.enter(id)}><Icon name="chat" size={16} /></button>
        {/if}
        <button class="btn ghost small" disabled={busy} onclick={() => run(() => social.remove(id))}>{t('social.remove')}</button>
        <button class="btn ghost small danger-text" disabled={busy} onclick={() => run(() => social.block(id, true))}>{t('social.block')}</button>
      </div>
    {:else}
      <p class="muted">{t('social.noFriends')}</p>
    {/each}

    {#if social.blocked.length}
      <h3>{t('social.blocked')}</h3>
      {#each social.blocked as id (id)}
        <div class="row off">
          <Avatar {id} size={32} />
          <span class="who">{app.name(id)}</span>
          <button class="btn small" disabled={busy} onclick={() => run(() => social.block(id, false))}>{t('social.unblock')}</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  header {
    flex: none;
    height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
  }
  h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .content { flex: 1; overflow-y: auto; padding: 8px 24px 32px; max-width: 720px; width: 100%; }
  h3 {
    margin: 24px 0 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .inline { display: flex; gap: 8px; }
  .inline .field { flex: 1; max-width: 320px; }
  p { margin: 8px 0 0; font-size: 13px; }
  .err { color: var(--red); }
  .ok { color: var(--green); }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 0 8px;
    border-radius: var(--r-sm);
  }
  .row:hover { background: var(--bg-hover); }
  .row.off { opacity: 0.7; }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 500;
  }
  .btn.small { height: 28px; padding: 0 12px; font-size: 12px; }
  .danger-text { color: var(--red); }
</style>
