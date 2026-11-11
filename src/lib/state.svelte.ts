import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { notify } from './notify';
import { playSound } from './sounds';
import { hasUnseenRelease } from './releases';

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

export type Presence = {
  user_id: string;
  at?: number; // quando è stato pubblicato (per scartare stati vecchi)
  dev?: string; // quale copia dell'app (stessa persona su app desktop + browser, o due PC)
  voice: number | null;
  mic: boolean;
  deaf: boolean;
  cam: boolean;
  screen: boolean;
};

const PAGE = 50;

/** `app.view` del canale "novità" (note di rilascio, non è un canale del server). */
export const RELEASES_VIEW = -1;
/** `app.view` della schermata dei messaggi privati (separata dal server). */
export const DM_VIEW = -2;

/** Identifica questa copia dell'app nella presenza (la chiave è l'utente, condivisa tra dispositivi). */
const DEVICE = crypto.randomUUID();

/**
 * Supabase accetta al massimo 5 track() ogni 30 s per client: oltre, CHIUDE il canale
 * (ClientPresenceRateLimitReached) e la presenza smette di aggiornarsi per tutti.
 * Noi: 5 ogni 32 s (margine sulla finestra); il resto viene accorpato e inviato appena si può.
 */
export class TrackBudget {
  private times: number[] = [];
  constructor(private max = 5, private windowMs = 32_000) {}
  /** Millisecondi da aspettare prima del prossimo track() (0 = subito). */
  wait(now = Date.now()): number {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    return this.times.length < this.max ? 0 : this.windowMs - (now - this.times[0]) + 100;
  }
  take(now = Date.now()) {
    this.times.push(now);
  }
}

/** Un solo conteggio per lobby e canale vocale: prudente anche se il limite fosse per connessione. */
export const presenceBudget = new TrackBudget();

class ChannelLog {
  messages = $state<Message[]>([]);
  loaded = $state(false);
  hasMore = $state(true);
  loading = $state(false);

  constructor(public id: number) {}

  /** Una pagina di messaggi (i più recenti, o quelli prima di `before`), in ordine cronologico. */
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
    // Unisce eventuali messaggi arrivati via realtime durante il fetch.
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
  /** Poke ricevuti (come su TeamSpeak), mostrati finché non li chiudi. */
  pokes = $state<{ key: number; from: string; text: string }[]>([]);
  private pokeKey = 0;
  private lastPoke: Record<string, number> = {};
  logs: Record<number, ChannelLog> = {};
  unread = $state<Record<number, number>>({});

  view = $state<number>(1); // canale visualizzato (testo o voce, o RELEASES_VIEW / DM_VIEW)
  releasesUnseen = $state(hasUnseenRelease()); // pallino "nuovo" sul canale novità
  settingsOpen = $state(false);
  // scheda da mostrare alla prossima apertura delle impostazioni (es. 'media' dal menu del microfono)
  settingsTab = $state<string>('profile');
  focused = $state(true);

  /** Stato pubblicato in presence (aggiornato dalla stanza vocale). */
  myPresence = $state<Omit<Presence, 'user_id'>>({ voice: null, mic: true, deaf: false, cam: false, screen: false });

  private db: RealtimeChannel | null = null;
  private lobby: RealtimeChannel | null = null;
  onKicked: (() => void) | null = null;
  onMemberLeft: ((id: string) => void) | null = null;
  /** Chiamato prima dell'uscita dall'account (i messaggi privati cancellano la chiave locale). */
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
   * Presenza da mostrare: quella del server per gli altri, e per te sempre lo
   * stato locale attuale (aggiornato subito, anche prima che il server risponda).
   */
  get presence(): Record<string, Presence> {
    const me = this.me;
    if (!me || !this.online[me]) return this.online;
    return { ...this.online, [me]: { ...this.online[me], ...this.myPresence, user_id: me } };
  }
  /**
   * Chi è nella tua stanza vocale secondo la stanza stessa (fonte più affidabile
   * della lista generale per il canale in cui sei). Aggiornato da voice.svelte.ts.
   */
  room = $state<{ channel: number | null; ids: string[] }>({ channel: null, ids: [] });

