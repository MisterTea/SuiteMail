import { test, expect } from "./fixtures";

test.skip(process.env.SUITEMAIL_ANDROID_PROTON !== "1", "Requires the Android Proton fixture APK");

test("Android Proton signs in and delivers mail locally", async ({ page }) => {
  await expect(page.locator("[data-app-content]")).toBeVisible({ timeout: 60_000 });
  const chooser = page.getByRole("dialog", { name: "Add Account", exact: true });
  if (!(await chooser.isVisible())) {
    const addAccount = page.getByRole("button", { name: "Add Account", exact: true });
    if (!(await addAccount.isVisible())) await page.getByRole("button", { name: "Folders", exact: true }).click();
    await addAccount.click();
  }
  await chooser.getByRole("button", { name: /^Proton Mail/ }).click();
  const setup = page.getByRole("dialog", { name: "Connect Proton Mail", exact: true });
  await setup.getByLabel("Proton email or username").fill("sender");
  await setup.getByLabel("Proton password").fill("incorrect-password");
  await setup.getByRole("button", { name: "Connect Proton Mail" }).click();
  await expect(setup.getByRole("alert")).toBeVisible({ timeout: 60_000 });
  await setup.getByLabel("Proton password").fill("fixture-password");
  await setup.getByRole("button", { name: "Connect Proton Mail" }).click();
  await expect(setup).toBeHidden({ timeout: 60_000 });

  const delivery = await page.evaluate(async () => {
    const native = window.supermail!;
    const config = { host: "supermail-proton-android", username: "sender@proton.local" };
    const rows = await native.db!.select("SELECT email, imap_host, accept_invalid_certs FROM accounts");
    const folders = await native.invoke!("imap_list_folders", { config });
    await native.invoke!("proton_login", { email: "recipient", password: "fixture-password" });
    const raw = btoa("From: sender@proton.local\r\nTo: recipient@proton.local\r\nSubject: Local Android Proton test\r\n\r\nSent by the APK.\r\n")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sent = await native.invoke!("smtp_send_email", { config, raw_email: raw });
    return { rows, folders, sent };
  });
  expect(delivery.rows).toEqual([{ email: "sender@proton.local", imap_host: "supermail-proton-android", accept_invalid_certs: 0 }]);
  expect(delivery.folders).toEqual(expect.arrayContaining([expect.objectContaining({ path: "INBOX" })]));
  expect(delivery.sent).toEqual(expect.objectContaining({ success: true }));

  await expect.poll(() => page.evaluate(async () => {
    const native = window.supermail!;
    const config = { host: "supermail-proton-android", username: "recipient@proton.local" };
    const folder = "INBOX";
    const uids = await native.invoke!<number[]>("imap_search_all_uids", { config, folder });
    if (!uids?.length) return [];
    const result = await native.invoke!<{ messages: { subject: string }[] }>("imap_fetch_messages", { config, folder, uids });
    return result.messages.map((message) => message.subject);
  }), { timeout: 30_000 }).toContain("Local Android Proton test");

  await page.evaluate(async () => {
    await window.supermail!.invoke!("proton_remove", { email: "recipient@proton.local" });
  });
  await expect(page.evaluate(async () => {
    const config = { host: "supermail-proton-android", username: "recipient@proton.local" };
    await window.supermail!.invoke!("imap_list_folders", { config });
  })).rejects.toThrow("sign in to your Proton account again");
});
