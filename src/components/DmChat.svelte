<script lang="ts">
  // Una conversazione privata. Stesso aspetto dei canali di testo, senza allegati.
  import { onMount, tick } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { dm, DM_MAX, DM_DAYS, type DmMessage } from '../lib/dm.svelte';
  import { time, day, splitLinks } from '../lib/util';
  import { openExternal } from '../lib/platform';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';

  let { peer }: { peer: string } = $props();
  // svelte-ignore state_referenced_locally
  const log = dm.log(peer); // il componente è ricreato a ogni cambio chat

  let scroller: HTMLDivElement;
  let input: HTMLTextAreaElement;
  let text = $state('');
  let error = $state<string | null>(null);
  let sending = $state(false);
  let stick = true;

  const left = $derived(DM_MAX - text.length);
  const canWrite = $derived(!!dm.keys[peer]);

  type Row = { m: DmMessage; head: boolean; dayLabel: string | null };
  const rows = $derived.by(() => {
    const out: Row[] = [];
    let prev: DmMessage | null = null;
    for (const m of log.messages) {
      const d = day(m.created_at);
      const newDay = !prev || day(prev.created_at) !== d;
      const head =
        newDay ||
        !prev ||
        prev.sender !== m.sender ||
        new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000;
      out.push({ m, head, dayLabel: newDay ? d : null });
      prev = m;
    }
    return out;
  });

  function expiry(m: DmMessage): string {
    if (dm.stars[m.id]) return 'Con la stellina: resta finché non la togli';
    const days = Math.ceil(DM_DAYS - (Date.now() - new Date(m.created_at).getTime()) / 86_400_000);
    return days <= 1 ? 'Sparisce entro un giorno' : `Sparisce tra ${days} giorni`;
  }

  onMount(async () => {
    await log.loadInitial();
    dm.markRead(peer);
    await tick();
    scroller.scrollTop = scroller.scrollHeight;
    input?.focus();
  });

  $effect(() => {
    if (app.focused && dm.unread[peer]) dm.markRead(peer);
  });

  $effect.pre(() => {
    void log.messages.length;
    if (scroller) stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  });
  $effect(() => {
    void log.messages.length;
    if (stick && scroller) tick().then(() => (scroller.scrollTop = scroller.scrollHeight));
  });

  async function onScroll() {
    if (scroller.scrollTop < 120 && log.hasMore && !log.loading) {
      const before = scroller.scrollHeight;
      stick = false;
      await log.loadOlder();
      await tick();
      scroller.scrollTop += scroller.scrollHeight - before;
    }
  }

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    sending = true;
    error = null;
    text = '';
    resize();
    const err = await dm.send(peer, content);
    sending = false;
    if (err) {
      error = err;
      text = content;
      tick().then(resize);
    } else {
      stick = true;
    }
    input?.focus();
  }

  async function star(m: DmMessage) {
    error = await dm.toggleStar(m);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function resize() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  }

  function link(e: MouseEvent, href: string) {
    e.preventDefault();
    openExternal(href);
  }
</script>

