export function isExternalUrl(value) {
  if (typeof value !== 'string') return false;
  const url = URL.parse(value);
  return !!url && ['http:', 'https:', 'mailto:'].includes(url.protocol);
}

export function createRendererSecurity({ ipcMain, appUrl, preload, openExternal }) {
  const trusted = new WeakSet();
  const entry = new URL(appUrl);

  function isAppPage(value) {
    const url = URL.parse(value);
    if (!url || url.protocol !== entry.protocol || url.host !== entry.host || url.username || url.password) return false;
    return url.pathname === entry.pathname || (entry.pathname === '/' && url.pathname === '/index.html');
  }

  function protect(contents) {
    trusted.add(contents);
    contents.on('will-navigate', (event) => {
      if (!isAppPage(event.url)) event.preventDefault();
    });
    contents.on('will-redirect', (event) => {
      if (event.isMainFrame && !isAppPage(event.url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isAppPage(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        };
      }
      if (isExternalUrl(url)) void openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    contents.on('did-create-window', (child) => protect(child.webContents));
  }

  function handle(channel, callback) {
    ipcMain.handle(channel, (event, ...args) => {
      const frame = event.senderFrame;
      if (!frame || !trusted.has(event.sender) || frame.parent !== null || !isAppPage(frame.url)) {
        throw new Error('Untrusted SuiteMail IPC sender');
      }
      return callback(event, ...args);
    });
  }

  return { protect, handle };
}
