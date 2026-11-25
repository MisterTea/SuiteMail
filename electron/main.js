import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, globalShortcut } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSupermailCore } from './loadAddon.js';
import { showStartupError } from './startupError.js';
import { setupUpdater, checkForUpdates, installUpdate } from './updater.js';
import { createStartupTelemetry } from './telemetry.js';
import { createRendererSecurity, isExternalUrl } from './rendererSecurity.js';
import { DESKTOP_NAME, createAutostart, createComposeShortcut, createMailtoQueue, backgroundWindow, cancelBackgrounding, queryGlobalShortcutPortal } from './desktopIntegration.js';

if (process.platform === 'linux') app.setDesktopName(DESKTOP_NAME);

// Avoid VPN / corporate proxy interception on local development ports
app.commandLine.appendSwitch('no-proxy-server');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure application name
app.name = 'SuiteMail';
if (typeof app.setName === 'function') {
  app.setName('SuiteMail');
}

const appIconPath = fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.png'))
  ? path.join(__dirname, '..', 'assets', 'icon.png')
  : path.join(__dirname, 'icons', 'icon.png');

let rustCore = null;
let mainWindow = null;
let splashWindow = null;
let tray = null;
let isQuitting = false;
const STARTUP_TIMEOUT_MS = 30000;
let startupTimer = null;
let startupReady = false;
let startupErrorShown = false;
let startupErrorAbort = null;
const startupMarker = path.join(app.getPath('userData'), '.startup-ready');
const firstStartup = !fs.existsSync(startupMarker);
let startHidden = process.argv.includes('--hidden');
let pendingCompose = false;
let shortcutPortalSupport;
const appFile = path.join(__dirname, '..', 'dist', 'index.html');
const preload = path.join(__dirname, 'preload.cjs');
const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:1420';
const rendererSecurity = createRendererSecurity({
  ipcMain,
  preload,
  appUrl: isDevMode() ? devUrl : pathToFileURL(appFile).href,
  openExternal: (url) => shell.openExternal(url),
});
const telemetry = createStartupTelemetry({
  userData: app.getPath('userData'),
  version: app.getVersion(),
  platform: process.platform,
  packaged: app.isPackaged && !isDevMode(),
});
const autostart = createAutostart(app);
function showMainWindow() {
  startHidden = false;
  if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
  cancelBackgrounding(mainWindow);
  if (mainWindow.isMinimized()) mainWindow.restore();
  // show() already activates a hidden window. On Wayland, avoid issuing a
  // second activation request that can consume/replace a one-use desktop token.
  if (mainWindow.isVisible()) mainWindow.focus();
  else mainWindow.show();
}
const mailtoQueue = createMailtoQueue(process.argv, (url) => {
  showMainWindow();
  mainWindow?.webContents.send('supermail:open-url', url);
});
const composeShortcut = createComposeShortcut(globalShortcut, () => {
  showMainWindow();
  if (startupReady) mainWindow?.webContents.send('supermail:compose');
  else pendingCompose = true;
});

function armStartupTimer() {
  clearTimeout(startupTimer);
  startupTimer = setTimeout(() => {
    reportStartupError('Startup has taken more than thirty seconds. The mail window has not become ready.');
  }, STARTUP_TIMEOUT_MS);
}

function reportStartupError(detail) {
  if (startupReady || startupErrorShown || isQuitting) return;
  startupErrorShown = true;
  clearTimeout(startupTimer);
  void telemetry.record('failed');
  console.error("[Startup]", detail);
  const abortController = new AbortController();
  startupErrorAbort = abortController;
  showStartupError({
    app, dialog, window: mainWindow,
    getParent: () => splashWindow || mainWindow,
    detail,
    signal: abortController.signal,
  }).then((action) => {
    if (startupErrorAbort === abortController) startupErrorAbort = null;
    startupErrorShown = false;
    if (action === 'dismissed' || startupReady || isQuitting) return;
    if (action === 'wait') {
      armStartupTimer();
      return;
    }
    if (action === 'restart') app.relaunch();
    isQuitting = true;
    app.quit();
  }).catch((err) => {
    if (startupErrorAbort === abortController) startupErrorAbort = null;
    startupErrorShown = false;
    console.error("[Startup] Could not show error:", err);
  });
}

// 1. Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  isQuitting = true;
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const hasMailto = argv.some(arg => typeof arg === 'string' && /^mailto:/i.test(arg));
    mailtoQueue.push(argv);
    if (!hasMailto) showMainWindow();
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  mailtoQueue.push([url]);
});
app.on('activate', showMainWindow);

function isDevMode() {
  if (process.env.NODE_ENV === 'development') return true;
  if (process.env.NODE_ENV === 'production') return false;
  return Boolean(process.defaultApp || !fs.existsSync(path.join(process.resourcesPath, 'app.asar')));
}