  inVoice(channelId: number): Presence[] {
    const all = this.presence;
    const room = this.room.channel !== null ? this.room : null;
    if (room && channelId === room.channel) {
      // la tua stanza: chi c'è davvero, anche se la lista generale è indietro
      return room.ids.map(
        (id) => ({ ...(all[id] ?? { mic: true, deaf: false, cam: false, screen: false }), user_id: id, voice: channelId }) as Presence,
      );
    }
    // gli altri canali: chi la stanza dice essere con te non può essere altrove
    return Object.values(all).filter((p) => p.voice === channelId && !(room && room.ids.includes(p.user_id)));
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
    const [ch, mem, prof, mutes] = await Promise.all([
      supabase.from('channels').select('*').order('position'),
      supabase.from('members').select('*'),
      supabase.from('profiles').select('*'),
      supabase.from('voice_mutes').select('user_id'),
    ]);
    this.channels = (ch.data ?? []) as Channel[];
    this.members = (mem.data ?? []) as Member[];
    const p: Record<string, Profile> = {};
    for (const row of (prof.data ?? []) as Profile[]) p[row.id] = row;
    this.profiles = p;
    const m: Record<string, true> = {};
    for (const row of mutes.data ?? []) m[row.user_id] = true;
    this.voiceMutes = m;
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
          notify(`${this.name(m.author_id)} in #${ch?.name ?? ''}`, m.content || m.attachment_name || 'Allegato');
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'voice_mutes' }, (ev) => {
        if (ev.eventType === 'DELETE') delete this.voiceMutes[(ev.old as { user_id: string }).user_id];
        else this.voiceMutes[(ev.new as { user_id: string }).user_id] = true;
      })
      .subscribe();

    this.joinLobby();
    // Ripubblica ogni tanto: corregge eventuali stati persi o rimasti indietro sul server.
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
      // Il proprio stato è sempre quello locale (il server può essere un attimo indietro).
      if (this.me && this.lobbyJoined) {
        // Il server ci ha "perso" o ha uno stato vecchio: ripubblica.
        if (!this.serverHasMine(state[this.me])) this.healPresence();
        next[this.me] = { ...(next[this.me] ?? {}), ...$state.snapshot(this.myPresence), user_id: this.me };
      }
      this.detectCalls(next);
      this.online = next;
    }).on('broadcast', { event: 'poke' }, ({ payload }) => {
      if (this.lobby !== ch) return;
      const { from, to, text } = (payload ?? {}) as { from?: string; to?: string; text?: string };
      if (to !== this.me || !from || !this.members.some((m) => m.user_id === from)) return;
      const msg = String(text ?? '').slice(0, POKE_MAX);
      if (this.pokes.length >= 5) this.pokes = this.pokes.slice(-4); // niente pila infinita
      this.pokes = [...this.pokes, { key: ++this.pokeKey, from, text: msg }];
      playSound('poke');
      notify(`${this.name(from)} ti ha fatto un poke`, msg || 'Poke!');
    }).subscribe(async (status) => {
      if (this.lobby !== ch) return; // canale vecchio, già sostituito o chiuso da noi
      this.lobbyJoined = status === 'SUBSCRIBED';
      if (status === 'SUBSCRIBED') return void (await this.publishPresence());
      // Il server ha chiuso il canale (es. troppi aggiornamenti) o la rete è caduta:
      // senza questo la barra laterale resterebbe ferma fino al riavvio dell'app.
      if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[presence] canale lobby perso:', status, '- mi ricollego');
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

  /** Manda un poke a qualcuno (max uno ogni 3 s per persona). false = troppo presto o non connesso. */
  poke(to: string, text: string): boolean {
    const now = Date.now();
    if (!this.lobby || !this.lobbyJoined || !this.me || now - (this.lastPoke[to] ?? 0) < 3000) return false;
    this.lastPoke[to] = now;
    this.lobby.send({ type: 'broadcast', event: 'poke', payload: { from: this.me, to, text: text.trim().slice(0, POKE_MAX) } });
    return true;
  }

  closePoke(key: number) {
    this.pokes = this.pokes.filter((p) => p.key !== key);
  }

  /** Il server ha il nostro stato attuale (cercando tra gli stati di QUESTA copia dell'app). */
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
   * Controlla poco dopo che il server abbia il proprio stato attuale; se manca o
   * è vecchio lo ripubblica, riprovando con attese crescenti (0,8 s → 1,6 s → … max 10 s).
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
      console.info('[presence] stato sul server mancante o vecchio: ripubblico');
      this.publishPresence(); // al termine richiama healPresence per verificare di nuovo
    }, delay);
  }

  // Una pubblicazione alla volta, sempre con lo stato più recente: chiamate
  // ravvicinate (es. cambio canale vocale) non lasciano stati fantasma.
  // Oltre il limite di Supabase l'invio viene rimandato (sempre con lo stato più recente).
  private publishing = false;
  private publishAgain = false;
  private publishTimer: ReturnType<typeof setTimeout> | undefined;
  async publishPresence() {
    if (!this.lobby || !this.me) return;
    if (this.publishTimer) return; // un invio è già in programma: userà lo stato più recente
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
    // Verifica poco dopo che il server abbia davvero lo stato appena pubblicato.
    if (!deferred) this.healPresence();
  }

  /** Suono "chiamata": qualcuno entra in un canale vocale vuoto mentre tu non sei in vocale. */
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
      if (prev[p.user_id]?.voice === p.voice) continue; // era già lì
      const alreadyBusy = Object.values(prev).some((o) => o.voice === p.voice && o.user_id !== p.user_id);
      if (alreadyBusy) continue;
      const ch = this.channels.find((c) => c.id === p.voice);
      playSound('call');
      notify(`${this.name(p.user_id)} è in ${ch?.name ?? 'vocale'}`, 'Clicca il canale per entrare.');
    }
  }

  private async refreshProfile(id: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (data) this.profiles[id] = data as Profile;
  }

  /** Chiude la chiamata e le iscrizioni e svuota i dati del server. */
  private async reset() {
    this.onKicked?.();
    await this.unsubscribe();
    this.channels = [];
    this.logs = {};
    this.online = {};
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
    const { db, lobby } = this;
    this.db = this.lobby = null; // prima di chiudere: così i loro callback sanno che è voluto
    if (db) await supabase.removeChannel(db);
    if (lobby) await supabase.removeChannel(lobby);
  }

  async signOut() {
    await this.onSignOut?.();
    await this.reset();
    await supabase.auth.signOut();
    this.membership = 'unknown';
    this.members = [];
  }
}

/** Più stati per la stessa persona (aggiornamenti ravvicinati): vale il più recente. */
function latest(metas: Presence[]): Presence | null {
  return metas.reduce<Presence | null>((b, m) => (!b || (m.at ?? 0) >= (b.at ?? 0) ? m : b), null);
}

/**
 * Stato da mostrare per una persona. Per ogni copia dell'app vale il suo stato più
 * recente; se ne ha più di una (app + browser, due PC) conta quella in chiamata,
 * altrimenti gli altri la vedrebbero entrare e uscire di continuo.
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
// URL firmati per allegati/avatar (bucket privato), con cache.
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
