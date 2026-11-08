<script lang="ts">
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const messages: Record<string, string> = {
    wrong_password: 'Password del server errata.',
    too_many_attempts: 'Troppi tentativi. Riprova tra 15 minuti.',
    banned: 'Sei stato bannato da questo server.',
    server_full: 'Il server è pieno.',
    not_configured: 'Il server non è ancora configurato.',
    not_authenticated: 'Sessione scaduta, accedi di nuovo.',
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
      error = messages[data as string] ?? String(data);
    }
  }
</script>

<div class="wrap">
  {#if app.membership === 'banned'}
    <div class="card">
      <h1>Accesso negato</h1>
      <p class="muted">Sei stato bannato dal server{app.banReason ? `: ${app.banReason}` : '.'}</p>
      <button class="btn" onclick={() => app.signOut()}>Esci</button>
    </div>
  {:else}
    <form class="card" onsubmit={join}>
      <div class="lock"><Icon name="lock" size={22} /></div>
      <h1>Entra nel server</h1>
      <p class="muted">Ciao <b>{app.myProfile?.username ?? ''}</b>, inserisci la password che ti ha dato l’admin.</p>
      <input class="field" type="password" placeholder="Password del server" bind:value={password} required />
      {#if error}<p class="err">{error}</p>{/if}
      <button class="btn primary" disabled={busy || !password}>{busy ? '…' : 'Entra'}</button>
      <button type="button" class="link" onclick={() => app.signOut()}>Esci dall’account</button>
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
