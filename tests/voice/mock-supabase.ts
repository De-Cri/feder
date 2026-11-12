// supabase-js mock to test P2P voice in the browser without a backend:
// presence and the server's relays emulated with BroadcastChannel between pages of the same context.
// Like the real server (0006_secure_signaling.sql): voice_join/voice_leave keep a room registry,
// voice_signal and poke deliver only to the recipient's personal channel, with the real sender.
const DUP = new URLSearchParams(location.search).get('dup') === '1';
// ?drop=1 simulates the opposite case: two updates too close together and the server
// "loses" the person (gone for everyone, themselves included).
const DROP = new URLSearchParams(location.search).get('drop') === '1';
// ?stale=1: the too-close update is ignored (the old state stays).
const STALE = new URLSearchParams(location.search).get('stale') === '1';
// Like Supabase: max 5 track() every 30 s per client; beyond that the server closes the channel.
const PRESENCE_MAX = 5;
const PRESENCE_WINDOW = 30_000;
type Handler = { type: string; event: string; table?: string; cb: (p: any) => void };
const ME = new URLSearchParams(location.search).get('u') ?? '';
const live = new Set<MockChannel>();

class MockChannel {
  handlers: Handler[] = [];
  bc: BroadcastChannel;
  key: string;
  state: Record<string, any[]> = {};
  /** A "connection": the same person can have more than one (app + browser). */
  conn = Math.random().toString(36).slice(2);
  tracks: number[] = [];
  trackCount = 0;
  closedByServer = false;
  statusCb?: (s: string) => void;
  private post(m: any) {
    try { this.bc.postMessage(m); } catch { /* channel already closed */ }
  }
  constructor(public name: string, opts: any) {
    this.key = opts?.config?.presence?.key ?? Math.random().toString(36);
    this.bc = new BroadcastChannel(name);
    this.bc.onmessage = ({ data }) => this.receive(data);
    live.add(this);
  }
  on(type: string, filter: any, cb: (p: any) => void) {
    this.handlers.push({ type, event: filter.event, table: filter.table, cb });
    return this;
  }
  /** A database change, as postgres_changes would deliver it. */
  firePg(table: string, ev: any) {
    for (const h of this.handlers) if (h.type === 'postgres_changes' && h.table === table) h.cb(ev);
  }
  private fire(type: string, event: string, payload?: any) {
    for (const h of this.handlers) if (h.type === type && h.event === event) h.cb(payload);
  }
  private receive(d: any) {
    if (d.t === 'b') this.fire('broadcast', d.event, { payload: d.payload });
    else if (d.t === 'presence') {
      const old = this.state[d.key] ?? [];
      const isNew = !old.some((m) => m.__c === d.meta.__c);
      // ?dup=1 simulates the real Supabase case where two states remain for the
      // same person, with the old one at the end of the list.
      this.state[d.key] = DUP ? [d.meta, ...old].slice(0, 2) : [...old.filter((m) => m.__c !== d.meta.__c), d.meta];
      const mine = this.mine();
      if (isNew && mine) this.post({ t: 'presence', key: this.key, meta: mine });
      this.fire('presence', 'sync');
    } else if (d.t === 'leave') {
      this.removeConn(d.key, d.conn);
      this.fire('presence', 'sync');
    }
  }
  private mine() {
    return (this.state[this.key] ?? []).find((m) => m.__c === this.conn) ?? (DUP ? this.state[this.key]?.[0] : undefined);
  }
  private removeConn(key: string, conn?: string) {
    const left = conn ? (this.state[key] ?? []).filter((m) => m.__c !== conn) : [];
    if (left.length) this.state[key] = left;
    else delete this.state[key];
  }
  /** The server closes the channel (like ClientPresenceRateLimitReached). */
  serverClose() {
    if (this.closedByServer) return;
    this.closedByServer = true;
    this.post({ t: 'leave', key: this.key, conn: this.conn });
    this.statusCb?.('CLOSED');
  }
  subscribe(cb?: (s: string) => void) {
    this.statusCb = cb;
    setTimeout(() => cb?.('SUBSCRIBED'), 10);
    return this;
  }
  private lastTrack = 0;
  private lastTrackKept = 0;
  async track(meta: any) {
    if (this.closedByServer) return 'error';
    const now = Date.now();
    this.trackCount++;
    this.tracks = [...this.tracks.filter((t) => now - t < PRESENCE_WINDOW), now];
    if (this.tracks.length > PRESENCE_MAX) {
      console.warn('[mock] ClientPresenceRateLimitReached:', this.name);
      this.serverClose();
      return 'error';
    }
    meta = { ...meta, __c: this.conn };
    const tooFast = DROP && now - this.lastTrack < 300;
    this.lastTrack = now;
    if (STALE && now - this.lastTrackKept < 300) return;
    if (STALE) this.lastTrackKept = now;
    if (tooFast) {
      this.removeConn(this.key, this.conn);
      this.post({ t: 'leave', key: this.key, conn: this.conn });
      this.fire('presence', 'sync');
      return;
    }
    this.state[this.key] = DUP ? [meta] : [...(this.state[this.key] ?? []).filter((m) => m.__c !== this.conn), meta];
    this.post({ t: 'presence', key: this.key, meta });
    this.fire('presence', 'sync');
  }
  presenceState() {
    return this.state;
  }
  send(m: any) {
    if (this.closedByServer) return;
    this.post({ t: 'b', event: m.event, payload: m.payload });
  }
  close() {
    if (!this.closedByServer) this.post({ t: 'leave', key: this.key, conn: this.conn });
    this.bc.close();
    live.delete(this);
  }
}

