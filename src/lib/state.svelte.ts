import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { notify } from './notify';

export type Profile = { id: string; username: string; avatar_path: string | null };
export type Member = { user_id: string; role: 'admin' | 'member'; joined_at: string };
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
export type Presence = {
  user_id: string;
  voice: number | null;
  mic: boolean;
  deaf: boolean;
  cam: boolean;
  screen: boolean;
};

const PAGE = 50;

class ChannelLog {
  messages = $state<Message[]>([]);
  loaded = $state(false);
  hasMore = $state(true);
  loading = $state(false);

  constructor(public id: number) {}

  async loadInitial() {
    if (this.loaded || this.loading) return;
    this.loading = true;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('channel_id', this.id)
      .order('id', { ascending: false })
      .limit(PAGE);
    const rows = (data ?? []) as Message[];
    // Unisce eventuali messaggi arrivati via realtime durante il fetch.
    const ids = new Set(rows.map((m) => m.id));
    this.messages = [...rows.reverse(), ...this.messages.filter((m) => !ids.has(m.id))];
    this.hasMore = rows.length === PAGE;
    this.loaded = true;
    this.loading = false;
  }

  async loadOlder() {
    if (!this.hasMore || this.loading || !this.messages.length) return;
    this.loading = true;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('channel_id', this.id)
      .lt('id', this.messages[0].id)
      .order('id', { ascending: false })
      .limit(PAGE);
    const rows = (data ?? []) as Message[];
    this.messages = [...rows.reverse(), ...this.messages];
    this.hasMore = rows.length === PAGE;
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
  logs: Record<number, ChannelLog> = {};
  unread = $state<Record<number, number>>({});

  view = $state<number>(1); // canale visualizzato (testo o voce)
  showMembers = $state(true);
  settingsOpen = $state(false);
  focused = $state(true);

  /** Stato pubblicato in presence (aggiornato dalla stanza vocale). */
  myPresence = $state<Omit<Presence, 'user_id'>>({ voice: null, mic: true, deaf: false, cam: false, screen: false });

  private db: RealtimeChannel | null = null;
  private lobby: RealtimeChannel | null = null;
  onKicked: (() => void) | null = null;
  onMemberLeft: ((id: string) => void) | null = null;

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
  inVoice(channelId: number): Presence[] {
    return Object.values(this.online).filter((p) => p.voice === channelId);
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

    const me = this.me!;
    this.lobby = supabase.channel('cerchio:lobby', { config: { private: true, presence: { key: me } } });
    this.lobby
      .on('presence', { event: 'sync' }, () => {
        const state = this.lobby!.presenceState<Presence>();
        const next: Record<string, Presence> = {};
        for (const [key, metas] of Object.entries(state)) {
          const last = metas[metas.length - 1];
          if (last) next[key] = { ...last, user_id: key };
        }
        this.online = next;
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await this.publishPresence();
      });
  }

  async publishPresence() {
    if (!this.lobby || !this.me) return;
    await this.lobby.track({ user_id: this.me, ...$state.snapshot(this.myPresence) });
  }

  private async refreshProfile(id: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (data) this.profiles[id] = data as Profile;
  }

  private kicked() {
    this.onKicked?.();
    this.unsubscribe();
    this.channels = [];
    this.logs = {};
    this.online = {};
    this.checkMembership();
  }

  async unsubscribe() {
    if (this.db) await supabase.removeChannel(this.db);
    if (this.lobby) await supabase.removeChannel(this.lobby);
    this.db = this.lobby = null;
  }

  async signOut() {
    this.onKicked?.();
    await this.unsubscribe();
    await supabase.auth.signOut();
    this.membership = 'unknown';
    this.channels = [];
    this.members = [];
    this.logs = {};
    this.online = {};
  }
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
