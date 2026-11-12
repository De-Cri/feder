import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { notify } from './notify';
import { playSound } from './sounds';
import { hasUnseenRelease } from './releases';
import { t } from './i18n.svelte';

export type Profile = { id: string; username: string; avatar_path: string | null };
export type Member = { user_id: string; role: 'admin' | 'member'; joined_at: string; contributor?: boolean };
export type Channel = { id: number; name: string; kind: 'text' | 'voice'; position: number };
export type Message = {
  id: number;
  channel_id: number;
  author_id: string | null;
  content: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  created_at: string;
};
export const POKE_MAX = 120;

/** A batch of call signals relayed by the server (voice_signal), with the verified sender. */
export type SignalBatch = { from: string; signals: Record<string, unknown>[] };

export type Presence = {
  user_id: string;
  at?: number; // when it was published (to discard stale states)
  dev?: string; // which copy of the app (same person on desktop app + browser, or two PCs)
  voice: number | null;
  mic: boolean;
  deaf: boolean;
  cam: boolean;
  screen: boolean;
};

const PAGE = 50;

/** `app.view` of the "novità" channel (release notes, not a server channel). */
export const RELEASES_VIEW = -1;
/** `app.view` of the private messages screen (separate from the server). */
export const DM_VIEW = -2;

/** Identifies this copy of the app in presence (the key is the user, shared across devices). */
const DEVICE = crypto.randomUUID();

/**
 * Supabase accepts at most 5 track() calls every 30 s per client: beyond that it CLOSES the channel
 * (ClientPresenceRateLimitReached) and presence stops updating for everyone.
 * We use 5 every 32 s (margin on the window); the rest is merged and sent as soon as possible.
 */
export class TrackBudget {
  private times: number[] = [];
  constructor(private max = 5, private windowMs = 32_000) {}
  /** Milliseconds to wait before the next track() (0 = now). */
  wait(now = Date.now()): number {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    return this.times.length < this.max ? 0 : this.windowMs - (now - this.times[0]) + 100;
  }
  take(now = Date.now()) {
    this.times.push(now);
  }
}

/** A single counter for lobby and voice channel: safe even if the limit were per connection. */
export const presenceBudget = new TrackBudget();

class ChannelLog {
  messages = $state<Message[]>([]);
  loaded = $state(false);
  hasMore = $state(true);
  loading = $state(false);

  constructor(public id: number) {}

  /** One page of messages (the latest, or those before `before`), in chronological order. */
  private async page(before?: number): Promise<Message[]> {
    let q = supabase.from('messages').select('*').eq('channel_id', this.id);
    if (before !== undefined) q = q.lt('id', before);
    const { data } = await q.order('id', { ascending: false }).limit(PAGE);
    const rows = ((data ?? []) as Message[]).reverse();
    this.hasMore = rows.length === PAGE;
    return rows;
  }

  async loadInitial() {
    if (this.loaded || this.loading) return;
    this.loading = true;
    const rows = await this.page();
    // Merges any messages that arrived via realtime during the fetch.
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

  push(m: Message) {
    if (this.messages.some((x) => x.id === m.id)) return;
    this.messages.push(m);
  }

  remove(id: number) {
    this.messages = this.messages.filter((m) => m.id !== id);
  }
}

class AppState {
  session = $state<Session | null>(null);
  booted = $state(false);
  membership = $state<'unknown' | 'member' | 'none' | 'banned'>('unknown');
  banReason = $state<string | null>(null);

  profiles = $state<Record<string, Profile>>({});
  members = $state<Member[]>([]);
  channels = $state<Channel[]>([]);
  voiceMutes = $state<Record<string, true>>({});
  online = $state<Record<string, Presence>>({});
  /** Received pokes (like on TeamSpeak), shown until you close them. */
  pokes = $state<{ key: number; from: string; text: string }[]>([]);
  private pokeKey = 0;
  private lastPoke: Record<string, number> = {};
  /** Who is in which voice channel according to the server (voice_rooms): presence alone can be forged. */
  voiceRooms = $state<Record<string, number>>({});
  logs: Record<number, ChannelLog> = {};
  unread = $state<Record<number, number>>({});

  view = $state<number>(1); // channel being shown (text or voice, or RELEASES_VIEW / DM_VIEW)
  releasesUnseen = $state(hasUnseenRelease()); // "new" badge on the release notes channel
  settingsOpen = $state(false);
  // tab to show the next time settings open (e.g. 'media' from the microphone menu)
  settingsTab = $state<string>('profile');
  focused = $state(true);

