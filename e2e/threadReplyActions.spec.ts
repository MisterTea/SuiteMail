import { test, expect } from "./fixtures";
import { FakeServer } from "./fakeServer";
import { getElectronBridgeScript } from "./electronBridge";

test("translates from More and shows three-line quick replies below the reply buttons", async ({ page }) => {
  const server = new FakeServer(3334);
  await server.start();
  try {
    const translated = "The team welcomes you and has shared an onboarding guide.";
    const reply = "I’ll review the onboarding guide this afternoon and send the team any questions about getting set up, what to prepare for Monday, and where to find the rest of the materials.";
    server.db.exec(`
      INSERT OR REPLACE INTO settings (key, value) VALUES
        ('ai_provider', 'aicore'), ('ai_enabled', 'true'), ('ai_auto_summarize', 'false');
    `);
    await page.addInitScript(`${getElectronBridgeScript(3334)}
      const invoke = window.supermail.invoke;
      window.supermail.invoke = (command, args = {}) => {
        if (command === 'aicore_is_available' || command === 'aicore_prepare') return Promise.resolve({ available: true });
        if (command === 'aicore_generate' && args.systemPrompt.includes('email translator')) return Promise.resolve(${JSON.stringify(translated)});
        if (command === 'aicore_generate' && args.systemPrompt.includes('3 short email reply options')) return Promise.resolve(${JSON.stringify(JSON.stringify([reply, "I can review it tomorrow.", "Thanks for sharing the guide."]))});
        return invoke(command, args);
      };
    `);

    await page.goto("http://localhost:1420/#/mail/inbox");
    await page.getByRole("button", { name: /Team Welcome & Onboarding Guide/ }).click();
    const thread = page.locator("[data-thread-messages]");
    await expect(thread.getByRole("button", { name: "Translate", exact: true })).toHaveCount(0);

    const more = page.getByRole("button", { name: "More message actions" });
    const menu = page.getByRole("dialog", { name: "Message actions" });
    await more.click();
    await menu.getByRole("button", { name: "Translate", exact: true }).click();
    await expect(thread.getByText(translated)).toBeVisible();
    await more.click();
    await menu.getByRole("button", { name: "Show Original" }).click();
    await expect(thread.getByText(translated)).toHaveCount(0);

    const suggestion = thread.getByRole("button", { name: reply, exact: true });
    const text = suggestion.getByText(reply);
    await expect(text).toBeVisible();
    const forward = await thread.getByRole("button", { name: "Forward", exact: true }).boundingBox();
    const suggestionBounds = await suggestion.boundingBox();
    expect(suggestionBounds!.y).toBeGreaterThan(forward!.y + forward!.height);
    const lines = await text.evaluate((element) => {
      const style = getComputedStyle(element);
      return { visible: Math.round(element.clientHeight / parseFloat(style.lineHeight)), clamp: style.webkitLineClamp };
    });
    expect(lines).toEqual({ visible: 3, clamp: "3" });
    await suggestion.click();
    await expect(page.getByRole("textbox", { name: "Message body" })).toContainText(reply);
  } finally {
    await server.stop();
  }
});
