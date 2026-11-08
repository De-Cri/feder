<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { voice } from '../lib/voice.svelte';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import Logo from './Logo.svelte';

  function openVoice(id: number) {
    app.view = id;
    if (voice.channelId !== id) voice.join(id);
  }

  function speaking(id: string) {
    if (id === app.me) return voice.localSpeaking;
    return voice.peers[id]?.speaking ?? false;
  }

  const voiceName = $derived(app.channels.find((c) => c.id === voice.channelId)?.name);
</script>

<aside>
  <header>
    <Logo size={20} />
    <span class="title">Paper</span>
  </header>

  <nav>
    <div class="section">Chat</div>
    {#each app.textChannels as c (c.id)}
      <button class="item" class:active={app.view === c.id} onclick={() => (app.view = c.id)}>
        <Icon name="hash" size={16} />
        <span class="name">{c.name}</span>
        {#if app.unread[c.id]}<span class="badge">{app.unread[c.id]}</span>{/if}
      </button>
    {/each}

    <div class="section">Voce</div>
    {#each app.voiceChannels as c (c.id)}
      <button class="item" class:active={app.view === c.id} onclick={() => openVoice(c.id)}>
        <Icon name="volume" size={16} />
        <span class="name">{c.name}</span>
      </button>
      {#each app.inVoice(c.id) as p (p.user_id)}
        <div class="participant">
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

  {#if voice.channelId !== null}
    <div class="connected">
      <div>
        <div class="ok">{voice.joining ? 'Connessione…' : 'Connesso'}</div>
        <button class="where" onclick={() => (app.view = voice.channelId!)}>{voiceName}</button>
      </div>
      <button class="icon-btn bad" title="Esci dal vocale" onclick={() => voice.leave()}>
        <Icon name="leave" size={17} />
      </button>
    </div>
  {/if}

  <footer>
    <Avatar id={app.me} size={30} status="online" />
    <div class="me">
      <div class="uname">{app.myProfile?.username}</div>
      <div class="role">{app.isAdmin ? 'Admin' : 'Membro'}</div>
    </div>
    {#if voice.channelId !== null}
      <button
        class="icon-btn"
        class:bad={!voice.micOn || voice.adminMuted}
        title={voice.adminMuted ? 'Silenziato dall’admin' : voice.micOn ? 'Disattiva microfono' : 'Attiva microfono'}
        onclick={() => voice.toggleMic()}
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
    {/if}
    <button class="icon-btn" title="Impostazioni" onclick={() => (app.settingsOpen = true)}>
      <Icon name="settings" size={17} />
    </button>
  </footer>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  header {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 18px;
    flex: none;
  }
  .title { font-weight: 600; font-size: 15px; letter-spacing: -0.01em; }
  nav {
    flex: 1;
    overflow-y: auto;
    padding: 4px 10px 12px;
  }
  .section {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 16px 8px 6px;
  }
  .item {
    width: 100%;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    text-align: left;
  }
  .item:hover { background: var(--bg-hover); color: var(--text); }
  .item.active { background: var(--bg-active); color: var(--text); font-weight: 500; }
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
    height: 28px;
    padding: 0 8px 0 30px;
    color: var(--text-2);
    font-size: 13px;
  }
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
  .connected {
    margin: 0 10px 8px;
    padding: 8px 8px 8px 12px;
    border-radius: var(--r);
    background: var(--bg-hover);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ok { font-size: 12px; font-weight: 600; color: var(--green); }
  .where { font-size: 12px; color: var(--text-2); }
  .where:hover { color: var(--text); text-decoration: underline; }
  footer {
    flex: none;
    height: 56px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 0 14px;
    border-top: 1px solid var(--border);
  }
  .me { flex: 1; min-width: 0; }
  .uname { font-weight: 500; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role { font-size: 11px; color: var(--text-3); }
</style>
