// Mock di supabase-js per testare la voce P2P in browser senza backend:
// broadcast + presence emulati con BroadcastChannel tra pagine dello stesso contesto.
const DUP = new URLSearchParams(location.search).get('dup') === '1';
// ?drop=1 simula il caso opposto: due aggiornamenti troppo ravvicinati e il server
// "perde" la persona (sparisce per tutti, anche per sé stessa).
const DROP = new URLSearchParams(location.search).get('drop') === '1';
// ?stale=1: l'aggiornamento troppo ravvicinato viene ignorato (resta lo stato vecchio).
const STALE = new URLSearchParams(location.search).get('stale') === '1';
type Handler = { type: string; event: string; cb: (p: any) => void };

class MockChannel {
  handlers: Handler[] = [];
  bc: BroadcastChannel;
  key: string;
  state: Record<string, any[]> = {};
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
      const isNew = !this.state[d.key];
      // ?dup=1 simula il caso reale di Supabase in cui restano due stati per la
      // stessa persona, con quello vecchio in fondo alla lista.
      this.state[d.key] = DUP ? [d.meta, ...(this.state[d.key] ?? [])].slice(0, 2) : [d.meta];
      if (isNew && this.state[this.key]) this.bc.postMessage({ t: 'presence', key: this.key, meta: this.state[this.key][0] });
      this.fire('presence', 'sync');
    } else if (d.t === 'leave') {
      delete this.state[d.key];
      this.fire('presence', 'sync');
    }
  }
  subscribe(cb?: (s: string) => void) {
    setTimeout(() => cb?.('SUBSCRIBED'), 10);
    return this;
  }
  private lastTrack = 0;
  private lastTrackKept = 0;
  async track(meta: any) {
    const now = Date.now();
    const tooFast = DROP && now - this.lastTrack < 300;
    this.lastTrack = now;
    if (STALE && now - this.lastTrackKept < 300) return;
    if (STALE) this.lastTrackKept = now;
    if (tooFast) {
      delete this.state[this.key];
      this.bc.postMessage({ t: 'leave', key: this.key });
      this.fire('presence', 'sync');
      return;
    }
    this.state[this.key] = [meta];
    this.bc.postMessage({ t: 'presence', key: this.key, meta });
    this.fire('presence', 'sync');
  }
  presenceState() {
    return this.state;
  }
  send(m: any) {
    this.bc.postMessage({ t: 'b', event: m.event, payload: m.payload });
  }
  close() {
    this.bc.postMessage({ t: 'leave', key: this.key });
    this.bc.close();
  }
}

export const supabase = {
  realtime: { setAuth: async () => {} },
  channel: (name: string, opts: any) => new MockChannel(name, opts),
  removeChannel: async (ch: MockChannel) => ch.close(),
  functions: { invoke: async () => ({ data: null, error: 'none' }) },
};
