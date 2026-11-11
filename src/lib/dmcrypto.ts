// Cifratura end-to-end dei messaggi privati. Solo WebCrypto del browser, nessuna dipendenza.
//
// - Ogni membro ha una coppia di chiavi ECDH P-256. La privata va sul server solo
//   cifrata (AES-GCM) con una chiave derivata dal PIN delle chat (PBKDF2-SHA256):
//   su un dispositivo nuovo basta il PIN per riaverla.
// - Chiave di una chat = HKDF(ECDH(mia privata, sua pubblica)): uguale per i due,
//   il server non può calcolarla.
// - Ogni messaggio: AES-GCM con IV casuale; mittente e destinatario sono legati al
//   testo cifrato (additionalData), così il server non può spacciarlo per l'altro verso.
// - Su questo dispositivo la chiave privata resta in IndexedDB come CryptoKey non
//   esportabile: niente PIN a ogni avvio, ma nessuno script può leggerne i byte.

export const PBKDF2_ITERATIONS = 600_000;
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

export type Identity = { publicKey: string; privateKey: CryptoKey };
/** Come sta sul server (tabella dm_keys). */
export type WrappedKey = { public_key: string; wrapped_key: string; salt: string; iv: string; iterations: number };

export function b64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pinKey(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Nuova identità protetta dal PIN (prima attivazione o PIN dimenticato). */
export async function createIdentity(pin: string): Promise<{ identity: Identity; wrapped: WrappedKey }> {
  const pair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
  const publicKey = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await pinKey(pin, salt, PBKDF2_ITERATIONS);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(publicKey) }, k, pkcs8);
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
  return {
    identity: { publicKey, privateKey },
    wrapped: { public_key: publicKey, wrapped_key: b64(wrapped), salt: b64(salt), iv: b64(iv), iterations: PBKDF2_ITERATIONS },
  };
}

/** Sblocca l'identità salvata sul server. null = PIN sbagliato. */
export async function unlockIdentity(w: WrappedKey, pin: string): Promise<Identity | null> {
  try {
    const k = await pinKey(pin, unb64(w.salt), w.iterations);
    const pkcs8 = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(w.iv), additionalData: enc.encode(w.public_key) },
      k,
      unb64(w.wrapped_key),
    );
    const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits']);
    return { publicKey: w.public_key, privateKey };
  } catch {
    return null;
  }
}

// Chiave di una chat, per coppia di chiavi pubbliche (cambia se uno reimposta il PIN).
const chatKeys = new Map<string, Promise<CryptoKey>>();

function chatKey(me: Identity, peerPub: string): Promise<CryptoKey> {
  const id = `${me.publicKey}|${peerPub}`;
  let k = chatKeys.get(id);
  if (!k) {
    k = (async () => {
      const peer = await crypto.subtle.importKey('raw', unb64(peerPub), CURVE, false, []);
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, me.privateKey, 256);
      const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
      const [a, b] = [me.publicKey, peerPub].sort();
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('feder-dm-v1'), info: enc.encode(`${a}|${b}`) },
        hk,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    k.catch(() => chatKeys.delete(id));
    chatKeys.set(id, k);
  }
  return k;
}

const aad = (sender: string, recipient: string) => enc.encode(`feder-dm|${sender}>${recipient}`);

export async function encryptDm(me: Identity, peerPub: string, sender: string, recipient: string, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(sender, recipient) },
    await chatKey(me, peerPub),
    enc.encode(text),
  );
  return { body: b64(body), iv: b64(iv) };
}

/** Testo in chiaro, o null se non leggibile (chiave cambiata o dati alterati). */
export async function decryptDm(
  me: Identity,
  meId: string,
  m: { sender: string; recipient: string; sender_pub: string; recipient_pub: string; iv: string; body: string },
): Promise<string | null> {
  const mine = m.sender === meId;
  if ((mine ? m.sender_pub : m.recipient_pub) !== me.publicKey) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(m.iv), additionalData: aad(m.sender, m.recipient) },
      await chatKey(me, mine ? m.recipient_pub : m.sender_pub),
      unb64(m.body),
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chiave su questo dispositivo (IndexedDB). Ogni errore = "non salvata": si chiede il PIN.
// ---------------------------------------------------------------------------
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('feder-dm', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction('keys', mode).objectStore('keys'));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function loadLocal(userId: string): Promise<Identity | null> {
  try {
    const v = (await tx('readonly', (s) => s.get(userId))) as Identity | undefined;
    return v?.privateKey && v.publicKey ? v : null;
  } catch {
    return null;
  }
}

export async function saveLocal(userId: string, id: Identity) {
  try {
    await tx('readwrite', (s) => s.put(id, userId));
  } catch {
    /* niente IndexedDB: il PIN verrà chiesto al prossimo avvio */
  }
}

export async function clearLocal(userId: string) {
  try {
    await tx('readwrite', (s) => s.delete(userId));
  } catch {
    /* ignore */
  }
  chatKeys.clear();
}
