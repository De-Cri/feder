<script lang="ts">
  import { app, type Channel } from '../lib/state.svelte';
  import { voice, rtcSupported } from '../lib/voice.svelte';
  import { prefs, savePrefs, screenVolume } from '../lib/prefs.svelte';
  import Avatar from './Avatar.svelte';
  import VideoTile from './VideoTile.svelte';
  import VoiceMenu from './VoiceMenu.svelte';
  import CallControls from './CallControls.svelte';

  let { channel }: { channel: Channel } = $props();

  const joined = $derived(voice.channelId === channel.id);
  const others = $derived(app.inVoice(channel.id));
  const peers = $derived(Object.values(voice.peers));
  let focus = $state<string | null>(null); // chiave del riquadro in primo piano
  let menu = $state<{ id: string; x: number; y: number; screen: boolean } | null>(null);

  // Ogni persona ha il suo riquadro; chi condivide lo schermo ne ha uno in più, separato.
  type Tile = {
    key: string;
    id: string;
    screen: boolean;
    stream: MediaStream | null;
    hasVideo: boolean;
    rev: number;
    speaking: boolean;
    mirror: boolean;
    connecting: boolean;
  };
  const tiles = $derived.by(() => {
    const out: Tile[] = [];
    const me = app.me!;
    out.push({
      key: me, id: me, screen: false, stream: voice.camPreview, hasVideo: voice.camOn,
      rev: voice.localRev, speaking: voice.localSpeaking, mirror: true, connecting: false,
    });
    if (voice.screenOn) {
      out.push({
        key: `${me}:screen`, id: me, screen: true, stream: voice.screenPreview, hasVideo: true,
        rev: voice.localRev, speaking: false, mirror: false, connecting: false,
      });
    }
    for (const p of peers) {
      const pres = app.presence[p.id];
      // Versioni vecchie non dicono quale video è lo schermo: si deduce dalla presenza.
      const legacyScreen = p.screenStreamId === undefined && !!pres?.screen && !pres?.cam;
      const camStream = legacyScreen ? null : p.camView;
      const camLive = legacyScreen ? false : p.hasCam;
      const screenStream = legacyScreen ? p.camView : p.screenView;
      const screenLive = legacyScreen ? p.hasCam : p.hasScreen;
      out.push({
        key: p.id, id: p.id, screen: false, stream: camStream, hasVideo: camLive, rev: p.rev,
        speaking: p.speaking && !app.voiceMutes[p.id], mirror: false, connecting: p.connection !== 'connected',
      });
      if (pres?.screen || screenLive) {
        out.push({
          key: `${p.id}:screen`, id: p.id, screen: true, stream: screenStream, hasVideo: screenLive, rev: p.rev,
          speaking: false, mirror: false, connecting: p.connection !== 'connected',
        });
      }
    }
    return out;
  });
  const focused = $derived(focus ? tiles.find((t) => t.key === focus) ?? null : null);
  const strip = $derived(focused ? tiles.filter((t) => t.key !== focused.key) : []);

  $effect(() => {
    if (focus && !tiles.some((t) => t.key === focus && !locked(t))) focus = null;
  });

  // Lo schermo degli altri parte chiuso: un click lo apre piccolo, doppio click grande.
  const locked = (t: Tile) => t.screen && t.id !== app.me && !voice.watching[t.id];
  function watch(t: Tile) {
    if (locked(t)) voice.watching[t.id] = true;
  }

  function openMenu(e: MouseEvent, id: string, screen = false) {
    e.preventDefault();
    if (id === app.me) {
      menu = null;
      return;
    }
    menu = { id, screen, x: e.clientX, y: e.clientY };
  }

  // Silenzia o riattiva l'audio della condivisione schermo di qualcuno (per te).
  function toggleScreenAudio(id: string) {
    prefs.screenVolumes[id] = screenVolume(id) > 0 ? 0 : 1;
    savePrefs();
  }

  const count = $derived(tiles.length);
  const cols = $derived(count <= 1 ? 1 : count <= 4 ? 2 : 3);
  const rows = $derived(Math.max(1, Math.ceil(count / cols)));
</script>

{#snippet tileView(t: Tile, isFocused: boolean)}
  <VideoTile
    id={t.id}
    stream={t.stream}
    hasVideo={t.hasVideo}
    rev={t.rev}
    speaking={t.speaking}
    mirror={t.mirror}
    screen={t.screen}
    focused={isFocused}
    audioMuted={t.screen && screenVolume(t.id) === 0}
    ontoggleaudio={t.screen && t.id !== app.me ? () => toggleScreenAudio(t.id) : undefined}
    connecting={t.connecting}
    locked={locked(t)}
    onstopwatch={t.screen && t.id !== app.me ? () => delete voice.watching[t.id] : undefined}
    onclick={() => watch(t)}
    ondblclick={() => {
      watch(t);
      focus = isFocused ? null : t.key;
    }}
    oncontextmenu={(e) => openMenu(e, t.id, t.screen)}
  />
{/snippet}

<div class="voice">
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
    <div class="stage" class:focus={!!focused}>
      {#if focused}
        <div class="main">
          {@render tileView(focused, true)}
        </div>
        {#if strip.length}
          <div class="strip">
            {#each strip as t (t.key)}
              <div class="mini">{@render tileView(t, false)}</div>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="grid" style="--cols:{cols}; --rows:{rows}">
          {#each tiles as t (t.key)}
            {@render tileView(t, false)}
          {/each}
        </div>
      {/if}
    </div>

    {#if prefs.callControls === 'stage'}
      <div class="controls"><CallControls big /></div>
    {/if}

    {#if menu}
      <VoiceMenu
        id={menu.id}
        x={menu.x}
        y={menu.y}
        screen={menu.screen}
        onclose={() => (menu = null)}
      />
    {/if}

    {#if voice.error}<p class="err center">{voice.error}</p>{/if}
    {#if voice.notice}<p class="muted center">{voice.notice}</p>{/if}
  {/if}
</div>

<style>
  .voice {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
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
    container-type: size;
  }
  /* Riquadri 16:9: la griglia non può essere più larga di quanto ci sta in altezza,
     altrimenti con la finestra larga e bassa i riquadri escono sopra e sotto. */
  .grid {
    width: min(100%, 1200px, calc((100cqh - (var(--rows) - 1) * 10px) / var(--rows) * 16 / 9 * var(--cols) + (var(--cols) - 1) * 10px));
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    gap: 10px;
    align-content: center;
  }
  .stage.focus { flex-direction: column; align-items: stretch; gap: 10px; overflow: hidden; padding-bottom: 4px; }
  .main { width: 100%; flex: 1; min-height: 0; }
  .strip { flex: none; display: flex; gap: 10px; justify-content: safe center; overflow-x: auto; }
  .mini { width: 176px; flex: none; }
  .controls { flex: none; display: flex; justify-content: center; gap: 8px; padding: 4px 16px 16px; }
  .center { text-align: center; font-size: 13px; margin: 0; padding-bottom: 8px; }
</style>