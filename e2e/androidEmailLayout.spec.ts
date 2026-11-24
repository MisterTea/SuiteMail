import { test, expect } from './fixtures';
import { FakeServer } from './fakeServer';
import { getElectronBridgeScript } from './electronBridge';

let server: FakeServer;
test.beforeAll(async () => { server = new FakeServer(3334); await server.start(); });
test.afterAll(async () => { await server.stop(); });

test('Android inbox syncs when a downward pull at the top is released', async ({ page }) => {
  test.skip(process.env.SUITEMAIL_ANDROID !== '1', 'Requires the installed Android WebView');
  server.reset();
  // Keep scheduled sync from issuing its own requests during the gesture.
  server.db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run('acc-test-1');
  await page.addInitScript(getElectronBridgeScript(3334));
  await page.goto('http://localhost:1420/#/mail/inbox');
  const list = page.locator('[data-email-scroll]');
  const root = page.locator('html');
  await expect(list.locator('[data-thread-id]').first()).toBeVisible();

  await page.evaluate(() => {
    const bridge = window.supermail!;
    const invoke = bridge.invoke!;
    const root = document.documentElement;
    root.dataset.refreshRequests = '0';
    const resumeSync = new Promise<void>((resolve) => {
      document.addEventListener('resume-test-sync', () => resolve(), { once: true });
    });
    bridge.invoke = async (command, args) => {
      if (command === 'imap_search_folder' && args?.folder === 'INBOX') {
        root.dataset.refreshRequests = String(Number(root.dataset.refreshRequests) + 1);
        await resumeSync;
      }
      return invoke(command, args);
    };
  });

  const cdp = await page.context().newCDPSession(page);
  const box = (await list.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 140;
  const move = async (offset: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + offset }] });
  };
  const start = async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  };
  const end = async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const indicator = page.getByText('Syncing mail…', { exact: true });

  await start();
  await move(20);
  await move(40);
  await end();
  await expect(indicator).toHaveCount(0);
  await expect(root).toHaveAttribute('data-refresh-requests', '0');

  await start();
  for (const offset of [16, 40, 75, 115]) await move(offset);
  await expect(root).toHaveAttribute('data-refresh-requests', '0');
  await end();
  await expect(indicator).toBeAttached();
  await expect(root).toHaveAttribute('data-refresh-requests', '1');

  await start();
  for (const offset of [20, 60, 110]) await move(offset);
  await end();
  await page.evaluate(() => document.dispatchEvent(new Event('resume-test-sync')));
  await expect(indicator).toHaveCount(0);
  await expect(root).toHaveAttribute('data-refresh-requests', '1');

  await start();
  for (const offset of [-20, -60, -110]) await move(offset);
  await end();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(indicator).toHaveCount(0);
});

test('Fixed-width newsletters reflow at phone widths', async ({ page }) => {
  server.reset();
  const html = `<center style="width:640px;min-width:640px">
    <table width="640" style="width:640px;min-width:640px" role="presentation"><tr><td width="640" style="min-width:640px;padding:20px">
      <div style="width:600px;min-width:600px">
        <h1 style="font-size:32px;margin:0">Community Weekly: SpaceX gets a permit for a 750 MW Texas gas plant</h1>
        <p>Plus data center deals in Odessa and Hunt County, and five Texas AI events.</p>
        <p>https://example.com/a-very-long-address-without-any-ordinary-spaces-to-wrap-onto-the-next-line</p>
      </div>
    </td></tr></table>
  </center>`;
  server.db.prepare('UPDATE messages SET body_html = ? WHERE id = ?').run(html, 'm-welcome-1');
  await page.addInitScript(getElectronBridgeScript(3334));
  await page.goto('http://localhost:1420/#/mail/inbox');
  await page.getByRole('button', { name: /Team Welcome & Onboarding Guide/ }).first().tap();
  const iframe = page.getByTitle('Email content', { exact: true });
  const heading = page.frameLocator('iframe[title="Email content"]').getByRole('heading', { name: /Community Weekly/ });
  await expect(heading).toBeVisible();

  const layout = await iframe.evaluate((element: HTMLIFrameElement) => {
    const doc = element.contentDocument!;
    const heading = doc.querySelector('h1')!;
    const range = doc.createRange();
    range.selectNodeContents(heading);
    return {
      contentWidth: doc.documentElement.scrollWidth,
      viewportWidth: doc.documentElement.clientWidth,
      fontSize: doc.defaultView!.getComputedStyle(heading).fontSize,
      lineCount: range.getClientRects().length,
      rightmostText: Math.max(...Array.from(range.getClientRects(), (line) => line.right)),
    };
  });
  expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.fontSize).toBe('32px');
  expect(layout.lineCount).toBeGreaterThan(2);
  expect(layout.rightmostText).toBeLessThanOrEqual(layout.viewportWidth + 1);
});

