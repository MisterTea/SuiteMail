import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const DESKTOP_NAME = 'com.suitemail.app.desktop';

export async function queryGlobalShortcutPortal(execute = promisify(execFile)) {
  try {
    const { stdout } = await execute('gdbus', ['introspect', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop', '--xml'], { timeout: 1500 });
    return stdout.includes('name="org.freedesktop.portal.GlobalShortcuts"');
  } catch {
    // Some desktops do not install gdbus. Let Electron attempt registration there.
    return null;
  }
}

// Exec quoting has two layers: command quoting, then desktop-entry string escaping.
export function desktopExecArg(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid executable path');
  const quoted = value.replace(/[\\"`$]/g, '\\$&').replace(/%/g, '%%');
  return `"${quoted.replace(/\\/g, '\\\\')}"`;
}

export function createAutostart(app, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  const filename = path.join(configHome, 'autostart', DESKTOP_NAME);
  return {
    async get() {
      if (platform !== 'linux') return app.getLoginItemSettings().openAtLogin;
      try {
        const entry = await fs.readFile(filename, 'utf8');
        return !/^Hidden=true\s*$/m.test(entry) && !/^X-GNOME-Autostart-enabled=false\s*$/m.test(entry);
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
    async set(enabled) {
      if (!app.isPackaged) throw new Error('Launch at login is available in installed builds.');
      if (platform !== 'linux') {
        app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
        return this.get();
      }
      if (enabled) {
        const executable = env.APPIMAGE || app.getPath('exe');
        const launcher = env.APPIMAGE && env.APPIMAGE_EXTRACT_AND_RUN === '1' ? 'env APPIMAGE_EXTRACT_AND_RUN=1 ' : '';
        await fs.mkdir(path.dirname(filename), { recursive: true });
        await fs.writeFile(filename, `[Desktop Entry]\nType=Application\nName=SuiteMail\nExec=${launcher}${desktopExecArg(executable)} --hidden\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o600 });
      } else {
        await fs.rm(filename, { force: true });
      }
      return this.get();
    },
  };
}

export function createComposeShortcut(globalShortcut, onCompose) {
  let current = null;
  return {
    register(shortcut) {
      if (shortcut === current) return;
      if (typeof shortcut !== 'string' || !shortcut.trim() || !globalShortcut.register(shortcut, onCompose)) {
        throw new Error('Could not register the compose shortcut. Choose another shortcut or check your desktop shortcut permissions.');
      }
      if (current) globalShortcut.unregister(current);
      current = shortcut;
    },
    unregister() {
      if (current) globalShortcut.unregister(current);
      current = null;
    },
  };
}

export function createMailtoQueue(initialArgs, deliver) {
  let ready = false;
  const pending = initialArgs.filter(arg => typeof arg === 'string' && /^mailto:/i.test(arg));
  return {
    push(args) {
      for (const arg of args) {
        if (typeof arg !== 'string' || !/^mailto:/i.test(arg)) continue;
        if (ready) deliver(arg); else pending.push(arg);
      }
    },
    ready() {
      ready = true;
      for (const url of pending.splice(0)) deliver(url);
    },
    hasPending: () => pending.length > 0,
  };
}

const backgroundRequests = new WeakMap();

export function cancelBackgrounding(window) {
  if (window) backgroundRequests.delete(window);
}

export async function backgroundWindow(window, platform = process.platform, hasTray = false) {
  if (!window) return;
  const request = {};
  backgroundRequests.set(window, request);
  if (platform === 'linux' || !hasTray) {
    // Linux tray creation does not imply the shell actually displays the icon.
    if (platform === 'linux' && !window.isVisible()) {
      // Wayland cannot show inactive windows. A new surface must be mapped before
      // its compositor can honor set_minimized; minimizing before its first frame
      // leaves login startup visible on KWin.
      window.show();
      let timeout;
      try {
        await Promise.race([
          window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))'),
          new Promise(resolve => { timeout = setTimeout(resolve, 1000); }),
        ]);
      } catch (error) {
        console.warn('[Window] Could not wait for the initial frame:', error.message);
      } finally { clearTimeout(timeout); }
    } else if (platform !== 'linux') window.showInactive();
    if (backgroundRequests.get(window) === request && !window.isDestroyed()) window.minimize();
  } else window.hide();
}
