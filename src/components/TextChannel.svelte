<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { supabase } from '../lib/supabase';
  import { app, type Channel, type Message } from '../lib/state.svelte';
  import { time, day, splitLinks, errorText } from '../lib/util';
  import { openExternal } from '../lib/platform';
  import Icon from './Icon.svelte';
  import Avatar from './Avatar.svelte';
  import Attachment from './Attachment.svelte';

  let { channel }: { channel: Channel } = $props();
  const log = $derived(app.log(channel.id));

  let scroller: HTMLDivElement;
  let input: HTMLTextAreaElement;
  let text = $state('');
  let uploading = $state<string | null>(null);
  let error = $state<string | null>(null);
  let dragging = $state(false);
  let fileInput: HTMLInputElement;
  let stick = true;

  const MAX = 50 * 1024 * 1024;

  type Row = { m: Message; head: boolean; dayLabel: string | null };
  const rows = $derived.by(() => {
    const out: Row[] = [];
    let prev: Message | null = null;
    for (const m of log.messages) {
      const d = day(m.created_at);
      const newDay = !prev || day(prev.created_at) !== d;
      const head =
        newDay ||
        !prev ||
        prev.author_id !== m.author_id ||
        new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000;
      out.push({ m, head, dayLabel: newDay ? d : null });
      prev = m;
    }
    return out;
  });

  onMount(async () => {
    await log.loadInitial();
    await tick();
    scroller.scrollTop = scroller.scrollHeight;
    input?.focus();
  });

  // Resta in fondo quando arrivano messaggi nuovi (se eri già in fondo).
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
    if (!content) return;
    text = '';
    resize();
    error = null;
    const { data, error: err } = await supabase
      .from('messages')
      .insert({ channel_id: channel.id, author_id: app.me, content })
      .select()
      .single();
    if (err) {
      error = errorText(err);
      text = content;
    } else if (data) {
      stick = true;
      log.push(data as Message);
    }
  }

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.size > MAX) {
        error = `${file.name} supera i 50 MB.`;
        continue;
      }
      uploading = file.name;
      error = null;
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
      const path = `${app.me}/${crypto.randomUUID()}-${safe}`;
      const { error: upErr } = await supabase.storage
        .from('attachments')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (upErr) {
        error = errorText(upErr);
        uploading = null;
        continue;
      }
      const caption = text.trim();
      text = '';
      const { data, error: err } = await supabase
        .from('messages')
        .insert({
          channel_id: channel.id,
          author_id: app.me,
          content: caption,
          attachment_path: path,
          attachment_name: file.name,
          attachment_mime: file.type || null,
          attachment_size: file.size,
        })
        .select()
        .single();
      if (err) error = errorText(err);
      else if (data) {
        stick = true;
        log.push(data as Message);
      }
      uploading = null;
    }
  }

  async function remove(m: Message) {
    const { error: err } = await supabase.from('messages').delete().eq('id', m.id);
    if (err) {
      error = errorText(err);
      return;
    }
    log.remove(m.id);
    if (m.attachment_path) await supabase.storage.from('attachments').remove([m.attachment_path]);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files;
    if (files && files.length) {
      e.preventDefault();
      upload(files);
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

<div
  class="channel"
  role="region"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (e.currentTarget === e.target) dragging = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files.length) upload(e.dataTransfer.files);
  }}
