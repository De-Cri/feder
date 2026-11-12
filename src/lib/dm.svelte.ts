// Private messages: state, sending, real-time receiving. Encryption lives in dmcrypto.ts,
// the rules (who can read, limits, 30-day expiry) in supabase/migrations/0004_dm.sql.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { app, DM_VIEW } from './state.svelte';
import { notify } from './notify';
import { playSound } from './sounds';
import { t, type Key } from './i18n.svelte';
import {
  createIdentity, generateCode, unlockIdentity, encryptDm, decryptDm, loadLocal, saveLocal, clearLocal,
  type Identity, type WrappedKey,
} from './dmcrypto';

export const DM_MAX = 2000; // characters per message
export const DM_DAYS = 30;
const PAGE = 50;
const READ_KEY = 'feder-dm-read';

type Row = {
  id: number;
  sender: string;
  recipient: string;
  sender_pub: string;
  recipient_pub: string;
  iv: string;
  body: string;
  created_at: string;
};
/** text null = unreadable (e.g. recovery code regenerated after sending). */
export type DmMessage = { id: number; sender: string; recipient: string; created_at: string; text: string | null };
export type Prepared = { code: string; identity: Identity; wrapped: WrappedKey };
export type Conversation = { peer: string; lastId: number; lastAt: string; lastSender: string };

const ERRORS: Record<string, Key> = {
  dm_rate_limited: 'dm.err.rateLimited',
  dm_too_many_people: 'dm.err.tooManyPeople',
  dm_recipient_no_key: 'dm.err.recipientNoKey',
  dm_invalid_recipient: 'dm.err.invalidRecipient',
  dm_no_key: 'dm.err.noKey',
  dm_not_found: 'dm.err.notFound',
  forbidden: 'error.forbidden',
};

export function dmError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return t(v);
  return t('dm.err.generic');
}

function readMarks(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
  } catch {
    return {};
  }
}

class DmLog {
  messages = $state<DmMessage[]>([]);
  loaded = $state(false);
  hasMore = $state(true);
  loading = $state(false);

  constructor(private peer: string) {}

  private async page(before?: number): Promise<DmMessage[]> {
    const me = app.me!;
    let q = supabase
      .from('dm_messages')
      .select('*')
      .or(`and(sender.eq.${me},recipient.eq.${this.peer}),and(sender.eq.${this.peer},recipient.eq.${me})`);
    if (before !== undefined) q = q.lt('id', before);
    const { data } = await q.order('id', { ascending: false }).limit(PAGE);
    const rows = (data ?? []) as Row[];
    this.hasMore = rows.length === PAGE;
    return (await Promise.all(rows.map((r) => dm.decrypt(r)))).reverse();
  }

  async loadInitial() {
    if (this.loaded || this.loading) return;
    this.loading = true;
    const rows = await this.page();
    const ids = new Set(rows.map((m) => m.id));
    this.messages = [...rows, ...this.messages.filter((m) => !ids.has(m.id))];
    this.loaded = true;
    this.loading = false;
  }

  async loadOlder() {
    if (!this.hasMore || this.loading || !this.messages.length) return;
    this.loading = true;
    this.messages = [...(await this.page(this.messages[0].id)), ...this.messages];
    this.loading = false;
  }

  push(m: DmMessage) {
    if (this.messages.some((x) => x.id === m.id)) return;
    this.messages.push(m);
  }
}

class DmState {
  /** off: server without private messages (migration not applied) or network error. */
  status = $state<'idle' | 'loading' | 'setup' | 'locked' | 'ready' | 'off'>('idle');
  conversations = $state<Conversation[]>([]);
  /** Open chat; null = "New chat" screen. */
  current = $state<string | null>(null);
  unread = $state<Record<string, number>>({});
  /** Members' public keys: whoever has none hasn't activated messages yet. */
  keys = $state<Record<string, string>>({});
  stars = $state<Record<number, true>>({});

  private identity: Identity | null = null;
  private serverKey: WrappedKey | null = null;
  private logs: Record<string, DmLog> = {};
  private channel: RealtimeChannel | null = null;
  private prevView = 1;
  private marks = readMarks();

