// Interface sounds, synthesized on the fly with Web Audio (no audio files).
// Each one can be turned off in settings; there is a single volume.
import { prefs } from './prefs.svelte';

export type SoundKind = 'selfJoin' | 'selfLeave' | 'join' | 'leave' | 'call' | 'message' | 'mute' | 'unmute' | 'poke';

export const SOUND_LABELS: Record<SoundKind, string> = {
  selfJoin: 'Entri in un canale vocale',
  selfLeave: 'Esci da un canale vocale',
  join: 'Qualcuno entra nel tuo canale',
  leave: 'Qualcuno esce dal tuo canale',
  call: 'Qualcuno ti chiama (entra in un canale vuoto)',
  message: 'Nuovo messaggio',
  mute: 'Microfono / audio disattivato',
  unmute: 'Microfono / audio riattivato',
  poke: 'Qualcuno ti fa un poke',
};

// Notes in Hz (A major scale, sounds "soft").
const N = { E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, Cs6: 1108.73, E6: 1318.51, A4: 440, E4: 329.63 };

type Note = { f: number; t: number; d: number; g?: number; type?: OscillatorType };
const PATTERNS: Record<SoundKind, Note[]> = {
  selfJoin: [
    { f: N.E5, t: 0, d: 0.16 },
    { f: N.A5, t: 0.09, d: 0.16 },
    { f: N.Cs6, t: 0.18, d: 0.3 },
  ],
  selfLeave: [
    { f: N.Cs6, t: 0, d: 0.16 },
    { f: N.A5, t: 0.09, d: 0.16 },
    { f: N.E5, t: 0.18, d: 0.3 },
  ],
  join: [
    { f: N.A5, t: 0, d: 0.14 },
    { f: N.E6, t: 0.08, d: 0.24 },
  ],
  leave: [
    { f: N.E6, t: 0, d: 0.14 },
    { f: N.A5, t: 0.08, d: 0.24 },
  ],
  call: [
    // two soft "rings"
    { f: N.A5, t: 0, d: 0.18, g: 0.9 },
    { f: N.Cs6, t: 0.12, d: 0.18, g: 0.9 },
    { f: N.E6, t: 0.24, d: 0.34, g: 0.9 },
    { f: N.A5, t: 0.8, d: 0.18, g: 0.9 },
    { f: N.Cs6, t: 0.92, d: 0.18, g: 0.9 },
    { f: N.E6, t: 1.04, d: 0.45, g: 0.9 },
  ],
  message: [{ f: N.B5, t: 0, d: 0.12, g: 0.6 }, { f: N.E6, t: 0.05, d: 0.16, g: 0.5 }],
  // three firm taps: audible even over a game
  poke: [
    { f: N.E6, t: 0, d: 0.1, g: 1, type: 'triangle' },
    { f: N.E6, t: 0.16, d: 0.1, g: 1, type: 'triangle' },
    { f: N.A5, t: 0.32, d: 0.22, g: 1, type: 'triangle' },
  ],
  mute: [{ f: N.E4, t: 0, d: 0.09, g: 0.7, type: 'triangle' }],
  unmute: [{ f: N.A4, t: 0, d: 0.09, g: 0.7, type: 'triangle' }],
};

let ctx: AudioContext | null = null;
let sinkApplied = '';
// Between sounds the context is suspended: no audio thread running idle.
let idle: ReturnType<typeof setTimeout> | undefined;

function context(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    sinkApplied = '';
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  // Same audio output chosen for calls (if supported).
  const c = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (c.setSinkId && sinkApplied !== prefs.speakerId) {
    sinkApplied = prefs.speakerId;
    c.setSinkId(prefs.speakerId || '').catch(() => {});
  }
  return ctx;
}

let last: Partial<Record<SoundKind, number>> = {};
/** Last sounds played (diagnostics/tests). */
export const soundLog: SoundKind[] = [];

/** Plays an event if it's enabled in settings. `force` plays it anyway ("test" button). */
export function playSound(kind: SoundKind, force = false) {
  if (!force && !prefs.sounds[kind]) return;
  const vol = prefs.soundVolume;
  if (vol <= 0) return;
  // avoid bursts (e.g. many messages at once)
  const now = performance.now();
  const prev = last[kind];
  if (!force && prev !== undefined && now - prev < (kind === 'call' ? 4000 : 250)) return;
  last[kind] = now;
  soundLog.push(kind);
  if (soundLog.length > 50) soundLog.shift();
  try {
    const c = context();
    const master = c.createGain();
    master.gain.value = vol * 0.22;
    master.connect(c.destination);
    const t0 = c.currentTime + 0.01;
    for (const n of PATTERNS[kind]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.value = n.f;
      // soft envelope: short attack, exponential decay
      const peak = n.g ?? 1;
      g.gain.setValueAtTime(0.0001, t0 + n.t);
      g.gain.exponentialRampToValueAtTime(peak, t0 + n.t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
      // light harmonic for a "bell"-like timbre
      const osc2 = c.createOscillator();
      const g2 = c.createGain();
      osc2.frequency.value = n.f * 2;
      g2.gain.value = 0.18;
      osc2.connect(g2).connect(g);
      osc.connect(g).connect(master);
      osc.start(t0 + n.t);
      osc2.start(t0 + n.t);
      osc.stop(t0 + n.t + n.d + 0.05);
      osc2.stop(t0 + n.t + n.d + 0.05);
    }
    const end = Math.max(...PATTERNS[kind].map((n) => n.t + n.d)) + 0.2;
    setTimeout(() => master.disconnect(), end * 1000);
    clearTimeout(idle);
    idle = setTimeout(() => ctx?.state === 'running' && ctx.suspend().catch(() => {}), end * 1000 + 2000);
  } catch {
    /* audio not available */
  }
}
