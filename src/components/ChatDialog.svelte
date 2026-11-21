<script lang="ts">
  import { app, type Channel } from '../lib/state.svelte';
  import { social } from '../lib/social.svelte';
  import { voice } from '../lib/voice.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';

  // Without `chat`: create a new private chat. With `chat`: its members, invites and settings.
  let { chat = null, onclose }: { chat?: Channel | null; onclose: () => void } = $props();

  // editable copies: they start from the chat and then follow what you type
  // svelte-ignore state_referenced_locally
  let name = $state(chat?.name ?? '');
  // svelte-ignore state_referenced_locally
  let kind = $state<'text' | 'voice'>(chat?.kind ?? 'text');
  let query = $state('');
  let picked = $state<Record<string, true>>({});
  let error = $state<string | null>(null);
  let busy = $state(false);
  let confirmDelete = $state(false);

  const members = $derived(chat ? social.chatMembers[chat.id] ?? [] : []);
  const owner = $derived(chat ? social.isOwner(chat.id) : true);
  const pendingInvites = $derived(chat ? social.outgoingInvites.filter((i) => i.channel_id === chat.id) : []);
  // friends you can still invite, alphabetical, filtered by the search
  const candidates = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return social.friends
      .filter((id) => !members.some((m) => m.user_id === id) && !pendingInvites.some((i) => i.invitee === id))
      .map((id) => ({ id, name: app.name(id) }))
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  async function run(fn: () => Promise<string | null>) {
    busy = true;
    error = await fn();
    busy = false;
  }

  async function create() {
    busy = true;
    const res = await social.createChat(name, kind, Object.keys(picked));
    busy = false;
    error = res.error;
    if (res.id === undefined) return;
    app.view = res.id;
    if (kind === 'voice') voice.join(res.id);
    onclose();
  }

  async function leaveOrDelete(del: boolean) {
    if (!chat) return;
    if (voice.channelId === chat.id) await voice.leave();
    busy = true;
    error = del ? await social.deleteChat(chat.id) : await social.leave(chat.id);
    busy = false;
    if (!error) onclose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="bg" role="presentation" onclick={onclose}>
  <div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <h3>{chat ? t('chats.manage') : t('chats.new')}</h3>

    {#if !chat}
      <div class="kinds">
        <button class="kind" class:on={kind === 'text'} onclick={() => (kind = 'text')}><Icon name="hash" size={16} /> {t('chats.text')}</button>
        <button class="kind" class:on={kind === 'voice'} onclick={() => (kind = 'voice')}><Icon name="volume" size={16} /> {t('chats.voice')}</button>
      </div>
    {/if}

    {#if !chat || owner}
      <div class="inline">
        <!-- svelte-ignore a11y_autofocus -->
        <input class="field" maxlength="32" placeholder={t('chats.name')} bind:value={name} autofocus={!chat} />
        {#if chat}
          <button class="btn" disabled={busy || name.trim() === chat.name} onclick={() => run(() => social.rename(chat.id, name))}>{t('chats.rename')}</button>
        {/if}
      </div>
    {/if}

    {#if chat}
      <div class="label">{t('chats.members', { n: members.length })}</div>
      <div class="list">
        {#each members as m (m.user_id)}
          <div class="person">
            <Avatar id={m.user_id} size={28} status={app.presence[m.user_id] ? 'online' : 'offline'} />
            <span class="pname">{app.name(m.user_id)}</span>
            {#if m.role === 'owner'}<span class="tag">{t('chats.owner')}</span>
            {:else if owner}
              <button class="btn ghost small" disabled={busy} onclick={() => run(() => social.removeMember(chat.id, m.user_id))}>{t('chats.removeMember')}</button>
            {/if}
          </div>
        {/each}
        {#each pendingInvites as i (i.id)}
          <div class="person off">
            <Avatar id={i.invitee} size={28} />
            <span class="pname">{app.name(i.invitee)}</span>
            <span class="tag">{t('chats.pending')}</span>
            <button class="icon-btn" title={t('common.cancel')} disabled={busy} onclick={() => run(() => social.cancelInvite(i))}><Icon name="x" size={14} /></button>
          </div>
        {/each}
      </div>
    {/if}

    {#if !chat || owner}
      <div class="label">{t('chats.inviteFriends')}</div>
      {#if social.friends.length > 6}
        <input class="field" placeholder={t('chats.search')} bind:value={query} />
      {/if}
      <div class="list">
        {#each candidates as c (c.id)}
          {#if chat}
            <div class="person">
              <Avatar id={c.id} size={28} status={app.presence[c.id] ? 'online' : 'offline'} />
              <span class="pname">{c.name}</span>
              <button class="btn small" disabled={busy} onclick={() => run(() => social.invite(chat.id, c.id))}>{t('chats.invite')}</button>
            </div>
          {:else}
            <label class="person pick">
              <Avatar id={c.id} size={28} status={app.presence[c.id] ? 'online' : 'offline'} />
              <span class="pname">{c.name}</span>
              <input
                type="checkbox"
                checked={!!picked[c.id]}
                onchange={(e) => {
                  if (e.currentTarget.checked) picked[c.id] = true;
                  else delete picked[c.id];
                }}
              />
            </label>
          {/if}
        {:else}
          <p class="muted small">{t('chats.noFriendsToInvite')}</p>
        {/each}
      </div>
      <p class="muted small">{t('chats.limits')}</p>
    {/if}

    {#if error}<p class="err">{error}</p>{/if}

    <div class="row">
      {#if chat}
        {#if confirmDelete}
          <span class="grow small">{t('chats.deleteConfirm', { name: chat.name })}</span>
          <button class="btn" onclick={() => (confirmDelete = false)}>{t('common.cancel')}</button>
          <button class="btn danger" disabled={busy} onclick={() => leaveOrDelete(true)}>{t('chats.delete')}</button>
        {:else}
          <button class="btn ghost danger-text" disabled={busy} onclick={() => leaveOrDelete(false)}>{t('chats.leave')}</button>
          {#if owner}<button class="btn ghost danger-text" onclick={() => (confirmDelete = true)}>{t('chats.delete')}</button>{/if}
          <span class="grow"></span>
          <button class="btn" onclick={onclose}>OK</button>
        {/if}
      {:else}
        <button class="btn" onclick={onclose}>{t('common.cancel')}</button>
        <button class="btn primary" disabled={busy || !name.trim()} onclick={create}>{t('chats.create')}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .bg {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
  }
  .modal {
    width: 420px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 22px;
    border-radius: var(--r-lg);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h3 { margin: 0; font-size: 16px; }
  p { margin: 0; }
  .small { font-size: 12px; }
  .label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 4px;
  }
  .kinds { display: flex; gap: 8px; }
  .kind {
    flex: 1;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-weight: 500;
  }
  .kind.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
  .inline { display: flex; gap: 8px; }
  .inline .field { flex: 1; }
  .list { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto; }
  .person {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 0 8px;
    border-radius: var(--r-sm);
  }
  .person.pick { cursor: pointer; }
  .person:hover { background: var(--bg-hover); }
  .person.off { opacity: 0.6; }
  .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
  .tag { font-size: 11px; color: var(--text-3); }
  .btn.small { height: 26px; padding: 0 10px; font-size: 12px; }
  .danger-text { color: var(--red); }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .grow { flex: 1; }
  .err { color: var(--red); font-size: 13px; }
</style>
