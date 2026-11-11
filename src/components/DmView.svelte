<script lang="ts">
  // Schermata dei messaggi privati: PIN (attivazione / sblocco), nuova chat, conversazione.
  import { app } from '../lib/state.svelte';
  import { dm, PIN_MIN } from '../lib/dm.svelte';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import DmChat from './DmChat.svelte';

  // --- PIN ---
  let pin = $state('');
  let pin2 = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let resetting = $state(false);
  const creating = $derived(dm.status === 'setup' || resetting);

  async function submitPin(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (creating) {
      if (pin.length < PIN_MIN) return void (error = `Il PIN deve avere almeno ${PIN_MIN} caratteri.`);
      if (pin !== pin2) return void (error = 'I due PIN non coincidono.');
    }
    busy = true;
    error = creating ? await dm.setup(pin) : await dm.unlock(pin);
    busy = false;
    if (!error) {
      pin = pin2 = '';
      resetting = false;
    }
  }

  // --- Nuova chat: membri in ordine alfabetico, prima chi inizia con quello che scrivi ---
  let query = $state('');
  const candidates = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const all = app.members
      .filter((m) => m.user_id !== app.me)
      .map((m) => ({ id: m.user_id, name: app.name(m.user_id), ready: !!dm.keys[m.user_id] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return all;
    const starts = all.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    return [...starts, ...contains];
  });

  $effect(() => {
    // le chiavi possono essere cambiate da quando è partita l'app (qualcuno ha appena attivato)
    if (dm.status === 'ready' && dm.current === null) dm.loadKeys();
  });

  function pick(id: string) {
    query = '';
    dm.enter(id);
  }

  function searchKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    const first = candidates.find((c) => c.ready);
    if (first) pick(first.id);
  }
</script>

<div class="dm">
  {#if dm.status === 'idle' || dm.status === 'loading'}
    <div class="center muted">Caricamento…</div>
  {:else if dm.status === 'off'}
    <div class="center muted">I messaggi privati non sono ancora disponibili su questo server.</div>
  {:else if dm.status === 'setup' || dm.status === 'locked'}
    <div class="center">
      <form class="card" onsubmit={submitPin}>
        <div class="badge-icon"><Icon name="lock" size={24} /></div>
        {#if creating}
          <h2>{resetting ? 'Nuovo PIN delle chat' : 'Messaggi privati cifrati'}</h2>
          <p class="muted">
            {#if resetting}
              I messaggi che hai già non potrai più leggerli tu; chi ti ha scritto continuerà a vederli.
            {:else}
              Solo tu e chi ti risponde potete leggerli, nemmeno il server. Scegli un PIN per le chat: ti
              servirà per leggerli su un altro dispositivo.
            {/if}
          </p>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="field" type="password" placeholder="PIN (almeno {PIN_MIN} caratteri)" autocomplete="new-password"
            bind:value={pin} autofocus />
          <input class="field" type="password" placeholder="Ripeti il PIN" autocomplete="new-password" bind:value={pin2} />
          <p class="hint">Non usare la password dell’account. Se dimentichi il PIN, i messaggi vecchi non si possono recuperare.</p>
        {:else}
          <h2>Sblocca i messaggi</h2>
          <p class="muted">Inserisci il PIN delle chat. Su questo dispositivo non te lo chiederemo più.</p>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="field" type="password" placeholder="PIN delle chat" autocomplete="current-password"
            bind:value={pin} autofocus />
        {/if}
        {#if error}<p class="err">{error}</p>{/if}
        <button class="btn primary" type="submit" disabled={busy || !pin}>
          {busy ? 'Un attimo…' : creating ? 'Attiva' : 'Sblocca'}
        </button>
        {#if dm.status === 'locked'}
          <button class="link" type="button" onclick={() => { resetting = !resetting; error = null; pin = pin2 = ''; }}>
            {resetting ? 'Ho ritrovato il PIN' : 'Ho dimenticato il PIN'}
          </button>
        {/if}
      </form>
    </div>
  {:else if dm.current === null}
    <header><Icon name="plus" size={18} /><h2>Nuova chat</h2></header>
    <div class="picker">
      <label class="search">
        <Icon name="search" size={16} />
        <!-- svelte-ignore a11y_autofocus -->
        <input placeholder="Cerca un membro" bind:value={query} onkeydown={searchKey} autofocus />
      </label>
      <div class="list">
        {#each candidates as c (c.id)}
          <button class="person" disabled={!c.ready} onclick={() => pick(c.id)}>
            <Avatar id={c.id} size={32} status={app.presence[c.id] ? 'online' : 'offline'} />
            <span class="who">
              <span class="pname">{c.name}</span>
              {#if !c.ready}<span class="sub">non ha ancora attivato i messaggi</span>{/if}
            </span>
          </button>
        {:else}
          <p class="muted none">Nessun membro trovato.</p>
        {/each}
      </div>
    </div>
  {:else}
    {#key dm.current}
      <DmChat peer={dm.current} />
    {/key}
  {/if}
</div>

<style>
  .dm { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .center { flex: 1; display: grid; place-items: center; padding: 24px; text-align: center; }
  .card {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .badge-icon {
    align-self: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  h2 { margin: 4px 0 0; font-size: 18px; font-weight: 600; }
  .card p { margin: 0; font-size: 13px; line-height: 1.5; }
  .hint { color: var(--text-3); font-size: 12px !important; text-align: left; }
  .err { text-align: left; }
  .link {
    align-self: center;
    font-size: 12px;
    color: var(--text-3);
  }
  .link:hover { color: var(--text); text-decoration: underline; }

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
  header h2 { margin: 0; font-size: 15px; color: var(--text); }
  .picker { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 16px 20px 0; max-width: 560px; width: 100%; }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    border-radius: var(--r);
    background: var(--bg-input);
    border: 1px solid transparent;
    color: var(--text-3);
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .search input { flex: 1; border: 0; outline: none; background: transparent; color: var(--text); }
  .list { flex: 1; overflow-y: auto; margin-top: 10px; padding-bottom: 16px; }
  .person {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .person:hover:not(:disabled) { background: var(--bg-hover); }
  .person:disabled { cursor: default; opacity: 0.5; }
  .who { display: flex; flex-direction: column; min-width: 0; }
  .pname { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: 12px; color: var(--text-3); }
  .none { padding: 8px 10px; font-size: 13px; }
</style>
