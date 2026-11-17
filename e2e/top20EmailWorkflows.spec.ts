import { test, expect } from "@playwright/test";
import { FakeServer } from "./fakeServer";
import { getTauriBridgeScript } from "./tauriBridge";

const FAKE_SERVER_PORT = 3334;
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

test.describe("Top 20 Email Workflows", () => {
  // Helper to setup page with Tauri bridge and navigate to Inbox
  async function setupInboxPage(page: any) {
    await page.addInitScript(getTauriBridgeScript(FAKE_SERVER_PORT));
    page.on("console", (msg: any) => {
      if (msg.type() === "error") {
        console.error(`[Browser Error] ${msg.text()}`);
      }
    });
    await page.goto("http://localhost:1420/#/mail/inbox");
    // Wait for email list to load
    await expect(page.locator("text=Team Welcome & Onboarding Guide").first()).toBeVisible({ timeout: 15_000 });
  }

  // Storyboard 1: Read & Browse Inbox
  test("1. Read & Browse Inbox: navigates to thread, views formatted email, and marks as read", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Click on the welcome email thread
    const threadCard = page.locator('button[aria-label*="Team Welcome & Onboarding Guide"]').first();
    await expect(threadCard).toBeVisible();
    await threadCard.click();

    // Verify reading pane displays the subject heading
    await expect(page.locator('h1:has-text("Team Welcome & Onboarding Guide")').first()).toBeVisible({ timeout: 10_000 });

    // Verify sender info in reading pane
    await expect(page.locator("text=SuperMail Team").first()).toBeVisible();

    // Verify body content rendered inside the iframe
    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("text=Welcome to SuperMail! Enjoy your fast email client.").first()).toBeVisible();
  });

  // Storyboard 2: Compose and Send New Email
  test("2. Compose and Send New Email: opens composer, addresses recipient, fills content, and sends email", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Click Compose button in the sidebar
    const composeBtn = page.locator('button:has-text("Compose")').first();
    await expect(composeBtn).toBeVisible();
    await composeBtn.click();

    // Verify composer modal opened with 'New Message'
    await expect(page.locator("text=New Message").first()).toBeVisible();

    // Enter Recipient
    const toInput = page.locator('input[aria-label="To"]');
    await toInput.fill("colleague@workplace.org");
    await toInput.press("Enter");
    await expect(page.locator("span:has-text('colleague@workplace.org')").first()).toBeVisible();

    // Enter Subject
    const subjectInput = page.locator('input[placeholder="Subject"]');
    await subjectInput.fill("Project Milestone Review");

    // Enter Body in TipTap editor
    const editor = page.locator(".tiptap.ProseMirror");
    await editor.click();
    await editor.fill("Hi Dave, here is the milestone breakdown for our review.");

    // Click Send button
    const sendBtn = page.locator('button:has-text("Send")').first();
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // Verify composer closes
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);

    // Verify email was sent through SMTP
    expect(fakeServer.state.sentEmails.length).toBeGreaterThanOrEqual(1);
  });

  // Storyboard 3: Reply to Sender
  test("3. Reply to Sender: opens reply mode with quoted context, types response, and sends", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Select colleague thread
    const threadCard = page.locator('button[aria-label*="Sprint Retrospective Notes"]').first();
    await threadCard.click();

    // Click Reply button in ActionBar
    const replyBtn = page.locator('button[title*="Reply (r)"]').first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.click();

    // Composer opens in Reply mode
    await expect(page.locator(".slide-up-panel")).toBeVisible();
    await expect(page.locator('input[value*="Re: Sprint Retrospective Notes"]')).toBeVisible();

    // Type reply message
    const editor = page.locator(".tiptap.ProseMirror");
    await editor.click();
    await editor.fill("Thanks Sarah, looks great! I will review the action items.");

    // Click Send
    const sendBtn = page.locator('button:has-text("Send")').first();
    await sendBtn.click();

    // Composer closes
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);
    expect(fakeServer.state.sentEmails.length).toBeGreaterThanOrEqual(1);
  });

  // Storyboard 4: Reply All
  test("4. Reply All: preserves all original recipients and CC addresses on reply", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Select multi-recipient thread
    const threadCard = page.locator('button[aria-label*="Quarterly Planning Sync"]').first();
    await threadCard.click();

    // Click Reply All button in ActionBar
    const replyAllBtn = page.locator('button[title*="Reply All (a)"]').first();
    await expect(replyAllBtn).toBeVisible();
    await replyAllBtn.click();

    // Verify Reply All composer title and recipients
    await expect(page.locator(".slide-up-panel")).toBeVisible();
    await expect(page.locator("span:has-text('sarah@workplace.org')").first()).toBeVisible();

    // Type reply body
    const editor = page.locator(".tiptap.ProseMirror");
    await editor.click();
    await editor.fill("Confirmed, see everyone at the sync.");

    // Send
    const sendBtn = page.locator('button:has-text("Send")').first();
    await sendBtn.click();
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);
    expect(fakeServer.state.sentEmails.length).toBeGreaterThanOrEqual(1);
  });

  // Storyboard 5: Forward Email
  test("5. Forward Email: opens forward composer with 'Fwd:' subject prefix and quotes", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Select report thread
    const threadCard = page.locator('button[aria-label*="Quarterly Client Growth Report"]').first();
    await threadCard.click();

    // Click Forward button
    const forwardBtn = page.locator('button[title*="Forward (f)"]').first();
    await expect(forwardBtn).toBeVisible();
    await forwardBtn.click();

    // Verify Forward composer opened
    await expect(page.locator(".slide-up-panel")).toBeVisible();
    await expect(page.locator('input[value*="Fwd: Quarterly Client Growth Report"]')).toBeVisible();

    // Enter recipient
    const toInput = page.locator('input[aria-label="To"]');
    await toInput.fill("manager@workplace.org");
    await toInput.press("Enter");

    // Click Send
    const sendBtn = page.locator('button:has-text("Send")').first();
    await sendBtn.click();
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);
    expect(fakeServer.state.sentEmails.length).toBeGreaterThanOrEqual(1);
  });

  // Storyboard 6: Archive Email (Inbox Zero)
  test("6. Archive Email: removes thread from Inbox toward Inbox Zero", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Thread is initially in Inbox
    const threadTitle = "DevOps System Maintenance Notification";
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible();

    // Click thread and archive it
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    const archiveBtn = page.locator('button[title*="Archive (e)"]').first();
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    // Thread is immediately removed from the active inbox list
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);
  });

  // Storyboard 7: Delete / Trash Email
  test("7. Delete / Trash Email: moves unwanted email from Inbox into Trash folder", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Special Limited 50% Off Discount";
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible();

    // Click thread and delete it
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    const deleteBtn = page.locator('button[title*="Delete (#)"]').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Verify removed from Inbox
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);

    // Navigate to Trash folder via sidebar nav item
    const trashNavBtn = page.locator('aside button:has-text("Trash")').first();
    await trashNavBtn.click();
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 8: Star / Flag Important Email
  test("8. Star / Flag Important Email: marks thread with star and displays in Starred view", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Annual Tax Statement & Salary Slip";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    // Click Star button in ActionBar
    const starBtn = page.locator('button[title*="Star (s)"]').first();
    await expect(starBtn).toBeVisible();
    await starBtn.click();

    // Verify button switches to 'Unstar (s)'
    await expect(page.locator('button[title*="Unstar (s)"]').first()).toBeVisible();

    // Navigate to Starred view in sidebar
    const starredNavBtn = page.locator('aside button:has-text("Starred")').first();
    await starredNavBtn.click();
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 9: Pin Urgent Thread
  test("9. Pin Urgent Thread: pins high-priority thread to the top of the email list", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "URGENT: Production Server Latency Alert";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    // Click Pin button in ActionBar
    const pinBtn = page.locator('button[title*="Pin (p)"]').first();
    await expect(pinBtn).toBeVisible();
    await pinBtn.click();

    // Verify pin state toggles to 'Unpin (p)'
    await expect(page.locator('button[title*="Unpin (p)"]').first()).toBeVisible();

    // Verify 'Other emails' section divider appears separating pinned from unpinned
    await expect(page.locator("text=Other emails").first()).toBeVisible();
  });

  // Storyboard 10: Search Emails
  test("10. Search Emails: filters list by query keywords and isolates matching conversations", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Locate SearchBar input
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Roadmap");
    await searchInput.press("Enter");

    // Matching thread is shown
    await expect(page.locator("text=Q4 Product Roadmap & Vision").first()).toBeVisible();

    // Non-matching thread is filtered out
    await expect(page.locator("text=Special Limited 50% Off Discount")).toHaveCount(0);
  });

  // Storyboard 11: Organize / Move to Folder (Apply Label)
  test("11. Organize / Move to Folder: moves thread into user-created label folder", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Client Alpha Contract Discussion";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    // Click Move to folder button in ActionBar
    const moveBtn = page.locator('button[title*="Move to folder (v)"]').first();
    await expect(moveBtn).toBeVisible();
    await moveBtn.click();

    // Move modal opens; select 'Projects' destination inside the dialog listbox
    const dialogListbox = page.locator('[role="listbox"]').first();
    await expect(dialogListbox).toBeVisible();
    const projectsOption = dialogListbox.locator('button:has-text("Projects")').first();
    await expect(projectsOption).toBeVisible();
    await projectsOption.click();

    // Modal closes upon destination selection
    await expect(page.locator('[role="listbox"]')).toHaveCount(0);
  });

  // Storyboard 12: Mark as Unread
  test("12. Mark as Unread: toggles an opened email back to unread status for later follow-up", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Annual Benefits Enrollment Deadline";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    // Thread is read; click 'Mark unread' button in ActionBar
    const markUnreadBtn = page.locator('button[title="Mark unread"]').first();
    await expect(markUnreadBtn).toBeVisible();
    await markUnreadBtn.click();

    // Verify button switches to 'Mark read'
    await expect(page.locator('button[title="Mark read"]').first()).toBeVisible();
  });

  // Storyboard 13: Snooze Email
  test("13. Snooze Email: snoozes an email until tomorrow, temporarily removing it from Inbox", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Weekly Book Club Suggestions";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    // Click Snooze button
    const snoozeBtn = page.locator('button[title*="Snooze (h)"]').first();
    await expect(snoozeBtn).toBeVisible();
    await snoozeBtn.click();

    // In SnoozeDialog modal, click 'Tomorrow' preset
    const tomorrowBtn = page.locator('button:has-text("Tomorrow")').first();
    await expect(tomorrowBtn).toBeVisible();
    await tomorrowBtn.click();

    // Thread is removed from active inbox
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);

    // Navigate to Snoozed view in sidebar
    const snoozedNavBtn = page.locator('aside button:has-text("Snoozed")').first();
    await snoozedNavBtn.click();
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 14: Schedule Send
  test("14. Schedule Send: sets a future delivery time for an outbound email", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Open composer
    const composeBtn = page.locator('button:has-text("Compose")').first();
    await composeBtn.click();

    // Enter recipient and subject
    const toInput = page.locator('input[aria-label="To"]');
    await toInput.fill("team@workplace.org");
    await toInput.press("Enter");

    const subjectInput = page.locator('input[placeholder="Subject"]');
    await subjectInput.fill("Morning Standup Agenda");

    // Click Schedule Send trigger button
    const scheduleTrigger = page.locator('button[title="Schedule send"]').first();
    await expect(scheduleTrigger).toBeVisible();
    await scheduleTrigger.click();

    // Select Tomorrow morning preset
    const presetBtn = page.locator('button:has-text("Tomorrow morning")').first();
    await expect(presetBtn).toBeVisible();
    await presetBtn.click();

    // Composer closes upon successful scheduling
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);
  });

  // Storyboard 15: Auto-Save & Resume Draft
  test("15. Auto-Save & Resume Draft: navigates to Drafts and resumes composing saved message", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Navigate to Drafts via sidebar
    const draftsNavBtn = page.locator('aside button:has-text("Drafts")').first();
    await draftsNavBtn.click();

    // Draft thread is present in Drafts view
    const draftTitle = "Draft Proposal for Q3 Campaign";
    const draftCard = page.locator(`text=${draftTitle}`).first();
    await expect(draftCard).toBeVisible({ timeout: 15_000 });
    await draftCard.click();

    // Composer automatically opens with pre-populated draft content
    await expect(page.locator('input[value="Draft Proposal for Q3 Campaign"]')).toBeVisible();
    await expect(page.locator("span:has-text('marketing@workplace.org')").first()).toBeVisible();

    // Discard draft cleanly
    const discardBtn = page.locator('button:has-text("Discard")').first();
    await discardBtn.click();
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);
  });

  // Storyboard 16: Attach Files & View Attachment Library
  test("16. Attach Files & Attachment Library: displays message attachments and centralized attachment browser", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Open email containing attachment
    const threadCard = page.locator('button[aria-label*="Financial Report Attached"]').first();
    await threadCard.click();

    // Verify attachment badge / pill in reading pane
    await expect(page.locator("text=Quarterly_Financial_Report.pdf").first()).toBeVisible();

    // Navigate to central Attachment Library via sidebar
    const attachmentsNavBtn = page.locator('aside button:has-text("Attachments")').first();
    await attachmentsNavBtn.click();
    await expect(page.locator("text=Quarterly_Financial_Report.pdf").first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 17: Calendar Invite & One-Click RSVP
  test("17. Calendar Invite & RSVP: detects .ics event and allows one-click Accept response", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Open calendar invite email
    const threadCard = page.locator('button[aria-label*="Meeting: Design System Architecture Review"]').first();
    await threadCard.click();

    // CalendarInviteBanner is visible
    await expect(page.locator("text=Design System Architecture Review").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Conference Room B").first()).toBeVisible();

    // Click Accept button
    const acceptBtn = page.locator('button:has-text("Accept")').first();
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // RSVP updates to 'Accepted'
    await expect(page.locator("text=Accepted").first()).toBeVisible();
    await expect(page.locator("text=You accepted this invitation").first()).toBeVisible();
  });

  // Storyboard 18: One-Click Unsubscribe from Mailing List
  test("18. One-Click Unsubscribe: executes RFC 8058 one-click unsubscribe and auto-archives newsletter", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Weekly Retail Promotions & Discounts";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await expect(threadCard).toBeVisible();
    await threadCard.click();

    // Verify Unsubscribe action in ActionBar
    const unsubBtn = page.locator('button[title*="Unsubscribe"]').first();
    await expect(unsubBtn).toBeVisible();
    await unsubBtn.click();

    // Unsubscribe HTTP request made to fake server
    await expect.poll(() => fakeServer.state.unsubscribes.length).toBeGreaterThanOrEqual(1);

    // Newsletter is auto-archived from Inbox
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);
  });

  // Storyboard 19: Report Spam / Phishing Safety
  test("19. Report Spam / Phishing Safety: displays auth failure warning and moves email to Spam", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "URGENT: Verify Your Bank Account Immediately";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.click();

    // AuthWarningBanner displayed due to SPF/DKIM/DMARC failure
    await expect(page.locator("text=Authentication failed").first()).toBeVisible();

    // Click Report Spam button
    const spamBtn = page.locator('button[title*="Report Spam (!)"]').first();
    await expect(spamBtn).toBeVisible();
    await spamBtn.click();

    // Thread removed from Inbox
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);

    // Verify listed under Spam folder via sidebar nav
    const spamNavBtn = page.locator('aside button:has-text("Spam")').first();
    await spamNavBtn.click();
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 20: Multi-Select Bulk Actions
  test("20. Multi-Select Bulk Actions: selects multiple threads and archives them simultaneously", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadA = "Weekly Analytics Digest Vol 1";
    const threadB = "Weekly Analytics Digest Vol 2";

    const cardA = page.locator(`button[aria-label*="${threadA}"]`).first();
    const cardB = page.locator(`button[aria-label*="${threadB}"]`).first();

    await expect(cardA).toBeVisible();
    await expect(cardB).toBeVisible();

    // Click with Ctrl/Meta key to toggle multi-select
    await cardA.click({ modifiers: ["Control"] });
    await cardB.click({ modifiers: ["Control"] });

    // Multi-select bar appears showing '2 selected'
    const bulkBar = page.locator("text=2 selected").first();
    await expect(bulkBar).toBeVisible();

    // Click Archive selected button in the floating multi-select bar
    const bulkArchiveBtn = page.locator('button[title="Archive selected"]').first();
    await expect(bulkArchiveBtn).toBeVisible();
    await bulkArchiveBtn.click();

    // Both threads removed from Inbox
    await expect(page.locator(`text=${threadA}`)).toHaveCount(0);
    await expect(page.locator(`text=${threadB}`)).toHaveCount(0);
  });
});
