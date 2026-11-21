<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { prefs, savePrefs } from '../lib/prefs.svelte';
  import { social } from '../lib/social.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n.svelte';

  // Shows/hides the right column (chats, friends, members). Remembered in the preferences.
  // While hidden, a dot says something is waiting there (invites, requests, unread chats).
  const waiting = $derived(!prefs.rightBar && (social.pending > 0 || app.chats.some((c) => app.unread[c.id])));

  function toggle() {
    prefs.rightBar = !prefs.rightBar;
    savePrefs();
  }
</script>

<button
  class="icon-btn"
  class:on={prefs.rightBar}
  title={prefs.rightBar ? t('rightBar.hide') : t('rightBar.show')}
  aria-pressed={prefs.rightBar}
  onclick={toggle}
>
  <Icon name="users" size={18} />
  {#if waiting}<span class="dot"></span>{/if}
</button>

<style>
  button { position: relative; }
  button.on { color: var(--text); }
  .dot {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--bg);
  }
</style>