// ---- server side: room registry and relays -----------------------------------
const rooms: Record<string, number> = {};
const roomListeners: ((user: string, channel: number | null) => void)[] = [];
const roomsBc = new BroadcastChannel('mock-voice-rooms');
function applyRoom(user: string, channel: number | null) {
  if (channel === null) delete rooms[user];
  else rooms[user] = channel;
  const ev = channel === null ? { eventType: 'DELETE', old: { user_id: user } } : { eventType: 'INSERT', new: { user_id: user, channel_id: channel } };
  for (const ch of live) ch.firePg('voice_rooms', ev);
  for (const cb of roomListeners) cb(user, channel);
}
roomsBc.onmessage = ({ data }) => {
  if (data.hello) {
    if (rooms[ME] !== undefined) roomsBc.postMessage({ user: ME, channel: rooms[ME] });
  } else applyRoom(data.user, data.channel);
};
roomsBc.postMessage({ hello: true }); // pages opened earlier tell us their room
/** Room registry changes (the test page mirrors them into app.voiceRooms). */
export const onMockRooms = (cb: (user: string, channel: number | null) => void) => roomListeners.push(cb);

const outboxes: Record<string, BroadcastChannel> = {};
function deliver(to: string, event: string, payload: any) {
  (outboxes[to] ??= new BroadcastChannel(`cerchio:user:${to}`)).postMessage({ t: 'b', event, payload });
}

async function rpc(fn: string, args: any = {}) {
  const ok = { data: null, error: null };
  if (fn === 'voice_join' || fn === 'voice_leave') {
    const channel = fn === 'voice_join' ? args.p_channel : null;
    applyRoom(ME, channel);
    roomsBc.postMessage({ user: ME, channel });
    return ok;
  }
  if (fn === 'voice_signal') {
    if (rooms[ME] === undefined || rooms[ME] !== rooms[args.p_to]) return { data: null, error: { message: 'not_in_same_room' } };
    deliver(args.p_to, 'signal', { from: ME, signals: args.p_signals });
    return ok;
  }
  if (fn === 'poke') {
    deliver(args.p_to, 'poke', { from: ME, text: args.p_text });
    return ok;
  }
  return ok;
}

export const supabase = {
  realtime: { setAuth: async () => {} },
  // prefs.svelte.ts subscribes to login to sync preferences
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: (name: string, opts: any) => new MockChannel(name, opts),
  rpc,
  removeChannel: async (ch: MockChannel) => ch.close(),
  functions: { invoke: async () => ({ data: null, error: 'none' }) },
};
