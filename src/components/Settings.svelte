<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import { prefs, savePrefs, setTheme, type Theme, type Language } from '../lib/prefs.svelte';
  import { t, type Key } from '../lib/i18n.svelte';
  import { appVersion, checkUpdate } from '../lib/platform';
  import { errorText } from '../lib/util';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import AudioSettings from './AudioSettings.svelte';
  import AvatarCropper from './AvatarCropper.svelte';

  type Tab = 'profile' | 'appearance' | 'notifications' | 'media' | 'admin' | 'about';
  let tab = $state<Tab>(app.settingsTab as Tab);
  app.settingsTab = 'profile'; // the next normal opening starts from the profile again
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

  const themes: { v: Theme; label: Key }[] = [
    { v: 'system', label: 'theme.system' },
    { v: 'light', label: 'theme.light' },
    { v: 'dark', label: 'theme.dark' },
    { v: 'black', label: 'theme.black' },
    { v: 'oled', label: 'theme.oled' },
  ];

  // Language names stay in their own language, as usual; "system" is translated.
  const languages = $derived<{ v: Language; label: string }[]>([
    { v: 'system', label: t('settings.langSystem') },
    { v: 'it', label: 'Italiano' },
    { v: 'en', label: 'English' },
  ]);

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
    if (!/^[a-z0-9_.]{3,20}$/.test(u)) return flash(false, t('auth.usernameRule'));
    const { error } = await supabase.from('profiles').update({ username: u }).eq('id', app.me!);
    if (error) flash(false, error.code === '23505' ? t('settings.usernameTaken') : errorText(error));
    else {
      app.profiles[app.me!] = { ...app.profiles[app.me!], username: u };
      flash(true, t('settings.saved'));
    }
  }

  async function uploadAvatar(blob: Blob) {
    if (blob.size > 5 * 1024 * 1024) return flash(false, t('settings.max5mb'));
    const path = `${app.me}/avatar-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('attachments').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) return flash(false, errorText(error));
    const old = app.myProfile?.avatar_path;
    const { error: e2 } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', app.me!);
    if (e2) return flash(false, errorText(e2));
    app.profiles[app.me!] = { ...app.profiles[app.me!], avatar_path: path };
    if (old) supabase.storage.from('attachments').remove([old]);
    flash(true, t('settings.avatarUpdated'));
  }

  function pickAvatar(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) return flash(false, t('settings.pickImage'));
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
      flash(true, t('settings.passwordChanged'));
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
    updateState = t('settings.checking');
    const u = await checkUpdate();
    if (!u) {
      updateState = t('settings.upToDate');
      return;
    }
    updateState = t('settings.installing', { version: u.version });
    await u.install();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="bg" role="presentation" onclick={() => (app.settingsOpen = false)}>
  <div class="panel" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <nav class="side">
      <div class="group">{t('settings.title')}</div>
      <button class:active={tab === 'profile'} onclick={() => (tab = 'profile')}>{t('settings.account')}</button>
      <button class:active={tab === 'media'} onclick={() => (tab = 'media')}>{t('settings.media')}</button>
      <button class:active={tab === 'notifications'} onclick={() => (tab = 'notifications')}>{t('settings.notifications')}</button>
      <button class:active={tab === 'appearance'} onclick={() => (tab = 'appearance')}>{t('settings.appearance')}</button>

      {#if app.isAdmin}
        <div class="group">{t('settings.administration')}</div>
        <button class:active={tab === 'admin'} onclick={() => (tab = 'admin')}>{t('settings.server')}</button>
      {/if}

      <div class="group spaced">App</div>
      <button class:active={tab === 'about'} onclick={() => (tab = 'about')}>{t('settings.about')}</button>

      <span class="grow"></span>
      <button class="logout" onclick={() => { app.settingsOpen = false; app.signOut(); }}>
        <Icon name="logout" size={15} /> {t('join.logout')}
      </button>
    </nav>

    <section>
      <button class="close" title={t('settings.closeEsc')} onclick={() => (app.settingsOpen = false)}>
        <Icon name="x" size={20} />
        <span>ESC</span>
      </button>

      <div class="content">
        {#if tab === 'profile'}
          <h2>{t('settings.account')}</h2>
          <div class="card">
            <div class="user-row">
              <Avatar id={app.me} size={80} />
              <div class="user-info">
                <div class="uname">{app.myProfile?.username}</div>
                <div class="muted small">{app.isAdmin ? t('menu.admin') : t('menu.member')}</div>
              </div>
              <button class="btn" onclick={() => avatarInput?.click()}>{t('settings.changeAvatar')}</button>
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

          <h3>{t('settings.username')}</h3>
          <div class="inline">
            <input class="field" bind:value={username} />
            <button class="btn primary" onclick={saveUsername}>{t('settings.save')}</button>
          </div>

        {:else if tab === 'appearance'}
          <h2>{t('settings.appearance')}</h2>
          <h3>{t('settings.theme')}</h3>
          <div class="radios">
            {#each themes as th (th.v)}
              <label class="radio-row">
                <input
                  type="radio"
                  name="theme"
                  checked={prefs.theme === th.v}
                  onchange={() => setTheme(th.v)}
                />
                <span class="radio-dot" class:on={prefs.theme === th.v}></span>
                <span>{t(th.label)}</span>
              </label>
            {/each}
          </div>

          <h3>{t('settings.language')}</h3>
          <div class="radios">
            {#each languages as l (l.v)}
              <label class="radio-row">
                <input
                  type="radio"
                  name="language"
                  checked={prefs.language === l.v}
                  onchange={() => setPref('language', l.v)}
                />
                <span class="radio-dot" class:on={prefs.language === l.v}></span>
                <span>{l.label}</span>
              </label>
            {/each}
          </div>

        {:else if tab === 'notifications'}
          <h2>{t('settings.notifications')}</h2>
          <div class="toggle-row">
            <div>
              <div class="row-title">{t('settings.desktopNotifications')}</div>
              <div class="muted small">{t('settings.desktopNotificationsHint')}</div>
            </div>
            <button
              class="switch"
              class:on={prefs.notifications}
              role="switch"
              aria-checked={prefs.notifications}
              aria-label={t('settings.desktopNotifications')}
              onclick={() => setPref('notifications', !prefs.notifications)}
            >
              <span></span>
            </button>
          </div>

        {:else if tab === 'media'}
          <AudioSettings />

        {:else if tab === 'admin' && app.isAdmin}
          <h2>{t('settings.server')}</h2>
          <h3>{t('settings.newServerPassword')}</h3>
          <div class="inline">
            <input class="field" type="password" bind:value={newPass} placeholder={t('settings.min6')} />
            <button class="btn primary" disabled={newPass.length < 6} onclick={changePassword}>{t('settings.change')}</button>
          </div>

          <h3>{t('settings.bannedUsers')}</h3>
          {#if !bans.length}
            <p class="muted small">{t('settings.none')}</p>
          {/if}
          {#each bans as b (b.user_id)}
            <div class="ban">
              <Avatar id={b.user_id} size={28} />
              <div class="grow">
                <div>{app.name(b.user_id)}</div>
                {#if b.reason}<div class="muted small">{b.reason}</div>{/if}
              </div>
              <button class="btn" onclick={() => unban(b.user_id)}>{t('settings.unban')}</button>
            </div>
          {/each}

        {:else}
          <h2>{t('settings.about')}</h2>
          <div class="card">
            <div class="row-title">Feder</div>
            <div class="muted small">{t('settings.version', { version })}</div>
          </div>
          <div class="inline">
            <button class="btn" onclick={runUpdateCheck}>{t('settings.checkUpdates')}</button>
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
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 0;
    background: var(--bg);
  }

  nav {
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    padding: 12px 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
  }
  .group {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 16px 8px 6px;
  }
  .group:first-child { padding-top: 4px; }
  .group.spaced { margin-top: 12px; }
  nav button {
    width: 100%;
    height: 34px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 500;
    text-align: left;
  }
  nav button:hover { background: var(--bg-hover); color: var(--text); }
  nav button.active { background: var(--bg-active); color: var(--text); }
  .grow { flex: 1; min-width: 0; }

  /* "Esci" like the sidebar footer: full-width line on top. */
  .logout {
    width: calc(100% + 20px);
    height: 48px;
    margin: 8px -10px -12px;
    padding: 0 18px;
    border-radius: 0;
    border-top: 1px solid var(--border);
    color: var(--red) !important;
  }

  section {
    position: relative;
    overflow-y: auto;
    padding: 60px 40px 150px;
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
    position: relative;
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