  get unreadChats(): number {
    return Object.values(this.unread).filter((n) => n > 0).length;
  }

  log(peer: string): DmLog {
    return (this.logs[peer] ??= new DmLog(peer));
  }

  // -------------------------------------------------------------------------
  // Start and stop (Shell mounted = inside the server)
  // -------------------------------------------------------------------------
  async init() {
    const me = app.me;
    if (!me || this.status !== 'idle') return;
    this.status = 'loading';
    app.onSignOut = () => this.forget();

    const [{ data: key, error }, local] = await Promise.all([supabase.rpc('dm_my_key').maybeSingle(), loadLocal(me)]);
    if (error) {
      this.status = 'off'; // migration not applied yet: the rest of the app works the same
      return;
    }
    this.serverKey = (key as WrappedKey | null) ?? null;
    if (!this.serverKey) this.status = 'setup';
    else if (local && local.publicKey === this.serverKey.public_key) this.ready(local);
    else this.status = 'locked';

    await supabase.realtime.setAuth(); // realtime RLS needs to know who you are
    this.listen();
    await Promise.all([this.loadConversations(), this.loadKeys(), this.loadStars()]);
  }

  /** Leaves the server (or the app): closes the channel, clears memory. */
  async stop() {
    const ch = this.channel;
    this.channel = null;
    if (ch) await supabase.removeChannel(ch);
    this.identity = null;
    this.serverKey = null;
    this.logs = {};
    this.conversations = [];
    this.unread = {};
    this.keys = {};
    this.stars = {};
    this.current = null;
    this.status = 'idle';
  }

  /** Sign out: the key doesn't stay on this device. */
  private async forget() {
    const me = app.me;
    if (me) await clearLocal(me);
    await this.stop();
  }

  private ready(id: Identity) {
    this.identity = id;
    this.status = 'ready';
    this.logs = {}; // reload, decrypting with the right key
  }

