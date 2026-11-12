<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { voice } from '../lib/voice.svelte';
  import { prefs, savePrefs, userVolume, screenVolume } from '../lib/prefs.svelte';
  import { supabase } from '../lib/supabase';
  import Icon from './Icon.svelte';
  import VolumeSlider from './VolumeSlider.svelte';
  import PokeItem from './PokeItem.svelte';
  import { t } from '../lib/i18n.svelte';

  // Right-click menu on a person in voice: volume, mute, admin mute.
  // Closes with a click or right-click outside the menu, or with Esc.
  let { id, x, y, screen = false, onclose }: {
    id: string;
    x: number;
    y: number;
    screen?: boolean;
    onclose: () => void;
  } = $props();

  let panel: HTMLDivElement | undefined;

  const vol = $derived(screen ? screenVolume(id) : userVolume(id));
  const left = $derived(Math.max(8, Math.min(x, window.innerWidth - 250)));
  const top = $derived(Math.max(8, Math.min(y, window.innerHeight - 170)));

  function setVol(v: number) {
    if (screen) prefs.screenVolumes[id] = v;
    else prefs.userVolumes[id] = v;
    savePrefs();
  }

  async function toggleVoiceMute() {
    onclose();
    await supabase.rpc('admin_set_voice_mute', { p_user: id, p_muted: !app.voiceMutes[id] });
  }

  // A click or right-click outside the menu closes it. The "capture" phase makes it
  // close before the new right-click opens another person's menu.
  function outside(e: Event) {
    if (panel && e.target instanceof Node && panel.contains(e.target)) return;
    onclose();
  }

  onMount(() => {
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('contextmenu', outside, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('contextmenu', outside, true);
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="menu" bind:this={panel} style="left:{left}px; top:{top}px" role="presentation" oncontextmenu={(e) => e.preventDefault()}>
  <div class="menu-title">{screen ? t('menu.streamOf', { name: app.name(id) }) : app.name(id)}</div>
  <VolumeSlider label={screen ? t('menu.streamAudio') : t('menu.volume')} value={vol} onchange={setVol} />
  <button onclick={() => setVol(vol > 0 ? 0 : 1)}>
    <Icon name={vol > 0 ? 'volume' : 'mic-off'} size={15} />
    {vol > 0 ? (screen ? t('menu.muteStream') : t('menu.muteForMe')) : t('call.undeafen')}
  </button>
  {#if screen && voice.watching[id]}
    <button onclick={() => { delete voice.watching[id]; onclose(); }}>
      <Icon name="screen" size={15} />
      {t('menu.stopWatching')}
    </button>
  {/if}
  {#if !screen && app.presence[id]?.deaf}<PokeItem {id} onsent={onclose} />{/if}
  {#if app.isAdmin && !screen}
    <button onclick={toggleVoiceMute}>
      <Icon name="mic-off" size={15} />
      {app.voiceMutes[id] ? t('menu.unmuteAdmin') : t('menu.muteAdmin')}
    </button>
  {/if}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 41;
    width: 260px;
    padding: 6px;
    border-radius: var(--r);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .menu-title { font-size: 11px; color: var(--text-3); padding: 4px 8px 6px; font-weight: 600; }
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