  /** State published in presence (updated by the voice room). */
  myPresence = $state<Omit<Presence, 'user_id'>>({ voice: null, mic: true, deaf: false, cam: false, screen: false });

  private db: RealtimeChannel | null = null;
  private lobby: RealtimeChannel | null = null;
  /** Personal channel cerchio:user:<me>: only the server writes to it (pokes, call signaling). */
  private inbox: RealtimeChannel | null = null;
  /** Call signaling received on the personal channel (handled by voice.svelte.ts). */
  onSignal: ((batch: SignalBatch) => void) | null = null;
  /** The server's room registry changed (voice.svelte.ts re-checks who is in the room). */
  onRoomsChange: (() => void) | null = null;
  onKicked: (() => void) | null = null;
  onMemberLeft: ((id: string) => void) | null = null;
  /** Called before signing out (private messages delete the local key). */
  onSignOut: (() => Promise<void>) | null = null;

  get me(): string | null {
    return this.session?.user.id ?? null;
  }
  get myProfile(): Profile | null {
    return this.me ? this.profiles[this.me] ?? null : null;
  }
  get isAdmin(): boolean {
    return this.members.some((m) => m.user_id === this.me && m.role === 'admin');
  }
  get textChannels() {
    return this.channels.filter((c) => c.kind === 'text');
  }
  get voiceChannels() {
    return this.channels.filter((c) => c.kind === 'voice');
  }
  log(id: number): ChannelLog {
    return (this.logs[id] ??= new ChannelLog(id));
  }
  name(id: string | null): string {
    return (id && this.profiles[id]?.username) || 'utente';
  }
  /**
   * Presence to show: the server's for everyone else, and for you always the
   * current local state (updated immediately, even before the server answers).
   */
  get presence(): Record<string, Presence> {
    const me = this.me;
    if (!me || !this.online[me]) return this.online;
    return { ...this.online, [me]: { ...this.online[me], ...this.myPresence, user_id: me } };
  }
  /**
   * Who is in your voice room according to the room itself (more reliable than
   * the general list for the channel you are in). Updated by voice.svelte.ts.
   */
  room = $state<{ channel: number | null; ids: string[] }>({ channel: null, ids: [] });

  inVoice(channelId: number): Presence[] {
    const all = this.presence;
    const room = this.room.channel !== null ? this.room : null;
    if (room && channelId === room.channel) {
      // your room: who is really there, even if the general list lags behind
      return room.ids.map(
        (id) => ({ ...(all[id] ?? { mic: true, deaf: false, cam: false, screen: false }), user_id: id, voice: channelId }) as Presence,
      );
    }
    // other channels: whoever the room says is with you can't be elsewhere, and others
    // count only if the server agrees they're in that channel (presence can be forged)
    return Object.values(all).filter(
      (p) =>
        p.voice === channelId &&
        !(room && room.ids.includes(p.user_id)) &&
        (p.user_id === this.me || this.voiceRooms[p.user_id] === channelId),
    );
  }

  async checkMembership() {
    const me = this.me;
    if (!me) return;
    const [{ data: member }, { data: ban }, { data: profile }] = await Promise.all([
      supabase.from('members').select('*').eq('user_id', me).maybeSingle(),
      supabase.from('bans').select('reason').eq('user_id', me).maybeSingle(),
      supabase.from('profiles').select('*').eq('id', me).maybeSingle(),
    ]);
    if (profile) this.profiles[me] = profile as Profile;
    if (member) {
      this.membership = 'member';
      await this.enterServer();
    } else if (ban) {
      this.membership = 'banned';
      this.banReason = ban.reason;
    } else {
      this.membership = 'none';
    }
  }

  async enterServer() {
    // A crash or a closed laptop can leave us registered in a room: clear it on start.
    if (this.myPresence.voice === null) void supabase.rpc('voice_leave');
    const [ch, mem, prof, mutes, rooms] = await Promise.all([
      supabase.from('channels').select('*').order('position'),
      supabase.from('members').select('*'),
      supabase.from('profiles').select('*'),
      supabase.from('voice_mutes').select('user_id'),
      supabase.from('voice_rooms').select('user_id, channel_id'),
    ]);
    this.channels = (ch.data ?? []) as Channel[];
    this.members = (mem.data ?? []) as Member[];
    const p: Record<string, Profile> = {};
    for (const row of (prof.data ?? []) as Profile[]) p[row.id] = row;
    this.profiles = p;
    const m: Record<string, true> = {};
    for (const row of mutes.data ?? []) m[row.user_id] = true;
    this.voiceMutes = m;
    const r: Record<string, number> = {};
    for (const row of (rooms.data ?? []) as { user_id: string; channel_id: number }[]) r[row.user_id] = row.channel_id;
    this.voiceRooms = r;
    this.onRoomsChange?.();
    if (!this.channels.some((c) => c.id === this.view)) this.view = this.textChannels[0]?.id ?? 1;
    await this.subscribe();
  }

