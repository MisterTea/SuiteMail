import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

let updateDownloaded = false;
let latestUpdate = null;

function isPackagedApp() {
  if (process.env.NODE_ENV === 'development') return false;
  return Boolean(app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app.asar')));
}

export function setupUpdater(mainWindow) {
  // Only auto-download in production packaged builds
  if (!isPackagedApp()) {
    autoUpdater.autoDownload = false;
  } else {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  autoUpdater.on('update-available', (info) => {
    latestUpdate = {
      version: info.version,
      body: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
          : null,
    };
    mainWindow?.webContents.send('supermail:update-available', latestUpdate);
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    latestUpdate = {
      version: info.version,
      body: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
          : null,
    };
    mainWindow?.webContents.send('supermail:update-downloaded', latestUpdate);
  });

  autoUpdater.on('error', (err) => {
    console.warn('[Updater] Error during update check:', err?.message || err);
  });
}

export async function checkForUpdates() {
  if (!isPackagedApp()) {
    return null;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable && result.updateInfo) {
      const info = result.updateInfo;
      latestUpdate = {
        version: info.version,
        body: typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
            : null,
      };
      return latestUpdate;
    }
    return null;
  } catch (err) {
    console.warn('[Updater] Failed to check for updates:', err?.message || err);
    throw err;
  }
}

export async function installUpdate() {
  if (!isPackagedApp()) {
    console.log('[Updater] App is not packaged; skipping installUpdate.');
    return;
  }
  if (updateDownloaded) {
    autoUpdater.quitAndInstall();
  } else {
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall();
  }
}
