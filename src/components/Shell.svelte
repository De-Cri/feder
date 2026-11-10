<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { checkUpdate, setBackgroundMode, type UpdateInfo } from '../lib/platform';
  import { voice } from '../lib/voice.svelte';
  import Sidebar from './Sidebar.svelte';
  import TextChannel from './TextChannel.svelte';
  import VoiceChannel from './VoiceChannel.svelte';
  import MemberList from './MemberList.svelte';
  import Settings from './Settings.svelte';
  import ScreenPicker from './ScreenPicker.svelte';
  import VoiceAudio from './VoiceAudio.svelte';

  // Il canale aperto, separato per tipo: così TypeScript sa sempre quale prop passare.
  const current = $derived(app.channels.find((c) => c.id === app.view) ?? null);
  const textChannel = $derived(current && current.kind === 'text' ? current : null);
  const voiceChannel = $derived(current && current.kind === 'voice' ? current : null);

  let update = $state<UpdateInfo | null>(null);
  let installing = $state(false);

  // Finestra nascosta e nessuna chiamata → modalità a basso consumo.
  let hidden = $state(typeof document !== 'undefined' && document.hidden);
  $effect(() => {
    const low = hidden && voice.channelId === null;
    setBackgroundMode(low);
  });

  onMount(() => {
    const onVis = () => (hidden = document.hidden);
    document.addEventListener('visibilitychange', onVis);
    checkUpdate().then((u) => (update = u));
    const t = setInterval(() => checkUpdate().then((u) => u && (update = u)), 6 * 3600_000);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  $effect(() => {
    // segna come letto il canale aperto quando la finestra è in primo piano
    if (app.focused && app.unread[app.view]) app.unread[app.view] = 0;
  });
</script>

<div class="shell">
  <Sidebar />
  <main>
    {#if update}
      <div class="banner">
        <span>Nuova versione {update.version} disponibile.</span>
        <button
          class="btn primary small"
          disabled={installing}
          onclick={async () => {
            installing = true;
            await update!.install();
          }}>{installing ? 'Aggiorno…' : 'Aggiorna e riavvia'}</button
        >
      </div>
    {/if}

    {#if textChannel}
      {#key textChannel.id}
        <TextChannel channel={textChannel} />
      {/key}
    {:else if voiceChannel}
      <VoiceChannel channel={voiceChannel} />
    {/if}
  </main>

  <MemberList />
</div>

{#if app.settingsOpen}
  <Settings />
{/if}

<ScreenPicker />
<VoiceAudio />

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 240px;
    grid-template-rows: 100%;
  }
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