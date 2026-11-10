<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import { prefs, savePrefs, setTheme, type Theme } from '../lib/prefs.svelte';
  import { appVersion, checkUpdate } from '../lib/platform';
  import { errorText } from '../lib/util';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import AudioSettings from './AudioSettings.svelte';
  import AvatarCropper from './AvatarCropper.svelte';

  type Tab = 'profile' | 'appearance' | 'notifications' | 'media' | 'admin' | 'about';
  let tab = $state<Tab>('profile');
  let msg = $state<{ ok: boolean; text: string } | null>(null);

  // profilo
  let username = $state(app.myProfile?.username ?? '');
  let avatarInput: HTMLInputElement | undefined = $state();
  let cropFile = $state<File | null>(null);

  // admin
  let newPass = $state('');
  let bans = $state<{ user_id: string; reason: string | null; banned_at: string }[]>([]);

  // info
  let version = $state('');
  let updateState = $state<string | null>(null);

  const themes: { v: Theme; label: string }[] = [
    { v: 'system', label: 'Sincronizza con il sistema' },
    { v: 'light', label: 'Chiaro' },
    { v: 'dark', label: 'Scuro (grigio)' },
    { v: 'black', label: 'Nero' },
    { v: 'oled', label: 'Nero profondo' },
  ];

  onMount(() => {
    appVersion().then((v) => (version = v));
  });

  $effect(() => {
    if (tab === 'admin' && app.isAdmin) loadBans();
  });

  function flash(ok: boolean, text: string) {
    msg = { ok, text };
    setTimeout(() => (msg = null), 3500);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (cropFile) cropFile = null;
    else app.settingsOpen = false;
  }

  async function saveUsername() {
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,20}$/.test(u)) return flash(false, 'Username: 3–20 caratteri, minuscole, numeri, _ e .');
    const { error } = await supabase.from('profiles').update({ username: u }).eq('id', app.me!);
    if (error) flash(false, error.code === '23505' ? 'Username già in uso.' : errorText(error));
    else {
      app.profiles[app.me!] = { ...app.profiles[app.me!], username: u };
      flash(true, 'Salvato.');
    }
  }

  async function uploadAvatar(blob: Blob) {
    if (blob.size > 5 * 1024 * 1024) return flash(false, 'Massimo 5 MB.');
    const path = `${app.me}/avatar-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('attachments').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) return flash(false, errorText(error));
    const old = app.myProfile?.avatar_path;
    const { error: e2 } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', app.me!);
    if (e2) return flash(false, errorText(e2));
    app.profiles[app.me!] = { ...app.profiles[app.me!], avatar_path: path };
    if (old) supabase.storage.from('attachments').remove([old]);
    flash(true, 'Avatar aggiornato.');
  }

  function pickAvatar(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) return flash(false, 'Scegli un’immagine.');
    cropFile = f;
  }

  function setPref<K extends keyof typeof prefs>(k: K, v: (typeof prefs)[K]) {
    prefs[k] = v;
    savePrefs();
  }

  async function changePassword() {
    const { error } = await supabase.rpc('admin_set_password', { p_password: newPass });
    if (error) flash(false, errorText(error));
    else {
      newPass = '';
      flash(true, 'Password del server cambiata. I membri attuali restano dentro.');
    }
  }

  async function loadBans() {
    const { data } = await supabase.from('bans').select('*').order('banned_at', { ascending: false });
    bans = data ?? [];
  }

  async function unban(id: string) {
    const { error } = await supabase.rpc('admin_unban', { p_user: id });
    if (error) flash(false, errorText(error));
    else loadBans();
  }

  async function runUpdateCheck() {
    updateState = 'Controllo…';
    const u = await checkUpdate();
    if (!u) {
      updateState = 'Sei all’ultima versione.';
      return;
    }
    updateState = `Installo ${u.version}…`;
    await u.install();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="bg" role="presentation" onclick={() => (app.settingsOpen = false)}>
  <div class="panel" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <nav>
      <div class="group">Impostazioni utente</div>
      <button class:active={tab === 'profile'} onclick={() => (tab = 'profile')}>Il mio account</button>
      <button class:active={tab === 'media'} onclick={() => (tab = 'media')}>Voce e video</button>
      <button class:active={tab === 'notifications'} onclick={() => (tab = 'notifications')}>Notifiche</button>
      <button class:active={tab === 'appearance'} onclick={() => (tab = 'appearance')}>Aspetto</button>

      {#if app.isAdmin}
        <div class="group">Amministrazione</div>
        <button class:active={tab === 'admin'} onclick={() => (tab = 'admin')}>Server</button>
      {/if}

      <div class="group">App</div>
      <button class:active={tab === 'about'} onclick={() => (tab = 'about')}>Info</button>

      <span class="grow"></span>
      <button class="logout" onclick={() => { app.settingsOpen = false; app.signOut(); }}>
        <Icon name="logout" size={15} /> Esci
      </button>
    </nav>

    <section>
      <button class="close" title="Chiudi (Esc)" onclick={() => (app.settingsOpen = false)}>
        <Icon name="x" size={20} />
        <span>ESC</span>
      </button>

      <div class="content">
        {#if tab === 'profile'}
          <h2>Il mio account</h2>
          <div class="card">
            <div class="user-row">
              <Avatar id={app.me} size={80} />
              <div class="user-info">
                <div class="uname">{app.myProfile?.username}</div>
                <div class="muted small">{app.isAdmin ? 'Admin' : 'Membro'}</div>
              </div>
              <button class="btn" onclick={() => avatarInput?.click()}>Cambia avatar</button>
              <input
                type="file"
                accept="image/*"
                hidden
                bind:this={avatarInput}
                onchange={(e) => {
                  pickAvatar(e.currentTarget.files?.[0]);
                  e.currentTarget.value = '';
                }}
              />
            </div>
          </div>

          <h3>Nome utente</h3>
          <div class="inline">
            <input class="field" bind:value={username} />
            <button class="btn primary" onclick={saveUsername}>Salva</button>
          </div>

        {:else if tab === 'appearance'}
          <h2>Aspetto</h2>
          <h3>Tema</h3>
          <div class="radios">
            {#each themes as t (t.v)}
              <label class="radio-row">
                <input
                  type="radio"
                  name="theme"
                  checked={prefs.theme === t.v}
                  onchange={() => setTheme(t.v)}
                />
                <span class="radio-dot" class:on={prefs.theme === t.v}></span>
                <span>{t.label}</span>
              </label>
            {/each}
          </div>

        {:else if tab === 'notifications'}
          <h2>Notifiche</h2>
          <div class="toggle-row">
            <div>
              <div class="row-title">Notifiche desktop</div>
              <div class="muted small">Avvisi per i nuovi messaggi e per le chiamate.</div>
            </div>
            <button
              class="switch"
              class:on={prefs.notifications}
              role="switch"
              aria-checked={prefs.notifications}
              aria-label="Notifiche desktop"
              onclick={() => setPref('notifications', !prefs.notifications)}
            >
              <span></span>
            </button>
          </div>

        {:else if tab === 'media'}
          <AudioSettings />

        {:else if tab === 'admin' && app.isAdmin}
          <h2>Server</h2>
          <h3>Nuova password del server</h3>
          <div class="inline">
            <input class="field" type="password" bind:value={newPass} placeholder="Almeno 6 caratteri" />
            <button class="btn primary" disabled={newPass.length < 6} onclick={changePassword}>Cambia</button>
          </div>

          <h3>Utenti bannati</h3>
          {#if !bans.length}
            <p class="muted small">Nessuno.</p>
          {/if}
          {#each bans as b (b.user_id)}
            <div class="ban">
              <Avatar id={b.user_id} size={28} />
              <div class="grow">
                <div>{app.name(b.user_id)}</div>
                {#if b.reason}<div class="muted small">{b.reason}</div>{/if}
              </div>
              <button class="btn" onclick={() => unban(b.user_id)}>Sbanna</button>
            </div>
          {/each}

        {:else}
          <h2>Info</h2>
          <div class="card">
            <div class="row-title">Paper</div>
            <div class="muted small">Versione {version}</div>
          </div>
          <div class="inline">
            <button class="btn" onclick={runUpdateCheck}>Controlla aggiornamenti</button>
            {#if updateState}<span class="muted small">{updateState}</span>{/if}
          </div>
        {/if}

        {#if msg}
          <p class="toast" class:bad={!msg.ok}>{msg.text}</p>
        {/if}
      </div>
    </section>
  </div>
</div>

{#if cropFile}
  <div class="crop-bg">
    <AvatarCropper
      file={cropFile}
      onconfirm={(blob) => {
        cropFile = null;
        uploadAvatar(blob);
      }}
      oncancel={() => (cropFile = null)}
    />
  </div>
{/if}

<style>
  .bg {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: var(--bg);
    display: flex;
  }
  .crop-bg {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
  }
  .panel {
    flex: 1;
    display: grid;
    grid-template-columns: 260px 1fr;
    min-height: 0;
    background: var(--bg);
  }
  nav {
    background: var(--bg-sidebar);
    padding: 60px 6px 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .group {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    padding: 14px 10px 6px;
  }
  nav button {
    text-align: left;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 500;
  }
  nav button:hover { background: var(--bg-hover); color: var(--text); }
  nav button.active { background: var(--bg-active); color: var(--text); }
  .logout { color: var(--red) !important; margin-top: 8px; }
  .grow { flex: 1; }

  section {
    position: relative;
    overflow-y: auto;
    padding: 60px 40px;
    display: flex;
    justify-content: center;
  }
  .content {
    width: 100%;
    max-width: 680px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .close {
    position: fixed;
    top: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    color: var(--text-3);
    font-size: 11px;
    font-weight: 600;
  }
  .close:hover { color: var(--text); }
  .close :global(.icon-btn) { width: 36px; height: 36px; }

  h2 { margin: 0 0 16px; font-size: 20px; font-weight: 600; color: var(--text); }
  h3 {
    margin: 22px 0 8px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-2);
  }
  .row-title { font-size: 16px; font-weight: 600; color: var(--text); }
  .small { font-size: 13px; }
  .card {
    background: var(--bg-elev);
    border-radius: var(--r);
    padding: 16px;
  }
  .user-row { display: flex; align-items: center; gap: 16px; }
  .user-info { flex: 1; min-width: 0; }
  .uname { font-size: 18px; font-weight: 600; }
  .inline { display: flex; gap: 8px; align-items: center; }
  .inline .field { flex: 1; }

  .radios { display: flex; flex-direction: column; gap: 4px; }
  .radio-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--r);
    background: var(--bg-elev);
    cursor: pointer;
    font-size: 15px;
  }
  .radio-row input { position: absolute; opacity: 0; pointer-events: none; }
  .radio-dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--text-3);
    display: grid;
    place-items: center;
    flex: none;
  }
  .radio-dot.on { border-color: var(--accent); }
  .radio-dot.on::after {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    background: var(--bg-elev);
    border-radius: var(--r);
  }
  .switch {
    width: 44px;
    height: 26px;
    border-radius: 13px;
    background: var(--bg-active);
    position: relative;
    flex: none;
    transition: background 0.15s;
  }
  .switch span {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch.on { background: var(--green); }
  .switch.on span { transform: translateX(18px); }

  .ban { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
  .grow { flex: 1; min-width: 0; }
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--green) 20%, var(--bg-elev));
    box-shadow: var(--shadow);
    font-size: 13px;
    z-index: 95;
  }
  .toast.bad { background: color-mix(in srgb, var(--red) 20%, var(--bg-elev)); }
</style>