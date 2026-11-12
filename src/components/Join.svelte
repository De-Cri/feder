<script lang="ts">
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';
  import { t, type Key } from '../lib/i18n.svelte';

  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const messages: Record<string, Key> = {
    wrong_password: 'join.wrongPassword',
    too_many_attempts: 'join.tooManyAttempts',
    banned: 'join.banned',
    server_full: 'join.full',
    not_configured: 'join.notConfigured',
    not_authenticated: 'join.sessionExpired',
  };

  async function join(e: Event) {
    e.preventDefault();
    busy = true;
    error = null;
    const { data, error: err } = await supabase.rpc('join_server', { p_password: password });
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
  {:else}
    <form class="card" onsubmit={join}>
      <div class="lock"><Icon name="lock" size={22} /></div>
      <h1>{t('join.title')}</h1>
      <p class="muted">{t('join.hello')} <b>{app.myProfile?.username ?? ''}</b>, {t('join.hint')}</p>
      <input class="field" type="password" placeholder={t('join.passwordPlaceholder')} bind:value={password} required />
      {#if error}<p class="err">{error}</p>{/if}
      <button class="btn primary" disabled={busy || !password}>{busy ? '…' : t('join.enter')}</button>
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
  .btn { height: 36px; }
  .link { font-size: 13px; color: var(--text-2); }
  .link:hover { color: var(--text); }
</style>
