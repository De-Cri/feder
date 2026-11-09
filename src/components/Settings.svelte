<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import { prefs, savePrefs } from '../lib/prefs.svelte';
  import { appVersion, checkUpdate } from '../lib/platform';
  import { errorText } from '../lib/util';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import AudioSettings from './AudioSettings.svelte';

  type Tab = 'profile' | 'media' | 'admin' | 'about';
  let tab = $state<Tab>('profile');
  let msg = $state<{ ok: boolean; text: string } | null>(null);

  // profilo
  let username = $state(app.myProfile?.username ?? '');
  let avatarInput: HTMLInputElement | undefined = $state();


  // admin
  let newPass = $state('');
  let bans = $state<{ user_id: string; reason: string | null; banned_at: string }[]>([]);

  // info
  let version = $state('');
  let updateState = $state<string | null>(null);

  onMount(async () => {
    appVersion().then((v) => (version = v));
  });

  $effect(() => {
    if (tab === 'admin' && app.isAdmin) loadBans();
  });

  function flash(ok: boolean, text: string) {
    msg = { ok, text };
    setTimeout(() => (msg = null), 3500);
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

  async function uploadAvatar(file: File) {
    if (!file.type.startsWith('image/')) return flash(false, 'Scegli un’immagine.');
    if (file.size > 5 * 1024 * 1024) return flash(false, 'Massimo 5 MB.');
    const path = `${app.me}/avatar-${Date.now()}`;
    const { error } = await supabase.storage.from('attachments').upload(path, file, { contentType: file.type });
    if (error) return flash(false, errorText(error));
    const old = app.myProfile?.avatar_path;
    const { error: e2 } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', app.me!);
    if (e2) return flash(false, errorText(e2));
    app.profiles[app.me!] = { ...app.profiles[app.me!], avatar_path: path };
    if (old) supabase.storage.from('attachments').remove([old]);
    flash(true, 'Avatar aggiornato.');
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

<svelte:window onkeydown={(e) => e.key === 'Escape' && (app.settingsOpen = false)} />

<div class="bg" role="presentation" onclick={() => (app.settingsOpen = false)}>
  <div class="panel" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <nav>
      <button class:active={tab === 'profile'} onclick={() => (tab = 'profile')}>Profilo</button>
      <button class:active={tab === 'media'} onclick={() => (tab = 'media')}>Voce e video</button>
      {#if app.isAdmin}
        <button class:active={tab === 'admin'} onclick={() => (tab = 'admin')}>Amministrazione</button>
      {/if}
      <button class:active={tab === 'about'} onclick={() => (tab = 'about')}>Info</button>
      <span class="grow"></span>
      <button class="logout" onclick={() => { app.settingsOpen = false; app.signOut(); }}>
        <Icon name="logout" size={15} /> Esci
      </button>
    </nav>

    <section>
      <button class="close icon-btn" onclick={() => (app.settingsOpen = false)}><Icon name="x" /></button>

      {#if tab === 'profile'}
        <h2>Profilo</h2>
        <div class="avatar-row">
          <Avatar id={app.me} size={64} />
          <button class="btn" onclick={() => avatarInput?.click()}>Cambia avatar</button>
          <input type="file" accept="image/*" hidden bind:this={avatarInput}
            onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) uploadAvatar(f); e.currentTarget.value = ''; }} />
        </div>
        <label class="label" for="un">Username</label>
        <div class="inline">
          <input id="un" class="field" bind:value={username} />
          <button class="btn primary" onclick={saveUsername}>Salva</button>
        </div>
        <label class="check">
          <input type="checkbox" checked={prefs.notifications}
            onchange={(e) => setPref('notifications', e.currentTarget.checked)} />
          Notifiche desktop per i nuovi messaggi
        </label>
      {:else if tab === 'media'}
        <AudioSettings />
      {:else if tab === 'admin' && app.isAdmin}
        <h2>Amministrazione</h2>
        <label class="label" for="np">Nuova password del server</label>
        <div class="inline">
          <input id="np" class="field" type="password" bind:value={newPass} placeholder="Almeno 6 caratteri" />
          <button class="btn primary" disabled={newPass.length < 6} onclick={changePassword}>Cambia</button>
        </div>
        <h3>Utenti bannati</h3>
        {#if !bans.length}
          <p class="hint">Nessuno.</p>
        {/if}
        {#each bans as b (b.user_id)}
          <div class="ban">
            <Avatar id={b.user_id} size={28} />
            <div class="grow">
              <div>{app.name(b.user_id)}</div>
              {#if b.reason}<div class="hint">{b.reason}</div>{/if}
            </div>
            <button class="btn" onclick={() => unban(b.user_id)}>Sbanna</button>
          </div>
        {/each}
        <p class="hint">Espelli, banna e muta in vocale dal menu di ogni membro (lista membri a destra nei canali chat).</p>
      {:else}
        <h2>Info</h2>
        <p>Paper <span class="muted">v{version}</span></p>
        <div class="inline">
          <button class="btn" onclick={runUpdateCheck}>Controlla aggiornamenti</button>
          {#if updateState}<span class="hint">{updateState}</span>{/if}
        </div>
      {/if}

      {#if msg}
        <p class="toast" class:bad={!msg.ok}>{msg.text}</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .bg {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: rgba(0, 0, 0, 0.35);
    display: grid;
    place-items: center;
  }
  .panel {
    width: min(760px, calc(100% - 40px));
    height: min(640px, calc(100% - 40px));
    display: grid;
    grid-template-columns: 200px 1fr;
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  nav {
    background: var(--bg-sidebar);
    padding: 16px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  nav button {
    text-align: left;
    padding: 7px 10px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  nav button:hover { background: var(--bg-hover); color: var(--text); }
  nav button.active { background: var(--bg-active); color: var(--text); font-weight: 500; }
  .logout { color: var(--red) !important; }
  .grow { flex: 1; }
  section {
    position: relative;
    padding: 24px 28px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .close { position: absolute; top: 14px; right: 14px; }
  h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }
  h3 { margin: 22px 0 6px; font-size: 14px; font-weight: 600; }
  .label { margin-top: 10px; }
  .inline { display: flex; gap: 8px; align-items: center; }
  .avatar-row { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 16px; font-size: 13px; }
  .hint { font-size: 12px; color: var(--text-3); margin: 6px 0 0; }
  .ban { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
  .toast {
    margin-top: auto;
    padding: 8px 12px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--green) 15%, transparent);
    font-size: 13px;
  }
  .toast.bad { background: color-mix(in srgb, var(--red) 15%, transparent); }
</style>
