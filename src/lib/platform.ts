// Abstraction over the two shells: Tauri (Windows) and Electron (Linux).
// The rest of the frontend only uses these functions.

export type UpdateInfo = { version: string; install: () => Promise<void> };
export type ScreenSource = { id: string; name: string; thumb: string };
export type VoiceShortcut = 'mute' | 'deafen';

type ElectronBridge = {
  version: string;
  openExternal(url: string): Promise<void>;
  checkUpdate(): Promise<{ version: string } | null>;
  installUpdate(): Promise<void>;
  onPickSource(cb: (sources: ScreenSource[]) => void): void;
  pickSource(id: string | null): void;
  setBackground?(background: boolean): void;
  onWindowHidden?(cb: (hidden: boolean) => void): void;
  onVoiceShortcut?(cb: (action: VoiceShortcut) => void): void;
  setKeepRunning?(on: boolean, labels: TrayLabels): void;
  getAutostart?(): Promise<boolean>;
  setAutostart?(on: boolean): Promise<boolean>;
};

/** Tray menu texts, in the interface language. */
export type TrayLabels = { open: string; quit: string };

const electron = (globalThis as { cerchio?: ElectronBridge }).cerchio;
export const isElectron = !!electron;
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function openExternal(url: string) {
  if (electron) return electron.openExternal(url);
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    return openUrl(url);
  }
  window.open(url, '_blank');
}

export async function appVersion(): Promise<string> {
  if (electron) return electron.version;
  if (isTauri) {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  }
  return 'dev';
}

export async function checkUpdate(): Promise<UpdateInfo | null> {
  try {
    if (electron) {
      const u = await electron.checkUpdate();
      return u ? { version: u.version, install: () => electron.installUpdate() } : null;
    }
    if (isTauri) {
      const { check } = await import('@tauri-apps/plugin-updater');
      const u = await check();
      if (!u) return null;
      return {
        version: u.version,
        install: async () => {
          await u.downloadAndInstall();
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        },
      };
    }
  } catch {
    /* offline or updater not configured */
  }
  return null;
}

let notifGranted: boolean | null = null;
export async function showNotification(title: string, body: string) {
  try {
    if (isTauri) {
      const n = await import('@tauri-apps/plugin-notification');
      if (notifGranted === null) {
        notifGranted = await n.isPermissionGranted();
        if (!notifGranted) notifGranted = (await n.requestPermission()) === 'granted';
      }
      if (notifGranted) n.sendNotification({ title, body });
      return;
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(title, { body, silent: false });
  } catch {
    /* ignore */
  }
}

/** Electron: the main process asks which screen/window to share. */
export function onPickScreenSource(cb: (sources: ScreenSource[]) => void) {
  electron?.onPickSource(cb);
}
export function pickScreenSource(id: string | null) {
  electron?.pickSource(id);
}

/**
 * Hidden window with no call: less memory (Windows/WebView2) and less CPU
 * (Electron: background timer throttling). Undone as soon as you come back.
 */
export async function setBackgroundMode(background: boolean) {
  try {
    if (electron) return electron.setBackground?.(background);
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_background_mode', { background });
    }
  } catch {
    /* not supported: no problem */
  }
}

// ---- Hidden/minimized window ------------------------------------------------
// In Electron, with backgroundThrottling disabled (calls need it),
// document.hidden stays false even when minimized: the real state comes from
// the main process. Elsewhere the Page Visibility API is enough.
let winHidden = false;
const hiddenListeners = new Set<(hidden: boolean) => void>();

/** true if the window is minimized or hidden (nobody sees the page). */
export function isHidden(): boolean {
  return winHidden || (typeof document !== 'undefined' && document.hidden);
}

function emitHidden() {
  const h = isHidden();
  for (const cb of hiddenListeners) cb(h);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', emitHidden);
  electron?.onWindowHidden?.((h) => {
    winHidden = h;
    emitHidden();
  });
}

/** Notifies when the window gets hidden or visible again. Returns the function to stop listening. */
export function onHiddenChange(cb: (hidden: boolean) => void): () => void {
  hiddenListeners.add(cb);
  return () => {
    hiddenListeners.delete(cb);
  };
}

// ---- Global voice shortcuts (Electron) ---------------------------------------
const shortcutListeners = new Set<(action: VoiceShortcut) => void>();
let shortcutBound = false;

/** Notifies when a global mute/deafen shortcut is pressed. Returns the function to stop listening. */
export function onVoiceShortcut(cb: (action: VoiceShortcut) => void): () => void {
  if (!shortcutBound && electron?.onVoiceShortcut) {
    shortcutBound = true;
    electron.onVoiceShortcut((action) => {
      if (action !== 'mute' && action !== 'deafen') return;
      for (const fn of shortcutListeners) fn(action);
    });
  }
  shortcutListeners.add(cb);
  return () => {
    shortcutListeners.delete(cb);
  };
}

// ---- Desktop app: keep running in the background, start with the PC ------------
// Both off by default. They belong to this PC, not to the account: they live in
// localStorage (keep running) and in the system (start with the PC), never on the server.
const KEEP_KEY = 'feder-keep-running';

/** The installed app (Windows or Linux), not the browser. */
export const isDesktop = isTauri || isElectron;

export function keepRunning(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Closing the window leaves Feder running next to the clock (tray), for notifications and calls.
 * Also called at startup: the app passes the choice to the shell. If Feder started with the PC
 * (hidden) and this is off, the shell shows the window.
 */
export async function setKeepRunning(on: boolean, labels: TrayLabels) {
  try {
    localStorage.setItem(KEEP_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  try {
    if (electron) return electron.setKeepRunning?.(on, labels);
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_keep_running', { on, open: labels.open, quit: labels.quit });
    }
  } catch {
    /* older shell: closing quits, as before */
  }
}

/** Feder starts by itself when you log in to the PC. */
export async function getAutostart(): Promise<boolean> {
  try {
    if (electron) return (await electron.getAutostart?.()) ?? false;
    if (isTauri) {
      const { isEnabled } = await import('@tauri-apps/plugin-autostart');
      return await isEnabled();
    }
  } catch {
    /* not supported */
  }
  return false;
}

/** Returns the state actually set in the system. */
export async function setAutostart(on: boolean): Promise<boolean> {
  try {
    if (electron) return (await electron.setAutostart?.(on)) ?? false;
    if (isTauri) {
      const a = await import('@tauri-apps/plugin-autostart');
      if (on) await a.enable();
      else await a.disable();
      return await a.isEnabled();
    }
  } catch {
    /* not supported */
  }
  return getAutostart();
}
