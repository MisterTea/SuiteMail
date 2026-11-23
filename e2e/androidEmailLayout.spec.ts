import { test, expect } from './fixtures';
import { FakeServer } from './fakeServer';
import { getElectronBridgeScript } from './electronBridge';

test.skip(process.env.SUITEMAIL_ANDROID !== '1', 'Requires the installed Android WebView');
let server: FakeServer;
test.beforeAll(async () => { server = new FakeServer(3334); await server.start(); });
test.afterAll(async () => { await server.stop(); });

for (const wide of [true, false]) {
  test(`Android email uses one scrollbar for ${wide ? 'wide' : 'responsive'} content`, async ({ page }) => {
    server.reset();
    const html = `<h2>Release notification</h2>
      <table ${wide ? 'width="960" style="width:960px;min-width:960px"' : 'width="100%"'}><tr><td>
      <div style="height:1600px">A long email with ${wide ? 'fixed-width' : 'responsive'} content.</div>
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
