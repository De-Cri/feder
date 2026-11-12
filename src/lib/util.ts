export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

export function day(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Oggi';
  if (d.toDateString() === y.toDateString()) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function bytes(n: number | null): string {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

// Apple-style system colors for avatars (stable per user).
const AVATAR_COLORS = ['#0a84ff', '#30b0c7', '#34c759', '#ff9f0a', '#ff6482', '#bf5af2', '#5e5ce6', '#ac8e68'];

export function avatarColor(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return AVATAR_COLORS[(h >>> 0) % AVATAR_COLORS.length];
}

/** Safely turns links in text into anchors (no HTML from the user). */
export function splitLinks(text: string): { t: string; href?: string }[] {
  const out: { t: string; href?: string }[] = [];
  const re = /https?:\/\/[^\s<]+[^\s<.,:;"')\]]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index) });
    out.push({ t: m[0], href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

export function errorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  const map: Record<string, string> = {
    'Invalid login credentials': 'Email o password errati.',
    'User already registered': 'Esiste già un account con questa email.',
    forbidden: 'Non hai i permessi.',
    password_too_short: 'La password deve avere almeno 6 caratteri.',
  };
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v;
  return msg;
}
