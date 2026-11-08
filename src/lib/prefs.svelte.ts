// Preferenze locali (per utente e per PC). localStorage è sufficiente qui.
import type { NoiseMode } from './audio';

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
  userVolumes: Record<string, number>; // 0..1 per utente
  screenQuality: 'smooth' | 'sharp';
  screenAudio: boolean;
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
  screenQuality: 'smooth',
  screenAudio: true,
};

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (raw.noiseSuppression === false && !raw.noiseMode) raw.noiseMode = 'off';
    delete raw.noiseSuppression;
    return { ...defaults, ...raw };
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

export function userVolume(id: string): number {
  return prefs.userVolumes[id] ?? 1;
}
