<p align="center">
  <img src="assets/icon.png" alt="SuiteMail" width="128" height="128" style="border-radius: 24px;" />
</p>

<h1 align="center">SuiteMail</h1>

<p align="center">
  <strong>Your mail, your machine, your intelligence.</strong>
</p>

<p align="center">
  A privacy-first, open-source email client for desktop and mobile—supercharged with local AI, smart agents, direct mail-server metadata sync, and a unified interface for all your mailboxes.
</p>

<p align="center">
  <a href="https://mistertea.github.io/SuiteMail/">Website</a>
  &nbsp;&bull;&nbsp;
  <a href="https://mistertea.github.io/SuiteMail/features/">20 Narrated Storyboards</a>
  &nbsp;&bull;&nbsp;
  <a href="https://github.com/MisterTea/SuiteMail/releases/latest">Download</a>
  &nbsp;&bull;&nbsp;
  <a href="https://mistertea.github.io/SuiteMail/privacy/">Privacy Policy</a>
  &nbsp;&bull;&nbsp;
  <a href="https://mistertea.github.io/SuiteMail/terms/">Terms of Service</a>
</p>

---

## Core Principles

### 1. Privacy-First AI — Local on Desktop & Mobile
Run local language models directly on your desktop (`llama.cpp`) and Android phone so private conversations never leave your hardware. Local vector embeddings power offline semantic search and natural-language inbox queries. Prefer a cloud model? Bring your own API key for Anthropic Claude, OpenAI, or Google Gemini with explicit per-action consent.

### 2. Smart Agents That Work for You
SuiteMail includes built-in agents that actively help manage your inbox:
- **Filter Agent** — Create inbox rules and smart auto-labels from plain English.
- **Meeting Agent** — Detect `.ics` invitations, suggest meeting times, share availability slots, and RSVP in one click.
- **Reply Agent** — Generate quick replies and context-aware drafts matched to your writing style.

### 3. Sync Metadata & Labels Using Your Existing Mail Server
Other modern email clients store your labels, snoozes, and metadata on their own proprietary cloud. SuiteMail synchronizes CRDT metadata and labels directly through your existing mail server—**no additional data in the cloud**, no SuiteMail account, and no middleman servers. Everything is backed locally by SQLite for instant offline access.

### 4. One Interface for All Your Mailboxes
Unify work, personal, and encrypted email in a single keyboard-first workspace with instant account switching and an **All Accounts** unified view:
- **Gmail** (OAuth 2.0 PKCE + Gmail API & Google Calendar)
- **Microsoft 365 / Outlook** (Microsoft Graph) & **Exchange (EWS)**
- **Proton Mail** (Desktop Bridge & Android support)
- **Any IMAP / SMTP provider** (Fastmail, iCloud, Yahoo, Zoho, GMX, custom servers with auto-discovery)
- **CalDAV** calendars and **CardDAV / Google Contacts** sync

---

## Key Capabilities

- **Inbox & Triage** — Instant local SQLite + FTS5 search with Gmail-style operators, split inbox categories, snooze, pin, star, mute, follow-up reminders, newsletter bundling, one-click RFC 8058 unsubscribe, quick steps, and bulk actions.
- **Rich Composer** — TipTap v3 editor, undo send, schedule send, auto-saved drafts, reusable templates, signatures, send-as aliases, CSV mail merge, inline attachment previews, Attachment Library, and OpenPGP-signed contract blocks.
- **Security & Privacy by Default** — Remote image blocking with per-sender allowlists, DOMPurify HTML sanitization, sandboxed iframe rendering, tracking pixel detection, SPF/DKIM/DMARC verification badges, phishing link heuristics, and AES-256-GCM encrypted local credential storage.
- **Desktop & Mobile** — Native desktop builds for Windows, macOS, and Linux (Electron + Rust N-API) plus Android and iPhone builds (Capacitor) with responsive touch navigation.

See all 20 workflows in action on the **[Features & Storyboards page](https://mistertea.github.io/SuiteMail/features/)**, or watch the 30-second **[Account Setup Walkthrough](https://mistertea.github.io/SuiteMail/#account-setup)**.

---

## Download & Install

Grab the latest release for your platform from **[GitHub Releases](https://github.com/MisterTea/SuiteMail/releases/latest)**:

- **Windows:** `.exe` / `.msi`
- **macOS:** `.dmg`
- **Linux:** `.AppImage` / `.deb` (see [docs/linux.md](docs/linux.md))
- **Android:** APK preview (see [docs/android.md](docs/android.md))

---

## Building from Source

**Prerequisites:** [Node.js](https://nodejs.org/) v22.12+ and [Rust](https://www.rust-lang.org/tools/install)

```bash
git clone https://github.com/MisterTea/SuiteMail.git
cd SuiteMail
npm install
npm run dev:desktop
```

### Common Commands

| Command | Description |
| --- | --- |
| `npm run dev:desktop` | Build Rust core and start Electron desktop app with Vite HMR |
| `npm run package` | Build release Rust core, frontend bundle, and desktop installers |
| `npm run dev:ios` | Build SuiteMail for iPhone and open the Xcode project |
| `npm run build:android` | Build Android bundle and sync Capacitor project |
| `npm run dev:landing` | Preview the SuiteMail website (`landing/`) locally |
| `npm run test` | Run unit & component tests (Vitest) |
| `npm run test:e2e` | Run Playwright end-to-end tests |

---

## Architecture & Tech Stack

| Layer | Technologies |
| --- | --- |
| **Desktop & Mobile Shell** | Electron + Rust (N-API) · Capacitor (Android) |
| **Frontend** | React 19 · TypeScript · Tailwind CSS v4 · Zustand 5 · TipTap v3 |
| **Storage & Search** | Local SQLite + FTS5 trigram search · 384-d local vector embeddings |
| **Sync & Protocols** | Gmail API · Microsoft Graph · EWS · Rust `async-imap` / `lettre` · Proton Bridge · Automerge CRDT metadata sync |
| **AI** | On-device local AI (`llama.cpp` desktop + Android host AI) · Optional BYOK Claude, OpenAI, Gemini |

### Documentation

- [Architecture Overview](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Keyboard Shortcuts](docs/keyboard-shortcuts.md)
- [Linux Support](docs/linux.md)
- [Android Guide](docs/android.md)
- [iPhone Build and TestFlight Guide](docs/ios.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

---

## License

SuiteMail is open-source software licensed under the [Apache License, Version 2.0](LICENSE).
