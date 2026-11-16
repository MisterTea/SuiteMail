export const SYNTHETIC_ACCOUNT_ID = "synthetic-test-user@supermail.local";

export interface SyntheticMessage {
  id: string;
  thread_id: string;
  from_name: string;
  from_address: string;
  to_addresses: string;
  subject: string;
  snippet: string;
  date: number; // ms
  is_read: number;
  is_starred: number;
  body_text: string;
  body_html: string;
}

export interface SyntheticThread {
  id: string;
  subject: string;
  snippet: string;
  last_message_at: number;
  message_count: number;
  is_read: number;
  is_starred: number;
}

export const SYNTHETIC_THREADS: SyntheticThread[] = [
  {
    id: "thread-flight-sf",
    subject: "United Airlines Flight Confirmation: ORD to SFO",
    snippet: "Your flight UA-402 to San Francisco (SFO) is confirmed for March 25, 2026.",
    last_message_at: 1774426500000,
    message_count: 1,
    is_read: 1,
    is_starred: 1,
  },
  {
    id: "thread-project-phoenix",
    subject: "Project Phoenix Architecture Meeting Reschedule",
    snippet: "Thursday at 2:00 PM in Conference Room B works for everyone.",
    last_message_at: 1773756000000,
    message_count: 3,
    is_read: 1,
    is_starred: 0,
  },
  {
    id: "thread-cloud-invoice",
    subject: "Your CloudServices Receipt for March 2026 (#INV-2026-0881)",
    snippet: "Thank you for your payment of $249.00. Your receipt is attached.",
    last_message_at: 1773579600000,
    message_count: 1,
    is_read: 1,
    is_starred: 0,
  },
  {
    id: "thread-budget-urgent",
    subject: "URGENT: Sign off on Q2 Engineering Budget allocation",
    snippet: "Please review and approve the $45,000 compute allocation before Friday 5 PM.",
    last_message_at: 1773838800000,
    message_count: 1,
    is_read: 0,
    is_starred: 1,
  },
  {
    id: "thread-team-lunch",
    subject: "Team Lunch this Friday at 12:30 PM",
    snippet: "Join us for artisan pizza and tacos in the 4th floor lounge!",
    last_message_at: 1773918000000,
    message_count: 1,
    is_read: 1,
    is_starred: 0,
  },
];

