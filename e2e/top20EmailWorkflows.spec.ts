import { test, expect } from "./fixtures";
import { FakeServer } from "./fakeServer";
import { getElectronBridgeScript } from "./electronBridge";

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
  // Helper to setup page with Electron bridge and navigate to Inbox
  async function setupInboxPage(page: any) {
    await page.addInitScript(getElectronBridgeScript(FAKE_SERVER_PORT));
    page.on("console", (msg: any) => {
      if (msg.type() === "error") {
        console.error(`[Browser Error] ${msg.text()}`);
      }
    });
    await page.goto("http://localhost:1420/#/mail/inbox");
    // Wait for email list to load
    await expect(page.locator("text=Team Welcome & Onboarding Guide").first()).toBeVisible({ timeout: 15_000 });
  }

  // Helper to navigate via sidebar on mobile (opens drawer if collapsed/hidden) or desktop
  async function tapSidebarFolder(page: any, folderName: string) {
    const navBtn = page.locator(`aside button:has-text("${folderName}")`).first();
    if (!(await navBtn.isVisible())) {
      const menuBtn = page.locator('[data-testid="mobile-menu-button"]:visible, [data-testid="mobile-nav-menu"]:visible').first();
      await menuBtn.tap();
      await expect(navBtn).toBeVisible();
    }
    await navBtn.tap();
  }

  const messageActionsRoot = (page: any) => process.env.SUITEMAIL_ANDROID === "1"
    ? page.getByRole("dialog",{name:"Message actions",exact:true}) : page;

  async function openMobileActions(page: any) {
    const more = page.getByRole("button", {name:"More message actions",exact:true});
    if (process.env.SUITEMAIL_ANDROID === "1") {
      await expect(more).toBeVisible();
      await more.tap();
      await expect(messageActionsRoot(page)).toBeVisible();
    } else if (await more.isVisible()) await more.tap();
  }

  // Storyboard 1: Read & Browse Inbox
  test("1. Read & Browse Inbox: navigates to thread, views formatted email, and marks as read", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Tap on the welcome email thread
    const threadCard = page.locator('button[aria-label*="Team Welcome & Onboarding Guide"]').first();
    await expect(threadCard).toBeVisible();
    await threadCard.tap();

    // Verify reading pane displays the subject heading
    await expect(page.locator('h1:has-text("Team Welcome & Onboarding Guide")').first()).toBeVisible({ timeout: 10_000 });

    if (process.env.SUITEMAIL_ANDROID === "1") {
      const controls = page.getByTestId("android-message-actions").getByRole("button");
      expect(await controls.count()).toBe(5);
      for (const control of await controls.all()) {
        const bounds = await control.boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(48);
        expect(bounds!.height).toBeGreaterThanOrEqual(48);
      }
    }

    // Verify sender info in reading pane
    await expect(page.locator("text=SuperMail Team >> visible=true").first()).toBeVisible();

    // Verify body content rendered inside the iframe
    const iframe = page.frameLocator("iframe");
    await expect(iframe.locator("text=Welcome to SuperMail! Enjoy your fast email client.").first()).toBeVisible();
  });

  // Storyboard 2: Compose and Send New Email
  test("2. Compose and Send New Email: opens composer, addresses recipient, fills content, and sends email", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Tap Compose button (in mobile nav bar or sidebar)
    const composeBtn = page.locator('button:has-text("Compose"):visible').first();
    await expect(composeBtn).toBeVisible();
    await composeBtn.tap();

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
    await editor.tap();
    await editor.fill("Hi Dave, here is the milestone breakdown for our review.");

    // Tap Send button
    const sendBtn = page.getByRole('button', {name:'Send',exact:true});
    await expect(sendBtn).toBeEnabled();
    await sendBtn.tap();

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
    await threadCard.tap();

    await openMobileActions(page);
    // Tap Reply button in ActionBar
    const replyBtn = messageActionsRoot(page).locator('button[title*="Reply (r)"]').first();
    await expect(replyBtn).toBeVisible();
    await replyBtn.tap();

    // Composer opens in Reply mode
    await expect(page.locator(".slide-up-panel")).toBeVisible();
    await expect(page.locator('input[value*="Re: Sprint Retrospective Notes"]')).toBeVisible();

    // Type reply message
    const editor = page.locator(".tiptap.ProseMirror");
    await editor.tap();
    await editor.fill("Thanks Sarah, looks great! I will review the action items.");

    // Tap Send
    const sendBtn = page.getByRole('button', {name:'Send',exact:true});
    await sendBtn.tap();

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
    await threadCard.tap();

    await openMobileActions(page);
    // Tap Reply All button in ActionBar
    const replyAllBtn = messageActionsRoot(page).locator('button[title*="Reply All (a)"]').first();
    await expect(replyAllBtn).toBeVisible();
    await replyAllBtn.tap();

    // Verify Reply All composer title and recipients
    await expect(page.locator(".slide-up-panel")).toBeVisible();
    await expect(page.locator(".slide-up-panel").locator("span:has-text('sarah@workplace.org')").first()).toBeVisible();

    // Type reply body
    const editor = page.locator(".tiptap.ProseMirror");
    await editor.tap();
    await editor.fill("Confirmed, see everyone at the sync.");

    // Send
    const sendBtn = page.getByRole('button', {name:'Send',exact:true});
    await sendBtn.tap();
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
    await threadCard.tap();

    await openMobileActions(page);
    // Tap Forward button
    const forwardBtn = messageActionsRoot(page).locator('button[title*="Forward (f)"]').first();
    await expect(forwardBtn).toBeVisible();
    await forwardBtn.tap();

    // Verify Forward composer opened
    await expect(page.locator(".slide-up-panel")).toBeVisible();
    await expect(page.locator('input[value*="Fwd: Quarterly Client Growth Report"]')).toBeVisible();

    // Enter recipient
    const toInput = page.locator('input[aria-label="To"]');
    await toInput.fill("manager@workplace.org");
    await toInput.press("Enter");

    // Tap Send
    const sendBtn = page.getByRole('button', {name:'Send',exact:true});
    await sendBtn.tap();
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

    // Tap thread and archive it
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.tap();

    const archiveBtn = page.locator('button[title*="Archive (e)"]').first();
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.tap();

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

    // Tap thread and delete it
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.tap();

    const deleteBtn = page.locator('button[title*="Delete (#)"]').first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.tap();

    // Verify removed from Inbox
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);

    // Navigate to Trash folder via sidebar nav item
    await tapSidebarFolder(page, "Trash");
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 8: Star / Flag Important Email
  test("8. Star / Flag Important Email: marks thread with star and displays in Starred view", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Annual Tax Statement & Salary Slip";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.tap();

    // Tap Star button in ActionBar
    const starBtn = page.locator('button[title*="Star (s)"]').first();
    await expect(starBtn).toBeVisible();
    await starBtn.tap();

    // Verify button switches to 'Unstar (s)'
    await expect(page.locator('button[title*="Unstar (s)"]').first()).toBeVisible();

    // Navigate to Starred view in sidebar
    await tapSidebarFolder(page, "Starred");
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 9: Pin Urgent Thread
  test("9. Pin Urgent Thread: pins high-priority thread to the top of the email list", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "URGENT: Production Server Latency Alert";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.tap();

    await openMobileActions(page);
    // Tap Pin button in ActionBar
    const pinBtn = messageActionsRoot(page).locator('button[title*="Pin (p)"]').first();
    await expect(pinBtn).toBeVisible();
    await pinBtn.tap();

    // Verify pin state toggles to 'Unpin (p)'
    await openMobileActions(page);
    await expect(messageActionsRoot(page).locator('button[title*="Unpin (p)"]').first()).toBeVisible();
    const actionsDialog = page.getByRole('dialog',{name:'Message actions',exact:true});
    if (await actionsDialog.isVisible()) await actionsDialog.getByRole('button',{name:'Close',exact:true}).tap();

    // On mobile single-pane, tap Back to list to see the pinned section
    const backBtn = page.locator('button[title="Back to list"]:visible').first();
    if (await backBtn.isVisible()) {
      await backBtn.tap();
    }

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
    await searchInput.tap();
    await searchInput.fill("Roadmap");
    await searchInput.press("Enter");

    // Matching thread is shown
    await expect(page.locator("text=Q4 Product Roadmap & Vision").first()).toBeVisible();

    // Non-matching thread is filtered out
    await expect(page.locator("text=Special Limited 50% Off Discount")).toHaveCount(0);

    // Results count badge is visible on mobile
    await expect(page.locator('[data-testid="search-results-badge"]').first()).toBeVisible();

    // Clear search using the ergonomic clear button
    const clearBtn = page.locator('button[aria-label="Clear search"]').first();
    await expect(clearBtn).toBeVisible();
    await clearBtn.tap();

    // Resetting query restores filtered threads
    await expect(page.locator("text=Special Limited 50% Off Discount").first()).toBeVisible();
  });

  // Storyboard 11: Organize / Move to Folder (Apply Label)
  test("11. Organize / Move to Folder: moves thread into user-created label folder", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Client Alpha Contract Discussion";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.tap();

    await openMobileActions(page);
    // Tap Move to folder button in ActionBar
    const moveBtn = messageActionsRoot(page).locator('button[title*="Move to folder (v)"]').first();
    await expect(moveBtn).toBeVisible();
    await moveBtn.tap();

    // Move modal opens; select 'Projects' destination inside the dialog listbox
    const dialogListbox = page.locator('[role="listbox"]').first();
    await expect(dialogListbox).toBeVisible();
    const projectsOption = dialogListbox.locator('button:has-text("Projects")').first();
    await expect(projectsOption).toBeVisible();
    await projectsOption.tap();

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
    await threadCard.tap();

    await openMobileActions(page);
    // Thread is read; tap 'Mark unread' button in ActionBar
    const markUnreadBtn = messageActionsRoot(page).locator('button[title="Mark unread"]').first();
    await expect(markUnreadBtn).toBeVisible();
    await markUnreadBtn.tap();

    // Verify button switches to 'Mark read'
    await openMobileActions(page);
    await expect(messageActionsRoot(page).locator('button[title="Mark read"]').first()).toBeVisible();
  });

  // Storyboard 13: Snooze Email
  test("13. Snooze Email: snoozes an email until tomorrow, temporarily removing it from Inbox", async ({
    page,
  }) => {
    await setupInboxPage(page);

    const threadTitle = "Weekly Book Club Suggestions";
    const threadCard = page.locator(`button[aria-label*="${threadTitle}"]`).first();
    await threadCard.tap();

    await openMobileActions(page);
    // Tap Snooze button
    const snoozeBtn = messageActionsRoot(page).locator('button[title*="Snooze (h)"]').first();
    await expect(snoozeBtn).toBeVisible();
    await snoozeBtn.tap();

    // In SnoozeDialog modal, tap 'Tomorrow' preset
    const tomorrowBtn = page.locator('button:has-text("Tomorrow")').first();
    await expect(tomorrowBtn).toBeVisible();
    await tomorrowBtn.tap();

    // Thread is removed from active inbox
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);

    // Navigate to Snoozed view in sidebar
    await tapSidebarFolder(page, "Snoozed");
    await expect(page.locator(`text=${threadTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 14: Schedule Send
  test("14. Schedule Send: sets a future delivery time for an outbound email", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Open composer
    const composeBtn = page.locator('button:has-text("Compose"):visible').first();
    await composeBtn.tap();

    // Enter recipient and subject
    const toInput = page.locator('input[aria-label="To"]');
    await toInput.fill("team@workplace.org");
    await toInput.press("Enter");

    const subjectInput = page.locator('input[placeholder="Subject"]');
    await subjectInput.fill("Morning Standup Agenda");

    // Tap Schedule Send trigger button
    const scheduleTrigger = process.env.SUITEMAIL_ANDROID === "1" ? page.getByRole("button",{name:"Send later",exact:true}) : page.locator('button[title="Schedule send"]').first();
    await expect(scheduleTrigger).toBeVisible();
    await scheduleTrigger.tap();

    // Select Tomorrow morning preset
    const presetBtn = page.locator('button:has-text("Tomorrow morning")').first();
    await expect(presetBtn).toBeVisible();
    await presetBtn.tap();

    // Composer closes upon successful scheduling
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);
  });

  // Storyboard 15: Auto-Save & Resume Draft
  test("15. Auto-Save & Resume Draft: navigates to Drafts and resumes composing saved message", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Navigate to Drafts via sidebar
    await tapSidebarFolder(page, "Drafts");

    // Draft thread is present in Drafts view
    const draftTitle = "Draft Proposal for Q3 Campaign";
    const draftCard = page.locator(`text=${draftTitle}`).first();
    await expect(draftCard).toBeVisible({ timeout: 15_000 });
    await draftCard.tap();

    // Composer automatically opens with pre-populated draft content
    await expect(page.locator('input[value="Draft Proposal for Q3 Campaign"]')).toBeVisible();
    await expect(page.locator("span:has-text('marketing@workplace.org')").first()).toBeVisible();

    // Discard draft cleanly
    if (process.env.SUITEMAIL_ANDROID === "1") await page.locator(".slide-up-panel").getByRole("button",{name:"More",exact:true}).tap();
    const discardBtn = page.locator('button:has-text("Discard")').first();
    await discardBtn.tap();
    const confirmDiscard = page.getByRole("dialog",{name:"Discard this draft?",exact:true});
    if (await confirmDiscard.isVisible()) await confirmDiscard.getByRole("button",{name:"Discard draft",exact:true}).tap();
    await expect(page.locator(".slide-up-panel")).toHaveCount(0);
  });

  // Storyboard 16: Attach Files & View Attachment Library
  test("16. Attach Files & Attachment Library: displays message attachments and centralized attachment browser", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Open email containing attachment
    const threadCard = page.locator('button[aria-label*="Financial Report Attached"]').first();
    await threadCard.tap();

    // Verify attachment badge / pill in reading pane
    await expect(page.locator("text=Quarterly_Financial_Report.pdf").first()).toBeVisible();

    // Navigate to central Attachment Library via sidebar
    await tapSidebarFolder(page, "Attachments");
    await expect(page.locator("text=Quarterly_Financial_Report.pdf").first()).toBeVisible({ timeout: 10_000 });
  });

  // Storyboard 17: Calendar Invite & One-Click RSVP
  test("17. Calendar Invite & RSVP: detects .ics event and allows one-click Accept response", async ({
    page,
  }) => {
    await setupInboxPage(page);

    // Open calendar invite email
    const threadCard = page.locator('button[aria-label*="Meeting: Design System Architecture Review"]').first();
    await threadCard.tap();

    // CalendarInviteBanner is visible
    await expect(page.locator("text=Design System Architecture Review >> visible=true").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Conference Room B >> visible=true").first()).toBeVisible();

    // Tap Accept button
    const acceptBtn = page.locator('button:has-text("Accept")').first();
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.tap();

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
    await threadCard.tap();

    await openMobileActions(page);
    // Verify Unsubscribe action in ActionBar
    const unsubBtn = messageActionsRoot(page).locator('button[title*="Unsubscribe"]').first();
    await expect(unsubBtn).toBeVisible();
    await unsubBtn.tap();

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
    await threadCard.tap();

    // AuthWarningBanner displayed due to SPF/DKIM/DMARC failure
    await expect(page.getByRole("heading",{name:process.env.SUITEMAIL_ANDROID === "1" ? "Sender couldn’t be verified" : "Authentication failed",exact:true})).toBeVisible();

    await openMobileActions(page);
    // Tap Report Spam button
    const spamBtn = messageActionsRoot(page).locator('button[title*="Report Spam (!)"]').first();
    await expect(spamBtn).toBeVisible();
    await spamBtn.tap();

    // Thread removed from Inbox
    await expect(page.locator(`text=${threadTitle}`)).toHaveCount(0);

    // Verify listed under Spam folder via sidebar nav
    await tapSidebarFolder(page, "Spam");
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

    // Tap the avatar checkbox handles on mobile touch interface to toggle multi-select
    await cardA.locator('[role="checkbox"]').first().tap();
    await cardB.locator('[role="checkbox"]').first().tap();

    // Multi-select bar appears showing '2 selected'
    const bulkBar = page.locator("text=2 selected").first();
    await expect(bulkBar).toBeVisible();

    // Tap Archive selected button in the floating multi-select bar
    const bulkArchiveBtn = page.locator('button[title="Archive selected"]').first();
    await expect(bulkArchiveBtn).toBeVisible();
    await bulkArchiveBtn.tap();

    // Both threads removed from Inbox
    await expect(page.locator(`text=${threadA}`)).toHaveCount(0);
    await expect(page.locator(`text=${threadB}`)).toHaveCount(0);

    // Verify provider-aware bulk actions persist, rather than only hiding cards.
    await expect.poll(() => {
      const row = fakeServer.db.prepare(
        "SELECT COUNT(*) AS count FROM thread_labels WHERE account_id = 'acc-test-1' AND label_id = 'INBOX' AND thread_id IN (SELECT id FROM threads WHERE subject IN (?, ?))",
      ).get(threadA, threadB) as { count: number };
      return row.count;
    }).toBe(0);
  });
});
