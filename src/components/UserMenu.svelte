<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { prefs, savePrefs, userVolume } from '../lib/prefs.svelte';
  import { supabase } from '../lib/supabase';
  import { errorText } from '../lib/util';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import VolumeSlider from './VolumeSlider.svelte';
  import PokeItem from './PokeItem.svelte';

  // Menu del tasto destro su una persona. Usato da lista membri, sidebar vocale e chat.
  let {
    id,
    x,
    y,
    onclose,
    onconfirm,
  }: {
    id: string;
    x: number;
    y: number;
    onclose: () => void;
    // il genitore apre la finestra di conferma per espulsione e ban
    onconfirm: (action: 'kick' | 'ban') => void;
  } = $props();

  let panel: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  const isMe = $derived(id === app.me);
  const member = $derived(app.members.find((m) => m.user_id === id));
  const vol = $derived(userVolume(id));
  const left = $derived(Math.max(8, Math.min(x, window.innerWidth - 272)));
  const top = $derived(Math.max(8, Math.min(y, window.innerHeight - 360)));

  function setVol(v: number) {
    prefs.userVolumes[id] = v;
    savePrefs();
  }

  async function run(fn: string, args: Record<string, unknown>) {
    error = null;
    const { error: err } = await supabase.rpc(fn, args);
    if (err) error = errorText(err);
    else onclose();
  }

  function outside(e: Event) {
    if (panel && e.target instanceof Node && panel.contains(e.target)) return;
    onclose();
  }

  onMount(() => {
    // La fase di cattura chiude il menu prima che il nuovo clic destro ne apra un altro.
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('contextmenu', outside, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('contextmenu', outside, true);
    };
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div
  class="menu"
  bind:this={panel}
  style="left:{left}px; top:{top}px"
  role="menu"
  tabindex="-1"
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="head">
    <Avatar {id} size={32} />
    <div class="who">
      <div class="name">{app.name(id)}</div>
      <div class="role">{member?.role === 'admin' ? 'Admin' : 'Membro'}{member?.contributor ? ' · Contributor' : ''}</div>
    </div>
  </div>

  {#if !isMe}
    <div class="sep"></div>
    <VolumeSlider label="Volume" value={vol} onchange={setVol} />
    <button class="item" onclick={() => setVol(vol > 0 ? 0 : 1)}>
      <Icon name={vol > 0 ? 'volume' : 'mic-off'} size={15} />
      {vol > 0 ? 'Silenzia per me' : 'Riattiva audio'}
    </button>
    {#if app.presence[id]?.deaf}<PokeItem {id} onsent={onclose} />{/if}
    {#if app.presence[id]}
      <button class="item" onclick={() => { app.openDm(id); onclose(); }}><Icon name="send" size={15} /> Messaggio privato</button>
    {/if}
  {/if}

  {#if app.isAdmin}
    <div class="sep"></div>
    <button class="item" onclick={() => run('admin_set_contributor', { p_user: id, p_on: !member?.contributor })}>
      <Icon name="sword" size={15} />
      {member?.contributor ? 'Togli badge Contributor' : 'Dai badge Contributor'}
    </button>
  {/if}

  {#if app.isAdmin && !isMe}
    <button class="item" onclick={() => run('admin_set_voice_mute', { p_user: id, p_muted: !app.voiceMutes[id] })}>
      <Icon name="mic-off" size={15} />
      {app.voiceMutes[id] ? 'Togli mute in vocale' : 'Muta in vocale'}
    </button>
    <button class="item danger" onclick={() => onconfirm('kick')}>
      <Icon name="logout" size={15} /> Espelli
    </button>
    <button class="item danger" onclick={() => onconfirm('ban')}>
      <Icon name="x" size={15} /> Banna
    </button>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}
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
  .head { display: flex; align-items: center; gap: 10px; padding: 8px; }
  .who { min-width: 0; }
  .name { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role { font-size: 11px; color: var(--text-3); }
  .sep { height: 1px; background: var(--border); margin: 4px 0; }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    font-size: 13px;
    text-align: left;
  }
  .item:hover { background: var(--accent); color: #fff; }
  .item.danger { color: var(--red); }
  .item.danger:hover { background: var(--red); color: #fff; }
  .err { font-size: 12px; color: var(--red); padding: 6px 8px; margin: 0; }
</style>