  private async subscribe() {
    await this.unsubscribe();
    await supabase.realtime.setAuth();

    this.db = supabase
      .channel('cerchio-db')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: row }) => {
        const m = row as Message;
        this.log(m.channel_id).push(m);
        const visible = this.view === m.channel_id && this.focused;
        if (!visible && m.author_id !== this.me) {
          this.unread[m.channel_id] = (this.unread[m.channel_id] ?? 0) + 1;
          const ch = this.channels.find((c) => c.id === m.channel_id);
          notify(t('notify.channelMessage', { name: this.name(m.author_id), channel: ch?.name ?? '' }), m.content || m.attachment_name || t('notify.attachment'));
          playSound('message');
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
        const id = (old as { id: number }).id;
        for (const l of Object.values(this.logs)) l.remove(id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, (ev) => {
        if (ev.eventType === 'DELETE') {
          const id = (ev.old as Member).user_id;
          this.members = this.members.filter((m) => m.user_id !== id);
          if (id === this.me) {
            this.kicked();
          } else {
            this.onMemberLeft?.(id);
          }
        } else {
          const row = ev.new as Member;
          this.members = [...this.members.filter((m) => m.user_id !== row.user_id), row];
          if (!this.profiles[row.user_id]) this.refreshProfile(row.user_id);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (ev) => {
        if (ev.eventType !== 'DELETE') {
          const p = ev.new as Profile;
          this.profiles[p.id] = p;
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_rooms' }, (ev) => {
        if (ev.eventType === 'DELETE') delete this.voiceRooms[(ev.old as { user_id: string }).user_id];
        else {
          const row = ev.new as { user_id: string; channel_id: number };
          this.voiceRooms[row.user_id] = row.channel_id;
        }
        this.onRoomsChange?.();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_mutes' }, (ev) => {
        if (ev.eventType === 'DELETE') delete this.voiceMutes[(ev.old as { user_id: string }).user_id];
        else this.voiceMutes[(ev.new as { user_id: string }).user_id] = true;
      })
      .subscribe();

    this.joinLobby();
    this.joinInbox();
    // Republish now and then: fixes states lost or left behind on the server.
    clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => this.lobbyJoined && this.publishPresence(), 45_000);
  }

  private lobbyRetry: ReturnType<typeof setTimeout> | undefined;
  private joinLobby() {
    const me = this.me!;
    const ch = supabase.channel('cerchio:lobby', { config: { private: true, presence: { key: me } } });
    this.lobby = ch;
    ch.on('presence', { event: 'sync' }, () => {
      if (this.lobby !== ch) return;
      const state = ch.presenceState<Presence>();
      const next: Record<string, Presence> = {};
      for (const [key, metas] of Object.entries(state)) {
        const best = pick(metas);
        if (best) next[key] = { ...best, user_id: key };
      }
      // Your own state is always the local one (the server may lag a moment behind).
      if (this.me && this.lobbyJoined) {
        // The server "lost" us or has a stale state: republish.
        if (!this.serverHasMine(state[this.me])) this.healPresence();
        next[this.me] = { ...(next[this.me] ?? {}), ...$state.snapshot(this.myPresence), user_id: this.me };
      }
      this.detectCalls(next);
      this.online = next;
    }).subscribe(async (status) => {
      if (this.lobby !== ch) return; // old channel, already replaced or closed by us
      this.lobbyJoined = status === 'SUBSCRIBED';
      if (status === 'SUBSCRIBED') return void (await this.publishPresence());
      // The server closed the channel (e.g. too many updates) or the network dropped:
      // without this the sidebar would stay frozen until the app restarts.
      if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[presence] lobby channel lost:', status, '- reconnecting');
        clearTimeout(this.lobbyRetry);
        this.lobbyRetry = setTimeout(async () => {
          if (this.lobby !== ch || !this.me) return;
          this.lobby = null;
          await supabase.removeChannel(ch);
          await supabase.realtime.setAuth();
          if (this.lobby === null && this.me && this.db) this.joinLobby();
        }, 3000);
      }
    });
  }

  /**
   * Personal channel: the server delivers pokes and call signaling here, with the
   * sender set by the server, and nobody else can read it (0006_secure_signaling.sql).
   */
  private inboxRetry: ReturnType<typeof setTimeout> | undefined;
  private joinInbox() {
    const me = this.me!;
    const ch = supabase.channel(`cerchio:user:${me}`, { config: { private: true } });
    this.inbox = ch;
    ch.on('broadcast', { event: 'poke' }, ({ payload }) => {
      const { from, text } = (payload ?? {}) as { from?: string; text?: string };
      if (this.inbox !== ch || !from || !this.members.some((m) => m.user_id === from)) return;
      const msg = String(text ?? '').slice(0, POKE_MAX);
      if (this.pokes.length >= 5) this.pokes = this.pokes.slice(-4); // no endless stack
      this.pokes = [...this.pokes, { key: ++this.pokeKey, from, text: msg }];
      playSound('poke');
      notify(t('notify.poke', { name: this.name(from) }), msg || t('notify.pokeDefault'));
    })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        const b = payload as SignalBatch | undefined;
        if (this.inbox !== ch || !b?.from || !Array.isArray(b.signals)) return;
        this.onSignal?.(b);
      })
      .subscribe((status) => {
        if (this.inbox !== ch) return;
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[inbox] personal channel lost:', status, '- reconnecting');
          clearTimeout(this.inboxRetry);
          this.inboxRetry = setTimeout(async () => {
            if (this.inbox !== ch || !this.me) return;
            this.inbox = null;
            await supabase.removeChannel(ch);
            await supabase.realtime.setAuth();
            if (this.inbox === null && this.me && this.db) this.joinInbox();
          }, 3000);
        }
      });
  }

  /** Sends someone a poke through the server. Returns an error key, or null if sent. */
  async poke(to: string, text: string): Promise<'poke.wait' | 'poke.failed' | null> {
    const now = Date.now();
    if (!this.me || now - (this.lastPoke[to] ?? 0) < 3000) return 'poke.wait';
    this.lastPoke[to] = now;
    const { error } = await supabase.rpc('poke', { p_to: to, p_text: text.trim().slice(0, POKE_MAX) });
    if (!error) return null;
    return error.message.includes('poke_rate_limited') ? 'poke.wait' : 'poke.failed';
  }

  closePoke(key: number) {
    this.pokes = this.pokes.filter((p) => p.key !== key);
  }

  /** The server has our current state (looking among the states of THIS copy of the app). */
  private serverHasMine(metas: Presence[] | undefined): boolean {
    const mine = latest((metas ?? []).filter((m) => m.dev === DEVICE));
    return !!mine && this.samePresence(mine);
  }

  private samePresence(p: Presence) {
    const m = this.myPresence;
    return p.voice === m.voice && p.mic === m.mic && p.deaf === m.deaf && p.cam === m.cam && p.screen === m.screen;
  }

  private lobbyJoined = false;
  private presenceTimer: ReturnType<typeof setInterval> | undefined;
  private healTimer: ReturnType<typeof setTimeout> | undefined;
  private healAttempts = 0;
  /**
   * Shortly after, checks that the server has our current state; if it's missing or
   * stale, republishes it, retrying with growing delays (0.8 s → 1.6 s → … max 10 s).
   */
  private healPresence() {
    if (this.healTimer) return;
    const delay = Math.min(800 * 2 ** this.healAttempts, 10_000);
    this.healTimer = setTimeout(() => {
      this.healTimer = undefined;
      if (!this.lobby || !this.me || !this.lobbyJoined) return;
      if (this.serverHasMine(this.lobby.presenceState<Presence>()[this.me])) {
        this.healAttempts = 0;
        return;
      }
      this.healAttempts++;
      console.info('[presence] state on the server missing or stale: republishing');
      this.publishPresence(); // when done it calls healPresence again to re-check
    }, delay);
  }

  // One publish at a time, always with the latest state: calls in quick
  // succession (e.g. switching voice channel) leave no ghost states.
  // Past Supabase's limit the send is postponed (still with the latest state).
  private publishing = false;
  private publishAgain = false;
  private publishTimer: ReturnType<typeof setTimeout> | undefined;
  async publishPresence() {
    if (!this.lobby || !this.me) return;
    if (this.publishTimer) return; // a send is already scheduled: it will use the latest state
    if (this.publishing) {
      this.publishAgain = true;
      return;
    }
    this.publishing = true;
    let deferred = false;
    try {
      do {
        this.publishAgain = false;
        const wait = presenceBudget.wait();
        if (wait > 0) {
          deferred = true;
          this.publishTimer = setTimeout(() => {
            this.publishTimer = undefined;
            this.publishPresence();
          }, wait);
          break;
        }
        presenceBudget.take();
        await this.lobby?.track({ user_id: this.me, ...$state.snapshot(this.myPresence), at: Date.now(), dev: DEVICE });
      } while (this.publishAgain && this.lobby);
    } finally {
      this.publishing = false;
    }
    // Shortly after, check that the server really has the state just published.
    if (!deferred) this.healPresence();
  }

  /** "Call" sound: someone joins an empty voice channel while you're not in voice. */
  private presenceReady = false;
  private detectCalls(next: Record<string, Presence>) {
    const prev = this.online;
    if (!this.presenceReady) {
      this.presenceReady = true;
      return;
    }
    if (this.myPresence.voice !== null) return;
    for (const p of Object.values(next)) {
      if (p.user_id === this.me || p.voice === null) continue;
      if (prev[p.user_id]?.voice === p.voice) continue; // was already there
      const alreadyBusy = Object.values(prev).some((o) => o.voice === p.voice && o.user_id !== p.user_id);
      if (alreadyBusy) continue;
      const ch = this.channels.find((c) => c.id === p.voice);
      playSound('call');
      notify(t('notify.call', { name: this.name(p.user_id), channel: ch?.name ?? t('notify.voice') }), t('notify.callBody'));
    }
  }

  private async refreshProfile(id: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (data) this.profiles[id] = data as Profile;
  }

  /** Closes the call and the subscriptions and clears the server data. */
  private async reset() {
    this.onKicked?.();
    await this.unsubscribe();
    this.channels = [];
    this.logs = {};
    this.online = {};
    this.voiceRooms = {};
  }

  private async kicked() {
    await this.reset();
    this.checkMembership();
  }

  async unsubscribe() {
    this.presenceReady = false;
    this.lobbyJoined = false;
    clearInterval(this.presenceTimer);
    clearTimeout(this.healTimer);
    this.healTimer = undefined;
    clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    clearTimeout(this.lobbyRetry);
    clearTimeout(this.inboxRetry);
    const { db, lobby, inbox } = this;
    this.db = this.lobby = this.inbox = null; // before closing: so their callbacks know it's intentional
    if (db) await supabase.removeChannel(db);
    if (lobby) await supabase.removeChannel(lobby);
    if (inbox) await supabase.removeChannel(inbox);
  }

  async signOut() {
    await this.onSignOut?.();
    await this.reset();
    await supabase.auth.signOut();
    this.membership = 'unknown';
    this.members = [];
  }
}

