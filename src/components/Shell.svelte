<script lang="ts">
  import { onMount } from 'svelte';
  import { app, RELEASES_VIEW, DM_VIEW } from '../lib/state.svelte';
  import { dm } from '../lib/dm.svelte';
  import DmView from './DmView.svelte';
  import { checkUpdate, setBackgroundMode, isHidden, onHiddenChange, setVoiceShortcuts, onVoiceShortcut, type UpdateInfo, type VoiceShortcut } from '../lib/platform';
  import { voice } from '../lib/voice.svelte';
  import Sidebar from './Sidebar.svelte';
  import TextChannel from './TextChannel.svelte';
  import VoiceChannel from './VoiceChannel.svelte';
  import RightBar from './RightBar.svelte';
  import FriendsView from './FriendsView.svelte';
  import { social, FRIENDS_VIEW } from '../lib/social.svelte';
  import { games, CHESS_VIEW } from '../lib/games.svelte';
  import ChessView from './ChessView.svelte';
  import { prefs } from '../lib/prefs.svelte';
  import Settings from './Settings.svelte';
  import ScreenPicker from './ScreenPicker.svelte';
  import VoiceAudio from './VoiceAudio.svelte';
  import Releases from './Releases.svelte';
  import Pokes from './Pokes.svelte';
  import { t } from '../lib/i18n.svelte';

  // The open channel, split by kind: so TypeScript always knows which prop to pass.
  const current = $derived(app.channels.find((c) => c.id === app.view) ?? null);
  const textChannel = $derived(current && current.kind === 'text' ? current : null);
  const voiceChannel = $derived(current && current.kind === 'voice' ? current : null);

  let update = $state<UpdateInfo | null>(null);
  let installing = $state(false);

  // Hidden window and no call → low-power mode.
  // isHidden() also sees the minimized window in Electron (there document.hidden stays false).
  let hidden = $state(isHidden());
  $effect(() => {
    const low = hidden && voice.channelId === null;
    setBackgroundMode(low);
  });

  // Register Electron global mute/deafen shortcuts only while in a voice channel.
  $effect(() => {
    setVoiceShortcuts(voice.channelId !== null);
  });

  onMount(() => {
    dm.init();
    social.init();
    games.init();
    const offHidden = onHiddenChange((h) => (hidden = h));
    const offShortcut = onVoiceShortcut(triggerVoiceShortcut);
    checkUpdate().then((u) => (update = u));
    const t = setInterval(() => checkUpdate().then((u) => u && (update = u)), 6 * 3600_000);
    return () => {
      clearInterval(t);
      offHidden();
      offShortcut();
      setVoiceShortcuts(false);
      dm.stop();
      social.stop();
      games.stop();
    };
  });

  // Right column: not in private messages nor chess (the board needs the room), and hidden if you chose so (RightBarToggle).
  const showRight = $derived(app.view !== DM_VIEW && app.view !== CHESS_VIEW && prefs.rightBar);

  // Removed from a voice chat (or it was deleted) while in it: leave the call.
  $effect(() => {
    const id = voice.channelId;
    if (id !== null && app.channels.length && !app.channels.some((c) => c.id === id)) voice.leave();
  });

  // One-time notice for the original members: they are now all friends (0.6.0).
  const NOTICE_KEY = 'feder.friendsNotice';
  let founderNotice = $state(false);
  $effect(() => {
    founderNotice = app.isFounder && !localStorage.getItem(NOTICE_KEY);
  });
  function closeNotice() {
    localStorage.setItem(NOTICE_KEY, '1');
    founderNotice = false;
  }

  $effect(() => {
    // mark the open channel as read when the window is focused
    if (app.focused && app.unread[app.view]) app.unread[app.view] = 0;
  });

  // Discord-style shortcuts (only while in a voice channel):
  // Ctrl/Cmd+Shift+M toggles mic, Ctrl/Cmd+Shift+D toggles deafen.
  // Deduplicated briefly in case both a global shortcut and a window keydown arrive together.
  let lastShortcut = { action: '', at: 0 };
  function triggerVoiceShortcut(action: VoiceShortcut) {
    if (voice.channelId === null) return;
    const now = performance.now();
    if (lastShortcut.action === action && now - lastShortcut.at < 50) return;
    lastShortcut = { action, at: now };
    if (action === 'mute') voice.toggleMic();
    else voice.toggleDeaf();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (voice.channelId === null) return;
    if (e.repeat || e.altKey || !(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key === 'm') {
      e.preventDefault();
      triggerVoiceShortcut('mute');
    } else if (key === 'd') {
      e.preventDefault();
      triggerVoiceShortcut('deafen');
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="shell" class:members={showRight}>
  <Sidebar />
  <main>
    {#if update}
      <div class="banner">
        <span>{t('update.available', { version: update.version })}</span>
        <button
          class="btn primary small"
          disabled={installing}
          onclick={async () => {
            installing = true;
            await update!.install();
          }}>{installing ? t('update.installing') : t('update.install')}</button
        >
      </div>
    {/if}

    {#if founderNotice}
      <div class="banner">
        <span>{t('social.founderNotice')}</span>
        <button class="btn primary small" onclick={closeNotice}>{t('social.ok')}</button>
      </div>
    {/if}

    {#if app.view === RELEASES_VIEW}
      <Releases />
    {:else if app.view === FRIENDS_VIEW}
      <FriendsView />
    {:else if app.view === CHESS_VIEW}
      <ChessView />
    {:else if app.view === DM_VIEW}
      <DmView />
    {:else if textChannel}
      {#key textChannel.id}
        <TextChannel channel={textChannel} />
      {/key}
    {:else if voiceChannel}
      <VoiceChannel channel={voiceChannel} />
    {/if}
  </main>

  <!-- Right column: friends, private chats and members (not in private messages). -->
  {#if showRight}
    <RightBar />
  {/if}
</div>

<Pokes />

{#if app.settingsOpen}
  <Settings />
{/if}

<ScreenPicker />
<VoiceAudio />

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    grid-template-rows: 100%;
  }
  .shell.members { grid-template-columns: 240px minmax(0, 1fr) 240px; }
  main {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 6px 12px;
    background: var(--accent-soft);
    font-size: 13px;
  }
  .small { height: 26px; padding: 0 10px; font-size: 12px; }
  .banner .btn { flex: none; white-space: nowrap; }
</style>