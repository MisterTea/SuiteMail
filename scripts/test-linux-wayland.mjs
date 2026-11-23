// Native Wayland assertions use compositor state, not Electron's X11-only minimized flag.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { desktopExecArg } from '../electron/desktopIntegration.js';

assert.equal(process.platform, 'linux', 'This check requires Linux');
assert.equal(process.env.SUITEMAIL_ISOLATED_DESKTOP_TEST, '1');
const desktop = process.env.SUITEMAIL_COMPOSITOR;
assert.ok(['gnome', 'kde'].includes(desktop), 'Use scripts/run-linux-wayland.sh');
const executable = path.resolve(process.argv[2] || '/opt/SuiteMail/suitemail');
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'suitemail-native-wayland-'));
const warmURL = `mailto:second@example.invalid?subject=Wayland%20relaunch&body=${encodeURIComponent(path.basename(fixture))}`;
const reportDirectory = process.env.SUITEMAIL_DESKTOP_REPORT_DIR || path.resolve('test-results');
const run = promisify(execFile);
let sequence = 0;
let app;
let keyboardTarget;
let version = '0.1.2';
const logs = [];
const feed = http.createServer((_req, res) => res.end(`version: ${version}\nfiles: []\n`));
await new Promise(resolve => feed.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, HOME: fixture, XDG_CONFIG_HOME: path.join(fixture, 'config'), XDG_DATA_HOME: path.join(fixture, 'data'), XDG_CACHE_HOME: path.join(fixture, 'cache'), NODE_ENV: 'production' };
delete env.ELECTRON_RUN_AS_NODE;
const flags = ['--no-sandbox', '--disable-dev-shm-usage', '--ozone-platform=wayland'];
const consentHelper = new URL('./fixtures/shortcut-consent.py', import.meta.url).pathname;
const dbus = (...args) => run('gdbus', ['call', '--session', ...args], { timeout: 10000 }).then(result => result.stdout);
const gnomeEval = async code => {
  const result = await dbus('--dest', 'org.gnome.Shell', '--object-path', '/org/gnome/Shell', '--method', 'org.gnome.Shell.Eval', code);
  const match = /^\(true, '(.*)'\)\s*$/s.exec(result);
  assert.ok(match, `GNOME queries unavailable: ${result}`);
  return match[1] ? JSON.parse(match[1].replace(/\\'/g, "'")) : undefined;
};
const gnomePointer = async (x, y, click = false) => {
  await gnomeEval(`(async () => {
    const {default: Clutter} = await import('gi://Clutter');
    const backend = Clutter.get_default_backend ? Clutter.get_default_backend() : global.stage.context.get_backend();
    global.suitemailTestPointer ??= backend.get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    global.suitemailTestPointer.notify_absolute_motion(GLib.get_monotonic_time(), ${x}, ${y});
    ${click ? 'global.suitemailTestPointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED); global.suitemailTestPointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);' : ''}
  })()`);
};
const windows = async () => {
  if (desktop === 'gnome') {
    return gnomeEval('global.get_window_actors().map(a => ({ title: a.meta_window.get_title(), minimized: a.meta_window.minimized, appId: a.meta_window.get_wm_class() }))');
  }
  const id = `suitemail-query-${sequence++}`;
  const file = path.join(fixture, `${id}.js`);
  await fs.writeFile(file, `print('${id}=' + JSON.stringify(workspace.clientList().map(function(w) { return {title:w.caption, minimized:w.minimized, appId:String(w.desktopFileName)}; })));`);
  await dbus('--dest', 'org.kde.KWin', '--object-path', '/Scripting', '--method', 'org.kde.kwin.Scripting.loadScript', file, id);
  await dbus('--dest', 'org.kde.KWin', '--object-path', '/Scripting', '--method', 'org.kde.kwin.Scripting.start');
  let line;
  for (let attempt = 0; attempt < 50; attempt++) {
    const log = await fs.readFile(process.env.SUITEMAIL_COMPOSITOR_LOG, 'utf8');
    line = log.split('\n').find(line => line.includes(`${id}=`));
    if (line) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await dbus('--dest', 'org.kde.KWin', '--object-path', '/Scripting', '--method', 'org.kde.kwin.Scripting.unloadScript', id);
  assert.ok(line, 'KWin did not return window state');
  return JSON.parse(line.slice(line.indexOf(`${id}=`) + id.length + 1));
};
const poll = async (check, label, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${label}. Compositor windows: ${JSON.stringify(await windows())}`);
};
const mainWindow = async () => (await windows()).find(window => /suitemail/i.test(window.appId) && window.title.startsWith('SuiteMail'));
const stop = async () => {
  if (!app) return;
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  app = null;
};
const launch = async args => {
  app = await electron.launch({ executablePath: executable, args: [...flags, ...args], env, timeout: 30000 });
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', data => logs.push(data.toString()));
  version = await app.evaluate(({ app }) => app.getVersion());
  await app.evaluate(({ app }, url) => {
    const require = process.getBuiltinModule('module').createRequire(`${app.getAppPath()}/package.json`);
    require('electron-updater').autoUpdater.autoDownload = false;
    require('electron-updater').autoUpdater.setFeedURL({ provider: 'generic', url });
  }, `http://127.0.0.1:${feed.address().port}`);
  let page;
  await poll(() => Boolean(page = app.windows().find(page => page.url().includes('/dist/index.html'))), 'mail window loads');
  page.on('pageerror', error => logs.push(String(error)));
  await poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1), 'splash closes', 35000);
  assert.equal(await app.evaluate(({ app }) => app.commandLine.getSwitchValue('ozone-platform')), 'wayland');
  return page;
};

try {
  let page = await launch(['mailto:wayland@example.invalid?subject=Native%20Wayland']);
  if (desktop === 'gnome') await gnomeEval('Main.overview.hide()');
  await page.getByPlaceholder('Subject').waitFor();
  assert.equal(await page.getByPlaceholder('Subject').inputValue(), 'Native Wayland');
  if (process.env.SUITEMAIL_TEST_SHORTCUT_CONSENT === '1') {
    const consent = async button => JSON.parse((await run('python3', [consentHelper, ...(button ? [button] : [])], { timeout: 5000 })).stdout);
    let dialog;
    let lastDialog = '';
    await poll(async () => {
      dialog = await consent();
      const summary = JSON.stringify(dialog);
      if (summary !== lastDialog) { console.log(`Shortcut dialog: ${summary}`); lastDialog = summary; }
      return dialog.buttons.includes('Allow') || dialog.buttons.includes('Add');
    }, 'global-shortcut permission dialog');
    console.log(`Shortcut consent buttons: ${JSON.stringify(dialog.buttons)}`);
    const denial = dialog.buttons.includes('Deny') ? 'Deny' : 'Cancel';
    assert.equal((await consent(denial)).clicked, denial);
    await poll(async () => !(await windows()).some(window => window.title === 'Add Keyboard Shortcuts'), 'denied dialog closes');
    await page.evaluate(() => window.supermail.invoke('unregister_compose_shortcut'));
    await page.evaluate(() => window.supermail.invoke('register_compose_shortcut', { shortcut: 'Control+Alt+G' }));
    let replacement;
    await poll(async () => {
      replacement = await consent();
      return replacement.buttons.includes('Allow') || replacement.buttons.includes('Add');
    }, 'replacement shortcut permission dialog');
    const approval = replacement.buttons.includes('Allow') ? 'Allow' : 'Add';
    assert.equal((await consent(approval)).clicked, approval);
    await poll(async () => !(await windows()).some(window => window.title === 'Add Keyboard Shortcuts'), 'approved dialog closes');
    // The shell overview deliberately suppresses normal application bindings.
    // Give a separate native GTK client focus to verify global dispatch instead.
    keyboardTarget = spawn('python3', ['-c', `import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk
app = Gtk.Application(application_id='com.suitemail.KeyboardTest')
def activate(app):
    window = Gtk.ApplicationWindow(application=app, title='Isolated keyboard target')
    window.set_child(Gtk.Entry())
    window.present()
app.connect('activate', activate)
app.run(None)
`], { env, stdio: 'ignore' });
    await poll(() => gnomeEval("global.get_window_actors().some(a => a.meta_window.get_title() === 'Isolated keyboard target')"), 'separate keyboard client loads');
    await gnomeEval("global.get_window_actors().find(a => a.meta_window.get_title() === 'Isolated keyboard target').meta_window.activate(global.get_current_time())");
    await poll(() => gnomeEval("global.display.focus_window?.get_title() === 'Isolated keyboard target'"), 'separate client takes keyboard input');
    await gnomeEval(`(async () => {
      const {default: Clutter} = await import('gi://Clutter');
      const backend = Clutter.get_default_backend ? Clutter.get_default_backend() : global.stage.context.get_backend();
      global.suitemailTestKeyboard = backend.get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
      for (const key of [Clutter.KEY_Control_L, Clutter.KEY_Alt_L, Clutter.KEY_g]) global.suitemailTestKeyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
      for (const key of [Clutter.KEY_g, Clutter.KEY_Alt_L, Clutter.KEY_Control_L]) global.suitemailTestKeyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
    })()`);
    await poll(async () => (await page.getByPlaceholder('Subject').inputValue()) === '', 'permitted global shortcut opens compose');
    keyboardTarget.kill();
    keyboardTarget = null;
    console.log('PASS GNOME shortcut consent: denied initial request, allowed a replacement, dispatched native keys from another application to compose');
  }
  await poll(async () => Boolean(await mainWindow()), 'window is registered with the compositor');
  const identity = await mainWindow();
  assert.match(identity.appId, /suitemail/i, 'Desktop identity must be associated with SuiteMail');
  await page.evaluate(() => window.supermail.window.close());
  await poll(async () => (await mainWindow())?.minimized === true, 'close minimizes the native Wayland window');
  if (desktop === 'gnome') {
    // A real notification activation supplies the Wayland token. A bare IPC call
    // is correctly blocked by GNOME's focus-stealing prevention.
    await gnomeEval('Main.messageTray.getSources().flatMap(s => s.notifications).forEach(n => n.destroy())');
    await gnomePointer(50, 300);
    await page.evaluate(async () => {
      if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission denied');
      window.waylandNotificationClicked = false;
      const notification = new Notification('SuiteMail Wayland test', { body: 'Click to restore the mail window' });
      notification.onclick = async () => {
        await window.supermail.invoke('show_main_window');
        window.waylandNotificationClicked = true;
      };
      window.waylandTestNotification = notification;
    });
    await poll(() => gnomeEval('Main.messageTray.getSources().some(s => s.notifications.some(n => n.title === "SuiteMail Wayland test"))'), 'native desktop notification appears');
    await poll(() => gnomeEval('Main.messageTray._notification?.title === "SuiteMail Wayland test" && Main.messageTray.visible && Main.messageTray._bannerBin.is_mapped() && Main.messageTray._bannerBin.get_transformed_position()[1] >= 0'), 'notification banner is visible');
    const banner = await gnomeEval('({position: Main.messageTray._bannerBin.get_transformed_position(), size: Main.messageTray._bannerBin.get_size(), appIds: Main.messageTray.getSources().map(s => s.app?.get_id())})');
    const x = Math.round(banner.position[0] + banner.size[0] / 2);
    const y = Math.round(banner.position[1] + banner.size[1] / 2);
    await gnomePointer(x, y, true);
    await poll(() => page.evaluate(() => window.waylandNotificationClicked), 'native notification click reaches the app');
  } else await page.evaluate(() => window.supermail.invoke('show_main_window'));
  await poll(async () => (await mainWindow())?.minimized === false, 'notification activation restores the native Wayland window');
  await stop();
  page = await launch(['--hidden']);
  await poll(async () => (await mainWindow())?.minimized === true, 'hidden startup creates a reachable minimized window');
  if (desktop === 'gnome') {
    const launcher = path.join(fixture, 'com.suitemail.app.desktop');
    await fs.writeFile(launcher, `[Desktop Entry]\nType=Application\nName=SuiteMail\nExec=${desktopExecArg(executable)} ${flags.join(' ')} %U\nStartupNotify=true\n`);
    const settings = Object.fromEntries(['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'].map(key => [key, env[key]]));
    await gnomeEval(`(async () => {
      const {default: St} = await import('gi://St');
      global.suitemailLaunchButton = new St.Button({label:'Launch SuiteMail test', x:40, y:400, width:240, height:60, reactive:true});
      Main.uiGroup.add_child(global.suitemailLaunchButton);
      global.suitemailLaunchButton.connect('clicked', () => {
        const context = global.create_app_launch_context(global.get_current_time(), -1);
        for (const [key, value] of Object.entries(${JSON.stringify(settings)})) context.setenv(key, value);
        Gio.DesktopAppInfo.new_from_filename(${JSON.stringify(launcher)}).launch_uris([${JSON.stringify(warmURL)}], context);
        global.suitemailLaunchButton.destroy();
      });
    })()`);
    await gnomePointer(150, 430, true);
  } else await run(executable, [...flags, warmURL], { env, timeout: 15000 });
  await poll(async () => (await mainWindow())?.minimized === false, 'second launch restores the window');
  await poll(async () => (await page.getByPlaceholder('Subject').inputValue()) === 'Wayland relaunch', 'second launch delivers its link');
  await poll(async () => {
    for (const entry of await fs.readdir('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const args = await fs.readFile(`/proc/${entry}/cmdline`, 'utf8').catch(() => '');
      const argv = args.split('\0');
      if (argv[0] === executable && argv.includes(warmURL)) return false;
    }
    return true;
  }, 'secondary process exits without opening another instance');
  const portal = await run('gdbus', ['introspect', '--session', '--dest', 'org.freedesktop.portal.Desktop', '--object-path', '/org/freedesktop/portal/desktop'], { timeout: 10000 });
  console.log(`PASS ${desktop}: native Wayland identity, cold/warm mailto, close/minimize, notification restoration and hidden startup; global-shortcut portal ${portal.stdout.includes('org.freedesktop.portal.GlobalShortcuts') ? 'available' : 'unavailable'}`);
  await fs.mkdir(reportDirectory, { recursive: true });
  await fs.writeFile(path.join(reportDirectory, `wayland-${desktop}.json`), JSON.stringify({ desktop, version, nativeWayland: true, shortcutPortal: portal.stdout.includes('org.freedesktop.portal.GlobalShortcuts'), shortcutConsentTested: process.env.SUITEMAIL_TEST_SHORTCUT_CONSENT === '1', passed: true }, null, 2));
} catch (error) {
  console.error(logs.join(''));
  await fs.mkdir(reportDirectory, { recursive: true });
  const compositorLog = await fs.readFile(process.env.SUITEMAIL_COMPOSITOR_LOG, 'utf8');
  await fs.writeFile(path.join(reportDirectory, `wayland-${desktop}.log`), logs.join('') + String(error) + '\n' + compositorLog);
  throw error;
} finally {
  keyboardTarget?.kill();
  await stop();
  await new Promise(resolve => feed.close(resolve));
  await fs.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
