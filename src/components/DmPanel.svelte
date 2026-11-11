<script lang="ts">
  // Chat privata temporanea: finestrella in basso a destra, separata dai canali.
  // I messaggi non vengono salvati da nessuna parte e spariscono dopo 2 minuti.
  import { app, DM_MAX } from '../lib/state.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let text = $state('');
  let err = $state<string | null>(null);
  let list: HTMLDivElement | undefined = $state();

  const peer = $derived(app.dmWith);
  const msgs = $derived(peer ? (app.dms[peer] ?? []) : []);
  // Altre chat con messaggi ancora vivi: per passare da una all'altra.
  const others = $derived(Object.keys(app.dms).filter((id) => id !== peer));
  const online = $derived(!!peer && !!app.presence[peer]);

  $effect(() => {
    void msgs.length;
    list?.scrollTo({ top: list.scrollHeight });
  });

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!peer) return;
    if (app.sendDm(peer, text)) {
      text = '';
      err = null;
    } else err = online ? 'Troppi messaggi, aspetta un attimo.' : 'Non è online: non lo riceverebbe.';
  }
</script>

{#if peer}
  <div class="dm" role="dialog" aria-label="Messaggio privato">
    <div class="head">
      <Avatar id={peer} size={24} />
      <div class="title">
        <div class="name">{app.name(peer)}</div>
        <div class="sub">Privato · ogni messaggio sparisce dopo 2 min</div>
      </div>
      <button class="icon-btn" title="Chiudi" onclick={() => (app.dmWith = null)}><Icon name="x" size={16} /></button>
    </div>
    {#if others.length}
      <div class="others">
        {#each others as id (id)}
          <button class="chip" onclick={() => app.openDm(id)}><Avatar {id} size={16} /> {app.name(id)}</button>
        {/each}
      </div>
    {/if}
    <div class="list" bind:this={list}>
      {#each msgs as m (m.key)}
        <div class="msg" class:mine={m.from === app.me}>
          <div class="bubble selectable allow-native-menu">{m.text}</div>
        </div>
      {:else}
        <p class="empty">Nessun messaggio. Quello che scrivi qui non viene salvato.</p>
      {/each}
    </div>
    <form onsubmit={send}>
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={text} maxlength={DM_MAX} placeholder={online ? 'Scrivi un messaggio privato' : 'Non è online'} disabled={!online} autofocus />
      <button class="icon-btn" type="submit" title="Invia" disabled={!online || !text.trim()}><Icon name="send" size={16} /></button>
    </form>
    {#if err}<p class="err">{err}</p>{/if}
  </div>
{/if}

<style>
  .dm {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 55;
    width: min(340px, calc(100vw - 32px));
    max-height: min(460px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    border-radius: var(--r);
    background: var(--bg-elev);
    box-shadow: var(--shadow);
  }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 12px; border-bottom: 1px solid var(--border-strong); }
  .title { flex: 1; min-width: 0; }
  .name { font-weight: 600; font-size: 13px; }
  .sub { font-size: 11px; color: var(--text-3); }
  .others { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border-strong); }
  .chip { display: flex; align-items: center; gap: 4px; padding: 2px 8px 2px 2px; border-radius: 999px; background: var(--bg-input); font-size: 12px; }
  .list { flex: 1; min-height: 120px; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .msg { display: flex; }
  .msg.mine { justify-content: flex-end; }
  .bubble { max-width: 80%; padding: 6px 10px; border-radius: 12px; background: var(--bg-input); font-size: 13px; overflow-wrap: anywhere; white-space: pre-wrap; }
  .mine .bubble { background: var(--accent); color: #fff; }
  .empty { margin: auto; font-size: 12px; color: var(--text-3); text-align: center; }
  form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border-strong); }
  input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border-radius: var(--r-sm); background: var(--bg-input); border: 0; }
  .err { margin: 0 10px 8px; font-size: 12px; color: var(--red); }
</style>
