import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { FakeServer } from "../e2e/fakeServer";
import { getTauriBridgeScript } from "../e2e/tauriBridge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const RECORDINGS_DIR = path.resolve(ROOT_DIR, "recordings");
const FAKE_SERVER_PORT = 3334;
const DEV_SERVER_PORT = 1420;
const CDP_PORT = 9223;

const adbPath = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe")
  : "adb";

function runAdb(args: string[]): string {
  return execSync(`"${adbPath}" ${args.join(" ")}`, { encoding: "utf8" }).trim();
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("\n=======================================================");
  console.log("   SuiteMail Android Emulator Storyboard Recorder");
  console.log("=======================================================\n");

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  // 1. Verify Android Emulator is running
  const devicesOutput = runAdb(["devices"]);
  console.log("ADB Devices:\n" + devicesOutput);
  if (!devicesOutput.includes("emulator") && !devicesOutput.includes("\tdevice")) {
    console.error("[ERROR] No online Android emulator/device detected.");
    process.exit(1);
  }

  // 2. Start FakeServer
  console.log("▶ Starting FakeServer on port " + FAKE_SERVER_PORT + "...");
  const fakeServer = new FakeServer(FAKE_SERVER_PORT);
  await fakeServer.start();
  fakeServer.reset();

  // 3. Start Vite Dev Server
  console.log("▶ Starting Vite dev server on port " + DEV_SERVER_PORT + "...");
  const viteProcess = spawn("npx", ["vite", "--host", "0.0.0.0", "--port", String(DEV_SERVER_PORT), "--strictPort"], {
    cwd: ROOT_DIR,
    shell: true,
    stdio: "pipe",
    env: { ...process.env, TAURI_DEV_HOST: "0.0.0.0" },
  });

  viteProcess.stderr?.on("data", (data) => {
    // suppress minor vite logs
  });

  // Wait for dev server port
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${DEV_SERVER_PORT}`);
      if (res.ok || res.status === 200) {
        serverReady = true;
        break;
      }
    } catch {}
    await sleep(1000);
  }

  if (!serverReady) {
    console.error("[ERROR] Vite dev server failed to start.");
    viteProcess.kill();
    await fakeServer.stop();
    process.exit(1);
  }
  console.log("✓ Vite dev server is running!");

  // 4. Reverse forward ports to Android emulator
  console.log("▶ Configuring ADB reverse ports...");
  runAdb(["reverse", `tcp:${DEV_SERVER_PORT}`, `tcp:${DEV_SERVER_PORT}`]);
  runAdb(["reverse", `tcp:${FAKE_SERVER_PORT}`, `tcp:${FAKE_SERVER_PORT}`]);

  // 5. Forward Chrome DevTools socket
  runAdb(["forward", `tcp:${CDP_PORT}`, "localabstract:chrome_devtools_remote"]);

  // 6. Launch Chrome on the emulator
  console.log("▶ Launching Chrome on the Android emulator...");
  runAdb(["shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main"]);
  await sleep(2000);

  // 7. Start on-device screen recording
  console.log("▶ Starting screenrecord on Android emulator...");
  runAdb(["shell", "rm", "-f", "/sdcard/emulator_live_storyboards.mp4"]);
  const screenrecordProcess = spawn(
    adbPath,
    ["shell", "screenrecord", "--bit-rate", "8000000", "/sdcard/emulator_live_storyboards.mp4"],
    { stdio: "ignore" }
  );

  // Give screenrecord a second to initialize
  await sleep(1500);

  try {
    // 8. Connect Playwright to Android Chrome via CDP
    console.log("▶ Connecting Playwright over CDP to Android emulator...");
    const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
    const context = browser.contexts()[0];
    const pages = context.pages();
    const page = pages[0] || (await context.newPage());

    // Inject Tauri Bridge
    await page.addInitScript(getTauriBridgeScript(FAKE_SERVER_PORT));

    console.log("▶ Navigating Android Chrome to SuiteMail inbox...");
    await page.goto(`http://localhost:${DEV_SERVER_PORT}/#/mail/inbox`, { waitUntil: "networkidle" });
    await sleep(2500);

    // --- Storyboard 1: Read & Browse Inbox ---
    console.log("  ▶ [Storyboard 1] Read & Browse Inbox...");
    const threadCard = page.locator('button[aria-label*="Team Welcome & Onboarding Guide"]').first();
    await threadCard.waitFor({ state: "visible", timeout: 15000 });
    await sleep(1000);
    await threadCard.tap();
    await sleep(2000);

    // Verify reading pane displays the subject heading
    const heading = page.locator('h1:has-text("Team Welcome & Onboarding Guide")').first();
    await heading.waitFor({ state: "visible", timeout: 10000 });
    console.log("    ✓ Opened thread & displayed formatted reading pane");
    await sleep(2000);

    // --- Storyboard 2: Compose and Send New Email ---
    console.log("  ▶ [Storyboard 2] Compose and Send New Email...");
    const composeBtn = page.locator('button:has-text("Compose"):visible').first();
    await composeBtn.waitFor({ state: "visible", timeout: 10000 });
    await composeBtn.tap();
    await sleep(1500);

    const toInput = page.locator('input[aria-label="To"]');
    await toInput.fill("partner@suitemail.org");
    await toInput.press("Enter");
    await sleep(800);

    const subjectInput = page.locator('input[placeholder="Subject"]');
    await subjectInput.fill("SuiteMail On-Device AICore Deployment");
    await sleep(800);

    const editor = page.locator(".tiptap.ProseMirror");
    await editor.tap();
    await editor.fill("Testing end-to-end storyboard execution on Android with on-device AICore Max AI mode.");
    await sleep(1200);

    const sendBtn = page.locator('button:has-text("Send")').first();
    await sendBtn.tap();
    console.log("    ✓ Composed and sent email successfully");
    await sleep(2500);

    // --- Storyboard 8: Star / Flag Important Email ---
    console.log("  ▶ [Storyboard 8] Star / Flag Important Email...");
    const starBtn = page.locator('button[aria-label*="Star"], button[title*="Star"]').first();
    if (await starBtn.isVisible()) {
      await starBtn.tap();
      await sleep(1000);
      console.log("    ✓ Starred message");
    }

    // --- Storyboard 10: Search Emails ---
    console.log("  ▶ [Storyboard 10] Search Emails...");
    const searchInput = page.locator('input[placeholder*="Search"], input[aria-label*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("Security");
      await searchInput.press("Enter");
      await sleep(2000);
      console.log("    ✓ Searched inbox for 'Security'");
      await searchInput.fill("");
      await searchInput.press("Enter");
      await sleep(1500);
    }

    // --- Storyboard 6: Archive Email ---
    console.log("  ▶ [Storyboard 6] Archive Email...");
    const archiveBtn = page.locator('button[aria-label*="Archive"], button[title*="Archive"]').first();
    if (await archiveBtn.isVisible()) {
      await archiveBtn.tap();
      await sleep(1500);
      console.log("    ✓ Archived thread toward Inbox Zero");
    }

    await sleep(2000);
    await browser.close();
  } catch (err) {
    console.error("Error during Android storyboard execution:", err);
  } finally {
    // 9. Stop screenrecord
    console.log("▶ Stopping screenrecord on Android emulator...");
    try {
      runAdb(["shell", "pkill", "-2", "screenrecord"]);
    } catch {}
    await sleep(3000);

    // 10. Pull recorded MP4 file
    const targetMp4 = path.join(RECORDINGS_DIR, "storyboard-android-emulator-live.mp4");
    console.log(`▶ Pulling recorded MP4 to ${targetMp4}...`);
    runAdb(["pull", "/sdcard/emulator_live_storyboards.mp4", targetMp4]);

    // 11. Cleanup processes
    viteProcess.kill();
    await fakeServer.stop();
  }

  const liveMp4Path = path.join(RECORDINGS_DIR, "storyboard-android-emulator-live.mp4");
  if (fs.existsSync(liveMp4Path)) {
    const stats = fs.statSync(liveMp4Path);
    console.log(`\n✓ SUCCESS! Recorded live Android emulator video: ${liveMp4Path} (${(stats.size / 1024 / 1024).toFixed(2)} MB)\n`);
  } else {
    console.error("\n[ERROR] Failed to save recorded Android emulator video.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
