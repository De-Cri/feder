// Preferenze locali (per utente e per PC). localStorage è sufficiente qui.
import type { NoiseMode } from './audio';
import type { SoundKind } from './sounds';

export type Prefs = {
  notifications: boolean;
  micId: string;
  camId: string;
  speakerId: string;
  noiseMode: NoiseMode;
  echoCancellation: boolean;
  autoGain: boolean;
  inputGain: number; // 0..2 (100% = 1)
  gateEnabled: boolean;
  gateDb: number; // soglia di attivazione, -80..-10
  outputVolume: number; // 0..1
  userVolumes: Record<string, number>; // 0..2 per utente (voce)
  screenVolumes: Record<string, number>; // 0..1 per utente (audio della sua condivisione schermo)
  screenHeight: number;
  screenFps: number;
  screenMode: 'motion' | 'detail'; // movimento (giochi, video) o dettaglio (testo, codice)
  screenAudio: boolean;
  sounds: Record<SoundKind, boolean>;
  soundVolume: number; // 0..1
};

const KEY = 'cerchio-prefs';
const defaults: Prefs = {
  notifications: true,
  micId: '',
  camId: '',
  speakerId: '',
  noiseMode: 'ai',
  echoCancellation: true,
  autoGain: true,
  inputGain: 1,
  gateEnabled: false,
  gateDb: -50,
  outputVolume: 1,
  userVolumes: {},
  screenVolumes: {},
  screenHeight: 720,
  screenFps: 30,
  screenMode: 'motion',
  screenAudio: true,
  sounds: { selfJoin: true, selfLeave: true, join: true, leave: true, call: true, message: true, mute: true, unmute: true },
  soundVolume: 0.6,
};

/** Solo 720p30, 720p60 o 1080p30: riporta valori vecchi o non validi alla combinazione più vicina. */
export function clampScreen(height: number, fps: number): { height: number; fps: number } {
  if (height >= 1080 || height === 0) return { height: 1080, fps: 30 };
  return { height: 720, fps: fps >= 45 ? 60 : 30 };
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (raw.noiseSuppression === false && !raw.noiseMode) raw.noiseMode = 'off';
    // vecchi preset → valori liberi
    if (raw.screenQuality && raw.screenHeight === undefined) {
      const map: Record<string, [number, number, string]> = {
        smooth: [720, 30, 'motion'],
        gaming: [720, 60, 'motion'],
        sharp: [1080, 30, 'detail'],
      };
      const m = map[raw.screenQuality] ?? map.smooth;
      [raw.screenHeight, raw.screenFps, raw.screenMode] = m;
    }
    delete raw.screenQuality;
    if (raw.screenHeight !== undefined) {
      ({ height: raw.screenHeight, fps: raw.screenFps } = clampScreen(raw.screenHeight, raw.screenFps ?? 30));
    }
    delete raw.noiseSuppression;
    return { ...defaults, ...raw, sounds: { ...defaults.sounds, ...(raw.sounds ?? {}) } };
  } catch {
    return { ...defaults };
  }
}

export const prefs = $state<Prefs>(load());

export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function micOptions() {
  return {
    deviceId: prefs.micId,
    noise: prefs.noiseMode,
    echoCancellation: prefs.echoCancellation,
    autoGain: prefs.autoGain,
    gain: prefs.inputGain,
    gateDb: prefs.gateEnabled ? prefs.gateDb : null,
  };
}

export function screenVolume(id: string): number {
  return prefs.screenVolumes[id] ?? 1;
}

export function userVolume(id: string): number {
  return prefs.userVolumes[id] ?? 1;
}
