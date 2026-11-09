// Mock di supabase-js per testare la voce P2P in browser senza backend:
// broadcast + presence emulati con BroadcastChannel tra pagine dello stesso contesto.
const DUP = new URLSearchParams(location.search).get('dup') === '1';
// ?drop=1 simula il caso opposto: due aggiornamenti troppo ravvicinati e il server
// "perde" la persona (sparisce per tutti, anche per sé stessa).
const DROP = new URLSearchParams(location.search).get('drop') === '1';
// ?stale=1: l'aggiornamento troppo ravvicinato viene ignorato (resta lo stato vecchio).
const STALE = new URLSearchParams(location.search).get('stale') === '1';
// Come Supabase: max 5 track() ogni 30 s per client, oltre il server chiude il canale.
const PRESENCE_MAX = 5;
const PRESENCE_WINDOW = 30_000;
type Handler = { type: string; event: string; cb: (p: any) => void };

class MockChannel {
  handlers: Handler[] = [];
  bc: BroadcastChannel;
  key: string;
  state: Record<string, any[]> = {};
  /** Una "connessione": la stessa persona può averne più di una (app + browser). */
  conn = Math.random().toString(36).slice(2);
  tracks: number[] = [];
  trackCount = 0;
  closedByServer = false;
  statusCb?: (s: string) => void;
  private post(m: any) {
    try { this.bc.postMessage(m); } catch { /* canale già chiuso */ }
  }
  constructor(public name: string, opts: any) {
    this.key = opts?.config?.presence?.key ?? Math.random().toString(36);
    this.bc = new BroadcastChannel(name);
    this.bc.onmessage = ({ data }) => this.receive(data);
  }
  on(type: string, filter: any, cb: (p: any) => void) {
    this.handlers.push({ type, event: filter.event, cb });
    return this;
  }
  private fire(type: string, event: string, payload?: any) {
    for (const h of this.handlers) if (h.type === type && h.event === event) h.cb(payload);
  }
  private receive(d: any) {
    if (d.t === 'b') this.fire('broadcast', d.event, { payload: d.payload });
    else if (d.t === 'presence') {
      const old = this.state[d.key] ?? [];
      const isNew = !old.some((m) => m.__c === d.meta.__c);
      // ?dup=1 simula il caso reale di Supabase in cui restano due stati per la
      // stessa persona, con quello vecchio in fondo alla lista.
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
  /** Il server chiude il canale (come ClientPresenceRateLimitReached). */
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
  }
}

export const supabase = {
  realtime: { setAuth: async () => {} },
  // prefs.svelte.ts si iscrive al login per sincronizzare le preferenze
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: (name: string, opts: any) => new MockChannel(name, opts),
  removeChannel: async (ch: MockChannel) => ch.close(),
  functions: { invoke: async () => ({ data: null, error: 'none' }) },
};
