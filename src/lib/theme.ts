import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'stacking:theme'

/** Background colors that the browser/OS chrome should match, per resolved theme. */
const CHROME_COLOR = { light: '#f6f5f3', dark: '#101214' } as const

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isThemeMode(raw) ? raw : 'system'
  } catch {
    // Private browsing and blocked site-data both throw here; fall back to the system preference.
    return 'system'
  }
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * `system` deliberately removes the attribute rather than writing a resolved value,
 * so the CSS falls back to `prefers-color-scheme` and keeps tracking the OS live.
 */
export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'system') delete root.dataset.theme
  else root.dataset.theme = mode

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', CHROME_COLOR[resolveTheme(mode)])
}

/**
 * Theme lives in localStorage rather than the app store: it is a per-device display
 * preference, not session data, so it must not ride along in the JSON backup — importing
 * a teammate's export should never flip your appearance.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStoredTheme)

  const setTheme = useCallback((next: ThemeMode) => {
    setMode(next)
    applyTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Preference just won't survive a reload; the current session still honors it.
    }
  }, [])

  // While on `system`, follow the OS if it flips (sunset, scheduled dark mode).
  useEffect(() => {
    if (mode !== 'system' || typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  return { mode, resolved: resolveTheme(mode), setTheme }
}
