// Mock con dati finti per vedere la UI senza backend (solo sviluppo/screenshot).
const ME = 'u1';
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const db: Record<string, any[]> = {
  profiles: [
    { id: 'u1', username: 'samu', avatar_path: null },
    { id: 'u2', username: 'marco', avatar_path: null },
    { id: 'u3', username: 'giulia', avatar_path: null },
    { id: 'u4', username: 'luca', avatar_path: null },
    { id: 'u5', username: 'fede', avatar_path: null },
    { id: 'u6', username: 'ale', avatar_path: null },
  ],
  members: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((id) => ({ user_id: id, role: id === 'u1' ? 'admin' : 'member', joined_at: iso(9999) })),
  bans: [],
  channels: [
    { id: 1, name: 'generale', kind: 'text', position: 1 },
    { id: 2, name: 'random', kind: 'text', position: 2 },
    { id: 3, name: 'Lounge', kind: 'voice', position: 3 },
    { id: 4, name: 'Gaming', kind: 'voice', position: 4 },
  ],
  voice_mutes: [],
  messages: [
    { id: 1, channel_id: 1, author_id: 'u2', content: 'stasera ranked?', created_at: iso(1500) },
    { id: 2, channel_id: 1, author_id: 'u3', content: 'io ci sono dalle 21', created_at: iso(1490) },
    { id: 3, channel_id: 1, author_id: 'u3', content: 'portate le cuffie decenti stavolta 😅', created_at: iso(1489) },
    { id: 4, channel_id: 1, author_id: 'u1', content: 'ho finito l’app, da oggi niente più discord pubblico', created_at: iso(42) },
    { id: 5, channel_id: 1, author_id: 'u1', content: 'scaricate da qui: https://github.com/samu/cerchio/releases/latest', created_at: iso(41) },
    { id: 6, channel_id: 1, author_id: 'u4', content: 'grande, già installata su fedora', created_at: iso(12) },
    { id: 7, channel_id: 1, author_id: 'u5', content: '', attachment_path: 'u5/x-setup.png', attachment_name: 'classifica.pdf', attachment_mime: 'application/pdf', attachment_size: 482113, created_at: iso(3) },
    { id: 8, channel_id: 1, author_id: 'u2', content: 'entro in Lounge', created_at: iso(1) },
  ].map((m) => ({ attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, ...m })),
};

function builder(table: string) {
  let rows = [...(db[table] ?? [])];
  if (table === 'members' && !joined) rows = rows.filter((r) => r.user_id !== ME);
  let single = false;
  const b: any = {
    select: () => b,
    eq: (k: string, v: any) => ((rows = rows.filter((r) => r[k] === v)), b),
    lt: (k: string, v: any) => ((rows = rows.filter((r) => r[k] < v)), b),
    order: (k: string, o?: { ascending?: boolean }) => (
      (rows = rows.sort((a, c) => (a[k] > c[k] ? 1 : -1) * (o?.ascending === false ? -1 : 1))), b
    ),
    limit: (n: number) => ((rows = rows.slice(0, n)), b),
    maybeSingle: () => ((single = true), b),
    single: () => ((single = true), b),
    insert: () => b,
    update: () => b,
    delete: () => b,
    then: (res: any) => res({ data: single ? rows[0] ?? null : rows, error: null }),
  };
  return b;
}

const params = new URLSearchParams(location.search);
let session: any = params.get('auth') === '0' ? null : { user: { id: ME } };
let joined = params.get('auth') !== '0';
const listeners: any[] = [];
const setSession = (s: any) => { session = s; listeners.forEach((cb) => cb(s ? 'SIGNED_IN' : 'SIGNED_OUT', s)); };

class Ch {
  cbs: any[] = [];
  on(t: string, f: any, cb: any) { this.cbs.push({ t, f, cb }); return this; }
  subscribe(cb?: any) { setTimeout(() => { cb?.('SUBSCRIBED'); this.cbs.filter((c) => c.t === 'presence').forEach((c) => c.cb()); }, 0); return this; }
  presenceState() {
    const voice = params.get('voice') === '1';
    return {
      u1: [{ user_id: 'u1', voice: voice ? 3 : null, mic: true, deaf: false, cam: false, screen: false }],
      u2: [{ user_id: 'u2', voice: 3, mic: true, deaf: false, cam: false, screen: true }],
      u3: [{ user_id: 'u3', voice: 3, mic: false, deaf: false, cam: false, screen: false }],
      u4: [{ user_id: 'u4', voice: null, mic: true, deaf: false, cam: false, screen: false }],
    };
  }
  async track() {}
  send() {}
}

export const supabase: any = {
  auth: {
    onAuthStateChange: (cb: any) => { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
    signOut: async () => setSession(null),
    signUp: async () => { const s = { user: { id: ME } }; setTimeout(() => setSession(s), 300); return { data: { session: s }, error: null }; },
    signInWithPassword: async () => { setTimeout(() => setSession({ user: { id: ME } }), 300); return { data: {}, error: null }; },
  },
  from: builder,
  rpc: async (fn: string, args: any) => {
    if (fn === 'join_server') {
      if (args.p_password !== 'segreta') return { data: 'wrong_password', error: null };
      joined = true;
    }
    return { data: 'ok', error: null };
  },
  realtime: { setAuth: async () => {} },
  channel: () => new Ch(),
  removeChannel: async () => {},
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }), upload: async () => ({}), remove: async () => ({}) }) },
  functions: { invoke: async () => ({ data: null }) },
};
