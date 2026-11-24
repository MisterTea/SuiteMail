export type StoryboardCategory =
  | 'Inbox & Triage'
  | 'Composing & Replies'
  | 'Organization & Search'
  | 'Scheduling & Drafts'
  | 'Calendar & Safety'

export interface StoryboardItem {
  id: number
  slug: string
  title: string
  category: StoryboardCategory
  summary: string
  narration: string
  videoFile: string
  shortcutHint?: string
}

export const STORYBOARD_CATEGORIES: ('All' | StoryboardCategory)[] = [
  'All',
  'Inbox & Triage',
  'Composing & Replies',
  'Organization & Search',
  'Scheduling & Drafts',
  'Calendar & Safety',
]

export const STORYBOARDS: StoryboardItem[] = [
  {
    id: 1,
    slug: 'read-and-browse-inbox',
    title: 'Read & Browse Inbox',
    category: 'Inbox & Triage',
    summary: 'Open conversations instantly from local SQLite storage with sanitized, sandboxed HTML rendering.',
    narration:
      'Browse your inbox with instant local SQLite speed. Tap any conversation to open the reading pane, view sanitized rich HTML in a secure sandboxed frame, and automatically mark the thread as read.',
    videoFile: 'storyboard-01-read-and-browse-inbox.mp4',
    shortcutHint: 'J / K / Enter',
  },
  {
    id: 2,
    slug: 'compose-and-send-new-email',
    title: 'Compose & Send New Email',
    category: 'Composing & Replies',
    summary: 'Draft formatted messages in the TipTap rich-text composer and send directly via your mail server.',
    narration:
      'Compose a new message from anywhere in SuiteMail. Add recipients, write with the rich text editor, and send directly through your mail server.',
    videoFile: 'storyboard-02-compose-and-send-new-email.mp4',
    shortcutHint: 'C',
  },
  {
    id: 3,
    slug: 'reply-to-sender',
    title: 'Reply to Sender',
    category: 'Composing & Replies',
    summary: 'Launch an inline reply with automatic quoted thread context and send in seconds.',
    narration:
      'Reply to the sender in a single tap. SuiteMail quotes the original thread context automatically so you can write a quick response and send.',
    videoFile: 'storyboard-03-reply-to-sender.mp4',
    shortcutHint: 'R',
  },
  {
    id: 4,
    slug: 'reply-all',
    title: 'Reply All',
    category: 'Composing & Replies',
    summary: 'Preserve every recipient and CC address cleanly when responding to group conversations.',
    narration:
      'Need to keep the whole team in the loop? Reply All preserves every original recipient and CC address cleanly in one step.',
    videoFile: 'storyboard-04-reply-all.mp4',
    shortcutHint: 'A',
  },
  {
    id: 5,
    slug: 'forward-email',
    title: 'Forward Email',
    category: 'Composing & Replies',
    summary: 'Route conversations to teammates with Fwd: subject formatting and full quoted history.',
    narration:
      'Forward any conversation with full quoted context and a clean Fwd subject prefix, ready to route to a teammate or collaborator.',
    videoFile: 'storyboard-05-forward-email.mp4',
    shortcutHint: 'F',
  },
  {
    id: 6,
    slug: 'archive-email',
    title: 'Archive Email',
    category: 'Inbox & Triage',
    summary: 'Clear handled threads toward Inbox Zero while keeping everything indexed and searchable.',
    narration:
      'Move toward Inbox Zero effortlessly. Archiving clears the thread from your inbox while keeping it searchable and synced on your mail server.',
    videoFile: 'storyboard-06-archive-email.mp4',
    shortcutHint: 'E',
  },
  {
    id: 7,
    slug: 'delete-trash-email',
    title: 'Delete & Trash Email',
    category: 'Inbox & Triage',
    summary: 'Move unwanted threads to Trash locally and sync deletions straight to your mail server.',
    narration:
      'Remove unwanted messages in one tap. SuiteMail moves the thread to Trash locally and syncs the deletion straight to your existing mail server, keeping all devices aligned without any third-party cloud.',
    videoFile: 'storyboard-07-delete-trash-email.mp4',
    shortcutHint: '#',
  },
  {
    id: 8,
    slug: 'star-flag-important-email',
    title: 'Star & Flag Important Email',
    category: 'Inbox & Triage',
    summary: 'Highlight high-value conversations so they stay immediately accessible in Starred.',
    narration:
      'Star important conversations to keep them within reach. Flagged threads appear immediately in your Starred view across desktop and mobile.',
    videoFile: 'storyboard-08-star-flag-important-email.mp4',
    shortcutHint: 'S',
  },
  {
    id: 9,
    slug: 'pin-urgent-thread',
    title: 'Pin Urgent Thread',
    category: 'Inbox & Triage',
    summary: 'Keep active, time-sensitive threads anchored to the top of your inbox list.',
    narration:
      'Pin urgent threads to the top of your inbox so critical messages never get buried under incoming mail.',
    videoFile: 'storyboard-09-pin-urgent-thread.mp4',
    shortcutHint: 'P',
  },
  {
    id: 10,
    slug: 'search-emails',
    title: 'Instant Local Search',
    category: 'Organization & Search',
    summary: 'Filter your entire mailbox with local FTS5 indexing and Gmail-style search operators.',
    narration:
      'Search your entire mailbox instantaneously using local full-text indexing and Gmail-style operators, even when you are completely offline.',
    videoFile: 'storyboard-10-search-emails.mp4',
    shortcutHint: '/',
  },
  {
    id: 11,
    slug: 'organize-move-to-folder',
    title: 'Organize & Move to Folder',
    category: 'Organization & Search',
    summary: 'Apply labels and move threads into folders synced directly over your mail server.',
    narration:
      'Organize threads into folders and labels in seconds. Your label metadata syncs directly through your existing mail server with zero extra cloud storage.',
    videoFile: 'storyboard-11-organize-move-to-folder.mp4',
    shortcutHint: 'V / L',
  },
  {
    id: 12,
    slug: 'mark-as-unread',
    title: 'Mark as Unread',
    category: 'Inbox & Triage',
    summary: 'Flip any opened thread back to unread so it remains visible for later follow-up.',
    narration:
      'Not ready to handle a thread yet? Toggle any opened conversation back to unread so it stays highlighted for later follow-up.',
    videoFile: 'storyboard-12-mark-as-unread.mp4',
    shortcutHint: 'U',
  },
  {
    id: 13,
    slug: 'snooze-email',
    title: 'Snooze Email',
    category: 'Scheduling & Drafts',
    summary: 'Defer conversations until tomorrow or a custom date so they return when you can act.',
    narration:
      'Snooze an email until tomorrow or a custom time. It disappears from your inbox now and resurfaces right when you are ready to act.',
    videoFile: 'storyboard-13-snooze-email.mp4',
    shortcutHint: 'H',
  },
  {
    id: 14,
    slug: 'schedule-send',
    title: 'Schedule Send',
    category: 'Scheduling & Drafts',
    summary: 'Write now and schedule outbound messages for the exact delivery window you prefer.',
    narration:
      'Draft on your own schedule and pick the exact delivery time. Schedule Send queues your message to go out at the right moment.',
    videoFile: 'storyboard-14-schedule-send.mp4',
  },
  {
    id: 15,
    slug: 'auto-save-and-resume-draft',
    title: 'Auto-Save & Resume Draft',
    category: 'Scheduling & Drafts',
    summary: 'Automatic local draft saving lets you close the composer and resume seamlessly from Drafts.',
    narration:
      'Never lose a thought. SuiteMail auto-saves your drafts locally as you type so you can jump back into Drafts and pick up right where you left off.',
    videoFile: 'storyboard-15-auto-save-and-resume-draft.mp4',
  },
  {
    id: 16,
    slug: 'attach-files-and-attachment-library',
    title: 'Attachments & Attachment Library',
    category: 'Organization & Search',
    summary: 'Preview inline attachments and browse every file across your mailbox in one library.',
    narration:
      'Inspect message attachments inline and browse every file across your mailbox from the centralized Attachment Library.',
    videoFile: 'storyboard-16-attach-files-and-attachment-library.mp4',
  },
  {
    id: 17,
    slug: 'calendar-invite-and-rsvp',
    title: 'Calendar Invite & One-Click RSVP',
    category: 'Calendar & Safety',
    summary: 'Automatically detect .ics meeting invitations and accept or decline directly in the thread.',
    narration:
      'SuiteMail detects calendar invitations automatically and lets you RSVP with one click, updating your schedule without leaving your inbox.',
    videoFile: 'storyboard-17-calendar-invite-and-rsvp.mp4',
  },
  {
    id: 18,
    slug: 'one-click-unsubscribe',
    title: 'One-Click Unsubscribe',
    category: 'Calendar & Safety',
    summary: 'Execute RFC 8058 one-click unsubscribe and automatically archive newsletter clutter.',
    narration:
      'Cut newsletter clutter with standards-based one-click unsubscribe that opts you out cleanly and archives the thread automatically.',
    videoFile: 'storyboard-18-one-click-unsubscribe.mp4',
  },
  {
    id: 19,
    slug: 'report-spam-phishing-safety',
    title: 'Spam & Phishing Protection',
    category: 'Calendar & Safety',
    summary: 'Inspect SPF, DKIM, and DMARC verification warnings and report suspicious mail in one tap.',
    narration:
      'Built-in authentication checks flag SPF, DKIM, and DMARC failures and suspicious links, letting you report spam and stay protected.',
    videoFile: 'storyboard-19-report-spam-phishing-safety.mp4',
  },
  {
    id: 20,
    slug: 'multi-select-bulk-actions',
    title: 'Multi-Select Bulk Actions',
    category: 'Organization & Search',
    summary: 'Select multiple threads simultaneously to archive, label, or triage in a single pass.',
    narration:
      'Select multiple threads at once to archive, label, or triage in bulk, clearing dozens of messages in a single action.',
    videoFile: 'storyboard-20-multi-select-bulk-actions.mp4',
    shortcutHint: 'X',
  },
]