>
  <header>
    <Icon name="hash" size={18} />
    <h2>{channel.name}</h2>
  </header>

  <div class="scroller" bind:this={scroller} onscroll={onScroll}>
    {#if log.loaded && !log.hasMore}
      <div class="start">
        <div class="start-icon"><Icon name="hash" size={26} /></div>
        <h3>Benvenuto in #{channel.name}</h3>
        <p class="muted">È l’inizio del canale.</p>
      </div>
    {/if}
    {#each rows as { m, head, dayLabel } (m.id)}
      {#if dayLabel}
        <div class="day"><span>{dayLabel}</span></div>
      {/if}
      <div class="msg" class:head>
        <div class="gutter">
          {#if head}
            <Avatar id={m.author_id} size={34} />
          {:else}
            <span class="hover-time">{time(m.created_at)}</span>
          {/if}
        </div>
        <div class="body">
          {#if head}
            <div class="meta">
              <span class="author">{app.name(m.author_id)}</span>
              <span class="time">{time(m.created_at)}</span>
            </div>
          {/if}
          {#if m.content}
            <div class="text selectable">
              {#each splitLinks(m.content) as part}
                {#if part.href}<a href={part.href} onclick={(e) => link(e, part.href!)}>{part.t}</a>{:else}{part.t}{/if}
              {/each}
            </div>
          {/if}
          {#if m.attachment_path}
            <Attachment message={m} />
          {/if}
        </div>
        {#if m.author_id === app.me || app.isAdmin}
          <div class="actions">
            <button class="icon-btn" title="Elimina" onclick={() => remove(m)}><Icon name="trash" size={15} /></button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="composer-wrap">
    {#if error}<div class="err bar">{error}</div>{/if}
    {#if uploading}<div class="muted bar">Caricamento di {uploading}…</div>{/if}
    <div class="composer">
      <button class="icon-btn" title="Allega file" onclick={() => fileInput.click()}>
        <Icon name="clip" size={18} />
      </button>
      <input
        type="file"
        multiple
        hidden
        bind:this={fileInput}
        onchange={(e) => {
          const f = e.currentTarget.files;
          if (f?.length) upload(f);
          e.currentTarget.value = '';
        }}
      />
      <textarea
        bind:this={input}
        bind:value={text}
        rows="1"
        placeholder="Scrivi in #{channel.name}"
        onkeydown={onKey}
        oninput={resize}
        onpaste={onPaste}
      ></textarea>
      <button class="icon-btn" class:on={!!text.trim()} title="Invia" onclick={send}>
        <Icon name="send" size={17} />
      </button>
    </div>
  </div>

  {#if dragging}
    <div class="drop">Rilascia per caricare in #{channel.name}</div>
  {/if}
</div>

<style>
  .channel {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  header {
    height: 52px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
  }
  h2 { font-size: 15px; font-weight: 600; margin: 0; color: var(--text); }
  .spacer { flex: 1; }
  .scroller {
    flex: 1;
    overflow-y: auto;
    padding: 12px 0 8px;
  }
  .start { padding: 24px 24px 12px; }
  .start-icon {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--bg-active);
    display: grid;
    place-items: center;
    color: var(--text-2);
  }
  .start h3 { margin: 12px 0 2px; font-size: 20px; font-weight: 600; }
  .start p { margin: 0; }
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
  .msg {
    position: relative;
    display: flex;
    gap: 12px;
    padding: 1px 20px;
  }
  .msg.head { margin-top: 10px; }
  .msg:hover { background: var(--bg-hover); }
  .gutter { width: 34px; flex: none; display: flex; justify-content: center; }
  .hover-time {
    visibility: hidden;
    font-size: 10px;
    color: var(--text-3);
    line-height: 22px;
  }
  .msg:hover .hover-time { visibility: visible; }
  .body { flex: 1; min-width: 0; }
  .meta { display: flex; align-items: baseline; gap: 8px; }
  .author { font-weight: 600; font-size: 14px; }
  .time { font-size: 11px; color: var(--text-3); }
  .text {
    white-space: pre-wrap;
    word-wrap: break-word;
    line-height: 1.5;
  }
  .text a { color: var(--accent); text-decoration: none; }
  .text a:hover { text-decoration: underline; }
  .actions {
    position: absolute;
    top: -12px;
    right: 20px;
    display: none;
    background: var(--bg-elev);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow);
  }
  .msg:hover .actions { display: flex; }
  .composer-wrap { padding: 0 20px 18px; flex: none; }
  .bar { font-size: 12px; padding: 0 4px 6px; }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 5px;
    border-radius: var(--r);
    background: var(--bg-input);
    border: 1px solid var(--border);
  }
  .composer:focus-within { border-color: var(--border-strong); }
  textarea {
    flex: 1;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    padding: 5px 4px;
    max-height: 180px;
    line-height: 1.45;
  }
  .drop {
    position: absolute;
    inset: 10px;
    border: 2px dashed var(--accent);
    border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    display: grid;
    place-items: center;
    font-weight: 600;
    color: var(--accent);
    pointer-events: none;
  }
</style>