export const SYNTHETIC_MESSAGES: SyntheticMessage[] = [
  // 1. Flight Confirmation
  {
    id: "msg-flight-001",
    thread_id: "thread-flight-sf",
    from_name: "United Airlines",
    from_address: "reservations@united.com",
    to_addresses: "synthetic-test-user@supermail.local",
    subject: "United Airlines Flight Confirmation: ORD to SFO",
    snippet: "Your flight UA-402 to San Francisco (SFO) is confirmed for March 25, 2026.",
    date: 1774426500000,
    is_read: 1,
    is_starred: 1,
    body_text: `Dear Traveler,

Thank you for booking with United Airlines.
Here are your trip details:
- Flight: UA-402
- Route: Chicago O'Hare (ORD) to San Francisco (SFO)
- Departure Date: March 25, 2026 at 09:15 AM
- Arrival Date: March 25, 2026 at 11:45 AM
- Confirmation Code: #SF-9042
- Seat: 14A (Window)

We look forward to seeing you onboard!`,
    body_html: "<p>Dear Traveler, your flight UA-402 is confirmed...</p>",
  },

  // 2. Project Phoenix Thread - Message 1
  {
    id: "msg-phoenix-001",
    thread_id: "thread-project-phoenix",
    from_name: "Alice Wong",
    from_address: "alice.wong@acmecorp.com",
    to_addresses: "synthetic-test-user@supermail.local, bob.martin@acmecorp.com",
    subject: "Project Phoenix Architecture Meeting Reschedule",
    snippet: "Can we move our architecture review from Wednesday to Thursday at 2:00 PM?",
    date: 1773738000000,
    is_read: 1,
    is_starred: 0,
    body_text: `Hi team,

Due to a conflict with the executive sync, can we please move our Project Phoenix architecture review from Wednesday to Thursday at 2:00 PM?
Let me know if this works.

Best,
Alice`,
    body_html: "<p>Hi team, can we move...</p>",
  },

  // 2. Project Phoenix Thread - Message 2
  {
    id: "msg-phoenix-002",
    thread_id: "thread-project-phoenix",
    from_name: "Bob Martin",
    from_address: "bob.martin@acmecorp.com",
    to_addresses: "alice.wong@acmecorp.com, synthetic-test-user@supermail.local",
    subject: "Re: Project Phoenix Architecture Meeting Reschedule",
    snippet: "Thursday at 2 PM works for me. Please bring the GraphQL API schema draft.",
    date: 1773745200000,
    is_read: 1,
    is_starred: 0,
    body_text: `Hey Alice,

Thursday at 2:00 PM works great for me.
Could you also bring the GraphQL API schema draft so we can review the mutation endpoints?

Thanks,
Bob`,
    body_html: "<p>Thursday at 2:00 PM works great...</p>",
  },

  // 2. Project Phoenix Thread - Message 3
  {
    id: "msg-phoenix-003",
    thread_id: "thread-project-phoenix",
    from_name: "Alice Wong",
    from_address: "alice.wong@acmecorp.com",
    to_addresses: "bob.martin@acmecorp.com, synthetic-test-user@supermail.local",
    subject: "Re: Project Phoenix Architecture Meeting Reschedule",
    snippet: "Confirmed for Thursday 2 PM in Conference Room B. GraphQL draft linked.",
    date: 1773756000000,
    is_read: 1,
    is_starred: 0,
    body_text: `Sounds like a plan!
Confirmed: Thursday at 2:00 PM in Conference Room B.
I have uploaded the GraphQL schema draft to the project wiki.

See you all there,
Alice`,
    body_html: "<p>Confirmed: Thursday at 2:00 PM...</p>",
  },

  // 3. Invoice
  {
    id: "msg-invoice-001",
    thread_id: "thread-cloud-invoice",
    from_name: "CloudServices Billing",
    from_address: "billing@cloudservices.io",
    to_addresses: "synthetic-test-user@supermail.local",
    subject: "Your CloudServices Receipt for March 2026 (#INV-2026-0881)",
    snippet: "Thank you for your payment of $249.00. Your receipt is attached.",
    date: 1773579600000,
    is_read: 1,
    is_starred: 0,
    body_text: `Receipt Number: #INV-2026-0881
Account: Acme Tech Labs
Billing Period: March 1, 2026 - March 31, 2026
Total Amount Paid: $249.00
Payment Method: Mastercard ending in 8812
Status: Paid in Full

Thank you for your business!`,
    body_html: "<p>Receipt Number: #INV-2026-0881...</p>",
  },

  // 4. Urgent Unread Budget
  {
    id: "msg-budget-001",
    thread_id: "thread-budget-urgent",
    from_name: "Dave Vance",
    from_address: "dave.vance@acmecorp.com",
    to_addresses: "synthetic-test-user@supermail.local",
    subject: "URGENT: Sign off on Q2 Engineering Budget allocation",
    snippet: "Please review and approve the $45,000 compute allocation before Friday 5 PM.",
    date: 1773838800000,
    is_read: 0,
    is_starred: 1,
    body_text: `Team,

Finance needs our finalized Q2 infrastructure headcount and cloud compute sign-off.
We are requesting $45,000 for additional GPU compute cluster capacity.
Please review and reply with your approval before Friday at 5:00 PM.

Thanks,
Dave Vance
VP of Engineering`,
    body_html: "<p>Finance needs our finalized Q2 infrastructure...</p>",
  },

  // 5. Team Lunch
  {
    id: "msg-lunch-001",
    thread_id: "thread-team-lunch",
    from_name: "Culture Committee",
    from_address: "culture@acmecorp.com",
    to_addresses: "all-staff@acmecorp.com",
    subject: "Team Lunch this Friday at 12:30 PM",
    snippet: "Join us for artisan pizza and tacos in the 4th floor lounge!",
    date: 1773918000000,
    is_read: 1,
    is_starred: 0,
    body_text: `Hello everyone!

This Friday at 12:30 PM we are celebrating the end of the sprint with a team lunch.
We will have artisan pizza and street tacos in the 4th floor lounge.
Vegetarian and gluten-free options will be provided.

Hope to see you there!`,
    body_html: "<p>Hello everyone! This Friday at 12:30 PM...</p>",
  },
];

