<script lang="ts">
  // Private messages screen: activation / unlock with the recovery code, new chat, conversation.
  import { app } from '../lib/state.svelte';
  import { dm, type Prepared } from '../lib/dm.svelte';
  import { normalizeCode, isFullCode } from '../lib/dmcrypto';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import DmChat from './DmChat.svelte';
  import { t } from '../lib/i18n.svelte';

  // --- Recovery code ---
  let busy = $state(false);
  let error = $state<string | null>(null);
  let resetting = $state(false); // "I lost the code"
  let prepared = $state<Prepared | null>(null); // generated code, not confirmed yet
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
      error = t('dmv.copyFailed');
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

  // --- New chat: members in alphabetical order, those starting with what you type first ---
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
    // keys may have changed since the app started (someone just activated)
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
    <div class="center muted">{t('common.loading')}</div>
  {:else if dm.status === 'off'}
    <div class="center muted">{t('dmv.unavailable')}</div>
  {:else if dm.status === 'setup' || dm.status === 'locked'}
    <div class="center">
      <div class="card">
        <div class="badge-icon"><Icon name="lock" size={24} /></div>
        {#if creating && prepared}
          <h2>{t('dmv.codeTitle')}</h2>
          <p class="muted">{t('dmv.codeHint')}</p>
          <div class="code selectable allow-native-menu">{prepared.code}</div>
          <button class="btn" onclick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? t('dmv.copied') : t('dmv.copy')}
          </button>
          <label class="check">
            <input type="checkbox" bind:checked={saved} />
            <span>{t('dmv.saved')}</span>
          </label>
          {#if error}<p class="err">{error}</p>{/if}
          <button class="btn primary" disabled={!saved || busy} onclick={activate}>
            {busy ? t('common.wait') : t('dmv.continue')}
          </button>
        {:else if creating}
          <h2>{resetting ? t('dmv.newCodeTitle') : t('dmv.introTitle')}</h2>
          {#if resetting}
            <p class="muted">{t('dmv.newCodeHint')}</p>
          {:else}
            <p class="why">
              <strong>{t('dmv.why')}</strong> {t('dmv.whyText')}
            </p>
          {/if}
          {#if error}<p class="err">{error}</p>{/if}
          <button class="btn primary" disabled={busy} onclick={generate}>
            {busy ? t('common.wait') : resetting ? t('dmv.generate') : t('dmv.activate')}
          </button>
        {:else}
          <h2>{t('dmv.unlockTitle')}</h2>
          <p class="muted">{t('dmv.unlockHint')}</p>
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
              {busy ? t('common.wait') : t('dmv.unlock')}
            </button>
          </form>
        {/if}
        {#if dm.status === 'locked'}
          <button class="link" type="button" onclick={toggleReset}>
            {resetting ? t('dmv.foundCode') : t('dmv.lostCode')}
          </button>
        {/if}
      </div>
    </div>
  {:else if dm.current === null}
    <header><Icon name="plus" size={18} /><h2>{t('dm.newChat')}</h2></header>
    <div class="picker">
      <label class="search">
        <Icon name="search" size={16} />
        <!-- svelte-ignore a11y_autofocus -->
        <input placeholder={t('dmv.search')} bind:value={query} onkeydown={searchKey} autofocus />
      </label>
      <div class="list">
        {#each candidates as c (c.id)}
          <button class="person" disabled={!c.ready} onclick={() => pick(c.id)}>
            <Avatar id={c.id} size={32} status={app.presence[c.id] ? 'online' : 'offline'} />
            <span class="who">
              <span class="pname">{c.name}</span>
              {#if !c.ready}<span class="sub">{t('dmv.notActivated')}</span>{/if}
            </span>
          </button>
        {:else}
          <p class="muted none">{t('dmv.noMembers')}</p>
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
