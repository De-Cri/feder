// Preferenze utente.
// - localStorage: copia immediata, così l'app parte anche senza rete.
// - Supabase (tabella user_prefs): le stesse impostazioni in app desktop e nel browser.
// Microfono, webcam e uscita audio restano solo su questo dispositivo: gli ID cambiano tra app e browser.
import { supabase } from './supabase';
import { configured } from './config';
import type { NoiseMode } from './audio';
import type { SoundKind } from './sounds';

export type Theme = 'system' | 'light' | 'dark';

export type Prefs = {
  theme: Theme;
  notifications: boolean;
  // solo su questo dispositivo
  micId: string;
  camId: string;
  speakerId: string;
  // sincronizzate tra app e browser
  noiseMode: NoiseMode;
  echoCancellation: boolean;
  autoGain: boolean;
  inputGain: number; // 0..2 (100% = 1)
  gateEnabled: boolean;
  gateDb: number; // soglia di attivazione, -80..-10
  outputVolume: number; // 0..1
  userVolumes: Record<string, number>; // 0..1 per utente (voce)
  screenVolumes: Record<string, number>; // 0..1 per utente (audio della condivisione)
  screenHeight: number; // 720 o 1080
  screenFps: number; // 30 o 60
  screenMode: 'motion' | 'detail';
  screenAudio: boolean;
  sounds: Record<SoundKind, boolean>;
  soundVolume: number; // 0..1
};

const DEVICE_KEYS = ['micId', 'camId', 'speakerId'] as const;
const THEMES: Theme[] = ['system', 'light', 'dark'];
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
  sounds: { selfJoin: true, selfLeave: true, join: true, leave: true, call: true, message: true, mute: true, unmute: true },
  soundVolume: 0.6,
};

// Corregge e completa un oggetto preferenze (vecchi formati, valori mancanti).
function normalize(raw: any): Prefs {
  if (raw.noiseSuppression === false && !raw.noiseMode) raw.noiseMode = 'off';

  // vecchi preset di qualità → valori liberi
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

  // solo 720p30, 720p60 o 1080p30
  if (raw.screenHeight !== undefined) {
    const h = raw.screenHeight >= 1080 || raw.screenHeight === 0 ? 1080 : 720;
    raw.screenHeight = h;
    raw.screenFps = h === 1080 ? 30 : (raw.screenFps ?? 30) >= 45 ? 60 : 30;
  }
  delete raw.noiseSuppression;

  if (!THEMES.includes(raw.theme)) raw.theme = 'system';

  return { ...defaults, ...raw, sounds: { ...defaults.sounds, ...(raw.sounds ?? {}) } };
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}');
    // il tema era salvato a parte in una versione precedente
    if (raw.theme === undefined) raw.theme = localStorage.getItem(OLD_THEME_KEY) ?? 'system';
    return normalize(raw);
  } catch {
    return normalize({});
  }
}

export const prefs = $state<Prefs>(load());

// ---------------------------------------------------------------------------
// Tema
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
// Salvataggio locale e remoto
// ---------------------------------------------------------------------------
function persistLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify($state.snapshot(prefs)));
  } catch {
    /* storage pieno o non disponibile */
  }
}

// Momento dell'ultima modifica fatta su questo dispositivo (per decidere cosa vince).
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

// Solo le preferenze che valgono ovunque (senza i dispositivi).
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

// Applica le preferenze arrivate dal server, mantenendo i dispositivi di questa macchina.
function applyRemote(remote: Record<string, unknown>) {
  const local = { micId: prefs.micId, camId: prefs.camId, speakerId: prefs.speakerId };
  Object.assign(prefs, normalize({ ...remote, ...local }));
  persistLocal();
  applyTheme();
}

/** Confronta con il server: vince la modifica più recente. */
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
    // primo accesso: il server non ha ancora nulla, carica quelle locali
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

/** Salva le preferenze: locale subito, sul server dopo un attimo. */
export function savePrefs() {
  markChanged(Date.now());
  persistLocal();
  applyTheme();
  schedulePush();
}

// Login/logout e ritorno nella finestra.
if (configured && typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user.id ?? null;
    if (uid === userId) return;
    // se c'è una modifica in attesa, va salvata prima di cambiare utente
    flushPush();
    userId = uid;
    // fuori dal callback per evitare deadlock interni di supabase-js
    if (uid) setTimeout(() => syncPrefs(), 0);
  });

  window.addEventListener('focus', () => {
    if (Date.now() - lastPull > 15_000) syncPrefs();
  });
}

// ---------------------------------------------------------------------------
// Helper usati dall'audio
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