/** Several states for the same person (updates in quick succession): the latest wins. */
function latest(metas: Presence[]): Presence | null {
  return metas.reduce<Presence | null>((b, m) => (!b || (m.at ?? 0) >= (b.at ?? 0) ? m : b), null);
}

/**
 * State to show for a person. For each copy of the app its latest state counts;
 * if they have more than one (app + browser, two PCs) the one in a call wins,
 * otherwise the others would see them join and leave all the time.
 */
function pick(metas: Presence[]): Presence | null {
  const byDev = new Map<string, Presence[]>();
  for (const m of metas) byDev.set(m.dev ?? '', [...(byDev.get(m.dev ?? '') ?? []), m]);
  const heads = [...byDev.values()].map((g) => latest(g)!);
  const inVoice = heads.filter((m) => m.voice !== null);
  return latest(inVoice.length ? inVoice : heads);
}

export const app = new AppState();

// ---------------------------------------------------------------------------
// Signed URLs for attachments/avatars (private bucket), cached.
// ---------------------------------------------------------------------------
const urlCache = new Map<string, { url: string; exp: number }>();

export async function signedUrl(path: string, download?: string): Promise<string | null> {
  const key = download ? `${path}::dl` : path;
  const hit = urlCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, 3600, download ? { download } : undefined);
  if (!data?.signedUrl) return null;
  urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 3500_000 });
  return data.signedUrl;
}
