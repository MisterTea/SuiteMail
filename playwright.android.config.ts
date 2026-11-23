import { defineConfig } from '@playwright/test';

process.env.SUITEMAIL_ANDROID = '1';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/top20EmailWorkflows.spec.ts','**/aiFilterWorkflow.spec.ts','**/androidNative.spec.ts','**/androidAccounts.spec.ts','**/androidEmailLayout.spec.ts','**/calendarTouch.spec.ts','**/smartCalendar.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: 'test-results/android',
  reporter: [['list'],['json',{outputFile:'test-results/android-results.json'}]],
  use: { actionTimeout: 15_000, screenshot: 'only-on-failure' },
});
