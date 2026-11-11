// Messaggi privati: stato, invio, ricezione in tempo reale. La cifratura sta in dmcrypto.ts,
// le regole (chi legge, limiti, scadenza a 30 giorni) in supabase/migrations/0004_dm.sql.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { app, DM_VIEW } from './state.svelte';
import { notify } from './notify';
import { playSound } from './sounds';
import {
  createIdentity, unlockIdentity, encryptDm, decryptDm, loadLocal, saveLocal, clearLocal,
  type Identity, type WrappedKey,
} from './dmcrypto';

export const DM_MAX = 2000; // caratteri per messaggio
export const DM_DAYS = 30;
export const PIN_MIN = 8;
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
/** text null = non leggibile (es. PIN reimpostato dopo l'invio). */
export type DmMessage = { id: number; sender: string; recipient: string; created_at: string; text: string | null };
export type Conversation = { peer: string; lastId: number; lastAt: string; lastSender: string };

const ERRORS: Record<string, string> = {
  dm_rate_limited: 'Stai scrivendo troppo in fretta: aspetta qualche secondo.',
  dm_too_many_people: 'Hai scritto a troppe persone diverse in poco tempo: aspetta un paio di minuti.',
  dm_recipient_no_key: 'Non ha ancora attivato i messaggi privati.',
  dm_invalid_recipient: 'Non puoi scrivere a questa persona.',
  dm_no_key: 'Attiva prima i messaggi privati.',
  dm_not_found: 'Messaggio non trovato.',
  forbidden: 'Non hai i permessi.',
};

export function dmError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v;
  return 'Qualcosa è andato storto, riprova.';
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
  /** off: server senza messaggi privati (migrazione non applicata) o errore di rete. */
  status = $state<'idle' | 'loading' | 'setup' | 'locked' | 'ready' | 'off'>('idle');
  conversations = $state<Conversation[]>([]);
  /** Chat aperta; null = schermata "Nuova chat". */
  current = $state<string | null>(null);
  unread = $state<Record<string, number>>({});
  /** Chiavi pubbliche dei membri: chi non ce l'ha non ha ancora attivato i messaggi. */
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
  // Avvio e chiusura (Shell montato = dentro il server)
  // -------------------------------------------------------------------------
  async init() {
    const me = app.me;
    if (!me || this.status !== 'idle') return;
    this.status = 'loading';
    app.onSignOut = () => this.forget();

    const [{ data: key, error }, local] = await Promise.all([supabase.rpc('dm_my_key').maybeSingle(), loadLocal(me)]);
    if (error) {
      this.status = 'off'; // migrazione non ancora applicata: il resto dell'app funziona uguale
      return;
    }
    this.serverKey = (key as WrappedKey | null) ?? null;
    if (!this.serverKey) this.status = 'setup';
    else if (local && local.publicKey === this.serverKey.public_key) this.ready(local);
    else this.status = 'locked';

    await supabase.realtime.setAuth(); // l'RLS del tempo reale deve sapere chi sei
    this.listen();
    await Promise.all([this.loadConversations(), this.loadKeys(), this.loadStars()]);
  }

  /** Esce dal server (o dall'app): chiude il canale, svuota la memoria. */
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

  /** Uscita dall'account: la chiave non resta su questo dispositivo. */
  private async forget() {
    const me = app.me;
    if (me) await clearLocal(me);
    await this.stop();
  }

  private ready(id: Identity) {
    this.identity = id;
    this.status = 'ready';
    this.logs = {}; // ricarica decifrando con la chiave giusta
  }

  private listen() {
    // Canale a parte: se il server non ha ancora la tabella, gli altri aggiornamenti non ne risentono.
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
  // PIN
  // -------------------------------------------------------------------------
  /** Prima attivazione, o PIN dimenticato (i messaggi vecchi diventano illeggibili per te). */
  async setup(pin: string): Promise<string | null> {
    const me = app.me;
    if (!me) return 'Non sei connesso.';
    const { identity, wrapped } = await createIdentity(pin);
    const { error } = await supabase.rpc('dm_set_key', {
      p_public: wrapped.public_key,
      p_wrapped: wrapped.wrapped_key,
      p_salt: wrapped.salt,
      p_iv: wrapped.iv,
      p_iterations: wrapped.iterations,
    });
    if (error) return dmError(error);
    this.serverKey = wrapped;
    this.keys[me] = wrapped.public_key;
    await saveLocal(me, identity);
    this.ready(identity);
    // dopo un PIN reimpostato le chat esistenti (e le tue stelline) restano
    await Promise.all([this.loadConversations(), this.loadStars()]);
    return null;
  }

  async unlock(pin: string): Promise<string | null> {
    const me = app.me;
    if (!me || !this.serverKey) return 'Non sei connesso.';
    const id = await unlockIdentity(this.serverKey, pin);
    if (!id) return 'PIN sbagliato.';
    await saveLocal(me, id);
    this.ready(id);
    return null;
  }

  async decrypt(r: Row): Promise<DmMessage> {
    const text = this.identity && app.me ? await decryptDm(this.identity, app.me, r) : null;
    return { id: r.id, sender: r.sender, recipient: r.recipient, created_at: r.created_at, text };
  }

  // -------------------------------------------------------------------------
  // Navigazione
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
  // Invio e ricezione
  // -------------------------------------------------------------------------
  async send(peer: string, text: string): Promise<string | null> {
    const me = app.me;
    const msg = text.trim();
    if (!me || !this.identity) return 'Sblocca prima i messaggi.';
    if (!msg) return null;
    if (msg.length > DM_MAX) return `Massimo ${DM_MAX} caratteri.`;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.keys[peer] || attempt > 0) await this.loadKeys();
      const peerPub = this.keys[peer];
      if (!peerPub) return ERRORS.dm_recipient_no_key;
      const { body, iv } = await encryptDm(this.identity, peerPub, me, peer, msg);
      const { data, error } = await supabase
        .rpc('dm_send', { p_to: peer, p_body: body, p_iv: iv, p_recipient_pub: peerPub })
        .single();
      if (error?.message.includes('dm_key_changed')) continue; // ha reimpostato il PIN: riprova con la chiave nuova
      if (error) return dmError(error);
      const row = data as Row;
      this.log(peer).push({ id: row.id, sender: me, recipient: peer, created_at: row.created_at, text: msg });
      this.touch(peer, row);
      this.markRead(peer);
      return null;
    }
    return 'Ha appena cambiato PIN: riprova.';
  }

  private async receive(r: Row) {
    const me = app.me;
    if (!me || (r.sender !== me && r.recipient !== me)) return;
    const peer = r.sender === me ? r.recipient : r.sender;
    const m = await this.decrypt(r);
    this.touch(peer, r);
    if (this.logs[peer]?.loaded) this.logs[peer].push(m);
    if (r.sender === me) return; // inviato da un altro dispositivo

    const visible = app.view === DM_VIEW && this.current === peer && app.focused;
    if (visible) {
      this.markRead(peer);
      return;
    }
    this.unread[peer] = (this.unread[peer] ?? 0) + 1;
    playSound('message');
    notify(`${app.name(peer)} ti ha scritto`, m.text ?? 'Nuovo messaggio privato');
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