function resolveFsPath(targetPath) {
  if (path.isAbsolute(targetPath)) return targetPath;
  return path.join(app.getPath('userData'), targetPath);
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  } else {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('SuiteMail');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show SuiteMail',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: 'Check for Mail',
      click: () => {
        mainWindow?.webContents.send('tray-check-mail');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    title: 'SuiteMail',
    icon: appIconPath,
    width: 400,
    height: 300,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const splashFile = path.join(__dirname, '..', 'splashscreen.html');
  if (fs.existsSync(splashFile)) {
    splashWindow.loadFile(splashFile);
  }
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'SuiteMail',
    icon: appIconPath,
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // frameless window for SuiteMail custom TitleBar
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  rendererSecurity.protect(mainWindow.webContents);

  // Keep syncing in the background; Linux stays reachable without a tray.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      backgroundWindow(mainWindow, process.platform, Boolean(tray));
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && !input.alt && !input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      app.quit();
    }
  });

  const isDev = isDevMode();

  // Start the watchdog before navigation: a failed page never finishes loading.
  armStartupTimer();

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      reportStartupError(`The mail window could not load (${errorCode}: ${errorDescription}).`);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    reportStartupError(`The mail window stopped unexpectedly (${details.reason}).`);
  });
  mainWindow.webContents.on('preload-error', (_event, _preloadPath, error) => {
    reportStartupError(`SuiteMail could not load its desktop connection: ${error.message}`);
  });

  mainWindow.webContents.on('console-message', (event, ...args) => {
    const msg = typeof event === 'object' && event?.message !== undefined
      ? event.message
      : args[1] !== undefined
        ? args[1]
        : event;
    console.log('[Renderer]', msg);
  });

  if (isDev) {
    // Probe dev server readiness before loadURL to prevent Chromium socket hang
    let devServerReady = false;
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        devServerReady = await new Promise((resolve) => {
          const req = http.get(devUrl, (res) => {
            resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
          });
          req.on('error', () => resolve(false));
          req.setTimeout(800, () => {
            req.destroy();
            resolve(false);
          });
        });
      } catch {
        devServerReady = false;
      }

      if (devServerReady) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    try {
      await mainWindow.loadURL(devUrl);
    } catch (err) {
      reportStartupError(`The development server could not be loaded: ${err.message}`);
    }
  } else {
    mainWindow.loadFile(appFile)
      .catch((err) => reportStartupError(`The installed mail window could not be loaded: ${err.message}`));
  }
}

function openThreadWindow(threadId, accountId) {
  const isDev = isDevMode();
  const threadWin = new BrowserWindow({
    title: 'SuiteMail',
    icon: appIconPath,
    width: 800,
    height: 700,
    frame: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  rendererSecurity.protect(threadWin.webContents);

  const params = `?thread=${encodeURIComponent(threadId)}&account=${encodeURIComponent(accountId)}`;
  if (isDev) {
    threadWin.loadURL(new URL(params, devUrl).href);
  } else {
    threadWin.loadFile(appFile, {
      query: { thread: threadId, account: accountId },
    });
  }
}

app.whenReady().then(() => {
  // ESM imports can finish after Electron becomes ready. A losing second
  // instance must not create windows in an already-resolved ready callback.
  if (!gotTheLock || isQuitting) return;
  // 0. Set macOS dock icon
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = nativeImage.createFromPath(appIconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    }
  }

  // 1. Load Rust addon and initialize SQLite database in Rust
  try {
    rustCore = loadSupermailCore();
    const dbPath = path.join(app.getPath('userData'), 'suitemail.db');
    rustCore.initDatabase(dbPath);
    console.log(`[Main] SuperMail Rust core and SQLite DB initialized at ${dbPath}`);
  } catch (err) {
    console.error('[Main] Failed to initialize SuperMail Rust core:', err);
  }

  // 2. Setup System Tray
  try { createTray(); } catch (error) { console.warn('[Tray] Unavailable:', error); }

  // 3. Open splash and main windows
  if (!startHidden || mailtoQueue.hasPending()) createSplashWindow();
  createMainWindow();

  // 4. Setup electron-updater
  setupUpdater(mainWindow);

});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('before-quit', () => {
  clearTimeout(startupTimer);
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray unless explicit quit
  }
});

// ---------- IPC Handlers ----------

// Database queries forwarded directly into Rust
rendererSecurity.handle('db:select', async (_event, query, bindValues = []) => {
  if (!rustCore) throw new Error('Rust core not loaded');
  const res = rustCore.dbSelect(query, JSON.stringify(bindValues ?? []));
  return JSON.parse(res);
});

rendererSecurity.handle('db:execute', async (_event, query, bindValues = []) => {
  if (!rustCore) throw new Error('Rust core not loaded');
  const res = rustCore.dbExecute(query, JSON.stringify(bindValues ?? []));
  return JSON.parse(res);
});

