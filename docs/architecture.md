# Architecture

SuiteMail follows a **three-layer architecture** with clear separation of concerns.

```
+--------------------------+
|     React 19 + Zustand   |   UI Layer
|  Components + 9 Stores   |   (TypeScript)
+--------------------------+
|     Service Layer         |   Business Logic
|  Email Provider / Gmail / |   (TypeScript)
|  IMAP / DB / AI / Sync /  |
|  Calendar / Bundles /     |
|  Filters / Notifications  |
+--------------------------+
|     Electron + Rust       |   Native Layer
|  System Tray / OAuth /    |   (Rust)
|  SQLite / Notifications / |
|  Deep Links / Autostart   |
+--------------------------+
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Electron + Rust (N-API) |
| **Frontend** | React 19, TypeScript, Zustand 5 |
| **Styling** | Tailwind CSS v4 |
| **Editor** | TipTap v3 |
| **Backend** | Rust |
| **Database** | SQLite (Rust core via Electron IPC) |
| **Search** | FTS5 with trigram tokenizer |
| **AI** | Anthropic Claude, OpenAI GPT, Google Gemini (user-selectable models per provider) |
| **Icons** | Lucide React |
| **Drag & Drop** | @dnd-kit |
| **Testing** | Vitest + Testing Library |

## Data Flow

1. **Sync** -- Background sync every 60s. Gmail accounts use Gmail History API (delta sync, falls back to full sync if history expires ~30 days). IMAP accounts use UIDVALIDITY/last_uid tracking for efficient delta sync.
2. **Storage** -- All messages, threads, labels, contacts, calendar events, and AI results stored in local SQLite (34 tables) with FTS5 full-text indexing.

EWS accounts also support calendars through `EwsCalendarProvider`, using the existing
mailbox OAuth session and Rust EWS transport. The adapter discovers the default and
additional mailbox calendars, loads recurring occurrences with CalendarView, and
supports event creation, edits, and deletion. Dense ranges are split rather than
truncated. Successful range refreshes reconcile remotely deleted or moved events
in the local cache. Edits carry Exchange change keys for conflict detection;
meeting changes send invitations, updates, or cancellations to attendees.
Like CalDAV, `syncEvents` currently performs a bounded full refresh (90 days back
through one year ahead), while the calendar UI fetches the displayed date range.
Shared/delegated calendar discovery and recurrence-rule editing are not included.
3. **State** -- Eight Zustand stores manage UI state. No middleware, no persistence needed -- ephemeral state rebuilds from SQLite on startup.
4. **Rendering** -- Email HTML is sanitized with DOMPurify and rendered in sandboxed iframes. Remote images blocked by default.
5. **Background services** -- Seven interval checkers run continuously: sync (60s), snooze (60s), scheduled send (60s), follow-up reminders (60s), newsletter bundles (60s), offline queue processor (30s), and attachment pre-cache (15min).
6. **Security** -- Phishing link detection scores message links with 10 heuristic rules. SPF/DKIM/DMARC authentication headers parsed and displayed as badges.

## Project Structure

```
suitemail/
├── src/
│   ├── components/           # React components (14 groups, ~94 files)
│   │   ├── layout/           # Sidebar, EmailList, ReadingPane, TitleBar
│   │   ├── email/            # ThreadView, MessageItem, EmailRenderer,
│   │   │                     # ContactSidebar, SmartReplySuggestions,
│   │   │                     # InlineReply, ThreadSummary, FollowUpDialog,
│   │   │                     # AuthBadge, AuthWarningBanner, PhishingBanner,
│   │   │                     # LinkConfirmDialog, CategoryTabs
│   │   ├── composer/         # Composer, AddressInput, EditorToolbar,
│   │   │                     # AiAssistPanel, ScheduleSendDialog, FromSelector
│   │   ├── search/           # CommandPalette, SearchBar, ShortcutsHelp, AskInbox
│   │   ├── settings/         # SettingsPage, FilterEditor, LabelEditor,
│   │   │                     # SubscriptionManager, ContactEditor,
│   │   │                     # QuickStepEditor, SmartFolderEditor
│   │   ├── accounts/         # AddAccount, AddImapAccount, AddProtonAccount, AccountSwitcher, SetupClientId
│   │   ├── calendar/         # CalendarPage, MonthView, WeekView, DayView,
│   │   │                     # EventCard, EventCreateModal
│   │   ├── attachments/      # AttachmentLibrary, AttachmentGridItem, AttachmentListItem
│   │   ├── tasks/            # TasksPage, TaskItem, TaskSidebar, TaskQuickAdd,
│   │   │                     # AiTaskExtractDialog
│   │   ├── help/             # HelpPage, HelpSidebar, HelpSearchBar,
│   │   │                     # HelpCard, HelpCardGrid, HelpTooltip
│   │   ├── labels/           # LabelForm
│   │   ├── dnd/              # DndProvider (drag threads → sidebar labels)
│   │   └── ui/               # EmptyState, Skeleton, ContextMenu, OfflineBanner, illustrations/
│   ├── services/             # Business logic layer
│   │   ├── db/               # SQLite queries (29 files), migrations, FTS5
│   │   ├── email/            # EmailProvider abstraction, providerFactory,
│   │   │                     # gmailProvider, imapSmtpProvider
│   │   ├── gmail/            # GmailClient, tokenManager, syncManager
│   │   ├── imap/             # IMAP sync, folder mapper, auto-discovery,
│   │   │                     # config builder, Electron command wrappers
│   │   ├── proton/           # Proton Mail Bridge detection, status probe, launch automation
│   │   ├── threading/        # JWZ threading engine for IMAP conversations
│   │   ├── ai/               # AI service, 3 providers, categorization, Ask Inbox,
│   │   │                     # writing style analysis, auto-drafts, task extraction
│   │   ├── google/           # Google Calendar API
│   │   ├── composer/         # Draft auto-save
│   │   ├── search/           # Query parser, SQL builder
│   │   ├── filters/          # Auto-apply filter engine
│   │   ├── categorization/   # Rule-based categorization engine
│   │   ├── snooze/           # Snooze & scheduled send checkers
│   │   ├── followup/         # Follow-up reminder checker
│   │   ├── bundles/          # Newsletter bundle manager
│   │   ├── notifications/    # OS notification manager
│   │   ├── contacts/         # Gravatar integration
│   │   ├── attachments/      # Attachment cache manager, pre-cache manager
│   │   ├── unsubscribe/      # One-click unsubscribe (RFC 8058)
│   │   ├── quickSteps/       # Quick step executor, types, defaults
│   │   ├── queue/            # Offline queue processor
│   │   ├── tasks/            # Task recurrence manager
│   │   ├── emailActions.ts   # Centralized email action service (offline-aware)
│   │   ├── badgeManager.ts   # Taskbar badge count
│   │   ├── deepLinkHandler.ts # mailto: protocol handler
│   │   └── globalShortcut.ts # System-wide compose shortcut
│   ├── stores/               # Zustand stores (9): ui, account, thread,
│   │                         # composer, label, contextMenu, shortcut, smartFolder, task
│   ├── hooks/                # useKeyboardShortcuts, useClickOutside, useContextMenu
│   ├── utils/                # crypto, date, emailBuilder, sanitize, imageBlocker,
│   │                         # mailtoParser, fileUtils, templateVariables, noReply
│   ├── constants/            # Keyboard shortcuts, color themes, help content
│   └── styles/               # Tailwind CSS v4 globals
├── electron/                # Desktop shell, preload bridge, icons
├── crates/supermail-core/    # Rust N-API module: SQLite, OAuth, IMAP/SMTP
├── docs/                     # Documentation
├── package.json
├── CLAUDE.md                 # AI coding assistant context
└── README.md
```

## Desktop and Rust Backend

`electron/main.js` handles windows, system tray, single-instance enforcement, deep links, notifications and desktop IPC. `electron/preload.cjs` exposes the `window.supermail` bridge consumed through `src/platform/`.

The Rust N-API module in `crates/supermail-core/` handles SQLite, OAuth, IMAP (`async-imap` and `mail-parser`), SMTP (`lettre`), Proton Bridge discovery and local AI operations. Native commands are routed through `src/dispatcher.rs` in that crate.

## Service Layer

All business logic lives in `src/services/` as plain async functions (except `GmailClient` class). Email operations use the `EmailProvider` abstraction — all sync/send flows go through `providerFactory.ts` which returns the appropriate provider (Gmail API or IMAP/SMTP) based on the account type.

| Service | Description |
|---------|-------------|
| `db/` | SQLite queries (29 files), migrations, FTS5 search |
| `email/` | EmailProvider abstraction, provider factory, Gmail/IMAP adapters |
| `gmail/` | Gmail client, token management, sync engine |
| `imap/` | IMAP sync, folder-to-label mapping, auto-discovery, Electron command wrappers |
| `threading/` | JWZ threading algorithm for IMAP message grouping |
| `ai/` | AI service with 3 providers (selectable models), categorization, Ask Inbox, writing style analysis, auto-drafts, task extraction |
| `google/` | Google Calendar API |
| `composer/` | Draft auto-save (3s debounce) |
| `contracts/` | Signed contract blocks on outgoing mail, verified with the appended public key |
| `search/` | Gmail-style query parser, SQL builder |
| `filters/` | Auto-apply filter engine (AND logic) |
| `categorization/` | Rule-based categorization before AI fallback |
| `snooze/` | Snooze & scheduled send background checkers |
| `followup/` | Follow-up reminder checker |
| `bundles/` | Newsletter bundling with delivery schedules |
| `notifications/` | OS notifications with VIP filtering |
| `contacts/` | Gravatar integration |
| `attachments/` | Local attachment caching, pre-cache recent attachments |
| `unsubscribe/` | One-click unsubscribe (RFC 8058) |
| `quickSteps/` | Custom action chains with executor engine |
| `queue/` | Offline queue processor with exponential backoff |
| `tasks/` | Task recurrence manager |
| `smartLabels/` | AI-powered auto-labeling with two-phase matching (criteria + AI) |

**Root-level services:** `emailActions.ts` (centralized offline-aware email actions), `badgeManager.ts` (taskbar badge), `deepLinkHandler.ts` (mailto: protocol), `globalShortcut.ts` (system-wide compose)

## UI Layer

Nine Zustand stores manage ephemeral UI state:

| Store | Purpose |
|-------|---------|
| `uiStore` | Theme, sidebar, sidebar nav config, reading pane, density, font scale, selections, online status, pending ops count |
| `accountStore` | Account list, active account |
| `threadStore` | Thread list, selected thread, loading state |
| `composerStore` | Compose state, recipients, body, attachments |
| `labelStore` | Label list, label operations |
| `contextMenuStore` | Right-click context menu state |
| `shortcutStore` | Custom keyboard shortcut bindings |
| `smartFolderStore` | Saved searches with dynamic query tokens |
| `taskStore` | Task list, filters, grouping, thread tasks, incomplete count |

## Database

SQLite via the Electron preload bridge and Rust core. 28 migrations, 35 tables total. `contract_key_sightings` stores each email address and public key seen on a signed contract.

Key tables: `accounts` (with `provider`, IMAP/SMTP fields), `messages` (with FTS5 index, `auth_results`, IMAP headers, `imap_uid`, `imap_folder`), `threads` (with `is_pinned`, `is_muted`), `thread_labels`, `labels` (with `imap_folder_path`, `imap_special_use`), `contacts`, `attachments` (with `imap_part_id`), `filter_rules`, `scheduled_emails`, `templates`, `signatures`, `image_allowlist`, `settings`, `ai_cache`, `thread_categories`, `calendar_events`, `follow_up_reminders`, `notification_vips`, `unsubscribe_actions`, `bundle_rules`, `bundled_threads`, `send_as_aliases`, `smart_folders`, `link_scan_results`, `phishing_allowlist`, `quick_steps`, `folder_sync_state` (IMAP sync tracking), `pending_operations` (offline action queue), `local_drafts` (offline draft persistence), `writing_style_profiles` (AI writing style per account), `tasks` (full task management with priorities, subtasks, recurrence), `task_tags` (custom task tag colors), `smart_label_rules` (AI-powered auto-labeling rules).

## Startup Sequence

1. Run database migrations
2. Restore persisted settings (theme, sidebar, density, font scale, reading pane, etc.)
3. Load custom keyboard shortcuts
4. Initialize email providers for all accounts (Gmail API clients + IMAP providers), sync send-as aliases for Gmail accounts
5. Start background sync (60s interval), backfill uncategorized threads
6. Start background checkers (snooze, scheduled send, follow-up, bundles, queue processor, attachment pre-cache)
7. Initialize network status detection (online/offline listeners)
8. Initialize OS notifications
9. Register global compose shortcut
10. Initialize deep link handler (`mailto:`)
11. Update taskbar badge count
12. Close splash screen, show main window

## Packaging & Distribution

`npm run package` builds the Rust N-API module and frontend, then runs Electron Builder using `electron-builder.json`. Installers are written to `dist-electron/`: NSIS and portable executables for Windows, DMG and ZIP for macOS, and AppImage and DEB for Linux.
