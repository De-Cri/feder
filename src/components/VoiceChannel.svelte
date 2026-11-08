<script lang="ts">
  import { app, type Channel } from '../lib/state.svelte';
  import { voice, rtcSupported, screenShareSupported } from '../lib/voice.svelte';
  import { prefs, savePrefs, userVolume } from '../lib/prefs.svelte';
  import { supabase } from '../lib/supabase';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import VideoTile from './VideoTile.svelte';
  import PeerAudio from './PeerAudio.svelte';

  let { channel }: { channel: Channel } = $props();

  const joined = $derived(voice.channelId === channel.id);
  const others = $derived(app.inVoice(channel.id));
  const peers = $derived(Object.values(voice.peers));
  let focus = $state<string | null>(null);
  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  const autoFocused = new Set<string>();

  // Quando qualcuno inizia a condividere lo schermo, lo metti in primo piano (una volta).
  $effect(() => {
    for (const p of peers) {
      const sharing = app.online[p.id]?.screen;
      if (sharing && !autoFocused.has(p.id) && focus === null) {
        autoFocused.add(p.id);
        focus = p.id;
      }
      if (!sharing) autoFocused.delete(p.id);
    }
    if (focus && focus !== app.me && !voice.peers[focus]) focus = null;
  });

  function volumeOf(id: string) {
    if (voice.deaf || app.voiceMutes[id]) return 0;
    return prefs.outputVolume * userVolume(id);
  }

  function openMenu(e: MouseEvent, id: string) {
    if (id === app.me) return;
    e.preventDefault();
    menu = { id, x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 160) };
  }

  function setUserVolume(id: string, v: number) {
    prefs.userVolumes[id] = v;
    savePrefs();
  }

  // Mute imposto dall'admin: applicato appena cambia.
  $effect(() => {
    void app.voiceMutes[app.me ?? ''];
    voice.applyMic();
  });

  const count = $derived(peers.length + 1);
  const cols = $derived(count <= 1 ? 1 : count <= 4 ? 2 : 3);
</script>

