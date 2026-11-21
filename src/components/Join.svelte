<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import { t, type Key } from '../lib/i18n.svelte';

  // Open sign-ups: one button, up to the cap. Closed: the founders' password (0009).
  type Status = { open: boolean; members: number; max_members: number };
  let status = $state<Status | null>(null);
  let usePassword = $state(false);
  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const messages: Record<string, Key> = {
    wrong_password: 'join.wrongPassword',
    too_many_attempts: 'join.tooManyAttempts',
    banned: 'join.banned',
    server_full: 'join.full',
    closed: 'join.closedNow',
    busy: 'join.busy',
    not_configured: 'join.notConfigured',
    not_authenticated: 'join.sessionExpired',
  };

  async function loadStatus() {
    const { data } = await supabase.rpc('server_status');
    status = ((data as Status[] | null) ?? [])[0] ?? { open: false, members: 0, max_members: 0 };
  }
  onMount(loadStatus);

  const full = $derived(!!status && status.members >= status.max_members);
  const canJoinOpen = $derived(!!status?.open && !full);

  async function join(e: Event) {
    e.preventDefault();
    busy = true;
    error = null;
    const { data, error: err } =
      canJoinOpen && !usePassword
        ? await supabase.rpc('join_open')
        : await supabase.rpc('join_server', { p_password: password });
    busy = false;
    if (err) {
      error = err.message;
      return;
    }
    if (data === 'ok' || data === 'already_member') {
      app.membership = 'unknown';
      await app.checkMembership();
    } else if (data === 'banned') {
      app.membership = 'banned';
    } else {
      const key = messages[data as string];
      error = key ? t(key) : String(data);
      if (data === 'closed' || data === 'server_full') void loadStatus();
    }
  }
</script>

<div class="wrap">
  {#if app.membership === 'banned'}
    <div class="card">
      <h1>{t('join.deniedTitle')}</h1>
      <p class="muted">{app.banReason ? t('join.bannedReason', { reason: app.banReason }) : t('join.banned')}</p>
      <button class="btn" onclick={() => app.signOut()}>{t('join.logout')}</button>
    </div>
  {:else if !status}
    <div class="spinner"></div>
  {:else}
    <form class="card" onsubmit={join}>
      <div class="lock"><Icon name={canJoinOpen && !usePassword ? 'users' : 'lock'} size={22} /></div>
      {#if canJoinOpen && !usePassword}
        <h1>{t('join.openTitle')}</h1>
        <p class="muted">{t('join.hello')} <b>{app.myProfile?.username ?? ''}</b>, {t('join.openHint', { n: status.max_members - status.members })}</p>
        {#if error}<p class="err">{error}</p>{/if}
        <button class="btn primary" disabled={busy}>{busy ? '…' : t('join.enter')}</button>
        <button type="button" class="link" onclick={() => (usePassword = true)}>{t('join.havePassword')}</button>
      {:else}
        <h1>{status.open || usePassword ? t('join.title') : full ? t('join.full') : t('join.closedTitle')}</h1>
        <p class="muted">
          {#if status.open || usePassword}{t('join.hello')} <b>{app.myProfile?.username ?? ''}</b>, {t('join.hint')}
          {:else}{t('join.closedHint')}{/if}
        </p>
        <input class="field" type="password" placeholder={t('join.passwordPlaceholder')} bind:value={password} required />
        {#if error}<p class="err">{error}</p>{/if}
        <button class="btn primary" disabled={busy || !password}>{busy ? '…' : t('join.enter')}</button>
        {#if usePassword && canJoinOpen}
          <button type="button" class="link" onclick={() => (usePassword = false)}>{t('join.noPassword')}</button>
        {/if}
      {/if}
      <button type="button" class="link" onclick={() => app.signOut()}>{t('join.signOut')}</button>
    </form>
  {/if}
</div>

<style>
  .wrap {
    height: 100%;
    display: grid;
    place-items: center;
    background: var(--bg-sidebar);
  }
  .card {
    width: 360px;
    padding: 30px 28px 20px;
    background: var(--bg-elev);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
  .lock {
    width: 48px;
    height: 48px;
    margin: 0 auto;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    display: grid;
    place-items: center;
  }
  h1 { font-size: 19px; font-weight: 600; margin: 0; }
  p { margin: 0; font-size: 13px; }
  .err { color: var(--red); }
  .btn { height: 36px; }
  .link { font-size: 13px; color: var(--text-2); }
  .link:hover { color: var(--text); }
  .spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
