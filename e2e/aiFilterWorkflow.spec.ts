import { test, expect } from "@playwright/test";
import { FakeServer } from "./fakeServer";
import { getTauriBridgeScript } from "./tauriBridge";

const FAKE_SERVER_PORT = 3333;
let fakeServer: FakeServer;

test.beforeAll(async () => {
  fakeServer = new FakeServer(FAKE_SERVER_PORT);
  await fakeServer.start();
});

test.afterAll(async () => {
  await fakeServer.stop();
});

test.beforeEach(async () => {
  fakeServer.reset();
});

test.describe("AI Filter Suggestion & Retroactive Sync Workflow", () => {
  test("asks AI to create a filter, previews affected emails, accepts with retroactive filtering, and syncs changes to fake server", async ({
    page,
  }) => {
    // 1. Inject the Tauri IPC bridge connected to our Fake Server
    await page.addInitScript(getTauriBridgeScript(FAKE_SERVER_PORT));

    // Capture browser console logs for debug visibility
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Browser Error] ${msg.text()}`);
      }
    });

    // 2. Navigate to Settings and open Mail Rules tab
    await page.goto("http://localhost:1420/#/settings/mail-rules");

    const mailRulesTab = page.locator('button:has-text("Mail Rules")');
    await expect(mailRulesTab).toBeVisible({ timeout: 15_000 });
    await mailRulesTab.click();

    // 3. Verify Filters section loaded and click "Suggest filter with Pi Agent"
    const suggestButton = page.locator('button:has-text("Suggest filter with Pi Agent")');
    await expect(suggestButton).toBeVisible({ timeout: 15_000 });
    await suggestButton.click();

    // 4. Modal opens with title and AI prompt input
    const modalTitle = page.locator("text=AI Filter Assistant");
    await expect(modalTitle).toBeVisible();

    const promptTextarea = page.locator("textarea");
    await expect(promptTextarea).toBeVisible();

    // 5. User enters the natural language filter request
    await promptTextarea.fill(
      "Move all newsletters from Tech Weekly into a new Newsletters folder and mark as read",
    );

    // 6. User clicks "Generate Filter"
    const generateButton = page.locator('button:has-text("Generate Filter")');
    await expect(generateButton).toBeEnabled();
    await generateButton.click();

    // 7. Verify AI contacted our Fake Server and modal transitions to Accept/Reject pane
    const reviewHeader = page.locator("text=Review Filter & Affected Emails");
    await expect(reviewHeader).toBeVisible({ timeout: 15_000 });

    const filterNameInput = page.locator('input[value="Tech Weekly Newsletters"]');
    await expect(filterNameInput).toBeVisible();

    // Verify folder creation notice
    const folderNotice = page.locator('text=Creates new folder: "Newsletters"');
    await expect(folderNotice).toBeVisible();

    // Verify Criteria and Actions in the preview
    await expect(page.locator("text=newsletter@techweekly.com").first()).toBeVisible();
    await expect(page.locator("text=Archive from Inbox").first()).toBeVisible();
    await expect(page.locator("text=Mark as read").first()).toBeVisible();

    // 8. Verify Affected Emails preview list
    // Thread 1 and Thread 2 should be listed as affected
    await expect(page.locator("text=Tech Weekly #101: AI Agents & Innovations")).toBeVisible();
    await expect(page.locator("text=Tech Weekly #102: Deep Dive into Gemma 4")).toBeVisible();

    // Thread 3 (Sprint Retrospective) should NOT be in the affected list
    await expect(page.locator("text=Sprint Retrospective Notes")).toHaveCount(0);

    // 9. Verify the "Apply this new filter to whole inbox" checkbox is present and checked
    const wholeInboxCheckbox = page.locator(
      'label:has-text("Apply this new filter to whole inbox")',
    );
    await expect(wholeInboxCheckbox).toBeVisible();
    const checkboxInput = page.locator('input[type="checkbox"]');
    await expect(checkboxInput).toBeChecked();

    // 10. Click "Add Filter (Highest Priority)" to accept
    const addFilterButton = page.locator('button:has-text("Add Filter (Highest Priority)")');
    await expect(addFilterButton).toBeVisible();
    await addFilterButton.click();

    // 11. Modal closes upon successful addition
    await expect(reviewHeader).toBeHidden({ timeout: 10_000 });

    // 12. VERIFY RETROACTIVE FILTERING IN DATABASE
    // Verify that the 2 affected Tech Weekly threads were updated in SQLite:
    const tw1Thread = fakeServer.db
      .prepare("SELECT is_read FROM threads WHERE id = 't-tw-1'")
      .get() as { is_read: number };
    expect(tw1Thread.is_read).toBe(1);

    const tw2Thread = fakeServer.db
      .prepare("SELECT is_read FROM threads WHERE id = 't-tw-2'")
      .get() as { is_read: number };
    expect(tw2Thread.is_read).toBe(1);

    // Verify un-affected thread remains unread
    const workThread = fakeServer.db
      .prepare("SELECT is_read FROM threads WHERE id = 't-work-3'")
      .get() as { is_read: number };
    expect(workThread.is_read).toBe(0);

    // Verify thread labels: t-tw-1 and t-tw-2 moved out of INBOX and labeled with new folder
    const tw1Labels = fakeServer.db
      .prepare("SELECT label_id FROM thread_labels WHERE thread_id = 't-tw-1'")
      .all() as Array<{ label_id: string }>;
    const tw1LabelIds = tw1Labels.map((l) => l.label_id);
    expect(tw1LabelIds).not.toContain("INBOX");
    expect(tw1LabelIds.length).toBeGreaterThan(0);

    // Verify folder was created in labels table
    const createdFolder = fakeServer.db
      .prepare("SELECT * FROM labels WHERE account_id = 'acc-test-1' AND name = 'Newsletters'")
      .get();
    expect(createdFolder).toBeTruthy();

    // Verify filter rule was created in filter_rules table with highest priority
    const filterRule = fakeServer.db
      .prepare("SELECT * FROM filter_rules WHERE account_id = 'acc-test-1' AND name = 'Tech Weekly Newsletters'")
      .get() as { id: string; name: string; criteria: string; actions: string; sort_order: number };
    expect(filterRule).toBeTruthy();
    expect(filterRule.name).toBe("Tech Weekly Newsletters");

    // 13. VERIFY SYNC WITH FAKE SERVER
    // Fake Server received the AI completions request
    expect(fakeServer.state.aiRequests.length).toBeGreaterThanOrEqual(1);
    const aiReq = fakeServer.state.aiRequests[0];
    const aiMessages = (aiReq.body as any)?.messages || [];
    const userPrompt = aiMessages.find((m: any) => m.role === "user")?.content;
    expect(userPrompt).toContain("newsletter");

    // Fake Server received the settings sidecar sync containing the newly added filter
    await expect
      .poll(
        () =>
          fakeServer.state.syncedFilters.find(
            (s) => s.folder === ".settings/filters" || s.folder?.includes("filters"),
          ),
        { timeout: 10_000 },
      )
      .toBeDefined();

    const synced = fakeServer.state.syncedFilters.find(
      (s) => s.folder === ".settings/filters" || s.folder?.includes("filters"),
    )!;
    expect(synced.folder).toContain("filters");

    // Verify the synced payload contains the filter
    const syncedPayload = synced.payload as any;
    expect(syncedPayload.filters).toBeDefined();
    const syncedFilter = syncedPayload.filters.find(
      (f: any) => f.name === "Tech Weekly Newsletters",
    );
    expect(syncedFilter).toBeDefined();
    expect(syncedFilter.criteria.from).toBe("newsletter@techweekly.com");
    expect(syncedFilter.actions.archive).toBe(true);
    expect(syncedFilter.actions.markRead).toBe(true);
  });

  test("accepting a filter with retroactive checkbox unchecked saves filter and syncs without altering existing inbox emails", async ({
    page,
  }) => {
    await page.addInitScript(getTauriBridgeScript(FAKE_SERVER_PORT));
    await page.goto("http://localhost:1420/#/settings/mail-rules");

    const mailRulesTab = page.locator('button:has-text("Mail Rules")');
    await expect(mailRulesTab).toBeVisible({ timeout: 15_000 });
    await mailRulesTab.click();

    const suggestButton = page.locator('button:has-text("Suggest filter with Pi Agent")');
    await expect(suggestButton).toBeVisible({ timeout: 15_000 });
    await suggestButton.click();

    const promptTextarea = page.locator("textarea");
    await expect(promptTextarea).toBeVisible();
    await promptTextarea.fill(
      "Move all newsletters from Tech Weekly into a new Newsletters folder and mark as read",
    );

    const generateButton = page.locator('button:has-text("Generate Filter")');
    await generateButton.click();

    const reviewHeader = page.locator("text=Review Filter & Affected Emails");
    await expect(reviewHeader).toBeVisible({ timeout: 15_000 });

    // UNCHECK the retroactive checkbox
    const checkboxInput = page.locator('input[type="checkbox"]');
    await expect(checkboxInput).toBeChecked();
    await checkboxInput.uncheck();
    await expect(checkboxInput).not.toBeChecked();

    // Click "Add Filter (Highest Priority)"
    const addFilterButton = page.locator('button:has-text("Add Filter (Highest Priority)")');
    await addFilterButton.click();
    await expect(reviewHeader).toBeHidden({ timeout: 10_000 });

    // VERIFY DATABASE: Filter rule is created
    const filterRule = fakeServer.db
      .prepare("SELECT * FROM filter_rules WHERE account_id = 'acc-test-1' AND name = 'Tech Weekly Newsletters'")
      .get();
    expect(filterRule).toBeTruthy();

    // Existing emails are NOT updated retroactively (they remain unread with is_read = 0)
    const tw1Thread = fakeServer.db
      .prepare("SELECT is_read FROM threads WHERE id = 't-tw-1'")
      .get() as { is_read: number };
    expect(tw1Thread.is_read).toBe(0);

    const tw2Thread = fakeServer.db
      .prepare("SELECT is_read FROM threads WHERE id = 't-tw-2'")
      .get() as { is_read: number };
    expect(tw2Thread.is_read).toBe(0);

    // Sync to fake server still succeeds
    await expect
      .poll(
        () =>
          fakeServer.state.syncedFilters.find(
            (s) => s.folder === ".settings/filters" || s.folder?.includes("filters"),
          ),
        { timeout: 10_000 },
      )
      .toBeDefined();
  });

  test("manual filter creation transitions to same accept/reject pane with retroactive filtering preview and sync", async ({
    page,
  }) => {
    await page.addInitScript(getTauriBridgeScript(FAKE_SERVER_PORT));
    await page.goto("http://localhost:1420/#/settings/mail-rules");

    const mailRulesTab = page.locator('button:has-text("Mail Rules")');
    await expect(mailRulesTab).toBeVisible({ timeout: 15_000 });
    await mailRulesTab.click();

    // Click "+ Add filter" to open Manual filter creation modal
    const addFilterButton = page.locator('button:has-text("+ Add filter")');
    await expect(addFilterButton).toBeVisible({ timeout: 15_000 });
    await addFilterButton.click();

    // Verify modal is in Manual mode
    const manualHeader = page.locator("text=Create Filter Manually");
    await expect(manualHeader).toBeVisible();

    // Fill manual form
    const filterNameField = page.locator('input[placeholder="e.g. Important Client Updates"]');
    await filterNameField.fill("Manual Tech Filter");

    const fromField = page.locator('input[placeholder="e.g. boss@corp.com or github.com"]');
    await fromField.fill("newsletter@techweekly.com");

    const newFolderField = page.locator('input[placeholder="e.g. Invoices, Taxes, ClientB"]');
    await newFolderField.fill("TechArchive");

    // Check Mark as Read and Archive checkboxes
    const markReadLabel = page.locator('label:has-text("Mark as read")');
    await markReadLabel.click();

    const archiveLabel = page.locator('label:has-text("Archive from Inbox")');
    await archiveLabel.click();

    // Click "Preview & Continue"
    const previewButton = page.locator('button:has-text("Preview & Continue")');
    await previewButton.click();

    // Transitions to the exact same Accept/Reject pane
    const reviewHeader = page.locator("text=Review Filter & Affected Emails");
    await expect(reviewHeader).toBeVisible({ timeout: 15_000 });

    // Verify preview contents
    await expect(page.locator('input[value="Manual Tech Filter"]')).toBeVisible();
    await expect(page.locator('text=Creates new folder: "TechArchive"')).toBeVisible();
    await expect(page.locator("text=Tech Weekly #101: AI Agents & Innovations")).toBeVisible();
    await expect(page.locator("text=Tech Weekly #102: Deep Dive into Gemma 4")).toBeVisible();

    // Accept filter
    const confirmAddButton = page.locator('button:has-text("Add Filter (Highest Priority)")');
    await confirmAddButton.click();
    await expect(reviewHeader).toBeHidden({ timeout: 10_000 });

    // Verify retroactive updates executed
    const tw1Thread = fakeServer.db
      .prepare("SELECT is_read FROM threads WHERE id = 't-tw-1'")
      .get() as { is_read: number };
    expect(tw1Thread.is_read).toBe(1);

    // Verify folder TechArchive created in DB
    const folder = fakeServer.db
      .prepare("SELECT * FROM labels WHERE name = 'TechArchive'")
      .get();
    expect(folder).toBeTruthy();

    // Verify synced to fake server
    await expect
      .poll(
        () =>
          fakeServer.state.syncedFilters.find(
            (s) => s.folder === ".settings/filters" || s.folder?.includes("filters"),
          ),
        { timeout: 10_000 },
      )
      .toBeDefined();
  });
});