// Rust command dispatcher
rendererSecurity.handle('supermail:invoke', async (_event, cmd, args = {}) => {
  if (cmd === 'close_splashscreen') {
    if (_event.sender !== mainWindow?.webContents) return undefined;
    const showTelemetryPrompt = !startupReady && args.hasConfiguredAccounts === true && telemetry.shouldPrompt;
    startupReady = true;
    clearTimeout(startupTimer);
    if (startupErrorAbort) {
      startupErrorAbort.abort();
      startupErrorAbort = null;
    }
    startupErrorShown = false;
    void telemetry.record('ready');
    if (firstStartup) {
      try { fs.writeFileSync(startupMarker, 'ready\n', { mode: 0o600 }); }
      catch (error) { console.warn('[Startup] Could not save startup state:', error.message); }
    }
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    if (startHidden && !mailtoQueue.hasPending() && !pendingCompose) backgroundWindow(mainWindow, process.platform, Boolean(tray));
    else if (!mailtoQueue.hasPending()) showMainWindow();
    mailtoQueue.ready();
    if (pendingCompose) {
      pendingCompose = false;
      mainWindow?.webContents.send('supermail:compose');
    }
    return showTelemetryPrompt;
  }

  if (cmd === 'get_autostart') return autostart.get();
  if (cmd === 'set_autostart') {
    if (typeof args.enabled !== 'boolean') throw new Error('Expected an enabled boolean');
    return autostart.set(args.enabled);
  }
  if (cmd === 'register_compose_shortcut') {
    const ozone = app.commandLine.getSwitchValue('ozone-platform');
    if (process.platform === 'linux' && ozone !== 'x11' && (ozone === 'wayland' || process.env.WAYLAND_DISPLAY)) {
      shortcutPortalSupport ??= queryGlobalShortcutPortal();
      if (await shortcutPortalSupport === false) {
        throw new Error('This desktop does not provide global shortcuts on Wayland. Use GNOME 48 or newer, a compatible KDE desktop, or launch SuiteMail with --ozone-platform=x11.');
      }
    }
    return composeShortcut.register(args.shortcut);
  }
  if (cmd === 'unregister_compose_shortcut') return composeShortcut.unregister();
  if (cmd === 'get_app_version') return app.getVersion();
  if (cmd === 'get_startup_telemetry') return telemetry.enabled;
  if (cmd === 'set_startup_telemetry') return telemetry.setEnabled(args.enabled);
  if (cmd === 'show_main_window') return showMainWindow();

  if (cmd === 'set_tray_tooltip') {
    if (tray && args.tooltip) tray.setToolTip(args.tooltip);
    return undefined;
  }

  if (cmd === 'open_devtools') {
    mainWindow?.webContents.openDevTools();
    return undefined;
  }

  if (cmd === 'check_for_updates') {
    return await checkForUpdates();
  }

  if (cmd === 'install_update') {
    await installUpdate();
    return undefined;
  }

  if (!rustCore) throw new Error('Rust core not loaded');
  const res = await rustCore.invoke(cmd, JSON.stringify(args ?? {}));
  return JSON.parse(res);
});

// Window controls
rendererSecurity.handle('feedback:captureScreenshot', async (event) => {
  const image = await event.sender.capturePage();
  return image.toDataURL();
});

rendererSecurity.handle('window:minimize', () => mainWindow?.minimize());
rendererSecurity.handle('window:toggleMaximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
rendererSecurity.handle('window:close', () => backgroundWindow(mainWindow, process.platform, Boolean(tray)));
rendererSecurity.handle('window:openThread', (_event, threadId, accountId) => openThreadWindow(threadId, accountId));

// Filesystem operations
rendererSecurity.handle('fs:mkdir', async (_event, dir, options) => {
  const fullPath = resolveFsPath(dir);
  await fs.promises.mkdir(fullPath, { recursive: options?.recursive ?? true });
});

rendererSecurity.handle('fs:writeFile', async (_event, file, data) => {
  const fullPath = resolveFsPath(file);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, Buffer.from(data));
});

rendererSecurity.handle('fs:readFile', async (_event, file) => {
  const fullPath = resolveFsPath(file);
  const buf = await fs.promises.readFile(fullPath);
  return new Uint8Array(buf);
});

rendererSecurity.handle('fs:readTextFile', async (_event, file) => {
  const fullPath = resolveFsPath(file);
  return await fs.promises.readFile(fullPath, 'utf-8');
});

rendererSecurity.handle('fs:writeTextFile', async (_event, file, text) => {
  const fullPath = resolveFsPath(file);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, text, 'utf-8');
});

rendererSecurity.handle('fs:remove', async (_event, targetPath, options) => {
  const fullPath = resolveFsPath(targetPath);
  await fs.promises.rm(fullPath, { recursive: options?.recursive ?? true, force: true });
});

rendererSecurity.handle('fs:exists', async (_event, targetPath) => {
  const fullPath = resolveFsPath(targetPath);
  return fs.existsSync(fullPath);
});

// Dialogs & Shell
rendererSecurity.handle('dialog:save', async (_event, options) => {
  const res = await dialog.showSaveDialog(mainWindow, options);
  return res.filePath ?? null;
});

rendererSecurity.handle('dialog:open', async (_event, options) => {
  const res = await dialog.showOpenDialog(mainWindow, options);
  return res.filePaths;
});

rendererSecurity.handle('shell:openExternal', async (_event, url) => {
  if (!isExternalUrl(url)) throw new Error('Unsupported external URL');
  await shell.openExternal(url);
});