for (const wide of [true, false]) {
  test(`Android email uses one scrollbar for ${wide ? 'wide' : 'responsive'} content`, async ({ page }) => {
    test.skip(process.env.SUITEMAIL_ANDROID !== '1', 'Requires the installed Android WebView');
    server.reset();
    const html = `<h2>Release notification</h2>
      <table width="100%"><tr><td>
      <div style="height:1600px">${wide
        ? '<p style="white-space:nowrap">Date　　Order number　　Quantity　　Unit cost　　Discount　　Subtotal　　Tax amount　　Currency　　Total</p>'
        : 'A long email with responsive content.'}</div>
      </td></tr></table><p>End of email</p>`;
    server.db.prepare('UPDATE messages SET body_html = ? WHERE id = ?').run(html, 'm-welcome-1');
    await page.addInitScript(getElectronBridgeScript(3334));
    await page.goto('http://localhost:1420/#/mail/inbox');
    await page.locator('button[aria-label*="Team Welcome & Onboarding Guide"]').first().tap();
    const iframe = page.getByTitle('Email content', { exact: true });
    await expect(iframe).toBeVisible();
    const footer = page.frameLocator('iframe[title="Email content"]').getByText('End of email');
    await expect(footer).toBeAttached();
    const layout = await iframe.evaluate((element: HTMLIFrameElement) => {
      const doc = element.contentDocument!;
      const bounds = element.getBoundingClientRect();
      const card = element.closest('[data-message-card]')!;
      const scroller = element.closest('[data-thread-messages]')!;
      return {
        left: bounds.left, width: bounds.width, screen: window.innerWidth,
        availableWidth: scroller.clientWidth, scrollerRight: scroller.getBoundingClientRect().right,
        documentWidth: document.documentElement.scrollWidth,
        cardRadius: getComputedStyle(card).borderRadius,
        cardBorder: getComputedStyle(card).borderLeftWidth,
        padding: getComputedStyle(doc.body).paddingLeft,
        overflowX: getComputedStyle(doc.documentElement).overflowX,
        overflowY: getComputedStyle(doc.documentElement).overflowY,
        scrollbarWidth: getComputedStyle(doc.documentElement).getPropertyValue('scrollbar-width'),
        scrollbarDisplay: getComputedStyle(doc.documentElement, '::-webkit-scrollbar').display,
        contentWidth: doc.documentElement.scrollWidth, viewportWidth: doc.documentElement.clientWidth,
        contentHeight: doc.documentElement.scrollHeight, viewportHeight: doc.documentElement.clientHeight,
        verticalScroll: scroller.scrollHeight > scroller.clientHeight,
      };
    });
    expect(layout.left).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.width - layout.availableWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.scrollerRight - layout.screen)).toBeLessThanOrEqual(1);
    expect(layout.screen - layout.width).toBeLessThanOrEqual(8); // Only the vertical scrollbar uses width.
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.screen + 1);
    expect(layout.cardRadius).toBe('0px');
    expect(layout.cardBorder).toBe('0px');
    expect(layout.padding).toBe('0px');
    expect(layout.verticalScroll).toBe(true);
    expect(layout.overflowY).toBe('hidden');
    expect(layout.scrollbarWidth === 'none' || layout.scrollbarDisplay === 'none').toBe(true);
    expect(layout.contentHeight).toBe(layout.viewportHeight);
    const cdp = await page.context().newCDPSession(page);
    const box = (await iframe.boundingBox())!;
    if (wide) {
      expect(layout.contentWidth).toBeGreaterThan(layout.viewportWidth);
      expect(layout.overflowX).toBe('auto');
      const y = box.y + 60;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 310, y }] });
      for (const x of [280, 240, 190, 140, 90]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => iframe.evaluate((element: HTMLIFrameElement) => element.contentDocument!.documentElement.scrollLeft)).toBeGreaterThan(30);
    } else expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);

    const x = box.x + box.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: box.y + 200 }] });
    for (const offset of [170, 130, 90, 50, 10]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: box.y + offset }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();

    const thread = page.locator('[data-thread-messages]');
    await expect.poll(() => thread.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    await expect.poll(() => iframe.evaluate((element: HTMLIFrameElement) => element.contentWindow!.scrollY)).toBe(0);
    await iframe.evaluate((element: HTMLIFrameElement) => element.contentDocument!.documentElement.scrollLeft = 0);
    await thread.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(footer).toBeInViewport({ ratio: 0.95 });
  });
}