  private listen() {
    // Separate channel: if the server doesn't have the table yet, the other updates aren't affected.
    this.channel = supabase
      .channel('feder-dm')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, ({ new: row }) => {
        this.receive(row as Row);
      })
      .subscribe();
  }

  async loadConversations() {
    const { data } = await supabase.rpc('dm_conversations');
    const list = ((data ?? []) as { peer: string; last_id: number; last_at: string; last_sender: string }[]).map(
      (c) => ({ peer: c.peer, lastId: c.last_id, lastAt: c.last_at, lastSender: c.last_sender }),
    );
    this.conversations = list.sort((a, b) => b.lastId - a.lastId);
    for (const c of list) {
      if (c.lastSender !== app.me && c.lastId > (this.marks[c.peer] ?? 0)) this.unread[c.peer] ||= 1;
    }
  }

  async loadKeys() {
    const { data } = await supabase.from('dm_keys').select('user_id, public_key');
    const k: Record<string, string> = {};
    for (const r of (data ?? []) as { user_id: string; public_key: string }[]) k[r.user_id] = r.public_key;
    this.keys = k;
  }

  private async loadStars() {
    const { data } = await supabase.from('dm_stars').select('message_id');
    const s: Record<number, true> = {};
    for (const r of (data ?? []) as { message_id: number }[]) s[r.message_id] = true;
    this.stars = s;
  }

  // -------------------------------------------------------------------------
  // Recovery code
  // -------------------------------------------------------------------------
  /** New code and new keys, still only in memory: activate() saves them. */
  async prepare(): Promise<Prepared> {
    const code = generateCode();
    return { code, ...(await createIdentity(code)) };
  }

  /** After the user saved the code: publishes the key and activates messages. */
  async activate(p: Prepared): Promise<string | null> {
    const me = app.me;
    if (!me) return t('dm.err.offline');
    const { error } = await supabase.rpc('dm_set_key', {
      p_public: p.wrapped.public_key,
      p_wrapped: p.wrapped.wrapped_key,
      p_salt: p.wrapped.salt,
      p_iv: p.wrapped.iv,
      p_iterations: p.wrapped.iterations,
    });
    if (error) return dmError(error);
    this.serverKey = p.wrapped;
    this.keys[me] = p.wrapped.public_key;
    await saveLocal(me, p.identity);
    this.ready(p.identity);
    // with a regenerated code the existing chats (and your stars) stay
    await Promise.all([this.loadConversations(), this.loadStars()]);
    return null;
  }

  async unlock(code: string): Promise<string | null> {
    const me = app.me;
    if (!me || !this.serverKey) return t('dm.err.offline');
    const id = await unlockIdentity(this.serverKey, code);
    if (!id) return t('dm.err.wrongCode');
    await saveLocal(me, id);
    this.ready(id);
    return null;
  }

  async decrypt(r: Row): Promise<DmMessage> {
    const text = this.identity && app.me ? await decryptDm(this.identity, app.me, r) : null;
    return { id: r.id, sender: r.sender, recipient: r.recipient, created_at: r.created_at, text };
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  enter(peer?: string | null) {
    if (app.view !== DM_VIEW) this.prevView = app.view;
    app.view = DM_VIEW;
    if (peer !== undefined) this.current = peer;
    else if (this.current === null && this.conversations.length) this.current = this.conversations[0].peer;
  }

  leave() {
    app.view = this.prevView;
  }

  markRead(peer: string) {
    const last = this.conversations.find((c) => c.peer === peer)?.lastId ?? 0;
    if (this.unread[peer]) delete this.unread[peer];
    if (last > (this.marks[peer] ?? 0)) {
      this.marks[peer] = last;
      try {
        localStorage.setItem(READ_KEY, JSON.stringify(this.marks));
      } catch {
        /* ignore */
      }
    }
  }

  private touch(peer: string, r: Row) {
    const c: Conversation = { peer, lastId: r.id, lastAt: r.created_at, lastSender: r.sender };
    this.conversations = [c, ...this.conversations.filter((x) => x.peer !== peer)];
  }

  // -------------------------------------------------------------------------
  // Sending and receiving
  // -------------------------------------------------------------------------
  async send(peer: string, text: string): Promise<string | null> {
    const me = app.me;
    const msg = text.trim();
    if (!me || !this.identity) return t('dm.err.locked');
    if (!msg) return null;
    if (msg.length > DM_MAX) return t('dm.err.tooLong', { max: DM_MAX });

    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.keys[peer] || attempt > 0) await this.loadKeys();
      const peerPub = this.keys[peer];
      if (!peerPub) return t('dm.err.recipientNoKey');
      const { body, iv } = await encryptDm(this.identity, peerPub, me, peer, msg);
      const { data, error } = await supabase
        .rpc('dm_send', { p_to: peer, p_body: body, p_iv: iv, p_recipient_pub: peerPub })
        .single();
      if (error?.message.includes('dm_key_changed')) continue; // they regenerated their code: retry with the new key
      if (error) return dmError(error);
      const row = data as Row;
      this.log(peer).push({ id: row.id, sender: me, recipient: peer, created_at: row.created_at, text: msg });
      this.touch(peer, row);
      this.markRead(peer);
      return null;
    }
    return t('dm.err.keyChanged');
  }

  private async receive(r: Row) {
    const me = app.me;
    if (!me || (r.sender !== me && r.recipient !== me)) return;
    const peer = r.sender === me ? r.recipient : r.sender;
    const m = await this.decrypt(r);
    this.touch(peer, r);
    if (this.logs[peer]?.loaded) this.logs[peer].push(m);
    if (r.sender === me) return; // sent from another device

    const visible = app.view === DM_VIEW && this.current === peer && app.focused;
    if (visible) {
      this.markRead(peer);
      return;
    }
    this.unread[peer] = (this.unread[peer] ?? 0) + 1;
    playSound('message');
    notify(t('notify.dm', { name: app.name(peer) }), m.text ?? t('notify.dmBody'));
  }

  async toggleStar(m: DmMessage): Promise<string | null> {
    const on = !this.stars[m.id];
    const { error } = await supabase.rpc('dm_star', { p_id: m.id, p_on: on });
    if (error) return dmError(error);
    if (on) this.stars[m.id] = true;
    else delete this.stars[m.id];
    return null;
  }
}

export const dm = new DmState();