/**
 * Creates an in-memory tool executor with the synthetic inbox dataset for live model testing.
 */
export function createSyntheticToolExecutor() {
  return async (
    toolName: string,
    args: Record<string, unknown>,
    _accountId: string,
  ) => {
    switch (toolName) {
      case "search_emails": {
        const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
        const from = typeof args.from === "string" ? args.from.toLowerCase() : "";
        const isUnread = typeof args.is_unread === "boolean" ? args.is_unread : undefined;

        const matches = SYNTHETIC_MESSAGES.filter((m) => {
          if (from && !m.from_address.toLowerCase().includes(from) && !m.from_name.toLowerCase().includes(from)) {
            return false;
          }
          if (isUnread !== undefined && (m.is_read === 0) !== isUnread) {
            return false;
          }
          if (query) {
            const queryWords = query.split(/\s+/).filter(Boolean);
            const haystack = `${m.subject} ${m.snippet} ${m.body_text} ${m.from_name} ${m.from_address}`.toLowerCase();
            const hasMatch = queryWords.some((w) => haystack.includes(w));
            if (!hasMatch) return false;
          }
          return true;
        });

        if (matches.length === 0) {
          return { text: "No matching emails found in local database.", sourceMessages: [] };
        }

        const formatted = matches
          .map((r, i) => {
            const dateStr = new Date(r.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            return `[${i + 1}] Message ID: ${r.id} | Thread ID: ${r.thread_id}\nFrom: ${r.from_name} <${r.from_address}>\nDate: ${dateStr}\nSubject: ${r.subject}\nSnippet: ${r.snippet}`;
          })
          .join("\n\n");

        return {
          text: formatted,
          sourceMessages: matches.map((m) => ({
            message_id: m.id,
            account_id: SYNTHETIC_ACCOUNT_ID,
            thread_id: m.thread_id,
            subject: m.subject,
            from_name: m.from_name,
            from_address: m.from_address,
            snippet: m.snippet,
            date: m.date,
            rank: 0,
          })),
        };
      }

      case "get_thread": {
        const threadId = typeof args.thread_id === "string" ? args.thread_id.trim() : "";
        const msgs = SYNTHETIC_MESSAGES.filter((m) => m.thread_id === threadId);
        if (msgs.length === 0) {
          return { text: `No messages found for thread ID: ${threadId}` };
        }

        const formatted = msgs
          .map((m, idx) => {
            const dateStr = new Date(m.date).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return `--- Message ${idx + 1} of ${msgs.length} (ID: ${m.id}) ---\nFrom: ${m.from_name} <${m.from_address}>\nTo: ${m.to_addresses}\nDate: ${dateStr}\nSubject: ${m.subject}\n\n${m.body_text}`;
          })
          .join("\n\n");

        return { text: formatted, data: msgs };
      }

      case "get_email_stats": {
        const type = args.type as string;
        if (type === "unread_count") {
          const unreadMsgs = SYNTHETIC_MESSAGES.filter((m) => m.is_read === 0).length;
          const unreadThreads = SYNTHETIC_THREADS.filter((t) => t.is_read === 0).length;
          return {
            text: JSON.stringify(
              { unread_messages: unreadMsgs, unread_threads: unreadThreads },
              null,
              2,
            ),
          };
        }
        if (type === "total_count") {
          return {
            text: JSON.stringify(
              { total_messages: SYNTHETIC_MESSAGES.length, total_threads: SYNTHETIC_THREADS.length },
              null,
              2,
            ),
          };
        }
        return { text: `Synthetic stats for ${type} computed.` };
      }

      default:
        return { text: `Unknown tool: ${toolName}` };
    }
  };
}
