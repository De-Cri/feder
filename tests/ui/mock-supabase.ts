// Mock con dati finti per vedere la UI senza backend (solo sviluppo/screenshot).
import { createIdentity, encryptDm, type Identity } from '../../src/lib/dmcrypto';
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

// Messaggi privati: marco, giulia e fede hanno attivato (chiavi vere), luca e ale no.
db.dm_keys = [];
db.dm_messages = [];
db.dm_stars = [];
const peers: Record<string, Identity> = {};
const peersReady = (async () => {
  for (const u of ['u2', 'u3', 'u5']) {
    peers[u] = (await createIdentity('mock-pin')).identity;
    db.dm_keys.push({ user_id: u, public_key: peers[u].publicKey });
  }
})();
let myKey: any = null;
// ?dm=locked: chiave già sul server ma non su questo dispositivo (schermata di sblocco)
if (new URLSearchParams(location.search).get('dm') === 'locked') {
  myKey = { public_key: 'x'.repeat(88), wrapped_key: 'x'.repeat(208), salt: 'x'.repeat(24), iv: 'x'.repeat(16), iterations: 600000 };
}
let dmId = 100;
async function seedDms(myPub: string) {
  await peersReady;
  const add = async (from: string, to: string, peer: string, text: string, minAgo: number) => {
    const p = peers[peer];
    const { body, iv } = await encryptDm(p, myPub, from, to, text);
    db.dm_messages.push({
      id: ++dmId, sender: from, recipient: to, iv, body, created_at: iso(minAgo),
      sender_pub: from === ME ? myPub : p.publicKey, recipient_pub: to === ME ? myPub : p.publicKey,
    });
  };
  await add('u2', ME, 'u2', 'oh hai visto la patch nuova?', 60 * 24 * 27);
  await add(ME, 'u2', 'u2', 'sì, il codice del server è questo: 4471-KQ', 60 * 24 * 27 - 2);
  db.dm_stars.push({ user_id: ME, message_id: dmId });
  await add('u2', ME, 'u2', 'stasera ci sei? 🎮', 35);
  await add('u2', ME, 'u2', 'ti aspetto in Lounge', 34);
  await add(ME, 'u2', 'u2', 'arrivo tra 10 minuti', 20);
  await add('u3', ME, 'u3', 'mi passi il link della release quando puoi?', 5);
}

function rpcResult(data: any, error: any = null) {
  const p: any = Promise.resolve({ data, error });
  p.single = () => Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error });
  p.maybeSingle = p.single;
  return p;
}

async function dmRpc(fn: string, args: any) {
  if (fn === 'dm_my_key') return myKey ? [myKey] : [];
  if (fn === 'dm_set_key') {
    myKey = { public_key: args.p_public, wrapped_key: args.p_wrapped, salt: args.p_salt, iv: args.p_iv, iterations: args.p_iterations };
    db.dm_keys = [...db.dm_keys.filter((k) => k.user_id !== ME), { user_id: ME, public_key: args.p_public }];
    await seedDms(args.p_public);
    return null;
  }
  if (fn === 'dm_conversations') {
    const by: Record<string, any> = {};
    for (const m of db.dm_messages) {
      const peer = m.sender === ME ? m.recipient : m.sender;
      if (!by[peer] || by[peer].last_id < m.id) by[peer] = { peer, last_id: m.id, last_at: m.created_at, last_sender: m.sender };
    }
    return Object.values(by);
  }
  if (fn === 'dm_send') {
    const row = {
      id: ++dmId, sender: ME, recipient: args.p_to, iv: args.p_iv, body: args.p_body, created_at: new Date().toISOString(),
      sender_pub: myKey.public_key, recipient_pub: args.p_recipient_pub,
    };
    db.dm_messages.push(row);
    return row;
  }
  if (fn === 'dm_star') {
    db.dm_stars = db.dm_stars.filter((s) => s.message_id !== args.p_id);
    if (args.p_on) db.dm_stars.push({ user_id: ME, message_id: args.p_id });
    return null;
  }
  return 'ok';
}

function builder(table: string) {
  let rows = [...(db[table] ?? [])];
  if (table === 'members' && !joined) rows = rows.filter((r) => r.user_id !== ME);
  let single = false;
  const b: any = {
    select: () => b,
    eq: (k: string, v: any) => ((rows = rows.filter((r) => r[k] === v)), b),
    lt: (k: string, v: any) => ((rows = rows.filter((r) => r[k] < v)), b),
    or: (expr: string) => {
      const pairs = [...expr.matchAll(/sender\.eq\.([^,)]+),recipient\.eq\.([^,)]+)/g)];
      rows = rows.filter((r) => pairs.some((x) => r.sender === x[1] && r.recipient === x[2]));
      return b;
    },
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
  rpc: (fn: string, args: any) => {
    if (fn === 'join_server') {
      if (args.p_password !== 'segreta') return rpcResult('wrong_password');
      joined = true;
    }
    if (fn.startsWith('dm_')) {
      const p: any = dmRpc(fn, args).then((data) => ({ data, error: null }));
      p.single = () => p.then((r: any) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }));
      p.maybeSingle = p.single;
      return p;
    }
    return rpcResult('ok');
  },
  realtime: { setAuth: async () => {} },
  channel: () => new Ch(),
  removeChannel: async () => {},
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null }), upload: async () => ({}), remove: async () => ({}) }) },
  functions: { invoke: async () => ({ data: null }) },
};
