// Paper — contenitore Electron (Linux; utile anche per sviluppare su Windows).
// Su Linux la webview di sistema (WebKitGTK) spesso non ha WebRTC: Electron
// porta con sé Chromium, così voce, video e condivisione schermo funzionano sempre.
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.CERCHIO_DEV_URL; // es. http://localhost:1420 con `npm run electron:dev`
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "media-src 'self' blob: mediastream: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
].join('; ');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// Cattura schermo via PipeWire (Wayland: GNOME/KDE su Fedora) e Wayland nativo quando disponibile.
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,WaylandWindowDecorations');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// I dati (login, impostazioni) restano nella cartella di quando l'app si chiamava
// "Cerchio": così cambiare nome non fa perdere la sessione a nessuno.
app.setPath('userData', path.join(app.getPath('appData'), 'Cerchio'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 820,
    minHeight: 520,
    title: 'Paper',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#ffffff',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false, // la chiamata non deve rallentare con la finestra in background
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win?.show());

  // Link esterni → browser di sistema; nessuna navigazione fuori dall'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('app://') || (DEV_URL && url.startsWith(DEV_URL))) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  // F12 o Ctrl+Shift+I: strumenti per sviluppatori (utili per diagnosticare problemi).
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win?.webContents.toggleDevTools();
    }
  });

  win.loadURL(DEV_URL || 'app://cerchio/index.html');
  win.on('closed', () => (win = null));
}

function askScreenSource(sources) {
  return new Promise((resolve) => {
    if (!win) return resolve(null);
    ipcMain.once('screen:picked', (_e, id) => resolve(id));
    win.webContents.send(
      'screen:pick',
      sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() })),
    );
  });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  // File dell'app serviti da app://cerchio/ con CSP.
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    const type = MIME[path.extname(file)];
    if (type) headers.set('Content-Type', type);
    return new Response(res.body, { status: res.status, headers });
  });

  const ses = session.defaultSession;
  const allowed = new Set(['media', 'notifications', 'display-capture', 'fullscreen', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // getDisplayMedia: su Wayland compare il selettore di sistema (portale);
  // su X11 mostriamo il nostro selettore con le anteprime.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    let answered = false;
    const reply = (streams) => {
      if (answered) return;
      answered = true;
      callback(streams);
    };
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
      });
      if (!sources.length) return reply(null);
      if (sources.length === 1) return reply({ video: sources[0] });
      const id = await askScreenSource(sources);
      const chosen = sources.find((s) => s.id === id);
      reply(chosen ? { video: chosen } : null);
    } catch (e) {
      console.error('screen share', e);
      reply(null);
    }
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());

// ---- IPC -------------------------------------------------------------------
ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()));

// In background e senza chiamata i timer della pagina vengono rallentati (meno CPU).
ipcMain.on('background', (_e, background) => {
  win?.webContents.setBackgroundThrottling(!!background);
});

ipcMain.handle('open', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url);
});

// ---- Aggiornamenti (GitHub Releases, file latest-linux.yml) ------------------
let updater = null;
function getUpdater() {
  if (updater || !app.isPackaged) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
  } catch (e) {
    console.error('electron-updater', e);
  }
  return updater;
}

ipcMain.handle('update:check', async () => {
  const u = getUpdater();
  if (!u) return null;
  try {
    const r = await u.checkForUpdates();
    if (!r) return null;
    const available = r.isUpdateAvailable ?? r.updateInfo.version !== app.getVersion();
    return available ? { version: r.updateInfo.version } : null;
  } catch {
    return null;
  }
});

ipcMain.handle('update:install', async () => {
  const u = getUpdater();
  if (!u) return;
  await u.downloadUpdate();
  u.quitAndInstall(false, true);
});
