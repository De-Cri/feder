// Screen sharing quality: resolution and fps, with a load estimate and
// warnings when it's too much.
import { prefs, clampScreen } from './prefs.svelte';

/** The only allowed combinations: beyond these, PC and network can't keep up in a group call. */
export const SCREEN_OPTIONS = [
  { height: 720, fps: 30, label: '720p · 30 fps' },
  { height: 720, fps: 60, label: '720p · 60 fps' },
  { height: 1080, fps: 30, label: '1080p · 30 fps' },
] as const;

export type ScreenSettings = {
  height: number;
  fps: number;
  bitrate: number; // bps per viewer
  hint: 'motion' | 'detail';
  degradation: RTCDegradationPreference;
};

/** Pixels for a 16:9 resolution. */
const pixels = (h: number) => Math.round((h * 16) / 9) * h;

export function screenSettings(): ScreenSettings {
  const { height, fps } = clampScreen(prefs.screenHeight, prefs.screenFps);
  const motion = prefs.screenMode === 'motion';
  // ~0.08 bits per pixel per frame for motion, less for text (changes little)
  const bpp = motion ? 0.08 : 0.05;
  const bitrate = Math.min(20_000_000, Math.max(800_000, pixels(height) * fps * bpp));
  return {
    height,
    fps,
    bitrate,
    hint: motion ? 'motion' : 'detail',
    degradation: motion ? 'maintain-framerate' : 'maintain-resolution',
  };
}

export type ScreenWarning = { level: 'ok' | 'warn' | 'danger'; text: string };

/** Warning based on load: pixels per second and upload per viewer. */
export function screenWarning(viewers = 4): ScreenWarning {
  const s = screenSettings();
  const load = pixels(s.height) * s.fps; // pixels per second to encode (for each viewer)
  const base = 1280 * 720 * 30;
  const mbps = s.bitrate / 1_000_000;
  const total = (mbps * viewers).toFixed(0);
  const upload = `circa ${mbps.toFixed(1)} Mbps in upload per ogni spettatore (${total} Mbps con ${viewers})`;
  if (load <= base * 1.05) return { level: 'ok', text: `Leggera: va bene quasi ovunque. Serve ${upload}.` };
  if (load <= base * 2.3)
    return {
      level: 'warn',
      text: `Impegnativa: serve un PC discreto e ${upload}. Se a chi guarda scatta, abbassa fps o risoluzione.`,
    };
  return {
    level: 'danger',
    text: `Molto pesante: il tuo PC codifica una copia per ogni spettatore e serve ${upload}. Con connessioni normali o PC poco potenti la stream scatterà.`,
  };
}
