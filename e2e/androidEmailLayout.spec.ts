import { test, expect } from './fixtures';
import { FakeServer } from './fakeServer';
import { getElectronBridgeScript } from './electronBridge';

test.skip(process.env.SUITEMAIL_ANDROID !== '1', 'Requires the installed Android WebView');
let server: FakeServer;
test.beforeAll(async () => { server = new FakeServer(3334); await server.start(); });
test.afterAll(async () => { await server.stop(); });

for (const wide of [true, false]) {
  test(`Android email uses screen width and ${wide ? 'scrolls wide sender content' : 'fits responsive content'}`, async ({ page }) => {
    server.reset();
    const html = `<table ${wide ? 'width="960" style="width:960px;min-width:960px"' : 'width="100%"'}><tr><td>
      <h2>Release notification</h2><div style="height:1600px">A long email with ${wide ? 'fixed-width' : 'responsive'} content.</div>
      <p data-fixture-footer>End of email</p></td></tr></table>`;
    server.db.prepare('UPDATE messages SET body_html = ? WHERE id = ?').run(html, 'm-welcome-1');
    await page.addInitScript(getElectronBridgeScript(3334));
    await page.goto('http://localhost:1420/#/mail/inbox');
    await page.locator('button[aria-label*="Team Welcome & Onboarding Guide"]').first().tap();
    const iframe = page.getByTitle('Email content', { exact: true });
    await expect(iframe).toBeVisible();
    await expect(page.frameLocator('iframe[title="Email content"]').getByText('End of email')).toBeAttached();
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
        overflow: getComputedStyle(doc.documentElement).overflowX,
        contentWidth: doc.documentElement.scrollWidth, viewportWidth: doc.documentElement.clientWidth,
        bodyHeight: doc.body.scrollHeight, frameHeight: element.clientHeight,
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
    expect(layout.frameHeight).toBeGreaterThanOrEqual(layout.bodyHeight);
    if (wide) {
      expect(layout.contentWidth).toBeGreaterThan(layout.viewportWidth);
      expect(layout.overflow).toBe('auto');
      const box = (await iframe.boundingBox())!;
      const y = box.y + 60;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 310, y }] });
      for (const x of [280, 240, 190, 140, 90]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => iframe.evaluate((element: HTMLIFrameElement) => element.contentDocument!.documentElement.scrollLeft)).toBeGreaterThan(30);
      await cdp.detach();
    } else expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    await page.locator('[data-thread-messages]').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => page.locator('[data-thread-messages]').evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  });
}
