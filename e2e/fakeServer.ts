import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, splitStatements } from "../src/services/db/migrations";

export interface FakeServerState {
  aiRequests: Array<{ url: string; body: unknown; timestamp: number }>;
  syncedFilters: Array<{
    folder: string;
    rawMessage: string;
    decodedEmail: string;
    payload: unknown;
    timestamp: number;
  }>;
  sentEmails: Array<{
    config: unknown;
    rawEmail: string;
    timestamp: number;
  }>;
  unsubscribes: Array<{
    url: string;
    timestamp: number;
  }>;
}

export class FakeServer {
  private server: http.Server | null = null;
  public port: number;
  public db: DatabaseSync;
  public state: FakeServerState = {
    aiRequests: [],
    syncedFilters: [],
    sentEmails: [],
    unsubscribes: [],
  };

  constructor(port = 3333) {
    this.port = port;
    this.db = new DatabaseSync(":memory:");
    this.initializeSchema();
    this.seedInitialData();
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at INTEGER DEFAULT (unixepoch())
      );
    `);

    for (const migration of MIGRATIONS) {
      const statements = splitStatements(migration.sql);
      try {
        this.db.exec("BEGIN");
        for (const statement of statements) {
          try {
            this.db.exec(statement);
          } catch (err: any) {
            if (err.message.includes("duplicate column")) {
              // ignore duplicate column
            } else {
              throw err;
            }
          }
        }
        const escapedDesc = migration.description.replace(/'/g, "''");
        this.db.exec(
          `INSERT OR IGNORE INTO _migrations (version, description) VALUES (${migration.version}, '${escapedDesc}');`,
        );
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        console.error(`[FakeServer] Failed migration v${migration.version}:`, err);
        throw err;
      }
    }
  }

  public seedInitialData() {
    // 1. Account
    this.db.exec(`
      INSERT OR REPLACE INTO accounts (id, email, display_name, provider, imap_host, imap_port, smtp_host, smtp_port, is_active)
      VALUES ('acc-test-1', 'user@test.com', 'Test User', 'imap', 'imap.test.com', 993, 'smtp.test.com', 587, 1);
    `);

    // 2. Settings
    this.db.exec(`
      INSERT OR REPLACE INTO settings (key, value) VALUES ('pi_server_url', 'http://localhost:${this.port}');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('pi_model', 'gemma-4-e4b');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', 'acc-test-1');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('undo_send_delay_seconds', '0');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('mark_as_read_behavior', 'instant');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('block_remote_images', 'false');
    `);

    // 3. System & User Labels
    this.db.exec(`
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('INBOX', 'acc-test-1', 'Inbox', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('SENT', 'acc-test-1', 'Sent', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('TRASH', 'acc-test-1', 'Trash', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('STARRED', 'acc-test-1', 'Starred', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('DRAFT', 'acc-test-1', 'Drafts', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('SPAM', 'acc-test-1', 'Spam', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('SNOOZED', 'acc-test-1', 'Snoozed', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type, color_bg, color_fg) VALUES ('lbl-projects', 'acc-test-1', 'Projects', 'user', '#6366f1', '#ffffff');
    `);

    // 4. Contacts
    this.db.exec(`
      INSERT OR REPLACE INTO contacts (id, email, display_name, frequency) VALUES ('c-1', 'colleague@workplace.org', 'Colleague Dave', 10);
      INSERT OR REPLACE INTO contacts (id, email, display_name, frequency) VALUES ('c-2', 'sarah@workplace.org', 'Sarah Miller', 20);
      INSERT OR REPLACE INTO contacts (id, email, display_name, frequency) VALUES ('c-3', 'manager@workplace.org', 'Manager Bob', 15);
      INSERT OR REPLACE INTO contacts (id, email, display_name, frequency) VALUES ('c-4', 'team@workplace.org', 'Core Engineering Team', 5);
    `);

    // 5. Threads & Messages
    // Thread 1: Tech Weekly #101 (Unread, in INBOX)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-tw-1', 'acc-test-1', 'Tech Weekly #101: AI Agents & Innovations', 'Welcome to issue 101 of Tech Weekly!', 1700000100, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-tw-1', 'acc-test-1', 't-tw-1', 'newsletter@techweekly.com', 'Tech Weekly', 'user@test.com', 'Tech Weekly #101: AI Agents & Innovations', 'Welcome to issue 101 of Tech Weekly!', '<p>Welcome to issue 101 of Tech Weekly!</p>', 'Welcome to issue 101 of Tech Weekly!', 1700000100, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-tw-1', 'acc-test-1', 'INBOX');
    `);

    // Thread 2: Tech Weekly #102 (Unread, in INBOX)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-tw-2', 'acc-test-1', 'Tech Weekly #102: Deep Dive into Gemma 4', 'Here is the latest scoop on local LLMs...', 1700000200, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-tw-2', 'acc-test-1', 't-tw-2', 'newsletter@techweekly.com', 'Tech Weekly', 'user@test.com', 'Tech Weekly #102: Deep Dive into Gemma 4', 'Here is the latest scoop on local LLMs...', '<p>Here is the latest scoop on local LLMs...</p>', 'Here is the latest scoop on local LLMs...', 1700000200, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-tw-2', 'acc-test-1', 'INBOX');
    `);

    // Thread 3: Sprint Retrospective Notes (Unread, in INBOX)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-work-3', 'acc-test-1', 'Sprint Retrospective Notes', 'Here are the action items from our retrospective.', 1700000300, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-work-3', 'acc-test-1', 't-work-3', 'sarah@workplace.org', 'Sarah Miller', 'user@test.com', 'Sprint Retrospective Notes', 'Here are the action items from our retrospective.', '<p>Here are the action items from our retrospective.</p>', 'Here are the action items from our retrospective.', 1700000300, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-work-3', 'acc-test-1', 'INBOX');
    `);

    // Thread 4: Welcome & Onboarding Guide (Story 1: Read & Browse)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-welcome-1', 'acc-test-1', 'Team Welcome & Onboarding Guide', 'Welcome to SuperMail! Enjoy your fast email client.', 1700000400, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-welcome-1', 'acc-test-1', 't-welcome-1', 'team@velomail.app', 'SuperMail Team', 'user@test.com', 'Team Welcome & Onboarding Guide', 'Welcome to SuperMail! Enjoy your fast email client.', '<p>Welcome to SuperMail! Enjoy your fast email client.</p>', 'Welcome to SuperMail! Enjoy your fast email client.', 1700000400, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-welcome-1', 'acc-test-1', 'INBOX');
    `);

    // Thread 5: Quarterly Planning Sync (Story 4: Reply All)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-collab-4', 'acc-test-1', 'Quarterly Planning Sync', 'Team, let us sync on next quarter OKRs.', 1700000500, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, cc_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-collab-4', 'acc-test-1', 't-collab-4', 'sarah@workplace.org', 'Sarah Miller', 'user@test.com, alex@workplace.org', 'team@workplace.org', 'Quarterly Planning Sync', 'Team, let us sync on next quarter OKRs.', '<p>Team, let us sync on next quarter OKRs.</p>', 'Team, let us sync on next quarter OKRs.', 1700000500, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-collab-4', 'acc-test-1', 'INBOX');
    `);

    // Thread 6: Quarterly Client Growth Report (Story 5: Forward)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-report-5', 'acc-test-1', 'Quarterly Client Growth Report', 'Hi, please find the growth summary for Q3.', 1700000600, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-report-5', 'acc-test-1', 't-report-5', 'michael@client.com', 'Michael Chen', 'user@test.com', 'Quarterly Client Growth Report', 'Hi, please find the growth summary for Q3.', '<p>Hi, please find the growth summary for Q3.</p>', 'Hi, please find the growth summary for Q3.', 1700000600, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-report-5', 'acc-test-1', 'INBOX');
    `);

    // Thread 7: DevOps System Maintenance Notification (Story 6: Archive)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-devops-6', 'acc-test-1', 'DevOps System Maintenance Notification', 'Maintenance completed successfully across clusters.', 1700000700, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-devops-6', 'acc-test-1', 't-devops-6', 'ops@internal.net', 'DevOps Team', 'user@test.com', 'DevOps System Maintenance Notification', 'Maintenance completed successfully across clusters.', '<p>Maintenance completed successfully across clusters.</p>', 'Maintenance completed successfully across clusters.', 1700000700, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-devops-6', 'acc-test-1', 'INBOX');
    `);

    // Thread 8: Special Limited 50% Off Discount (Story 7: Delete)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-promo-7', 'acc-test-1', 'Special Limited 50% Off Discount', 'Exclusive discount promo inside for your office equipment.', 1700000800, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-promo-7', 'acc-test-1', 't-promo-7', 'promo@store.com', 'Online Deals', 'user@test.com', 'Special Limited 50% Off Discount', 'Exclusive discount promo inside for your office equipment.', '<p>Exclusive discount promo inside for your office equipment.</p>', 'Exclusive discount promo inside for your office equipment.', 1700000800, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-promo-7', 'acc-test-1', 'INBOX');
    `);

    // Thread 9: Annual Tax Statement & Salary Slip (Story 8: Star)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-tax-8', 'acc-test-1', 'Annual Tax Statement & Salary Slip', 'Your annual income statements are ready for review.', 1700000900, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-tax-8', 'acc-test-1', 't-tax-8', 'finance@workplace.org', 'Finance Payroll', 'user@test.com', 'Annual Tax Statement & Salary Slip', 'Your annual income statements are ready for review.', '<p>Your annual income statements are ready for review.</p>', 'Your annual income statements are ready for review.', 1700000900, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-tax-8', 'acc-test-1', 'INBOX');
    `);

    // Thread 10: URGENT: Production Server Latency Alert (Story 9: Pin)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-urgent-9', 'acc-test-1', 'URGENT: Production Server Latency Alert', 'High latency detected on database replicas.', 1700001000, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-urgent-9', 'acc-test-1', 't-urgent-9', 'alerts@cloud.io', 'Cloud Monitoring', 'user@test.com', 'URGENT: Production Server Latency Alert', 'High latency detected on database replicas.', '<p>High latency detected on database replicas.</p>', 'High latency detected on database replicas.', 1700001000, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-urgent-9', 'acc-test-1', 'INBOX');
    `);

    // Thread 11: Q4 Product Roadmap & Vision (Story 10: Search)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-roadmap-10', 'acc-test-1', 'Q4 Product Roadmap & Vision', 'Detailed breakdown of upcoming roadmap features and timelines.', 1700001100, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-roadmap-10', 'acc-test-1', 't-roadmap-10', 'pm@workplace.org', 'Product Team', 'user@test.com', 'Q4 Product Roadmap & Vision', 'Detailed breakdown of upcoming roadmap features and timelines.', '<p>Detailed breakdown of upcoming roadmap features and timelines.</p>', 'Detailed breakdown of upcoming roadmap features and timelines.', 1700001100, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-roadmap-10', 'acc-test-1', 'INBOX');
    `);

