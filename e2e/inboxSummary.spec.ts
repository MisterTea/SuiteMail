import { test, expect } from "./fixtures";
import { FakeServer } from "./fakeServer";
import { getElectronBridgeScript } from "./electronBridge";

test("generates, clamps, and reuses an inbox summary from the configured AI provider", async ({ page }) => {
  const server = new FakeServer(3334);
  await server.start();
  try {
    const body = "Orientation starts Monday. Complete the setup checklist by Friday and ask the onboarding team if you need access.";
    const summary = "Orientation is Monday, and new hires must complete the setup checklist by Friday and contact the onboarding team for help accessing the required tools.";
    server.db.exec(`
      INSERT OR REPLACE INTO settings (key, value) VALUES
        ('ai_provider', 'aicore'), ('ai_enabled', 'true'), ('ai_auto_summarize', 'true');
      UPDATE threads SET last_message_at = 1900000000000 WHERE id = 't-welcome-1';
    `);
    server.db.prepare("UPDATE messages SET date = 1900000000000, body_text = ? WHERE id = 'm-welcome-1'").run(body);

    await page.addInitScript(`${getElectronBridgeScript(3334)}
      (() => {
        const invoke = window.supermail.invoke;
        window.supermail.invoke = async (cmd, args = {}) => {
          if (cmd === 'aicore_is_available') return { available: true };
          if (cmd === 'aicore_generate' && args.systemPrompt.includes('three-line inbox preview')) {
            const input = JSON.parse(args.prompt);
            if (input.subject !== 'Team Welcome & Onboarding Guide') return '';
            const requests = JSON.parse(sessionStorage.getItem('inboxSummaryRequests') || '[]');
            requests.push({ input, systemPrompt: args.systemPrompt });
            sessionStorage.setItem('inboxSummaryRequests', JSON.stringify(requests));
            return ${JSON.stringify(summary)};
          }
          return invoke(cmd, args);
        };
      })();
    `);

    await page.goto("http://localhost:1420/#/mail/inbox");
    const row = page.getByRole("button", { name: /Team Welcome & Onboarding Guide/ });
    const preview = row.getByText(summary, { exact: true });
    await expect(preview).toBeVisible();
    const layout = await preview.evaluate((element) => {
      const style = getComputedStyle(element);
      return { clamp: style.webkitLineClamp, lines: Math.round(element.clientHeight / parseFloat(style.lineHeight)) };
    });
    expect(layout).toEqual({ clamp: "3", lines: 3 });

    await page.reload();
    await expect(preview).toBeVisible();
    const requests = await page.evaluate(() => JSON.parse(sessionStorage.getItem("inboxSummaryRequests") ?? "[]"));
    expect(requests).toHaveLength(1);
    expect(requests[0].input.messages[0].body).toBe(body);
    expect(requests[0].systemPrompt).toContain("15–20 words");

    server.db.exec("UPDATE settings SET value = 'false' WHERE key = 'ai_auto_summarize'");
    await page.reload();
    await expect(row.getByText("Welcome to SuperMail! Enjoy your fast email client.")).toBeVisible();
    await expect(preview).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
