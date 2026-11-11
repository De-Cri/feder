<script lang="ts">
  import { app, RELEASES_VIEW } from '../lib/state.svelte';
  import { voice, screenShareSupported } from '../lib/voice.svelte';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import VoiceMenu from './VoiceMenu.svelte';
  import MicMenu from './MicMenu.svelte';

  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  let micMenu = $state<DOMRect | null>(null);

  // Tasto destro sul microfono: volumi di ingresso/uscita e livello.
  function openMicMenu(e: MouseEvent) {
    e.preventDefault();
    micMenu = (e.currentTarget as HTMLElement).getBoundingClientRect();
  }

  function openVoice(id: number) {
    app.view = id;
    if (voice.channelId !== id) voice.join(id);
  }

  // Tasto destro su chi è in vocale: volume e silenzio (non su te stesso).
  function openMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    menu = id === app.me ? null : { id, x: e.clientX, y: e.clientY };
  }

  function speaking(id: string) {
    if (id === app.me) return voice.localSpeaking;
    return voice.peers[id]?.speaking ?? false;
  }
</script>

<aside class="side">
  <nav>
    <div class="nav-label">Chat</div>
    {#each app.textChannels as c (c.id)}
      <button class="nav-item" class:active={app.view === c.id} onclick={() => (app.view = c.id)}>
        <Icon name="hash" size={16} />
        <span class="name">{c.name}</span>
        {#if app.unread[c.id]}<span class="badge">{app.unread[c.id]}</span>{/if}
      </button>
    {/each}
    <button class="nav-item" class:active={app.view === RELEASES_VIEW} onclick={() => (app.view = RELEASES_VIEW)}>
      <Icon name="megaphone" size={16} />
      <span class="name">novità</span>
      {#if app.releasesUnseen}<span class="badge">nuovo</span>{/if}
    </button>

    <div class="nav-label">Voce</div>
    {#each app.voiceChannels as c (c.id)}
      <button class="nav-item" class:active={app.view === c.id} onclick={() => openVoice(c.id)}>
        <Icon name="volume" size={16} />
        <span class="name">{c.name}</span>
      </button>
      {#each app.inVoice(c.id) as p (p.user_id)}
        <div class="participant" role="presentation" oncontextmenu={(e) => openMenu(e, p.user_id)}>
          <Avatar id={p.user_id} size={20} speaking={speaking(p.user_id)} />
          <span class="pname">{app.name(p.user_id)}</span>
          {#if p.screen}<span class="live">LIVE</span>{/if}
          {#if p.cam}<Icon name="video" size={13} />{/if}
          {#if p.deaf}<Icon name="headphones-off" size={13} />
          {:else if !p.mic || app.voiceMutes[p.user_id]}<Icon name="mic-off" size={13} />{/if}
        </div>
      {/each}
    {/each}
  </nav>

  <footer>
    <div class="actions">
      <button class="icon-btn" title="Impostazioni" onclick={() => (app.settingsOpen = true)}>
        <Icon name="settings" size={17} />
      </button>

      {#if voice.channelId !== null}
        <button
          class="icon-btn"
          class:bad={!voice.micOn || voice.adminMuted}
          class:open={micMenu !== null}
          title={voice.adminMuted ? 'Silenziato dall’admin' : voice.micOn ? 'Disattiva microfono' : 'Attiva microfono'}
          onclick={() => voice.toggleMic()}
          oncontextmenu={openMicMenu}
        >
          <Icon name={voice.micOn && !voice.adminMuted ? 'mic' : 'mic-off'} size={17} />
        </button>
        <button
          class="icon-btn"
          class:bad={voice.deaf}
          title={voice.deaf ? 'Riattiva audio' : 'Disattiva audio'}
          onclick={() => voice.toggleDeaf()}
        >
          <Icon name={voice.deaf ? 'headphones-off' : 'headphones'} size={17} />
        </button>
        <button
          class="icon-btn"
          class:on={voice.camOn}
          title={voice.camOn ? 'Spegni webcam' : 'Accendi webcam'}
          onclick={() => voice.toggleCam()}
        >
          <Icon name={voice.camOn ? 'video' : 'video-off'} size={17} />
        </button>
        {#if screenShareSupported}
          <button
            class="icon-btn"
            class:on={voice.screenOn}
            title={voice.screenOn ? 'Interrompi condivisione' : 'Condividi schermo'}
            onclick={() => voice.toggleScreen()}
          >
            <Icon name="screen" size={17} />
          </button>
        {/if}
        <button class="icon-btn bad" title="Termina chiamata" onclick={() => voice.leave()}>
          <Icon name="leave" size={17} />
        </button>
      {/if}
    </div>
  </footer>
</aside>

{#if menu}
  <VoiceMenu id={menu.id} x={menu.x} y={menu.y} onclose={() => (menu = null)} />
{/if}
{#if micMenu && voice.channelId !== null}
  <MicMenu anchor={micMenu} onclose={() => (micMenu = null)} />
{/if}

<style>
  aside {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  nav {
    flex: 1;
    overflow-y: auto;
    padding: 12px 10px 12px;
  }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    display: grid;
    place-items: center;
  }
  .participant {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 8px 0 30px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: 13px;
  }
  .participant:hover { background: var(--bg-hover); color: var(--text); }
  .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .live {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #fff;
    background: var(--red);
    border-radius: 4px;
    padding: 1px 4px;
  }
  footer {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border-top: 1px solid var(--border);
  }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .icon-btn.open { background: var(--bg-active); color: var(--text); }
  .icon-btn.open.bad { color: var(--red); }
</style>