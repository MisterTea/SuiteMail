import { DEFAULT_BUGCATCHER_URL, submitBugcatcherReport } from './bugcatcher.js';

async function captureStartupScreenshot(window) {
  let timer;
  try {
    if (!window || window.isDestroyed()) return undefined;
    // A broken renderer must not prevent the error message from appearing.
    const image = await Promise.race([
      window.webContents.capturePage(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Screenshot timed out')), 1000); }),
    ]);
    return image.isEmpty() ? undefined : image.toDataURL();
  } catch (error) {
    console.warn('[Startup] Screenshot unavailable:', error.message);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Native reporting remains available even when the app's renderer cannot start. */
export async function showStartupError({ app, dialog, window, getParent, detail, signal }) {
  const screenshot = await captureStartupScreenshot(window);
  if (signal?.aborted) return 'dismissed';
  const report = {
    type: 'bug',
    text: `SuiteMail could not finish starting.\n\n${detail}${screenshot ? '' : '\n\nScreenshot capture was unavailable.'}`,
    screenshot,
    context: `SuperMail · startup · SuiteMail ${app.getVersion()} · ${process.platform} ${process.arch}`,
  };
  const choose = (options) => {
    const parent = getParent();
    return parent && !parent.isDestroyed()
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options);
  };
  let status = '';
  let reported = false;
  while (true) {
    if (signal?.aborted) return 'dismissed';
    const buttons = reported
      ? ['Keep waiting', 'Restart SuiteMail', 'Quit']
      : ['Keep waiting', 'Restart SuiteMail', 'Report Bug', 'Quit'];
    const { response } = await choose({
      type: 'error',
      title: 'SuiteMail could not start',
      message: 'SuiteMail could not finish starting.',
      detail: `${detail}\n\nTry keeping waiting or restarting SuiteMail. If this keeps happening, reinstall the latest version. Your saved mail and accounts will be kept.\n\n${status || (screenshot ? 'Report Bug sends a screenshot of the mail window and startup error details to our bug catcher.' : 'Report Bug sends startup error details to our bug catcher. A screenshot could not be captured.')}`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
      signal,
    });
    if (signal?.aborted) return 'dismissed';
    const choice = buttons[response];
    if (choice === 'Keep waiting') return 'wait';
    if (choice === 'Restart SuiteMail') return 'restart';
    if (choice !== 'Report Bug') return 'quit';
    const result = await submitBugcatcherReport(
      process.env.VITE_BUGCATCHER_URL ?? DEFAULT_BUGCATCHER_URL,
      report,
      (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
    );
    if (signal?.aborted) return 'dismissed';
    reported = result.success;
    status = result.success
      ? `Thanks! Your bug report was filed${result.number ? ` as #${result.number}` : ''}.`
      : `${result.error}\nYour report has not been sent. Choose Report Bug to try again.`;
  }
}
