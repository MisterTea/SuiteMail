import { FileText } from 'lucide-react'
import { SiteLayout } from '../components/SiteLayout'
import { withBase } from '../lib/paths'

const SECTIONS = [
  { id: 'acceptance', title: '1. Acceptance of Terms' },
  { id: 'license', title: '2. Open-Source License' },
  { id: 'local-software', title: '3. Local-First Software' },
  { id: 'third-party', title: '4. Third-Party Services & Accounts' },
  { id: 'ai-agents', title: '5. AI & Smart Agent Features' },
  { id: 'acceptable-use', title: '6. Acceptable Use' },
  { id: 'warranties', title: '7. Disclaimer of Warranties' },
  { id: 'liability', title: '8. Limitation of Liability' },
  { id: 'updates', title: '9. Changes to These Terms' },
  { id: 'contact', title: '10. Contact' },
]

export function TermsPage() {
  return (
    <SiteLayout activePage="terms">
      <section className="border-b border-line subtle-grid">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-14 pb-12 sm:pt-20 sm:pb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pine-soft text-pine-ink text-xs font-semibold tracking-wide mb-5">
            <FileText className="w-3.5 h-3.5" />
            TERMS OF SERVICE
          </div>
          <h1 className="font-display text-4xl sm:text-6xl text-ink leading-tight">
            Terms of Service
          </h1>
          <p className="mt-4 text-base sm:text-lg text-ink-muted max-w-2xl leading-relaxed">
            Effective Date: November 24, 2026 · Governs your use of the SuiteMail software and
            website.
          </p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Sticky TOC */}
          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-24 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-xs font-mono uppercase tracking-wider text-ink-subtle font-semibold mb-3">
                Contents
              </h2>
              <nav aria-label="Terms of service sections">
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

          {/* Terms Body */}
          <div className="lg:col-span-8 space-y-10 text-sm sm:text-base text-ink-muted leading-relaxed">
            <section id="acceptance" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                1. Acceptance of Terms
              </h2>
              <p>
                By downloading, installing, or using the SuiteMail desktop or mobile applications,
                or by accessing this website, you agree to these Terms of Service and our{' '}
                <a href={withBase('privacy/')} className="text-pine underline hover:text-pine-ink">
                  Privacy Policy
                </a>
                . If you do not agree, do not use the software.
              </p>
            </section>

            <section id="license" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                2. Open-Source License
              </h2>
              <p>
                SuiteMail is free and open-source software licensed under the{' '}
                <a
                  href="https://github.com/MisterTea/SuiteMail/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pine underline hover:text-pine-ink"
                >
                  Apache License, Version 2.0
                </a>
                . Nothing in these Terms restricts any rights granted to you under the Apache-2.0
                License. Where any provision conflicts with the Apache-2.0 License regarding your
                rights to the source code or binaries, the Apache-2.0 License controls.
              </p>
            </section>

            <section id="local-software" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                3. Local-First Software
              </h2>
              <p>
                SuiteMail is client software that runs locally on your device. The SuiteMail
                project does not host your email, does not provide an email address, and does not
                operate cloud synchronization servers. You are solely responsible for maintaining
                backups of your device and managing your underlying email accounts.
              </p>
            </section>

            <section id="third-party" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                4. Third-Party Services &amp; Accounts
              </h2>
              <p>
                When you connect Gmail, Microsoft 365 / Outlook, Exchange, Proton Mail, CalDAV,
                IMAP/SMTP servers, or optional cloud AI APIs, your relationship with those
                providers remains governed by their respective terms of service and acceptable use
                policies. You are responsible for safeguarding your passwords, app passwords,
                OAuth credentials, and API keys.
              </p>
            </section>

            <section id="ai-agents" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                5. AI &amp; Smart Agent Features
              </h2>
              <p>
                SuiteMail provides local and optional cloud AI features—including thread
                summaries, smart reply drafts, filter creation, and meeting scheduling assistants.
                AI outputs can occasionally be inaccurate or incomplete. You are responsible for
                reviewing drafted replies, calendar invitations, and automated filter rules before
                relying on them or sending communications to others.
              </p>
            </section>

            <section id="acceptable-use" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                6. Acceptable Use
              </h2>
              <p>
                You agree to use SuiteMail in compliance with all applicable laws and regulations,
                including anti-spam, privacy, and electronic communications laws. You may not use
                SuiteMail to send unsolicited bulk email, distribute malware, or violate the terms
                of your email service providers.
              </p>
            </section>

            <section id="warranties" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                7. Disclaimer of Warranties
              </h2>
              <p className="uppercase text-xs sm:text-sm tracking-wide leading-relaxed">
                SUITEMAIL IS PROVIDED “AS IS” AND “AS AVAILABLE,” WITHOUT WARRANTY OF ANY KIND,
                EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
                MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
                THE CONTRIBUTORS DO NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED,
                ERROR-FREE, OR FREE OF DEFECTS.
              </p>
            </section>

            <section id="liability" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                8. Limitation of Liability
              </h2>
              <p className="uppercase text-xs sm:text-sm tracking-wide leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE SUITEMAIL
                AUTHORS OR CONTRIBUTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
                EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING LOSS OF EMAILS, DATA, PROFITS, OR
                BUSINESS INTERRUPTION) ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF SUITEMAIL,
                EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
              </p>
            </section>

            <section id="updates" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                9. Changes to These Terms
              </h2>
              <p>
                We may revise these Terms of Service from time to time. Changes take effect when
                posted on this page with an updated effective date. Continued use of SuiteMail
                after changes are posted constitutes acceptance of the revised terms.
              </p>
            </section>

            <section id="contact" className="scroll-mt-24">
              <h2 className="font-display text-2xl sm:text-3xl text-ink mb-3">
                10. Contact
              </h2>
              <p>
                For questions regarding these Terms of Service, please open an issue or discussion
                in the{' '}
                <a
                  href="https://github.com/MisterTea/SuiteMail"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pine underline hover:text-pine-ink"
                >
                  SuiteMail GitHub Repository
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
