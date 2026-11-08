<script lang="ts">
  import { supabase } from '../lib/supabase';
  import { errorText } from '../lib/util';

  let mode = $state<'login' | 'register'>('login');
  let email = $state('');
  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const validUser = $derived(/^[a-z0-9_.]{3,20}$/.test(username));

  async function submit(e: Event) {
    e.preventDefault();
    error = null;
    if (mode === 'register' && !validUser) {
      error = 'Username: 3–20 caratteri, solo minuscole, numeri, _ e .';
      return;
    }
    if (password.length < 6) {
      error = 'La password deve avere almeno 6 caratteri.';
      return;
    }
    busy = true;
    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username } },
        });
        if (err) throw err;
        if (!data.session) error = 'Account creato, ma serve la conferma email: chiedi all’admin di disattivarla.';
      }
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <form class="card" onsubmit={submit}>
    <div class="logo" aria-hidden="true"></div>
    <h1>{mode === 'login' ? 'Bentornato' : 'Crea un account'}</h1>
    <p class="muted sub">Cerchio — solo per pochi.</p>

    <label class="label" for="email">Email</label>
    <input id="email" class="field" type="email" autocomplete="email" bind:value={email} required />

    {#if mode === 'register'}
      <label class="label" for="user">Username</label>
      <input
        id="user"
        class="field"
        autocomplete="username"
        bind:value={username}
        oninput={() => (username = username.toLowerCase())}
        placeholder="es. samu"
        required
      />
    {/if}

    <label class="label" for="pw">Password</label>
    <input
      id="pw"
      class="field"
      type="password"
      autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
      bind:value={password}
      required
    />

    {#if error}<p class="err">{error}</p>{/if}

    <button class="btn primary full" disabled={busy}>
      {busy ? '…' : mode === 'login' ? 'Accedi' : 'Registrati'}
    </button>

    <button
      type="button"
      class="switch"
      onclick={() => {
        mode = mode === 'login' ? 'register' : 'login';
        error = null;
      }}
    >
      {mode === 'login' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
    </button>
  </form>
</div>

<style>
  .wrap {
    height: 100%;
    display: grid;
    place-items: center;
    background: var(--bg-sidebar);
  }
  .card {
    width: 340px;
    padding: 32px 28px 22px;
    background: var(--bg-elev);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
  }
  .logo {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 5px solid var(--accent);
    margin: 0 auto 14px;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    text-align: center;
    margin: 0;
    letter-spacing: -0.01em;
  }
  .sub {
    text-align: center;
    margin: 4px 0 22px;
    font-size: 13px;
  }
  .label { margin-top: 12px; }
  .err { margin: 12px 0 0; }
  .full { width: 100%; margin-top: 20px; height: 36px; }
  .switch {
    margin-top: 14px;
    font-size: 13px;
    color: var(--accent);
    align-self: center;
  }
  .switch:hover { text-decoration: underline; }
</style>
