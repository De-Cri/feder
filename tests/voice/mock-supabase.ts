// Mock di supabase-js per testare la voce P2P in browser senza backend:
// broadcast + presence emulati con BroadcastChannel tra pagine dello stesso contesto.
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
      this.state[d.key] = [d.meta];
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
  async track(meta: any) {
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