<div class="voice">
  <header>
    <Icon name="volume" size={18} />
    <h2>{channel.name}</h2>
  </header>

  {#if !rtcSupported}
    <div class="empty">
      <h3>Vocale non disponibile</h3>
      <p class="muted">
        Il motore web di questo sistema non supporta WebRTC. Su Linux serve una WebKitGTK compilata con WebRTC
        e i plugin GStreamer (good/bad/nice). La chat funziona normalmente.
      </p>
    </div>
  {:else if !joined}
    <div class="empty">
      <div class="faces">
        {#each others as p (p.user_id)}<Avatar id={p.user_id} size={44} />{/each}
      </div>
      <h3>{others.length ? `${others.length} in ${channel.name}` : 'Nessuno qui'}</h3>
      {#if voice.error}<p class="err">{voice.error}</p>{/if}
      <button class="btn primary" disabled={voice.joining} onclick={() => voice.join(channel.id)}>
        {voice.channelId !== null ? 'Sposta qui' : 'Entra'}
      </button>
    </div>
  {:else}
    <div class="stage" class:focus={!!focus}>
      {#if focus}
        {@const fp = focus === app.me ? null : voice.peers[focus]}
        <div class="main">
          {#if focus === app.me}
            <VideoTile
              id={app.me!}
              stream={voice.localStream}
              hasVideo={!!voice.videoKind}
              rev={voice.localRev}
              speaking={voice.localSpeaking}
              mirror
              focused
              ondblclick={() => (focus = null)}
            />
          {:else if fp}
            <VideoTile
              id={fp.id}
              stream={fp.stream}
              hasVideo={fp.hasVideo}
              rev={fp.rev}
              speaking={fp.speaking}
              focused
              ondblclick={() => (focus = null)}
            />
          {/if}
        </div>
      {:else}
        <div class="grid" style="--cols:{cols}">
          <VideoTile
            id={app.me!}
            stream={voice.localStream}
            hasVideo={!!voice.videoKind}
            rev={voice.localRev}
            speaking={voice.localSpeaking}
            mirror
            ondblclick={() => (focus = app.me)}
          />
          {#each peers as p (p.id)}
            <VideoTile
              id={p.id}
              stream={p.stream}
              hasVideo={p.hasVideo}
              rev={p.rev}
              speaking={p.speaking && !app.voiceMutes[p.id]}
              connecting={p.connection !== 'connected'}
              ondblclick={() => (focus = p.id)}
              oncontextmenu={(e) => openMenu(e, p.id)}
            />
          {/each}
        </div>
      {/if}
    </div>

    {#each peers as p (p.id)}
      {#each p.audioStreams as s (s.id)}
        <PeerAudio stream={s} volume={volumeOf(p.id)} />
      {/each}
    {/each}

    {#if menu}
      {@const id = menu.id}
      <div class="backdrop" role="presentation" onclick={() => (menu = null)}></div>
      <div class="menu" style="left:{menu.x}px; top:{menu.y}px">
        <div class="menu-title">{app.name(id)}</div>
        <label class="vol">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={userVolume(id)}
            oninput={(e) => setUserVolume(id, Number(e.currentTarget.value))}
          />
          <span class="pct">{Math.round(userVolume(id) * 100)}%</span>
        </label>
        {#if app.isAdmin}
          <button
            onclick={async () => {
              menu = null;
              await supabase.rpc('admin_set_voice_mute', { p_user: id, p_muted: !app.voiceMutes[id] });
            }}
          >
            <Icon name="mic-off" size={15} />
            {app.voiceMutes[id] ? 'Togli mute (admin)' : 'Muta per tutti (admin)'}
          </button>
        {/if}
      </div>
    {/if}

    {#if voice.error}<p class="err center">{voice.error}</p>{/if}
    {#if voice.notice}<p class="muted center">{voice.notice}</p>{/if}

    <div class="controls">
      <button
        class="ctl"
        class:off={!voice.micOn || voice.adminMuted}
        title={voice.adminMuted ? 'Silenziato dall’admin' : 'Microfono'}
        onclick={() => voice.toggleMic()}
      >
        <Icon name={voice.micOn && !voice.adminMuted ? 'mic' : 'mic-off'} size={20} />
      </button>
      <button class="ctl" class:off={voice.deaf} title="Audio" onclick={() => voice.toggleDeaf()}>
        <Icon name={voice.deaf ? 'headphones-off' : 'headphones'} size={20} />
      </button>
      <button class="ctl" class:on={voice.videoKind === 'cam'} title="Webcam" onclick={() => voice.toggleCam()}>
        <Icon name={voice.videoKind === 'cam' ? 'video' : 'video-off'} size={20} />
      </button>
      {#if screenShareSupported}
        <button
          class="ctl"
          class:on={voice.videoKind === 'screen'}
          title={voice.videoKind === 'screen' ? 'Interrompi condivisione' : 'Condividi schermo'}
          onclick={() => voice.toggleScreen()}
        >
          <Icon name="screen" size={20} />
        </button>
      {/if}
      <button class="ctl leave" title="Esci" onclick={() => voice.leave()}>
        <Icon name="leave" size={20} />
      </button>
    </div>
  {/if}
</div>

<style>
  .voice {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    height: 52px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
  }
  h2 { font-size: 15px; font-weight: 600; margin: 0; color: var(--text); }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
  }
  .empty h3 { margin: 0; font-size: 17px; font-weight: 600; }
  .empty p { margin: 0; max-width: 440px; font-size: 13px; }
  .empty .btn { height: 36px; padding: 0 24px; }
  .faces { display: flex; gap: 8px; }
  .stage {
    flex: 1;
    min-height: 0;
    padding: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .grid {
    width: 100%;
    max-width: 1200px;
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    gap: 10px;
    align-content: center;
  }
  .main { width: 100%; height: 100%; }
  .controls {
    flex: none;
    display: flex;
    justify-content: center;
    gap: 10px;
    padding: 12px 0 20px;
  }
  .ctl {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--bg-active);
    color: var(--text);
    transition: background 0.12s, transform 0.08s;
  }
  .ctl:hover { background: var(--border-strong); }
  .ctl:active { transform: scale(0.95); }
  .ctl.on { background: var(--accent); color: #fff; }
  .ctl.off { background: var(--text); color: var(--bg); }
  .ctl.leave { background: var(--red); color: #fff; }
  .center { text-align: center; font-size: 13px; margin: 0; }
  .backdrop { position: fixed; inset: 0; z-index: 40; }
  .menu {
    position: fixed;
    z-index: 41;
    width: 240px;
    padding: 6px;
    border-radius: var(--r);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .menu-title { font-size: 11px; color: var(--text-3); padding: 4px 8px 6px; font-weight: 600; }
  .vol { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px; font-size: 13px; }
  .vol input { flex: 1; accent-color: var(--accent); }
  .pct { width: 36px; text-align: right; color: var(--text-2); font-size: 12px; }
  .menu button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    font-size: 13px;
    text-align: left;
  }
  .menu button:hover { background: var(--accent); color: #fff; }
</style>
