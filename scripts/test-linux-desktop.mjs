// Run under Xvfb + D-Bus. All account data, autostart entries and updates are isolated.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { startMailServers, MAIL_USERNAME, MAIL_PASSWORD, MESSAGE_SOURCE, ATTACHMENT_TEXT } from './fixtures/mail-servers.mjs';

const require = createRequire(import.meta.url);
const { load: loadYaml } = createRequire(require.resolve('electron-updater'))('js-yaml');

assert.equal(process.platform, 'linux', 'This check must run on Linux');
const output = path.resolve(process.argv[2] || 'dist-electron');
const updateOutput = process.argv[3] ? path.resolve(process.argv[3]) : null;
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'suitemail-linux-'));
const wm = spawn('openbox', [], { stdio: 'ignore' });
wm.on('error', error => console.warn('Window manager unavailable:', error.message));
let app;
const runtimeLogs = [];
const launchFlags = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const servers = [];
let mailServers;
const listen = async server => {
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
};
const hash = async file => createHash('sha512').update(await fs.readFile(file)).digest('base64');
const poll = async (check, label, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
const stop = async () => {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    app = null;
  }
};

try {
  mailServers = await startMailServers();
  const files = await fs.readdir(output);
  const manifest = loadYaml(await fs.readFile(path.join(output, 'latest-linux.yml'), 'utf8'));
  let feedDirectory = output;
  const feedPort = await listen(http.createServer(async (req, res) => {
    try {
      const filename = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1));
      if (!filename || filename !== path.basename(filename)) { res.writeHead(404).end(); return; }
      const data = await fs.readFile(path.join(feedDirectory, filename));
      res.writeHead(200, { 'Content-Length': data.length }).end(data);
    } catch { res.writeHead(404).end(); }
  }));
  const feedURL = `http://127.0.0.1:${feedPort}`;
  for (const format of ['deb', 'AppImage']) {
    feedDirectory = output;
    const artifact = files.find(file => file.endsWith(`.${format}`));
    assert.ok(artifact, `Missing ${format} package`);
    const root = path.join(fixture, format);
    await fs.mkdir(root);
    const original = path.join(output, artifact);
    const metadata = manifest.files.find(file => decodeURIComponent(file.url) === artifact);
    assert.ok(metadata, `${format} is missing from the update manifest`);
    assert.equal(metadata.sha512, await hash(original), 'Published package hash must match');
    let executable;
    let appImage;
    if (format === 'deb') {
      execFileSync('dpkg-deb', ['-x', original, root]);
      executable = path.join(root, 'opt/SuiteMail/suitemail');
      const desktop = path.join(root, 'usr/share/applications/com.suitemail.app.desktop');
      execFileSync('desktop-file-validate', [desktop]);
      const entry = await fs.readFile(desktop, 'utf8');
      assert.match(entry, /Exec=.* %U/);
      assert.match(entry, /MimeType=.*x-scheme-handler\/mailto/);
      assert.match(entry, /StartupWMClass=com.suitemail.app/);
      if (process.env.SUITEMAIL_TEST_INSTALLED === '1') executable = '/opt/SuiteMail/suitemail';
    } else {
      // A stable custom filename exercises the updater's in-place replacement path.
      appImage = path.join(root, 'SuiteMail.AppImage');
      await fs.copyFile(original, appImage);
      await fs.chmod(appImage, 0o755);
      execFileSync(appImage, ['--appimage-extract'], { cwd: root, stdio: 'ignore' });
      executable = path.join(root, 'squashfs-root/suitemail');
    }
    const home = path.join(root, 'home');
    const config = path.join(home, '.config');
    const bin = path.join(home, 'bin');
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(path.join(config, 'protonmail/bridge-v3'), { recursive: true });
    await fs.writeFile(path.join(bin, 'protonmail-bridge'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local/share'), PATH: `${bin}:${process.env.PATH}`, NODE_ENV: 'production', APPIMAGE_EXTRACT_AND_RUN: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.APPIMAGE;
    if (appImage) env.APPIMAGE = appImage;
    const launch = async (args = []) => {
      app = await electron.launch({ executablePath: executable, args: [...launchFlags, ...args], env, timeout: 30000 });
      for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', data => {
        runtimeLogs.push(data.toString());
        if (runtimeLogs.length > 100) runtimeLogs.shift();
      });
      const capturePageLogs = page => {
        page.on('console', message => runtimeLogs.push(`[Renderer ${message.type()}] ${message.text()}\n`));
        page.on('pageerror', error => runtimeLogs.push(`[Renderer error] ${error.stack}\n`));
      };
      app.on('window', capturePageLogs);
      for (const page of app.windows()) capturePageLogs(page);
      await app.evaluate(async ({ app }, feed) => {
        const { createRequire } = process.getBuiltinModule('module');
        const require = createRequire(`${app.getAppPath()}/package.json`);
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      }, feedURL);
      let main;
      await poll(() => Boolean(main = app.windows().find(page => page.url().includes('/dist/index.html'))), 'packaged main window loads', 30000);
      await poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1), 'splash closes', 35000);
      await main.locator('#root').filter({ hasText: /SuiteMail/ }).waitFor();
      const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, data: app.getPath('userData'), version: app.getVersion() }));
      assert.equal(info.packaged, true);
      assert.ok(info.data.startsWith(config), `User data escaped fixture: ${info.data}`);
      return main;
    };

    let page = await launch(['mailto:cold@example.com?subject=Linux%20cold%20launch']);
    await page.getByPlaceholder('Subject').filter({ visible: true }).waitFor();
    await poll(async () => page.getByPlaceholder('Subject').inputValue().then(value => value === 'Linux cold launch'), 'cold-start mailto');
    // A second process must pass its URL to the first process, exactly once.
    await promisify(execFile)(executable, [...launchFlags, 'mailto:warm@example.com?subject=Linux%20warm%20launch'], { env, timeout: 15000 });
    await poll(async () => page.getByPlaceholder('Subject').inputValue().then(value => value === 'Linux warm launch'), 'second-instance mailto');
    await page.evaluate(() => window.supermail.invoke('register_compose_shortcut', { shortcut: 'Control+Alt+G' }));
    execFileSync('xdotool', ['key', '--clearmodifiers', 'ctrl+alt+g']);
    await poll(async () => page.getByPlaceholder('Subject').inputValue().then(value => value === ''), 'native compose shortcut');
    const mailResult = await page.evaluate(async ({ imapPort, smtpPort, username, password, raw }) => {
      const config = { host: '127.0.0.1', security: 'none', username, password, auth_method: 'password' };
      const invoke = window.supermail.invoke;
      const folders = await invoke('imap_list_folders', { config: { ...config, port: imapPort } });
      const message = await invoke('imap_fetch_message_body', { config: { ...config, port: imapPort }, folder: 'INBOX', uid: 1 });
      const attachment = await invoke('imap_fetch_attachment', { config: { ...config, port: imapPort }, folder: 'INBOX', uid: 1, part_id: message.attachments[0].part_id });
      const sent = await invoke('smtp_send_email', { config: { ...config, port: smtpPort }, raw_email: raw });
      let rejected = false;
      try { await invoke('imap_list_folders', { config: { ...config, port: imapPort, password: 'incorrect' } }); }
      catch { rejected = true; }
      await window.supermail.fs.writeFile('fetched-linux-attachment.txt', Array.from(Uint8Array.from(atob(attachment), char => char.charCodeAt(0))));
      return { folders, message, sent, rejected };
    }, { imapPort: mailServers.imapPort, smtpPort: mailServers.smtpPort, username: MAIL_USERNAME, password: MAIL_PASSWORD, raw: Buffer.from(MESSAGE_SOURCE).toString('base64url') });
    assert.equal(mailResult.folders[0].path, 'INBOX');
    assert.equal(mailResult.message.subject, 'Linux native mail roundtrip');
    assert.match(mailResult.message.body_text, /packaged Rust backend/);
    assert.equal(mailResult.message.attachments[0].filename, 'linux.txt');
    assert.equal(mailResult.sent.success, true);
    assert.equal(mailResult.rejected, true, 'Incorrect credentials must be rejected');
    assert.match(mailServers.deliveries.at(-1).message, /Subject: Linux native mail roundtrip/);
    assert.ok(mailServers.deliveries.at(-1).envelope.some(line => /RCPT TO:<recipient@example.invalid>/i.test(line)));
    assert.equal(await page.evaluate(() => window.supermail.fs.readTextFile('fetched-linux-attachment.txt')), ATTACHMENT_TEXT);
    const imapPort = await listen(net.createServer(socket => socket.end('* OK Proton Bridge test greeting\r\n')));
    const smtpPort = await listen(net.createServer(socket => socket.end('220 Proton Bridge test greeting\r\n')));
    const bridge = await page.evaluate(({ imapPort, smtpPort }) => window.supermail.invoke('check_proton_bridge_status', { custom_imap_port: imapPort, custom_smtp_port: smtpPort }), { imapPort, smtpPort });
    assert.equal(bridge.is_installed, true);
    assert.equal(bridge.config_dir_found, true);
    assert.equal(bridge.imap_listening, true);
    assert.equal(bridge.smtp_listening, true);
    assert.match(bridge.banner, /Proton Bridge test/);
    await page.evaluate(async () => {
      await window.supermail.db.execute('CREATE TABLE linux_smoke (value TEXT NOT NULL)');
      await window.supermail.db.execute('INSERT INTO linux_smoke VALUES ($1)', ['survives restart']);
      await window.supermail.fs.writeTextFile('linux-smoke-attachment.txt', 'attachment contents');
      if (await window.supermail.fs.readTextFile('linux-smoke-attachment.txt') !== 'attachment contents') throw new Error('Filesystem roundtrip failed');
      if (!await window.supermail.invoke('set_autostart', { enabled: true })) throw new Error('Autostart not enabled');
    });
    const startupEntry = await fs.readFile(path.join(config, 'autostart/com.suitemail.app.desktop'), 'utf8');
    execFileSync('desktop-file-validate', [path.join(config, 'autostart/com.suitemail.app.desktop')]);
    assert.ok(startupEntry.includes(format === 'AppImage' ? appImage : executable));
    await page.evaluate(() => window.supermail.window.close());
    await poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), 'close minimizes without a tray');
    await page.evaluate(() => window.supermail.invoke('show_main_window'));
    await poll(async () => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isMinimized()), 'notification activation restores the window');
    await stop();
    page = await launch(['--hidden']);
    await poll(async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), 'hidden launch stays in background');
    assert.equal(await page.evaluate(async () => (await window.supermail.db.select('SELECT value FROM linux_smoke'))[0].value), 'survives restart');
    assert.equal(await page.evaluate(() => window.supermail.fs.readTextFile('fetched-linux-attachment.txt')), ATTACHMENT_TEXT);
    assert.equal(await page.evaluate(() => window.supermail.invoke('get_autostart')), true);
    assert.equal(await page.evaluate(() => window.supermail.invoke('set_autostart', { enabled: false })), false);

    console.log(`PASS ${format}: packaged startup, cold/warm links, IMAP authentication/fetch/attachment, rejected credentials, SMTP sink delivery, persistence, autostart, backgrounding, Proton Bridge discovery/probes`);

    if (updateOutput) {
      const updateFiles = await fs.readdir(updateOutput);
      const nextFile = updateFiles.find(file => file.endsWith(`.${format}`));
      assert.ok(nextFile, `Missing next-version ${format}`);
      const manifest = await fs.readFile(path.join(updateOutput, 'latest-linux.yml'), 'utf8');
      assert.ok(manifest.includes(nextFile), `Update manifest must include ${nextFile}`);
      feedDirectory = updateOutput;
      // Redirect the actual packaged updater to a local feed; no shipped test hooks.
      const downloaded = await app.evaluate(async ({ app }, feed) => {
        const { createRequire } = process.getBuiltinModule('module');
        const require = createRequire(`${app.getAppPath()}/package.json`);
        const { autoUpdater } = require('electron-updater');
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.disableDifferentialDownload = true;
        autoUpdater.setFeedURL({ provider: 'generic', url: feed });
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable) throw new Error('Next version not detected');
        const files = await autoUpdater.downloadUpdate();
        return { file: files[0], version: result.updateInfo.version };
      }, feedURL);
      assert.equal(await hash(downloaded.file), await hash(path.join(updateOutput, nextFile)));
      if (format === 'AppImage') {
        // Exercise the real replacement, then launch the updated contents with the same data.
        await app.evaluate(async ({ app }) => {
          const { createRequire } = process.getBuiltinModule('module');
          const require = createRequire(`${app.getAppPath()}/package.json`);
          const { autoUpdater } = require('electron-updater');
          if (!autoUpdater.doInstall({ isForceRunAfter: false })) throw new Error('AppImage replacement failed');
        });
        assert.equal(await hash(appImage), await hash(path.join(updateOutput, nextFile)));
      }
      await stop();
      const nextRoot = path.join(root, 'updated');
      await fs.mkdir(nextRoot);
      if (format === 'deb') {
        execFileSync('dpkg-deb', ['-x', path.join(updateOutput, nextFile), nextRoot]);
        executable = path.join(nextRoot, 'opt/SuiteMail/suitemail');
      } else {
        execFileSync(appImage, ['--appimage-extract'], { cwd: nextRoot, stdio: 'ignore' });
        executable = path.join(nextRoot, 'squashfs-root/suitemail');
      }
      page = await launch();
      assert.equal(await app.evaluate(({ app }) => app.getVersion()), downloaded.version);
      assert.equal(await page.evaluate(async () => (await window.supermail.db.select('SELECT value FROM linux_smoke'))[0].value), 'survives restart');
      // Regression: a current version must not be advertised as an available update.
      await app.evaluate(async ({ app }, feed) => {
        const { createRequire } = process.getBuiltinModule('module');
        const require = createRequire(`${app.getAppPath()}/package.json`);
        require('electron-updater').autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      }, feedURL);
      assert.equal(await page.evaluate(() => window.supermail.invoke('check_for_updates')), null);
      console.log(`PASS ${format}: newer release detected, download hash verified, updated app launched with existing data; ${format === 'AppImage' ? 'original AppImage replaced' : 'DebUpdater download tested (privileged installation is a separate acceptance check)'}`);
    }
    await stop();
  }
} catch (error) {
  console.error(runtimeLogs.join(''));
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/linux-desktop.log', runtimeLogs.join('') + String(error));
  const page = app?.windows().find(page => page.url().includes('/dist/index.html'));
  await page?.screenshot({ path: 'test-results/linux-desktop.png', timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await stop();
  await mailServers?.close();
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  wm.kill();
  await fs.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