    // Thread 12: Client Alpha Contract Discussion (Story 11: Move / Label)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-client-11', 'acc-test-1', 'Client Alpha Contract Discussion', 'Contract terms updated per discussion with legal counsel.', 1700001200, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-client-11', 'acc-test-1', 't-client-11', 'legal@alpha.com', 'Legal Counsel', 'user@test.com', 'Client Alpha Contract Discussion', 'Contract terms updated per discussion with legal counsel.', '<p>Contract terms updated per discussion with legal counsel.</p>', 'Contract terms updated per discussion with legal counsel.', 1700001200, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-client-11', 'acc-test-1', 'INBOX');
    `);

    // Thread 13: Annual Benefits Enrollment Deadline (Story 12: Mark as Unread)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-hr-12', 'acc-test-1', 'Annual Benefits Enrollment Deadline', 'Reminder: Benefits enrollment period ends this Friday.', 1700001300, 1, 1, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-hr-12', 'acc-test-1', 't-hr-12', 'hr@workplace.org', 'HR Benefits', 'user@test.com', 'Annual Benefits Enrollment Deadline', 'Reminder: Benefits enrollment period ends this Friday.', '<p>Reminder: Benefits enrollment period ends this Friday.</p>', 'Reminder: Benefits enrollment period ends this Friday.', 1700001300, 1);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-hr-12', 'acc-test-1', 'INBOX');
    `);

    // Thread 14: Weekly Book Club Suggestions (Story 13: Snooze)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-book-13', 'acc-test-1', 'Weekly Book Club Suggestions', 'Recommendations for this months reading discussion.', 1700001400, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-book-13', 'acc-test-1', 't-book-13', 'club@social.org', 'Book Club', 'user@test.com', 'Weekly Book Club Suggestions', 'Recommendations for this months reading discussion.', '<p>Recommendations for this months reading discussion.</p>', 'Recommendations for this months reading discussion.', 1700001400, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-book-13', 'acc-test-1', 'INBOX');
    `);

    // Thread 15: Draft Proposal for Q3 Campaign (Story 15: Drafts)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-draft-15', 'acc-test-1', 'Draft Proposal for Q3 Campaign', 'Here is the draft campaign proposal outline...', 1700001500, 1, 1, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-draft-15', 'acc-test-1', 't-draft-15', 'user@test.com', 'Test User', 'marketing@workplace.org', 'Draft Proposal for Q3 Campaign', 'Here is the draft campaign proposal outline...', '<p>Here is the draft campaign proposal outline...</p>', 'Here is the draft campaign proposal outline...', 1700001500, 1);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-draft-15', 'acc-test-1', 'DRAFT');
    `);

    // Thread 16: Financial Report Attached (Story 16: Attachments)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered, has_attachments)
      VALUES ('t-attach-16', 'acc-test-1', 'Financial Report Attached', 'Please find attached the financial review PDF.', 1700001600, 1, 0, 1, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-attach-16', 'acc-test-1', 't-attach-16', 'cfo@workplace.org', 'Finance Department', 'user@test.com', 'Financial Report Attached', 'Please find attached the financial review PDF.', '<p>Please find attached the financial review PDF.</p>', 'Please find attached the financial review PDF.', 1700001600, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-attach-16', 'acc-test-1', 'INBOX');

      INSERT OR REPLACE INTO attachments (id, message_id, account_id, filename, mime_type, size, is_inline)
      VALUES ('att-16', 'm-attach-16', 'acc-test-1', 'Quarterly_Financial_Report.pdf', 'application/pdf', 1048576, 0);
    `);

    // Thread 17: Meeting: Design System Architecture Review (Story 17: Calendar Invite)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-invite-17', 'acc-test-1', 'Meeting: Design System Architecture Review', 'Join us for the design system meeting.', 1700001700, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-invite-17', 'acc-test-1', 't-invite-17', 'alex@workplace.org', 'Alex Wong', 'user@test.com', 'Meeting: Design System Architecture Review', 'Join us for the design system meeting.', '<p>Join us for the design system meeting.</p>', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SuperMail//Test//EN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:event-ds-17\r\nSUMMARY:Design System Architecture Review\r\nDESCRIPTION:Review design system tokens and components\r\nLOCATION:Conference Room B\r\nDTSTART:20261201T150000Z\r\nDTEND:20261201T160000Z\r\nORGANIZER;CN=Alex Wong:mailto:alex@workplace.org\r\nATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Test User:mailto:user@test.com\r\nEND:VEVENT\r\nEND:VCALENDAR', 1700001700, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-invite-17', 'acc-test-1', 'INBOX');
    `);

    // Thread 18: Weekly Retail Promotions & Discounts (Story 18: Unsubscribe)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-unsub-18', 'acc-test-1', 'Weekly Retail Promotions & Discounts', 'Exclusive retail discount offers inside.', 1700001800, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, list_unsubscribe, list_unsubscribe_post, date, is_read)
      VALUES ('m-unsub-18', 'acc-test-1', 't-unsub-18', 'newsletter@retailer.com', 'Retail Deals', 'user@test.com', 'Weekly Retail Promotions & Discounts', 'Exclusive retail discount offers inside.', '<p>Exclusive retail discount offers inside.</p>', 'Exclusive retail discount offers inside.', '<http://localhost:${this.port}/api/unsubscribe>', 'List-Unsubscribe=One-Click', 1700001800, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-unsub-18', 'acc-test-1', 'INBOX');
    `);

    // Thread 19: URGENT: Verify Your Bank Account Immediately (Story 19: Phishing / Spam)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-phish-19', 'acc-test-1', 'URGENT: Verify Your Bank Account Immediately', 'Suspicious request to verify credentials.', 1700001900, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, auth_results, date, is_read)
      VALUES ('m-phish-19', 'acc-test-1', 't-phish-19', 'alert@suspicious-bank-login.xyz', 'Security Alert', 'user@test.com', 'URGENT: Verify Your Bank Account Immediately', 'Suspicious request to verify credentials.', '<p>Your account is locked. Click here to verify.</p>', 'Your account is locked. Click here to verify.', '{"spf":"fail","dkim":"fail","dmarc":"fail","aggregate":"fail"}', 1700001900, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-phish-19', 'acc-test-1', 'INBOX');
    `);

    // Thread 20a & 20b: Analytics Digest Vol 1 & 2 (Story 20: Multi-Select Bulk Actions)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-bulk-20a', 'acc-test-1', 'Weekly Analytics Digest Vol 1', 'Product usage statistics for week 1.', 1700002010, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-bulk-20a', 'acc-test-1', 't-bulk-20a', 'stats@internal.io', 'Analytics Bot', 'user@test.com', 'Weekly Analytics Digest Vol 1', 'Product usage statistics for week 1.', '<p>Product usage statistics for week 1.</p>', 'Product usage statistics for week 1.', 1700002010, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-bulk-20a', 'acc-test-1', 'INBOX');

      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-bulk-20b', 'acc-test-1', 'Weekly Analytics Digest Vol 2', 'Product usage statistics for week 2.', 1700002020, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, body_html, body_text, date, is_read)
      VALUES ('m-bulk-20b', 'acc-test-1', 't-bulk-20b', 'stats@internal.io', 'Analytics Bot', 'user@test.com', 'Weekly Analytics Digest Vol 2', 'Product usage statistics for week 2.', '<p>Product usage statistics for week 2.</p>', 'Product usage statistics for week 2.', 1700002020, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-bulk-20b', 'acc-test-1', 'INBOX');
    `);
  }

  public reset() {
    this.state.aiRequests = [];
    this.state.syncedFilters = [];
    this.state.sentEmails = [];
    this.state.unsubscribes = [];
    try {
      this.db.exec(`
        DELETE FROM attachments;
        DELETE FROM scheduled_emails;
        DELETE FROM local_drafts;
        DELETE FROM thread_labels;
        DELETE FROM messages;
        DELETE FROM threads;
        DELETE FROM filter_rules;
        DELETE FROM labels WHERE type != 'system';
      `);
    } catch {
      // ignore
    }
    this.seedInitialData();
  }

  public async start(retries = 30): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // CORS Headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url || "/";

        // Read request body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let parsedBody: any = null;
        if (rawBody.trim()) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }

        // 1. AI completions endpoint: POST /v1/chat/completions
        if (url.startsWith("/v1/chat/completions") && req.method === "POST") {
          this.state.aiRequests.push({
            url,
            body: parsedBody,
            timestamp: Date.now(),
          });

          // Return OpenAI format tool call invoking suggest_filter
          const responsePayload = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "gemma-4-e4b",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_suggest_filter_001",
                      type: "function",
                      function: {
                        name: "suggest_filter",
                        arguments: JSON.stringify({
                          name: "Tech Weekly Newsletters",
                          newFolder: "Newsletters",
                          criteria: {
                            from: "newsletter@techweekly.com",
                          },
                          actions: {
                            archive: true,
                            markRead: true,
                            applyLabel: "Newsletters",
                          },
                          explanation:
                            "Moves Tech Weekly emails into Newsletters folder, marks them as read, and archives them from inbox.",
                        }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          };

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(responsePayload));
          return;
        }

        // 2. Settings Sync endpoint: POST /api/sync/filters
        if (url === "/api/sync/filters" && req.method === "POST") {
          let decodedEmail = "";
          let filterPayload = null;

          try {
            const base64Url = parsedBody.rawMessage || "";
            const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
            const buf = Buffer.from(base64, "base64");
            decodedEmail = buf.toString("utf8");

            const jsonStart = decodedEmail.indexOf("\r\n\r\n");
            const rawJson = jsonStart !== -1 ? decodedEmail.slice(jsonStart).trim() : decodedEmail;
            filterPayload = JSON.parse(rawJson);
          } catch (err) {
            console.warn("[FakeServer] Error parsing raw sync email:", err);
          }

          this.state.syncedFilters.push({
            folder: parsedBody.folder,
            rawMessage: parsedBody.rawMessage,
            decodedEmail,
            payload: filterPayload,
            timestamp: Date.now(),
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, count: this.state.syncedFilters.length }));
          return;
        }

        // 3. Query synced filters: GET /api/sync/filters
        if (url === "/api/sync/filters" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.state.syncedFilters));
          return;
        }

        // 4. Query AI requests: GET /api/ai/requests
        if (url === "/api/ai/requests" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.state.aiRequests));
          return;
        }

        // 4b. SMTP send endpoint: POST /api/smtp/send
        if (url === "/api/smtp/send" && req.method === "POST") {
          this.state.sentEmails.push({
            config: parsedBody.config,
            rawEmail: parsedBody.rawEmail,
            timestamp: Date.now(),
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Sent successfully" }));
          return;
        }

        // 4c. Query SMTP sent: GET /api/smtp/sent
        if (url === "/api/smtp/sent" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.state.sentEmails));
          return;
        }

        // 4d. Unsubscribe endpoint: POST /api/unsubscribe
        if (url.startsWith("/api/unsubscribe") && req.method === "POST") {
          this.state.unsubscribes.push({
            url,
            timestamp: Date.now(),
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // 4e. Query unsubscribes: GET /api/unsubscribe
        if (url.startsWith("/api/unsubscribe") && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.state.unsubscribes));
          return;
        }

        // 5. Database execution endpoint: POST /api/sql
        if (url === "/api/sql" && req.method === "POST") {
          const { cmd, args } = parsedBody;
          const { query = "", values = [] } = args || {};

          try {
            const trimmed = query.trim();
            const upper = trimmed.toUpperCase();

            // Handle transaction commands safely
            if (upper === "BEGIN" || upper === "BEGIN TRANSACTION") {
              try {
                this.db.exec("BEGIN");
              } catch (txErr: any) {
                // If transaction already active, ignore
                if (!txErr.message.includes("cannot start a transaction")) {
                  throw txErr;
                }
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([0, 0]));
              return;
            }

            if (upper === "COMMIT") {
              try {
                this.db.exec("COMMIT");
              } catch (txErr: any) {
                if (!txErr.message.includes("cannot commit")) {
                  throw txErr;
                }
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([0, 0]));
              return;
            }

            if (upper === "ROLLBACK") {
              try {
                this.db.exec("ROLLBACK");
              } catch {
                // ignore
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([0, 0]));
              return;
            }

            if (cmd === "plugin:sql|execute") {
              if (values.length === 0) {
                this.db.exec(trimmed);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify([0, 0]));
                return;
              }
              const normalized = trimmed.replace(/\$(\d+)/g, "?$1");
              const stmt = this.db.prepare(normalized);
              const result = stmt.run(...values);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([Number(result.changes), Number(result.lastInsertRowid)]));
              return;
            }

            if (cmd === "plugin:sql|select") {
              if (values.length === 0) {
                const stmt = this.db.prepare(trimmed);
                const rows = stmt.all();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(rows));
                return;
              }
              const normalized = trimmed.replace(/\$(\d+)/g, "?$1");
              const stmt = this.db.prepare(normalized);
              const rows = stmt.all(...values);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(rows));
              return;
            }

            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Unknown SQL cmd: ${cmd}` }));
          } catch (sqlErr: any) {
            console.error("[FakeServer] SQL Error:", sqlErr.message, "Query:", query);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: sqlErr.message }));
          }
          return;
        }

        // 6. Status check
        if (url === "/api/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", port: this.port }));
          return;
        }

        res.writeHead(404);
        res.end("Not Found");
      });

      this.server.listen(this.port, () => {
        resolve(`http://localhost:${this.port}`);
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE" && retries > 0) {
          try {
            this.server?.close();
          } catch {}
          setTimeout(async () => {
            try {
              const url = await this.start(retries - 1);
              resolve(url);
            } catch (e) {
              reject(e);
            }
          }, 800);
        } else {
          reject(err);
        }
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        if (typeof (this.server as any).closeAllConnections === "function") {
          (this.server as any).closeAllConnections();
        }
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
