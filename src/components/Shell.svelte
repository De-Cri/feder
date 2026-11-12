<script lang="ts">
  import { onMount } from 'svelte';
  import { app, RELEASES_VIEW, DM_VIEW } from '../lib/state.svelte';
  import { dm } from '../lib/dm.svelte';
  import DmView from './DmView.svelte';
  import { checkUpdate, setBackgroundMode, isHidden, onHiddenChange, type UpdateInfo } from '../lib/platform';
  import { voice } from '../lib/voice.svelte';
  import Sidebar from './Sidebar.svelte';
  import TextChannel from './TextChannel.svelte';
  import VoiceChannel from './VoiceChannel.svelte';
  import MemberList from './MemberList.svelte';
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

  onMount(() => {
    dm.init();
    const offHidden = onHiddenChange((h) => (hidden = h));
    checkUpdate().then((u) => (update = u));
    const t = setInterval(() => checkUpdate().then((u) => u && (update = u)), 6 * 3600_000);
    return () => {
      clearInterval(t);
      offHidden();
      dm.stop();
    };
  });

  $effect(() => {
    // mark the open channel as read when the window is focused
    if (app.focused && app.unread[app.view]) app.unread[app.view] = 0;
  });
</script>

<div class="shell" class:members={!!textChannel}>
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

    {#if app.view === RELEASES_VIEW}
      <Releases />
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

  <!-- The member list is shown only in text channels. -->
  {#if textChannel}
    <MemberList />
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
</style>