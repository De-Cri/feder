// Interface sounds, synthesized on the fly with Web Audio (no audio files).
// Each one can be turned off in settings; there is a single volume.
import { prefs } from './prefs.svelte';
import { t, type Key } from './i18n.svelte';

export type SoundKind = 'selfJoin' | 'selfLeave' | 'join' | 'leave' | 'call' | 'message' | 'mute' | 'unmute' | 'poke' | 'chess';

export const SOUND_KINDS: SoundKind[] = ['selfJoin', 'selfLeave', 'join', 'leave', 'call', 'message', 'mute', 'unmute', 'poke', 'chess'];

/** Label shown in settings for each sound. */
export const soundLabel = (k: SoundKind) => t(`sound.${k}` as Key);

// Notes in Hz (A major scale, sounds "soft").
const N = { E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, Cs6: 1108.73, E6: 1318.51, A4: 440, E4: 329.63 };

type Note = { f: number; t: number; d: number; g?: number; type?: OscillatorType };
const PATTERNS: Record<Exclude<SoundKind, 'chess'>, Note[]> = {
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
  if (kind === 'chess') return playChess('move', force);
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

export type ChessSound = 'move' | 'capture' | 'check' | 'end';

/**
 * Chess sounds: a short dry "wooden" click (filtered noise + a low knock), louder and
 * double for a capture, with a short high note for check; two soft notes when it ends.
 */
export function playChess(kind: ChessSound, force = false) {
  if (!force && !prefs.sounds.chess) return;
  const vol = prefs.soundVolume;
  if (vol <= 0) return;
  try {
    const c = context();
    const master = c.createGain();
    master.gain.value = vol * 0.5;
    master.connect(c.destination);
    const t0 = c.currentTime + 0.01;
    // one knock: noise through a band-pass (the wood) + a short low sine (the board)
    const knock = (at: number, freq: number, gain: number) => {
      const len = Math.floor(c.sampleRate * 0.06);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      const noise = c.createBufferSource();
      noise.buffer = buf;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 3.5;
      const ng = c.createGain();
      ng.gain.value = gain;
      noise.connect(bp).connect(ng).connect(master);
      noise.start(at);
      const low = c.createOscillator();
      const lg = c.createGain();
      low.frequency.setValueAtTime(freq / 8, at);
      low.frequency.exponentialRampToValueAtTime(freq / 14, at + 0.07);
      lg.gain.setValueAtTime(0.0001, at);
      lg.gain.exponentialRampToValueAtTime(gain * 0.9, at + 0.003);
      lg.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      low.connect(lg).connect(master);
      low.start(at);
      low.stop(at + 0.1);
    };
    const tone = (at: number, f: number, d: number, gain: number) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + d + 0.05);
    };
    if (kind === 'move') knock(t0, 1700, 1);
    else if (kind === 'capture') {
      knock(t0, 1300, 1.3);
      knock(t0 + 0.045, 2100, 0.7);
    } else if (kind === 'check') {
      knock(t0, 1700, 1);
      tone(t0 + 0.04, N.E6, 0.18, 0.25);
    } else {
      tone(t0, N.A5, 0.25, 0.3);
      tone(t0 + 0.14, N.E5, 0.4, 0.3);
    }
    setTimeout(() => master.disconnect(), 800);
    clearTimeout(idle);
    idle = setTimeout(() => ctx?.state === 'running' && ctx.suspend().catch(() => {}), 2800);
  } catch {
    /* audio not available */
  }
}
