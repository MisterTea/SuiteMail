import { Lock, Server, ShieldCheck } from 'lucide-react'
import { SiteLayout } from '../components/SiteLayout'

const SECTIONS = [
  { id: 'overview', title: '1. Local-First Principle' },
  { id: 'what-we-collect', title: '2. Data We Do (and Do Not) Collect' },
  { id: 'mail-sync', title: '3. Mail, Metadata & Label Sync' },
  { id: 'ai-processing', title: '4. Local AI & Optional Cloud AI' },
  { id: 'credentials', title: '5. Credentials & Local Encryption' },
  { id: 'email-safety', title: '6. Remote Images & Tracking Protection' },
  { id: 'third-parties', title: '7. Third-Party Mail & Calendar Providers' },
  { id: 'google-limited-use', title: '8. Google API Services & Limited Use' },
  { id: 'retention', title: '9. Data Retention & Deletion' },
  { id: 'changes', title: '10. Changes & Contact' },
]

export function PrivacyPage() {
  return (
    <SiteLayout activePage="privacy">
      <section className="border-b border-line subtle-grid">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-14 pb-12 sm:pt-20 sm:pb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pine-soft text-pine-ink text-xs font-semibold tracking-wide mb-5">
            <ShieldCheck className="w-3.5 h-3.5" />
            PRIVACY POLICY
          </div>
          <h1 className="font-display text-4xl sm:text-6xl text-ink leading-tight">
            Privacy Policy
          </h1>
          <p className="mt-4 text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            Effective Date: November 25, 2026 · Applies to SuiteMail desktop, mobile, and this
            website.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
        {/* Plain-English Summary Box */}
        <div className="rounded-2xl border border-pine/25 bg-pine-soft/50 p-6 sm:p-8 mb-12">
          <h2 className="text-sm font-mono uppercase tracking-wider text-pine-ink font-semibold mb-3">
            Plain-English Summary
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-ink">
            <div className="flex items-start gap-2.5">
              <Server className="w-4 h-4 text-pine shrink-0 mt-0.5" />
              <span>
                <strong>No hosted mailbox.</strong> We do not operate cloud servers that store,
                proxy, or read your emails.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-pine shrink-0 mt-0.5" />
              <span>
                <strong>No email harvesting or ads.</strong> Optional startup diagnostics
                help us improve reliability and contain no email addresses or message content.
              </span>
            </div>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-pine shrink-0 mt-0.5" />
              <span>
                <strong>Your AI, your choice.</strong> Local AI runs entirely on your desktop or
                mobile device. Cloud AI is strictly opt-in.
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Sticky TOC */}
          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-24 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-xs font-mono uppercase tracking-wider text-ink-subtle font-semibold mb-3">
                Contents
              </h2>
              <nav aria-label="Privacy policy sections">
                <ul className="space-y-2 text-sm">
                  {SECTIONS.map((sec) => (
                    <li key={sec.id}>
                      <a
                        href={`#${sec.id}`}
                        className="text-ink-muted hover:text-pine transition-colors"
                      >
                        {sec.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </aside>

          {/* Policy Body */}
          <div className="lg:col-span-8 space-y-10 text-sm sm:text-base text-ink-muted leading-relaxed">
            <section id="overview" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                1. Local-First Principle
              </h2>
              <p>
                SuiteMail is an open-source, local-first email client for Windows, macOS, Linux,
                and Android. Your messages, attachments, search index, drafts, filters, labels,
                and cached AI outputs are stored locally in an SQLite database on your own
                device. SuiteMail does not require creating a SuiteMail user account and does not
                transmit your mailbox contents to any server operated by the SuiteMail project.
              </p>
            </section>

            <section id="what-we-collect" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                2. Data We Do (and Do Not) Collect
              </h2>
              <p>
                <strong>Optional startup diagnostics on desktop and Android.</strong> If you agree to share
                diagnostics when prompted or enable sharing in Settings, SuiteMail sends up to
                one report per launch containing the app version, operating system, and whether
                startup succeeded or failed. We use these counts to spot regressions and improve
                reliability. You can turn off sharing in Settings at any time.
              </p>
              <p className="mt-3">
                Cloudflare processes the source IP address to rate-limit requests. The diagnostics
                collector stores only daily totals by version, operating system, and outcome and
                keeps them for 90 days.
              </p>
              <p className="mt-3">
                This static website is hosted on GitHub Pages. Standard web server access logs
                (such as IP address and requested path) may be processed by GitHub in accordance
                with GitHub’s own privacy statement. SuiteMail does not set tracking cookies or
                third-party analytics scripts on this site.
              </p>
            </section>

            <section id="mail-sync" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                3. Mail, Metadata &amp; Label Sync
              </h2>
              <p>
                SuiteMail connects directly from your device to your chosen email providers
                (such as Gmail API, Microsoft 365 / Outlook, Exchange Web Services, Proton Mail
                Bridge, or any IMAP/SMTP server).
              </p>
              <p className="mt-3">
                To keep labels, filters, and mail metadata synchronized across your desktop and
                mobile devices, SuiteMail uses conflict-free replicated data types (CRDTs)
                stored directly on your existing mail server. No additional third-party cloud
                database is created or used.
              </p>
            </section>

            <section id="ai-processing" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                4. Local AI &amp; Optional Cloud AI
              </h2>
              <p>
                <strong>On-Device Local AI:</strong> When you use SuiteMail’s local AI engine on
                desktop (via llama.cpp) or mobile (on-device Android inference), prompts, email
                context, embeddings, and agent actions are processed entirely on your hardware
                with zero network transmission.
              </p>
              <p className="mt-3">
                <strong>Optional Cloud AI Providers:</strong> If you explicitly choose to enter
                your own API key for a cloud provider (such as Anthropic Claude, OpenAI, or
                Google Gemini), SuiteMail sends only the message context required to fulfill your
                requested action—gated by explicit consent controls—directly from your device to
                that provider under your own API account and their respective privacy policy.
              </p>
            </section>

            <section id="credentials" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                5. Credentials &amp; Local Encryption
              </h2>
              <p>
                OAuth tokens, IMAP/SMTP passwords, and optional AI API keys are stored locally on
                your device using AES-256-GCM encryption and OS keychain protections where
                available. Gmail authentication uses OAuth 2.0 PKCE directly between your device
                and Google without any SuiteMail intermediary server.
              </p>
            </section>

            <section id="email-safety" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                6. Remote Images &amp; Tracking Protection
              </h2>
              <p>
                By default, SuiteMail blocks remote images to prevent senders from learning when
                or where you open an email, sanitizes HTML with DOMPurify, renders messages inside
                sandboxed iframes, highlights tracking pixels, checks SPF/DKIM/DMARC headers, and
                warns against phishing links. You may allow remote images per sender at your
                discretion.
              </p>
            </section>

            <section id="third-parties" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                7. Third-Party Mail &amp; Calendar Providers
              </h2>
              <p>
                Your use of third-party email, calendar, contact, or optional cloud AI services
                (such as Google, Microsoft, Proton, Fastmail, Apple iCloud, Anthropic, or OpenAI)
                is governed by those providers’ privacy policies and terms. SuiteMail acts solely
                as a local client software tool under your control.
              </p>
            </section>

            <section id="google-limited-use" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                8. Google API Services &amp; Limited Use
              </h2>
              <p>
                SuiteMail’s use and transfer of information received from Google APIs to any other
                app adheres to the{' '}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pine underline hover:text-pine-ink"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
              <p className="mt-3">
                All Gmail and Google Calendar data accessed through Google APIs is fetched directly
                by the SuiteMail application running on your local device and stored only in your
                local encrypted database. SuiteMail does not transfer or store Google user data on
                any SuiteMail-operated server, does not sell or share Google user data for
                advertising, and does not use data obtained through Google Workspace APIs to
                develop, improve, or train generalized artificial intelligence (AI) or machine
                learning (ML) models.
              </p>
            </section>

            <section id="retention" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                9. Data Retention &amp; Deletion
              </h2>
              <p>
                Your mailbox data stays on your devices and your own mail servers. Removing an
                account in SuiteMail or deleting the local SuiteMail application data directory
                permanently removes all local copies, caches, embeddings, and encrypted tokens
                from your device.
              </p>
            </section>

            <section id="changes" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                10. Changes &amp; Contact
              </h2>
              <p>
                We may update this Privacy Policy as SuiteMail evolves. Any updates will be
                published on this page with an updated effective date and tracked publicly in our
                open-source repository.
              </p>
              <p className="mt-3">
                Questions or security reports can be submitted via our{' '}
                <a
                  href="https://github.com/MisterTea/SuiteMail/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pine underline hover:text-pine-ink"
                >
                  GitHub Issues page
                </a>{' '}
                or according to{' '}
                <a
                  href="https://github.com/MisterTea/SuiteMail/blob/main/SECURITY.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pine underline hover:text-pine-ink"
                >
                  SECURITY.md
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </section>
    </SiteLayout>
  )
}
