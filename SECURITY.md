# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older releases | No |

We only provide security fixes for the latest release. Please keep SuiteMail up to date.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them by opening a [private security advisory](https://github.com/MisterTea/SuiteMail/security/advisories/new) on GitHub.

Include as much of the following as possible:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive an acknowledgment within **48 hours**. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Model

### Local-First Architecture

SuiteMail stores downloaded mail, tokens, and settings in a local SQLite database. The app connects directly to configured mail and calendar services, and to your chosen AI provider when you use cloud AI. Optional diagnostics and manually submitted bug reports use separate hosted endpoints.

### Authentication & Credentials

- **Gmail**: OAuth 2.0 with PKCE. Tokens and any user-configured client secret are encrypted with AES-256-GCM before being saved to the local database.
- **IMAP/SMTP**: Passwords and app passwords are encrypted with AES-256-GCM in the local SQLite database.
- **AI API keys**: Stored locally and sent to the respective provider over HTTPS.

### Email Rendering

- HTML emails are sanitized with **DOMPurify** and rendered in a **sandboxed iframe** (`allow-same-origin` only -- no scripts)
- Remote images are **blocked by default** and replaced with placeholders. Users can allowlist specific senders.
- Phishing detection uses 10 heuristic rules to flag suspicious links before you click them

### Network

- Provider APIs use HTTPS. Local integrations can use HTTP, and manually configured IMAP or SMTP accounts can choose their transport security.
- **Startup diagnostics** are off by default. In the desktop app, open **Settings → General → Privacy & Security** to enable or disable them. From the next launch after enabling, SuiteMail sends at most one startup result per launch with the app version, operating system family, and whether startup succeeded. The payload contains no mail, addresses, account or device IDs, credentials, or error text.
- Cloudflare handles the connection and uses the source IP for short-term rate limiting. SuiteMail stores only daily aggregate counts and expires them after 90 days. Manual bug reports are separate and can include the details and screenshot you choose to send.

### Dependencies

- Frontend: React, Tailwind CSS, TipTap, Zustand, DOMPurify, lucide-react
- Backend: Electron + Rust (N-API), async-imap, lettre, mail-parser
- We monitor dependencies for known vulnerabilities and update regularly

## Scope

The following are **in scope** for security reports:

- Authentication bypass or token leakage
- Credential exposure (OAuth tokens, IMAP passwords, API keys)
- Cross-site scripting (XSS) via email content escaping the sandbox
- Remote code execution
- SQL injection in the local SQLite database
- Insecure data storage or encryption weaknesses
- Phishing detection bypasses

The following are **out of scope**:

- Vulnerabilities requiring physical access to the user's machine (local SQLite is not encrypted at rest by design -- the OS protects user files)
- Denial of service against the local application
- Issues in third-party dependencies with no demonstrated impact on SuiteMail
- Social engineering attacks

## Disclosure Policy

- We follow coordinated disclosure. Please allow us reasonable time (typically 90 days) to address the issue before public disclosure.
- We will credit reporters in release notes unless anonymity is requested.
