<script lang="ts">
  // Schermata dei messaggi privati: attivazione / sblocco col codice di recupero, nuova chat, conversazione.
  import { app } from '../lib/state.svelte';
  import { dm, type Prepared } from '../lib/dm.svelte';
  import { normalizeCode, isFullCode } from '../lib/dmcrypto';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import DmChat from './DmChat.svelte';

  // --- Codice di recupero ---
  let busy = $state(false);
  let error = $state<string | null>(null);
  let resetting = $state(false); // "Ho perso il codice"
  let prepared = $state<Prepared | null>(null); // codice generato, non ancora confermato
  let saved = $state(false);
  let copied = $state(false);
  let code = $state('');
  const creating = $derived(dm.status === 'setup' || resetting);

  async function generate() {
    busy = true;
    error = null;
    prepared = await dm.prepare();
    saved = copied = false;
    busy = false;
  }

  async function copy() {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(prepared.code);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      error = 'Copia non riuscita: selezionalo e copialo a mano.';
    }
  }

  async function activate() {
    if (!prepared || !saved) return;
    busy = true;
    error = await dm.activate(prepared);
    busy = false;
    if (!error) {
      prepared = null;
      resetting = false;
    }
  }

  async function unlock(e: SubmitEvent) {
    e.preventDefault();
    if (!isFullCode(code)) return;
    busy = true;
    error = await dm.unlock(code);
    busy = false;
    if (!error) code = '';
  }

  function toggleReset() {
    resetting = !resetting;
    prepared = null;
    error = null;
    code = '';
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
      <div class="card">
        <div class="badge-icon"><Icon name="lock" size={24} /></div>
        {#if creating && prepared}
          <h2>Il tuo codice di recupero</h2>
          <p class="muted">
            Serve solo per leggere i messaggi su un altro dispositivo o dopo una reinstallazione. Salvalo ora
            (gestore di password, foto, foglietto): non lo mostreremo più.
          </p>
          <div class="code selectable allow-native-menu">{prepared.code}</div>
          <button class="btn" onclick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? 'Copiato' : 'Copia'}
          </button>
          <label class="check">
            <input type="checkbox" bind:checked={saved} />
            <span>L’ho salvato in un posto sicuro</span>
          </label>
          {#if error}<p class="err">{error}</p>{/if}
          <button class="btn primary" disabled={!saved || busy} onclick={activate}>
            {busy ? 'Un attimo…' : 'Continua'}
          </button>
        {:else if creating}
          <h2>{resetting ? 'Nuovo codice di recupero' : 'Messaggi privati cifrati'}</h2>
          <p class="muted">
            {#if resetting}
              Con un codice nuovo i messaggi che hai già non potrai più leggerli tu; chi ti ha scritto
              continuerà a vederli.
            {:else}
              Solo tu e chi ti risponde potete leggerli, nemmeno il server. Ti daremo un codice di recupero da
              conservare: serve solo su un altro dispositivo.
            {/if}
          </p>
          {#if !resetting}
            <p class="why">
              <strong>Perché?</strong> Su Discord e app simili i messaggi privati non sono cifrati end-to-end:
              chi gestisce il servizio può leggerli. Qui no, per proteggere la tua privacy.
            </p>
          {/if}
          {#if error}<p class="err">{error}</p>{/if}
          <button class="btn primary" disabled={busy} onclick={generate}>
            {busy ? 'Un attimo…' : resetting ? 'Genera un nuovo codice' : 'Attiva'}
          </button>
        {:else}
          <h2>Sblocca i messaggi</h2>
          <p class="muted">Inserisci il codice di recupero. Su questo dispositivo non te lo chiederemo più.</p>
          <form class="unlock" onsubmit={unlock}>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="field code-input"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
              autocomplete="off"
              spellcheck="false"
              value={code}
              oninput={(e) => (code = e.currentTarget.value = normalizeCode(e.currentTarget.value))}
              autofocus
            />
            {#if error}<p class="err">{error}</p>{/if}
            <button class="btn primary" type="submit" disabled={busy || !isFullCode(code)}>
              {busy ? 'Un attimo…' : 'Sblocca'}
            </button>
          </form>
        {/if}
        {#if dm.status === 'locked'}
          <button class="link" type="button" onclick={toggleReset}>
            {resetting ? 'Ho ritrovato il codice' : 'Ho perso il codice'}
          </button>
        {/if}
      </div>
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
  .err { text-align: left; }
  .card p.why {
    padding: 10px 12px;
    border-radius: var(--r);
    background: var(--accent-soft);
    color: var(--text-2);
    font-size: 12px;
    text-align: left;
  }
  .why strong { color: var(--text); font-weight: 600; }
  .unlock { display: flex; flex-direction: column; gap: 10px; }
  .code {
    padding: 14px 10px;
    border-radius: var(--r);
    background: var(--bg-input);
    border: 1px dashed var(--border-strong);
    font-family: ui-monospace, 'JetBrains Mono', 'Cascadia Mono', monospace;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--text);
  }
  .code-input {
    text-align: center;
    font-family: ui-monospace, 'JetBrains Mono', 'Cascadia Mono', monospace;
    letter-spacing: 0.06em;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
  }
  .check input { accent-color: var(--accent); }
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
