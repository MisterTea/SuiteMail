import { useEffect, useState, type ReactNode } from 'react'
import { Download, Github, Menu, Moon, ShieldCheck, Sun, X } from 'lucide-react'
import { withBase } from '../lib/paths'
import { applyTheme, getInitialTheme, hasStoredTheme, type Theme } from '../lib/theme'

export type ActivePage = 'home' | 'features' | 'privacy' | 'terms'

interface SiteLayoutProps {
  activePage: ActivePage
  children: ReactNode
}

const NAV_ITEMS: { id: ActivePage; label: string; href: string }[] = [
  { id: 'home', label: 'Overview', href: '' },
  { id: 'features', label: 'Features & Storyboards', href: 'features/' },
  { id: 'privacy', label: 'Privacy Policy', href: 'privacy/' },
  { id: 'terms', label: 'Terms of Service', href: 'terms/' },
]

export function SiteLayout({ activePage, children }: SiteLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme())

  useEffect(() => {
    applyTheme(theme, false)
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      if (!hasStoredTheme()) {
        const next: Theme = e.matches ? 'dark' : 'light'
        setTheme(next)
        applyTheme(next, false)
      }
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next, true)
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <header className="sticky top-0 z-40 bg-paper/90 backdrop-blur-md border-b border-line">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <a
            href={withBase('')}
            className="flex items-center gap-2.5 group focus:outline-none"
          >
            <img
              src={withBase('icon.png')}
              alt="SuiteMail"
              className="w-8 h-8 rounded-lg shadow-xs ring-1 ring-ink/10"
            />
            <span className="text-lg font-bold tracking-tight text-ink group-hover:text-pine transition-colors">
              SuiteMail
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => {
              const isActive = item.id === activePage
              return (
                <a
                  key={item.id}
                  href={withBase(item.href)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-pine-soft text-pine-ink'
                      : 'text-ink-muted hover:text-ink hover:bg-paper-alt'
                  }`}
                >
                  {item.label}
                </a>
              )
            })}
          </nav>

          <div className="hidden md:flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-line text-ink-muted hover:text-ink hover:bg-paper-alt transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <a
              href="https://github.com/MisterTea/SuiteMail"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-ink-muted hover:text-ink hover:bg-paper-alt transition-colors"
            >
              <Github className="w-4 h-4" />
              GitHub
            </a>
            <a
              href="https://github.com/MisterTea/SuiteMail/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-pine text-white hover:bg-pine-dark transition-colors shadow-xs"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
          </div>

          <div className="md:hidden flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-line text-ink-muted hover:text-ink hover:bg-paper-alt transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-paper-alt transition-colors"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-line bg-paper px-5 py-4 space-y-1.5">
            {NAV_ITEMS.map((item) => {
              const isActive = item.id === activePage
              return (
                <a
                  key={item.id}
                  href={withBase(item.href)}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-3.5 py-2.5 rounded-lg text-sm font-medium ${
                    isActive
                      ? 'bg-pine-soft text-pine-ink'
                      : 'text-ink-muted hover:text-ink hover:bg-paper-alt'
                  }`}
                >
                  {item.label}
                </a>
              )
            })}
            <div className="pt-3 mt-2 border-t border-line flex flex-col gap-2">
              <a
                href="https://github.com/MisterTea/SuiteMail/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-pine text-white hover:bg-pine-dark transition-colors"
              >
                <Download className="w-4 h-4" />
                Download SuiteMail
              </a>
              <a
                href="https://github.com/MisterTea/SuiteMail"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-line text-ink hover:bg-paper-alt transition-colors"
              >
                <Github className="w-4 h-4" />
                View Source on GitHub
              </a>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-paper-alt/60 mt-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            <div className="md:col-span-5 space-y-4">
              <a href={withBase('')} className="inline-flex items-center gap-2.5">
                <img
                  src={withBase('icon.png')}
                  alt="SuiteMail"
                  className="w-8 h-8 rounded-lg ring-1 ring-ink/10"
                />
                <span className="text-lg font-bold tracking-tight text-ink">SuiteMail</span>
              </a>
              <p className="text-sm text-ink-muted leading-relaxed max-w-sm">
                Privacy-first email for desktop and mobile. Local AI, smart agents, direct
                mail-server metadata sync, and every mailbox in one calm workspace.
              </p>
              <div className="inline-flex items-center gap-2 text-xs font-mono text-pine-ink bg-pine-soft px-3 py-1.5 rounded-full">
                <ShieldCheck className="w-3.5 h-3.5" />
                Apache-2.0 Open Source · Zero Cloud Middlemen
              </div>
            </div>

            <div className="md:col-span-2 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Product
              </h3>
              <ul className="space-y-2 text-sm text-ink-muted">
                <li>
                  <a href={withBase('')} className="hover:text-pine transition-colors">
                    Overview
                  </a>
                </li>
                <li>
                  <a href={withBase('features/')} className="hover:text-pine transition-colors">
                    Features & Storyboards
                  </a>
                </li>
                <li>
                  <a
                    href={withBase('#account-setup')}
                    className="hover:text-pine transition-colors"
                  >
                    Account Setup Video
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/MisterTea/SuiteMail/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-pine transition-colors"
                  >
                    Downloads
                  </a>
                </li>
              </ul>
            </div>

            <div className="md:col-span-2 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Legal
              </h3>
              <ul className="space-y-2 text-sm text-ink-muted">
                <li>
                  <a href={withBase('privacy/')} className="hover:text-pine transition-colors">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href={withBase('terms/')} className="hover:text-pine transition-colors">
                    Terms of Service
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/MisterTea/SuiteMail/blob/main/LICENSE"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-pine transition-colors"
                  >
                    Apache-2.0 License
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/MisterTea/SuiteMail/blob/main/SECURITY.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-pine transition-colors"
                  >
                    Security Policy
                  </a>
                </li>
              </ul>
            </div>

            <div className="md:col-span-3 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Platforms & Code
              </h3>
              <ul className="space-y-2 text-sm text-ink-muted">
                <li>Windows (.exe / .msi)</li>
                <li>macOS (.dmg)</li>
                <li>Linux (.AppImage / .deb)</li>
                <li>Android (Local AI & Proton support)</li>
                <li>
                  <a
                    href="https://github.com/MisterTea/SuiteMail"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-pine transition-colors"
                  >
                    GitHub Repository ↗
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink-subtle">
            <p>© {new Date().getFullYear()} SuiteMail Contributors. Released under the Apache-2.0 License.</p>
            <p className="font-mono">Your mail stays on your device and your mail server.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