<div class="chat">
  <header>
    <Avatar id={peer} size={24} status={app.presence[peer] ? 'online' : 'offline'} />
    <h2>{app.name(peer)}</h2>
    <span class="e2e" title="Solo voi due potete leggere questi messaggi">
      <Icon name="lock" size={13} /> Cifrata end-to-end
    </span>
  </header>

  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    {#if log.loaded && !log.hasMore}
      <div class="start">
        <Avatar id={peer} size={56} />
        <h3>{app.name(peer)}</h3>
        <p class="muted">
          Messaggi cifrati end-to-end. Spariscono dopo {DM_DAYS} giorni, tranne quelli a cui metti la
          <Icon name="star" size={12} filled />.
        </p>
      </div>
    {/if}
    {#each rows as { m, head, dayLabel } (m.id)}
      {#if dayLabel}
        <div class="day"><span>{dayLabel}</span></div>
      {/if}
      <div class="msg" class:head title={expiry(m)}>
        <div class="gutter">
          {#if head}
            <Avatar id={m.sender} size={34} />
          {:else}
            <span class="hover-time">{time(m.created_at)}</span>
          {/if}
        </div>
        <div class="body">
          {#if head}
            <div class="meta">
              <span class="author">{app.name(m.sender)}</span>
              <span class="time">{time(m.created_at)}</span>
            </div>
          {/if}
          {#if m.text === null}
            <div class="text unreadable">Messaggio non leggibile: è stato cifrato con un PIN precedente.</div>
          {:else}
            <div class="text selectable allow-native-menu">
              {#each splitLinks(m.text) as part}
                {#if part.href}<a href={part.href} onclick={(e) => link(e, part.href!)}>{part.t}</a>{:else}{part.t}{/if}
              {/each}
            </div>
          {/if}
        </div>
        {#if dm.stars[m.id]}<span class="starred"><Icon name="star" size={13} filled /></span>{/if}
        <div class="actions">
          <button class="icon-btn" class:on={!!dm.stars[m.id]}
            title={dm.stars[m.id] ? 'Togli la stellina' : 'Metti la stellina: non sparisce dopo 30 giorni'}
            onclick={() => star(m)}>
            <Icon name="star" size={15} filled={!!dm.stars[m.id]} />
          </button>
        </div>
      </div>
    {/each}
  </div>

  <div class="composer-wrap">
    {#if error}<div class="err bar">{error}</div>{/if}
    {#if !canWrite}
      <div class="muted bar">{app.name(peer)} non ha ancora attivato i messaggi privati.</div>
    {/if}
    <div class="composer" class:disabled={!canWrite}>
      <textarea
        bind:this={input}
        bind:value={text}
        rows="1"
        maxlength={DM_MAX}
        disabled={!canWrite}
        placeholder="Scrivi a {app.name(peer)}"
        onkeydown={onKey}
        oninput={resize}
      ></textarea>
      {#if left <= 200}<span class="count" class:full={left <= 0}>{left}</span>{/if}
      <button class="icon-btn" class:on={!!text.trim()} title="Invia" disabled={!canWrite} onclick={send}>
        <Icon name="send" size={17} />
      </button>
    </div>
  </div>
</div>

<style>
  .chat { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  header {
    height: 52px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 20px;
    border-bottom: 1px solid var(--border);
  }
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  .e2e {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--text-3);
  }
  .scroller { flex: 1; overflow-y: auto; padding: 12px 0 8px; }
  .start { padding: 24px 24px 12px; }
  .start h3 { margin: 12px 0 2px; font-size: 20px; font-weight: 600; }
  .start p { margin: 0; font-size: 13px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .day {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 14px 20px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: capitalize;
  }
  .day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .msg { position: relative; display: flex; gap: 12px; padding: 1px 44px 1px 20px; }
  .msg.head { margin-top: 10px; }
  .msg:hover { background: var(--bg-hover); }
  .gutter { width: 34px; flex: none; display: flex; justify-content: center; }
  .hover-time { visibility: hidden; font-size: 10px; color: var(--text-3); line-height: 22px; }
  .msg:hover .hover-time { visibility: visible; }
  .body { flex: 1; min-width: 0; }
  .meta { display: flex; align-items: baseline; gap: 8px; }
  .author { font-weight: 600; font-size: 14px; }
  .time { font-size: 11px; color: var(--text-3); }
  .text { white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; }
  .text a { color: var(--accent); text-decoration: none; }
  .text a:hover { text-decoration: underline; }
  .unreadable { color: var(--text-3); font-style: italic; font-size: 13px; }
  .starred { position: absolute; right: 20px; bottom: 4px; color: var(--orange); display: flex; }
  .actions {
    position: absolute;
    top: -12px;
    right: 20px;
    display: none;
    background: var(--bg-elev);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow);
  }
  .actions .on { color: var(--orange); }
  .msg:hover .actions { display: flex; }
  .composer-wrap { padding: 0 20px 18px; flex: none; }
  .bar { font-size: 12px; padding: 0 4px 6px; }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 5px 5px 5px 9px;
    border-radius: var(--r);
    background: var(--bg-input);
    border: 1px solid var(--border);
  }
  .composer:focus-within { border-color: var(--border-strong); }
  .composer.disabled { opacity: 0.6; }
  textarea {
    flex: 1;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    padding: 5px 0;
    max-height: 180px;
    line-height: 1.45;
  }
  .count {
    align-self: center;
    font-size: 11px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .count.full { color: var(--red); }
</style>
