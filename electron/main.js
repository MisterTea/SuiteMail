import { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSupermailCore } from './loadAddon.js';
import { showStartupError } from './startupError.js';
import { setupUpdater, checkForUpdates, installUpdate } from './updater.js';

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
let startupTimer = null;
let startupReady = false;
let startupErrorShown = false;

function reportStartupError(detail) {
  if (startupReady || startupErrorShown || isQuitting) return;
  startupErrorShown = true;
  clearTimeout(startupTimer);
  console.error("[Startup]", detail);
  showStartupError({
    app, dialog, window: mainWindow,
    getParent: () => splashWindow || mainWindow,
    detail,
  }).then((action) => {
    if (action === 'restart') app.relaunch();
    isQuitting = true;
    app.quit();
  }).catch((err) => console.error("[Startup] Could not show error:", err));
}

// 1. Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      // Forward deep link or launch args
      mainWindow.webContents.send('single-instance-args', argv);
      const mailtoArg = argv.find((arg) => arg.startsWith('mailto:'));
      if (mailtoArg) {
        mainWindow.webContents.send('supermail:open-url', mailtoArg);
      }
    }
  });
}

// Register mailto scheme
app.setAsDefaultProtocolClient('mailto');

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
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
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
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Minimize to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  const isDev = isDevMode();

  // Start the watchdog before navigation: a failed page never finishes loading.
  startupTimer = setTimeout(() => {
    reportStartupError('Startup has taken more than five seconds. The mail window has not become ready.');
  }, 5000);

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
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:1420';

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
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
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
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const params = `?thread=${encodeURIComponent(threadId)}&account=${encodeURIComponent(accountId)}`;
  if (isDev) {
    const devUrl = (process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:1420') + params;
    threadWin.loadURL(devUrl);
  } else {
    threadWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: { thread: threadId, account: accountId },
    });
  }
}

app.whenReady().then(() => {
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
  createTray();

  // 3. Open splash and main windows
  createSplashWindow();
  createMainWindow();

  // 4. Setup electron-updater
  setupUpdater(mainWindow);

  // Handle autostart hidden flag
  if (process.argv.includes('--hidden')) {
    mainWindow?.hide();
    splashWindow?.close();
    splashWindow = null;
  }
});

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
ipcMain.handle('db:select', async (_event, query, bindValues = []) => {
  if (!rustCore) throw new Error('Rust core not loaded');
  const res = rustCore.dbSelect(query, JSON.stringify(bindValues ?? []));
  return JSON.parse(res);
});

ipcMain.handle('db:execute', async (_event, query, bindValues = []) => {
  if (!rustCore) throw new Error('Rust core not loaded');
  const res = rustCore.dbExecute(query, JSON.stringify(bindValues ?? []));
  return JSON.parse(res);
});

// Rust command dispatcher
ipcMain.handle('supermail:invoke', async (_event, cmd, args = {}) => {
  if (cmd === 'close_splashscreen') {
    startupReady = true;
    clearTimeout(startupTimer);
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    return undefined;
  }

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
ipcMain.handle('feedback:captureScreenshot', async (event) => {
  const image = await event.sender.capturePage();
  return image.toDataURL();
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.hide());
ipcMain.handle('window:openThread', (_event, threadId, accountId) => openThreadWindow(threadId, accountId));

// Filesystem operations
ipcMain.handle('fs:mkdir', async (_event, dir, options) => {
  const fullPath = resolveFsPath(dir);
  await fs.promises.mkdir(fullPath, { recursive: options?.recursive ?? true });
});

ipcMain.handle('fs:writeFile', async (_event, file, data) => {
  const fullPath = resolveFsPath(file);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, Buffer.from(data));
});

ipcMain.handle('fs:readFile', async (_event, file) => {
  const fullPath = resolveFsPath(file);
  const buf = await fs.promises.readFile(fullPath);
  return new Uint8Array(buf);
});

ipcMain.handle('fs:readTextFile', async (_event, file) => {
  const fullPath = resolveFsPath(file);
  return await fs.promises.readFile(fullPath, 'utf-8');
});

ipcMain.handle('fs:writeTextFile', async (_event, file, text) => {
  const fullPath = resolveFsPath(file);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, text, 'utf-8');
});

ipcMain.handle('fs:remove', async (_event, targetPath, options) => {
  const fullPath = resolveFsPath(targetPath);
  await fs.promises.rm(fullPath, { recursive: options?.recursive ?? true, force: true });
});

ipcMain.handle('fs:exists', async (_event, targetPath) => {
  const fullPath = resolveFsPath(targetPath);
  return fs.existsSync(fullPath);
});

// Dialogs & Shell
ipcMain.handle('dialog:save', async (_event, options) => {
  const res = await dialog.showSaveDialog(mainWindow, options);
  return res.filePath ?? null;
});

ipcMain.handle('dialog:open', async (_event, options) => {
  const res = await dialog.showOpenDialog(mainWindow, options);
  return res.filePaths;
});

ipcMain.handle('shell:openExternal', async (_event, url) => {
  await shell.openExternal(url);
});
