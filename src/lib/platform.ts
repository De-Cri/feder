// Astrazione sopra i due contenitori: Tauri (Windows) ed Electron (Linux).
// Il resto del frontend usa solo queste funzioni.

export type UpdateInfo = { version: string; install: () => Promise<void> };
export type ScreenSource = { id: string; name: string; thumb: string };

type ElectronBridge = {
  version: string;
  openExternal(url: string): Promise<void>;
  checkUpdate(): Promise<{ version: string } | null>;
  installUpdate(): Promise<void>;
  onPickSource(cb: (sources: ScreenSource[]) => void): void;
  pickSource(id: string | null): void;
  setBackground?(background: boolean): void;
  onWindowHidden?(cb: (hidden: boolean) => void): void;
};

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
    /* offline o updater non configurato */
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
    /* ignora */
  }
}

/** Electron: il processo principale chiede quale schermo/finestra condividere. */
export function onPickScreenSource(cb: (sources: ScreenSource[]) => void) {
  electron?.onPickSource(cb);
}
export function pickScreenSource(id: string | null) {
  electron?.pickSource(id);
}

/**
 * Finestra nascosta senza chiamata: meno memoria (Windows/WebView2) e meno CPU
 * (Electron: timer rallentati in background). Si annulla appena torni.
 */
export async function setBackgroundMode(background: boolean) {
  try {
    if (electron) return electron.setBackground?.(background);
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_background_mode', { background });
    }
  } catch {
    /* non supportato: nessun problema */
  }
}

// ---- Finestra nascosta/minimizzata ------------------------------------------
// In Electron, con backgroundThrottling disattivato (serve alla chiamata),
// document.hidden resta sempre false anche a finestra minimizzata: lo stato vero
// arriva dal processo principale. Altrove basta la Page Visibility API.
let winHidden = false;
const hiddenListeners = new Set<(hidden: boolean) => void>();

/** true se la finestra è minimizzata o nascosta (nessuno vede la pagina). */
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

/** Avvisa quando la finestra viene nascosta o torna visibile. Restituisce la funzione per smettere. */
export function onHiddenChange(cb: (hidden: boolean) => void): () => void {
  hiddenListeners.add(cb);
  return () => {
    hiddenListeners.delete(cb);
  };
}
