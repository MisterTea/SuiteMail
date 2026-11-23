import { test, expect } from './fixtures';
import { FakeServer } from './fakeServer';
import { getElectronBridgeScript } from './electronBridge';

let server: FakeServer;
test.beforeAll(async () => { server = new FakeServer(3334); await server.start(); });
test.afterAll(async () => { await server.stop(); });

test.beforeEach(async ({ page }) => {
  server.reset();
  server.db.exec("DELETE FROM settings WHERE key = 'calendar_view'");
  server.db.exec("UPDATE accounts SET provider = 'ews' WHERE id = 'acc-test-1'");
  await page.addInitScript(`${getElectronBridgeScript(3334)}
    (() => {
      // Exercise the Android layout in Chromium as well as the native WebView.
      if (!window.Capacitor) window.CapacitorCustomPlatform = { name: 'android' };
      const invoke = window.supermail.invoke;
      window.supermail.invoke = async (cmd, args = {}) => {
        if (cmd === 'ews_calendar') {
          if (args.operation === 'list') return [{ remoteId: 'primary', displayName: 'Calendar', color: null, isPrimary: true }];
          if (args.operation === 'fetch') {
            const start = new Date(); start.setHours(0, 0, 0, 0);
            return [{ remoteEventId: 'touch-event', uid: null, etag: null, summary: 'Touch test event',
              description: null, location: null, startTime: start.getTime() / 1000,
              endTime: start.getTime() / 1000 + 1800, isAllDay: false, status: 'confirmed',
              organizerEmail: null, attendeesJson: null, htmlLink: null, icalData: null }];
          }
        }
        return invoke(cmd, args);
      };
      const fixtureBridge = window.supermail;
      Object.defineProperty(window, 'supermail', {
        configurable: true, get: () => fixtureBridge, set: () => {},
      });
    })();`);
  await page.goto('http://localhost:1420/#/calendar');
});

test('Calendar hides Compose and supports horizontal dates and vertical time scrolling', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Create event', exact: true })).toBeVisible();
  await expect(page.getByTitle('Compose Email', { exact: true })).toHaveCount(0);
  await expect(page.getByTitle('Compose', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Calendar access error', { exact: true })).toHaveCount(0);

  const cdp = await page.context().newCDPSession(page);
  const swipe = async (x: number, y: number, dx: number, dy: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  for (const view of ['1 day', '3 days', '7 days']) {
    await page.getByRole('button', { name: view, exact: true }).tap();
    await page.getByRole('button', { name: 'Today', exact: true }).tap();
    const grid = page.getByLabel('Time of day', { exact: true });
    await expect(grid.getByRole('button', { name: 'Touch test event', exact: true })).toBeVisible();
    const title = await page.getByRole('heading', { level: 2 }).innerText();
    const box = (await grid.boundingBox())!;
    expect(box.height).toBeGreaterThan(100);
    expect(box.y + box.height).toBeLessThanOrEqual((await page.getByRole('navigation', { name: 'Mobile navigation' }).boundingBox())!.y + 1);
    await swipe(box.x + box.width / 2, box.y + Math.min(box.height - 30, 330), 3, -240);
    await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(title);

    await swipe(box.x + box.width - 25, box.y + 100, -220, 2);
    await expect(page.getByRole('heading', { level: 2 })).not.toHaveText(title);
    await swipe(box.x + 25, box.y + 100, 220, 2);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(title);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await cdp.detach();
});

test('Calendar remembers each selected view after navigation and reload', async ({ page }) => {
  test.setTimeout(90_000);
  const options = [
    { label: '1 day', value: 'day' },
    { label: '3 days', value: 'threeDay' },
    { label: '7 days', value: 'week' },
    { label: 'Month', value: 'month' },
  ];
  await expect(page.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const { label, value } of options) {
    await page.getByRole('button', { name: label, exact: true }).tap();
    await expect.poll(() => server.db.prepare("SELECT value FROM settings WHERE key = 'calendar_view'").get()?.value).toBe(value);
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Inbox', exact: true }).tap();
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Calendar', exact: true }).tap();
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
});
