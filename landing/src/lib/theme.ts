export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'suitemail-theme'

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme, persist = false): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#0e1113' : '#faf8f4')
  }
  if (persist) {
    window.localStorage.setItem(STORAGE_KEY, theme)
  }
}

export function hasStoredTheme(): boolean {
  if (typeof window === 'undefined') return false
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' || stored === 'light'
}
