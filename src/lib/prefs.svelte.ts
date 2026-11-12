// User preferences.
// - localStorage: immediate copy, so the app starts even without network.
// - Supabase (user_prefs table): the same settings in the desktop app and in the browser.
// Microphone, webcam and audio output stay on this device only: their IDs differ between app and browser.
import { supabase } from './supabase';
import { configured } from './config';
import type { NoiseMode } from './audio';
import type { SoundKind } from './sounds';

export type Theme = 'system' | 'light' | 'dark' | 'black' | 'oled';

export type Prefs = {
  theme: Theme;
  notifications: boolean;
  // this device only
  micId: string;
  camId: string;
  speakerId: string;
  // synced between app and browser
  noiseMode: NoiseMode;
  echoCancellation: boolean;
  autoGain: boolean;
  inputGain: number; // 0..2 (100% = 1)
  gateEnabled: boolean;
  gateDb: number; // activation threshold, -80..-10
  outputVolume: number; // 0..1
  userVolumes: Record<string, number>; // 0..2 per user (voice)
  screenVolumes: Record<string, number>; // 0..1 per user (screen share audio)
  screenHeight: number; // 720 or 1080
  screenFps: number; // 30 or 60
  screenMode: 'motion' | 'detail';
  screenAudio: boolean;
  sounds: Record<SoundKind, boolean>;
  soundVolume: number; // 0..1
};

const DEVICE_KEYS = ['micId', 'camId', 'speakerId'] as const;
const THEMES: Theme[] = ['system', 'light', 'dark', 'black', 'oled'];
const LOCAL_KEY = 'cerchio-prefs';
const CHANGED_KEY = 'cerchio-prefs-changed';
const OLD_THEME_KEY = 'paper.theme';

const defaults: Prefs = {
  theme: 'system',
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
  sounds: { selfJoin: true, selfLeave: true, join: true, leave: true, call: true, message: true, mute: true, unmute: true, poke: true },
  soundVolume: 0.6,
};

/** Only 720p30, 720p60 or 1080p30: maps old or invalid values to the closest combination. */
export function clampScreen(height: number, fps: number): { height: number; fps: number } {
  if (height >= 1080 || height === 0) return { height: 1080, fps: 30 };
  return { height: 720, fps: fps >= 45 ? 60 : 30 };
}

// Fixes and completes a preferences object (old formats, missing values).
function normalize(raw: any): Prefs {
  if (raw.noiseSuppression === false && !raw.noiseMode) raw.noiseMode = 'off';

  // old quality presets → free values
  if (raw.screenQuality && raw.screenHeight === undefined) {
    const map: Record<string, [number, number, 'motion' | 'detail']> = {
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

  if (raw.theme === 'black-blue') raw.theme = 'black'; // "Nero blu" removed: same palette as "Nero"
  if (!THEMES.includes(raw.theme)) raw.theme = 'system';

  return { ...defaults, ...raw, sounds: { ...defaults.sounds, ...(raw.sounds ?? {}) } };
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
    // the theme was stored separately in an older version
    if (raw.theme === undefined) raw.theme = localStorage.getItem(OLD_THEME_KEY) ?? 'system';
    return normalize(raw);
  } catch {
    return normalize({});
  }
}

export const prefs = $state<Prefs>(load());

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
export function getTheme(): Theme {
  return prefs.theme;
}

export function applyTheme(t: Theme = prefs.theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
}

export function setTheme(t: Theme) {
  prefs.theme = t;
  savePrefs();
}

// ---------------------------------------------------------------------------
// Local and remote saving
// ---------------------------------------------------------------------------
function persistLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify($state.snapshot(prefs)));
  } catch {
    /* storage full or unavailable */
  }
}

// Time of the last change made on this device (to decide which side wins).
function changedAt(): number {
  try {
    return Number(localStorage.getItem(CHANGED_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markChanged(ts: number) {
  try {
    localStorage.setItem(CHANGED_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

// Only the preferences that apply everywhere (without devices).
function syncedPrefs(): Record<string, unknown> {
  const out: Record<string, unknown> = { ...$state.snapshot(prefs) };
  for (const k of DEVICE_KEYS) delete out[k];
  return out;
}

let userId: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastPull = 0;

async function pushNow() {
  const uid = userId;
  if (!uid || !configured) return;
  const { error } = await supabase.from('user_prefs').upsert(
    {
      user_id: uid,
      data: syncedPrefs(),
      updated_at: new Date(changedAt() || Date.now()).toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) console.warn('[prefs] salvataggio remoto non riuscito:', error.message);
}

function schedulePush() {
  if (!userId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    pushNow();
  }, 1000);
}

function flushPush() {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = undefined;
  pushNow();
}

// Applies the preferences from the server, keeping this machine's devices.
function applyRemote(remote: Record<string, unknown>) {
  const local = { micId: prefs.micId, camId: prefs.camId, speakerId: prefs.speakerId };
  Object.assign(prefs, normalize({ ...remote, ...local }));
  persistLocal();
  applyTheme();
}

/** Compares with the server: the most recent change wins. */
export async function syncPrefs() {
  const uid = userId;
  if (!uid || !configured) return;
  lastPull = Date.now();
  const { data, error } = await supabase
    .from('user_prefs')
    .select('data, updated_at')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) return;

  const local = changedAt();
  if (!data) {
    // first login: the server has nothing yet, upload the local ones
    pushNow();
    return;
  }
  const remote = Date.parse(data.updated_at);
  if (remote > local) {
    applyRemote((data.data ?? {}) as Record<string, unknown>);
    markChanged(remote);
  } else if (local > remote) {
    pushNow();
  }
}

/** Saves preferences: locally right away, on the server shortly after. */
export function savePrefs() {
  markChanged(Date.now());
  persistLocal();
  applyTheme();
  schedulePush();
}

// Login/logout and coming back to the window.
if (configured && typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user.id ?? null;
    if (uid === userId) return;
    // a pending change must be saved before switching user
    flushPush();
    userId = uid;
    // outside the callback to avoid supabase-js internal deadlocks
    if (uid) setTimeout(() => syncPrefs(), 0);
  });

  window.addEventListener('focus', () => {
    if (Date.now() - lastPull > 15_000) syncPrefs();
  });
}

// ---------------------------------------------------------------------------
// Helpers used by the audio code
// ---------------------------------------------------------------------------
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