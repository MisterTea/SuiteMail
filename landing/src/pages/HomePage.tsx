import {
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Download,
  Filter,
  Github,
  Inbox,
  Layers,
  Lock,
  MessageSquareReply,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { SiteLayout } from '../components/SiteLayout'
import { withBase } from '../lib/paths'

const PROVIDERS = [
  'Gmail',
  'Outlook / Microsoft 365',
  'Exchange (EWS)',
  'Proton Mail',
  'iCloud Mail',
  'Fastmail',
  'Yahoo Mail',
  'Any IMAP / SMTP',
  'CalDAV & Google Calendar',
]

const SETUP_STEPS = [
  {
    step: '01',
    title: 'Pick any provider',
    detail: 'Connect Gmail, Microsoft 365, Exchange, Proton Mail, or any IMAP/SMTP server.',
  },
  {
    step: '02',
    title: 'Auto-discover servers',
    detail: 'SuiteMail automatically fills in TLS ports and hosts for popular providers.',
  },
  {
    step: '03',
    title: 'Verify & encrypt locally',
    detail: 'Credentials stay encrypted on your device with AES-256-GCM — never sent to a cloud.',
  },
  {
    step: '04',
    title: 'One unified workspace',
    detail: 'Switch accounts instantly or read everything together in All Accounts.',
  },
]

export function HomePage() {
  return (
    <SiteLayout activePage="home">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-line subtle-grid">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-20 sm:pt-24 sm:pb-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pine-soft text-pine-dark text-xs font-semibold tracking-wide mb-6">
              <Lock className="w-3.5 h-3.5" />
              PRIVACY-FIRST EMAIL FOR DESKTOP &amp; MOBILE
            </div>

            <h1 className="font-display text-5xl sm:text-6xl lg:text-[4.25rem] leading-[1.04] text-ink">
              Your mail, your machine,{' '}
              <span className="italic text-pine">your intelligence.</span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-ink-muted leading-relaxed max-w-2xl">
              SuiteMail brings all your mailboxes into one fast interface—supercharged with
              privacy-first local AI on desktop and mobile, smart agents that triage and schedule
              for you, and metadata sync that uses your own mail server with zero extra cloud
              storage.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3.5">
              <a
                href="https://github.com/MisterTea/SuiteMail/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-pine text-white font-semibold text-sm sm:text-base hover:bg-pine-dark transition-colors shadow-sm"
              >
                <Download className="w-4 h-4" />
                Download SuiteMail
              </a>
              <a
                href={withBase('features/')}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-surface border border-line-strong text-ink font-semibold text-sm sm:text-base hover:border-pine hover:text-pine transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                Watch 20 Feature Storyboards
              </a>
              <a
                href="https://github.com/MisterTea/SuiteMail"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-3.5 rounded-xl text-sm font-medium text-ink-muted hover:text-ink transition-colors"
              >
                <Github className="w-4 h-4" />
                Open Source (Apache-2.0)
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono text-ink-subtle">
              <span>Windows · macOS · Linux · Android</span>
              <span className="hidden sm:inline">•</span>
              <span>No SuiteMail account required</span>
              <span className="hidden sm:inline">•</span>
              <span>100% free &amp; open source</span>
            </div>
          </div>
        </div>
      </section>

      {/* Account Setup Walkthrough Video (Front Page) */}
      <section id="account-setup" className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-pine font-semibold mb-2">
              Quick Start Walkthrough
            </p>
            <h2 className="font-display text-3xl sm:text-4xl text-ink">
              Set up your account in under 30 seconds
            </h2>
            <p className="mt-2.5 text-ink-muted max-w-2xl">
              Watch how SuiteMail connects to your existing email provider, auto-discovers secure
              server settings, and verifies your connection—all without routing your credentials
              through a SuiteMail cloud.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-paper-alt border border-line text-xs font-medium text-ink-muted self-start lg:self-auto">
            <Volume2 className="w-3.5 h-3.5 text-pine" />
            Narrated HD walkthrough
          </div>
        </div>

        <div className="rounded-2xl bg-studio p-3 sm:p-5 shadow-xl ring-1 ring-ink/10">
          <div className="flex items-center justify-between px-2 pb-3 text-xs font-mono text-white/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
              <span>SuiteMail — Account Setup Walkthrough</span>
            </div>
            <span>1280×720 · Narrated</span>
          </div>

          <div className="relative rounded-xl overflow-hidden bg-black aspect-video ring-1 ring-white/10">
            <video
              controls
              playsInline
              preload="metadata"
              poster={withBase('videos/account-setup-poster.jpg')}
              className="w-full h-full object-contain bg-black"
              src={withBase('videos/account-setup.mp4')}
            >
              Your browser does not support HTML5 video playback.
            </video>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            {SETUP_STEPS.map((item) => (
              <div
                key={item.step}
                className="rounded-xl bg-studio-card/90 border border-white/10 p-3.5"
              >
                <span className="text-[11px] font-mono text-emerald-300/90">{item.step}</span>
                <h3 className="text-sm font-semibold text-white mt-1">{item.title}</h3>
                <p className="text-xs text-white/65 mt-1 leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Four Core Value Propositions */}
      <section className="border-y border-line bg-surface">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-mono uppercase tracking-widest text-pine font-semibold mb-2">
              Why SuiteMail
            </p>
            <h2 className="font-display text-3xl sm:text-5xl text-ink leading-tight">
              Built around four uncompromising principles
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
            {/* Pillar 1: Privacy-First AI (Local Desktop + Mobile) */}
            <article className="rounded-2xl border border-line bg-paper p-7 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div className="w-11 h-11 rounded-xl bg-pine-soft text-pine flex items-center justify-center">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-mono text-ink-subtle">01 / PRIVACY-FIRST AI</span>
                </div>

                <h3 className="font-display text-2xl sm:text-3xl text-ink">
                  Supercharged with privacy-first AI—local on desktop &amp; mobile
                </h3>
                <p className="mt-3 text-sm sm:text-base text-ink-muted leading-relaxed">
                  Run local language models directly on your desktop and Android phone so private
                  conversations never leave your hardware. Prefer a cloud model? Bring your own
                  API key for Claude, OpenAI, or Gemini with explicit per-action consent.
                </p>
              </div>

              <ul className="mt-6 pt-5 border-t border-line space-y-2.5 text-sm text-ink">
                <li className="flex items-start gap-2.5">
                  <Smartphone className="w-4 h-4 text-pine shrink-0 mt-0.5" />
                  <span>On-device local AI inference on both desktop (llama.cpp) and mobile</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-pine shrink-0 mt-0.5" />
                  <span>Local vector embeddings for private semantic search—works offline</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-pine shrink-0 mt-0.5" />
                  <span>Zero model training on your emails; all AI results cached locally</span>
                </li>
              </ul>
            </article>

            {/* Pillar 2: Smart Agents */}
            <article className="rounded-2xl border border-line bg-paper p-7 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div className="w-11 h-11 rounded-xl bg-amber-soft text-amber-accent flex items-center justify-center">
                    <Bot className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-mono text-ink-subtle">02 / SMART AGENTS</span>
                </div>

                <h3 className="font-display text-2xl sm:text-3xl text-ink">
                  Smart agents for filters, meetings, and quick replies
                </h3>
                <p className="mt-3 text-sm sm:text-base text-ink-muted leading-relaxed">
                  Go beyond passive summaries. SuiteMail’s built-in agents actively help you keep
                  your inbox effortless—writing filters, scheduling meetings, and drafting
                  context-aware replies you can approve in one click.
                </p>
              </div>

              <ul className="mt-6 pt-5 border-t border-line space-y-2.5 text-sm text-ink">
                <li className="flex items-start gap-2.5">
                  <Filter className="w-4 h-4 text-amber-accent shrink-0 mt-0.5" />
                  <span>
                    <strong>Filter agent:</strong> Create smart inbox rules and auto-labels from
                    plain English
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CalendarClock className="w-4 h-4 text-amber-accent shrink-0 mt-0.5" />
                  <span>
                    <strong>Meeting agent:</strong> Detect invites, suggest times, share
                    availability, and RSVP in one click
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <MessageSquareReply className="w-4 h-4 text-amber-accent shrink-0 mt-0.5" />
                  <span>
                    <strong>Reply agent:</strong> Instant smart reply suggestions and drafts
                    matched to your writing style
                  </span>
                </li>
              </ul>
            </article>

            {/* Pillar 3: Sync via Existing Mail Server */}
            <article className="rounded-2xl border border-line bg-paper p-7 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div className="w-11 h-11 rounded-xl bg-pine-soft text-pine flex items-center justify-center">
                    <RefreshCw className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-mono text-ink-subtle">03 / ZERO-CLOUD SYNC</span>
                </div>

                <h3 className="font-display text-2xl sm:text-3xl text-ink">
                  Sync mail metadata &amp; labels using your existing mail server
                </h3>
                <p className="mt-3 text-sm sm:text-base text-ink-muted leading-relaxed">
                  Other modern email clients store your labels, snoozes, and metadata on their own
                  proprietary cloud. SuiteMail synchronizes CRDT metadata and labels directly
                  through your existing mail server—<strong>no additional data in the cloud</strong>.
                </p>
              </div>

              <ul className="mt-6 pt-5 border-t border-line space-y-2.5 text-sm text-ink">
                <li className="flex items-start gap-2.5">
                  <Server className="w-4 h-4 text-pine shrink-0 mt-0.5" />
                  <span>No SuiteMail backend servers, no subscription lock-in, no sync account</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-pine shrink-0 mt-0.5" />
                  <span>Conflict-free CRDT sync keeps labels &amp; metadata consistent across devices</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-pine shrink-0 mt-0.5" />
                  <span>Full offline access backed by a fast local SQLite database</span>
                </li>
              </ul>
            </article>

            {/* Pillar 4: One Interface for All Mailboxes */}
            <article className="rounded-2xl border border-line bg-paper p-7 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div className="w-11 h-11 rounded-xl bg-pine-soft text-pine flex items-center justify-center">
                    <Layers className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-mono text-ink-subtle">04 / UNIFIED MAILBOXES</span>
                </div>

                <h3 className="font-display text-2xl sm:text-3xl text-ink">
                  One calm interface for all your mailboxes
                </h3>
                <p className="mt-3 text-sm sm:text-base text-ink-muted leading-relaxed">
                  Stop juggling browser tabs and separate apps for work, personal, and encrypted
                  mail. SuiteMail unifies Gmail, Outlook, Exchange, Proton Mail, and any IMAP
                  server behind one keyboard-first experience.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-line">
                <div className="flex flex-wrap gap-2">
                  {PROVIDERS.map((provider) => (
                    <span
                      key={provider}
                      className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface border border-line text-xs font-medium text-ink-muted"
                    >
                      {provider}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* Architecture Diagram: Zero-Cloud Data Path */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
        <div className="rounded-2xl border border-line bg-surface p-7 sm:p-10">
          <div className="max-w-2xl mb-8">
            <p className="text-xs font-mono uppercase tracking-widest text-pine font-semibold mb-2">
              Architecture
            </p>
            <h2 className="font-display text-3xl sm:text-4xl text-ink">
              Nothing stands between you and your mail server
            </h2>
            <p className="mt-2 text-sm sm:text-base text-ink-muted">
              SuiteMail talks directly to the mail servers you already trust. Your messages,
              labels, and AI processing stay strictly under your control.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
            <div className="rounded-xl bg-paper border border-line p-5">
              <div className="flex items-center gap-2 text-pine font-semibold text-sm mb-2">
                <Inbox className="w-4 h-4" />
                Your Desktop &amp; Mobile Devices
              </div>
              <p className="text-xs text-ink-muted leading-relaxed">
                Local SQLite + FTS5 search, AES-256-GCM encrypted credentials, on-device local AI
                models, and offline-first triage.
              </p>
            </div>

            <div className="rounded-xl bg-pine-soft/70 border border-pine/20 p-5 flex flex-col justify-center text-center">
              <span className="text-xs font-mono font-semibold text-pine-dark uppercase tracking-wider">
                Direct TLS Connection
              </span>
              <p className="text-xs text-pine-dark/80 mt-1.5 leading-relaxed">
                IMAP/SMTP, Gmail API, Microsoft Graph, EWS &amp; Proton Bridge—plus CRDT metadata
                &amp; label sync. <strong>Zero SuiteMail cloud servers.</strong>
              </p>
            </div>

            <div className="rounded-xl bg-paper border border-line p-5">
              <div className="flex items-center gap-2 text-ink font-semibold text-sm mb-2">
                <Server className="w-4 h-4 text-pine" />
                Your Existing Mail Server
              </div>
              <p className="text-xs text-ink-muted leading-relaxed">
                Your provider already stores your mail. SuiteMail reuses it to keep labels and
                metadata synchronized across all your devices.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Storyboard Teaser CTA */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-6">
        <div className="rounded-2xl bg-studio text-white p-8 sm:p-12 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-emerald-300 mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              20 NARRATED WORKFLOW STORYBOARDS
            </div>
            <h2 className="font-display text-3xl sm:text-4xl text-white">
              See every workflow in action
            </h2>
            <p className="mt-3 text-sm sm:text-base text-white/75 leading-relaxed">
              Explore narrated walkthroughs of reading, composing, snoozing, scheduling, calendar
              RSVPs, one-click unsubscribe, phishing protection, bulk triage, and more on the
              Features page.
            </p>
          </div>
          <a
            href={withBase('features/')}
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white text-ink font-semibold text-sm sm:text-base hover:bg-paper-alt transition-colors shrink-0"
          >
            Explore All 20 Storyboards
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>
    </SiteLayout>
  )
}
