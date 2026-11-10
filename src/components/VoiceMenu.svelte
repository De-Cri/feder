<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { prefs, savePrefs, userVolume, screenVolume } from '../lib/prefs.svelte';
  import { supabase } from '../lib/supabase';
  import Icon from './Icon.svelte';
  import VolumeSlider from './VolumeSlider.svelte';
  import PokeItem from './PokeItem.svelte';

  // Menu del tasto destro su una persona in vocale: volume, silenzio, mute admin.
  // Si chiude con un clic o un tasto destro fuori dal menu, oppure con Esc.
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

  // Clic o tasto destro fuori dal menu lo chiudono. La fase "capture" fa sì che la
  // chiusura avvenga prima che il nuovo clic destro apra il menu di un'altra persona.
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
  <div class="menu-title">{screen ? `Stream di ${app.name(id)}` : app.name(id)}</div>
  <VolumeSlider label={screen ? 'Audio stream' : 'Volume'} value={vol} onchange={setVol} />
  <button onclick={() => setVol(vol > 0 ? 0 : 1)}>
    <Icon name={vol > 0 ? 'volume' : 'mic-off'} size={15} />
    {vol > 0 ? (screen ? 'Silenzia la stream' : 'Silenzia per me') : 'Riattiva audio'}
  </button>
  {#if !screen && app.presence[id]?.deaf}<PokeItem {id} onsent={onclose} />{/if}
  {#if app.isAdmin && !screen}
    <button onclick={toggleVoiceMute}>
      <Icon name="mic-off" size={15} />
      {app.voiceMutes[id] ? 'Togli mute (admin)' : 'Muta per tutti (admin)'}
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