<script lang="ts">
  import { supabase } from '../lib/supabase';
  import { app } from '../lib/state.svelte';
  import { errorText } from '../lib/util';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  const sorted = $derived(
    [...app.members].sort((a, b) => app.name(a.user_id).localeCompare(app.name(b.user_id))),
  );
  const online = $derived(sorted.filter((m) => app.online[m.user_id]));
  const offline = $derived(sorted.filter((m) => !app.online[m.user_id]));

  let menu = $state<{ id: string; x: number; y: number } | null>(null);
  let confirm = $state<{ id: string; action: 'kick' | 'ban' } | null>(null);
  let reason = $state('');
  let error = $state<string | null>(null);

  function open(e: MouseEvent, id: string) {
    if (!app.isAdmin || id === app.me) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = { id, x: Math.min(r.left, window.innerWidth - 220), y: r.bottom + 4 };
  }

  async function rpc(fn: string, args: Record<string, unknown>) {
    error = null;
    const { error: err } = await supabase.rpc(fn, args);
    if (err) error = errorText(err);
  }

  async function toggleMute(id: string) {
    menu = null;
    await rpc('admin_set_voice_mute', { p_user: id, p_muted: !app.voiceMutes[id] });
  }

  async function doConfirm() {
    if (!confirm) return;
    const { id, action } = confirm;
    confirm = null;
    if (action === 'kick') await rpc('admin_kick', { p_user: id });
    else await rpc('admin_ban', { p_user: id, p_reason: reason.trim() || null });
    reason = '';
  }
</script>

<aside>
  {#snippet row(id: string, role: string, isOnline: boolean)}
    <button class="member" class:off={!isOnline} onclick={(e) => open(e, id)} oncontextmenu={(e) => open(e, id)}>
      <Avatar {id} size={30} status={isOnline ? 'online' : 'offline'} />
      <span class="name">{app.name(id)}</span>
      {#if role === 'admin'}<span class="admin" title="Admin"><Icon name="shield" size={13} /></span>{/if}
      {#if app.voiceMutes[id]}<span class="muted-ic" title="Silenziato dall’admin"><Icon name="mic-off" size={13} /></span>{/if}
      {#if app.online[id]?.voice}<span class="in-voice" title="In vocale"><Icon name="volume" size={13} /></span>{/if}
    </button>
  {/snippet}

  <div class="section">Online — {online.length}</div>
  {#each online as m (m.user_id)}{@render row(m.user_id, m.role, true)}{/each}
  {#if offline.length}
    <div class="section">Offline — {offline.length}</div>
    {#each offline as m (m.user_id)}{@render row(m.user_id, m.role, false)}{/each}
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
</aside>

{#if menu}
  <div class="backdrop" role="presentation" onclick={() => (menu = null)}></div>
  <div class="menu" style="left:{menu.x}px; top:{menu.y}px">
    <div class="menu-title">{app.name(menu.id)}</div>
    <button onclick={() => toggleMute(menu!.id)}>
      <Icon name="mic-off" size={15} />
      {app.voiceMutes[menu.id] ? 'Togli mute vocale' : 'Muta in vocale'}
    </button>
    <button onclick={() => { confirm = { id: menu!.id, action: 'kick' }; menu = null; }}>
      <Icon name="logout" size={15} /> Espelli
    </button>
    <button class="danger" onclick={() => { confirm = { id: menu!.id, action: 'ban' }; menu = null; }}>
      <Icon name="x" size={15} /> Banna
    </button>
  </div>
{/if}

{#if confirm}
  <div class="modal-bg" role="presentation" onclick={() => (confirm = null)}>
    <div class="modal" role="dialog" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <h3>{confirm.action === 'kick' ? 'Espellere' : 'Bannare'} {app.name(confirm.id)}?</h3>
      <p class="muted">
        {confirm.action === 'kick'
          ? 'Potrà rientrare con la password del server.'
          : 'Non potrà rientrare finché non lo sbanni dalle impostazioni.'}
      </p>
      {#if confirm.action === 'ban'}
        <input class="field" placeholder="Motivo (opzionale)" bind:value={reason} />
      {/if}
      <div class="row">
        <button class="btn" onclick={() => (confirm = null)}>Annulla</button>
        <button class="btn danger" onclick={doConfirm}>{confirm.action === 'kick' ? 'Espelli' : 'Banna'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  aside {
    background: var(--bg-sidebar);
    border-left: 1px solid var(--border);
    overflow-y: auto;
    padding: 8px 10px;
  }
  .section {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 14px 8px 6px;
  }
  .member {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 8px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .member:hover { background: var(--bg-hover); }
  .member.off { opacity: 0.5; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }
  .admin { color: var(--orange); display: flex; }
  .muted-ic { color: var(--red); display: flex; }
  .in-voice { color: var(--green); display: flex; }
  .err { font-size: 12px; padding: 8px; }
  .backdrop { position: fixed; inset: 0; z-index: 40; }
  .menu {
    position: fixed;
    z-index: 41;
    width: 200px;
    padding: 5px;
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
  .menu button.danger { color: var(--red); }
  .menu button.danger:hover { background: var(--red); color: #fff; }
  .modal-bg {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.35);
    display: grid;
    place-items: center;
  }
  .modal {
    width: 360px;
    padding: 22px;
    border-radius: var(--r-lg);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .modal h3 { margin: 0; font-size: 16px; }
  .modal p { margin: 0; font-size: 13px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
</style>
