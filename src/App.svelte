<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from './lib/supabase';
  import { configured } from './lib/config';
  import { app } from './lib/state.svelte';
  import { applyTheme } from './lib/theme';
  import { t, lang } from './lib/i18n.svelte';
  import Auth from './components/Auth.svelte';
  import Join from './components/Join.svelte';
  import Shell from './components/Shell.svelte';

  // Theme applied right away, before the first render.
  applyTheme();

  // <html lang> follows the interface language (screen readers, hyphenation).
  $effect(() => {
    document.documentElement.lang = lang();
  });

  onMount(() => {
    if (!configured) {
      app.booted = true;
      return;
    }
    let lastUser: string | null | undefined = undefined; // undefined = first event
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      app.session = session;
      const uid = session?.user.id ?? null;
      if (uid !== lastUser) {
        lastUser = uid;
        app.membership = 'unknown';
        // outside the callback to avoid supabase-js internal deadlocks
        if (uid) setTimeout(() => app.checkMembership().finally(() => (app.booted = true)), 0);
        else app.booted = true;
      }
    });
    const onFocus = () => (app.focused = true);
    const onBlur = () => (app.focused = false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    // No browser menu (Reload, Save as, Print…) anywhere,
    // except where copy/paste is needed.
    const noNativeMenu = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest('input, textarea, [contenteditable="true"], .allow-native-menu')) return;
      e.preventDefault();
    };
    window.addEventListener('contextmenu', noNativeMenu, { capture: true });

    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('contextmenu', noNativeMenu, { capture: true });
    };
  });
</script>

{#if !configured}
  <div class="center">
    <h2>{t('app.notConfigured')}</h2>
    <p class="muted">{t('app.notConfiguredHint')} <code>npm run setup</code></p>
  </div>
{:else if !app.booted || (app.session && app.membership === 'unknown')}
  <div class="center"><div class="spinner"></div></div>
{:else if !app.session}
  <Auth />
{:else if app.membership === 'member'}
  <Shell />
{:else}
  <Join />
{/if}

<style>
  .center {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
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