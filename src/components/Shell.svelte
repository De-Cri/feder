<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { checkUpdate, type UpdateInfo } from '../lib/platform';
  import Sidebar from './Sidebar.svelte';
  import TextChannel from './TextChannel.svelte';
  import VoiceChannel from './VoiceChannel.svelte';
  import MemberList from './MemberList.svelte';
  import Settings from './Settings.svelte';
  import ScreenPicker from './ScreenPicker.svelte';
  import VoiceAudio from './VoiceAudio.svelte';

  const current = $derived(app.channels.find((c) => c.id === app.view));
  let update = $state<UpdateInfo | null>(null);
  let installing = $state(false);

  onMount(() => {
    checkUpdate().then((u) => (update = u));
    const t = setInterval(() => checkUpdate().then((u) => u && (update = u)), 6 * 3600_000);
    return () => clearInterval(t);
  });

  $effect(() => {
    // segna come letto il canale aperto quando la finestra è in primo piano
    if (app.focused && app.unread[app.view]) app.unread[app.view] = 0;
  });
</script>

<div class="shell" class:members={app.showMembers && current?.kind === 'text'}>
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
    {#if current?.kind === 'text'}
      {#key current.id}
        <TextChannel channel={current} />
      {/key}
    {:else if current?.kind === 'voice'}
      <VoiceChannel channel={current} />
    {/if}
  </main>
  {#if app.showMembers && current?.kind === 'text'}
    <MemberList />
  {/if}
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
    grid-template-columns: 240px 1fr;
    grid-template-rows: 100%;
  }
  .shell.members { grid-template-columns: 240px 1fr 220px; }
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
