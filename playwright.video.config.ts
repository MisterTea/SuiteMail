import { defineConfig, devices } from "@playwright/test";
import path from "path";

const slowMo = process.env.SLOW_MO ? parseInt(process.env.SLOW_MO, 10) : 650;
const videoWidth = process.env.VIDEO_WIDTH ? parseInt(process.env.VIDEO_WIDTH, 10) : 390;
const videoHeight = process.env.VIDEO_HEIGHT ? parseInt(process.env.VIDEO_HEIGHT, 10) : 844;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/top20EmailWorkflows.spec.ts",
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [path.resolve("./e2e/videoReporter.ts"), { outputFile: path.resolve("./test-results/video-manifest.json") }],
  ],
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: videoWidth, height: videoHeight },
    isMobile: true,
    hasTouch: true,
    video: {
      mode: "on",
      size: { width: videoWidth, height: videoHeight },
    },
    launchOptions: slowMo > 0 ? { slowMo } : undefined,
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: videoWidth, height: videoHeight },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
