import { useSyncExternalStore } from 'react'
import type { ThemePref } from './types'

/**
 * The theme lives here, not in React state: it has to be on `<html>` before the first paint, and both
 * entries and the settings dialog read the same value. The pref is config (items.json); the resolved
 *档位 is what the CSS keys on.
 */
const media = matchMedia('(prefers-color-scheme: dark)')
/**
 * Read, not painted: the served HTML resolves the pref before this bundle runs (see themeBootstrapScript
 * in server/api.mjs). Repainting `system` here would flip an explicit 浅色 back to dark for a frame.
 */
let pref: ThemePref = (document.documentElement.dataset.themePref as ThemePref) ?? 'system'
const listeners = new Set<() => void>()

function paint() {
  const next = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
  document.documentElement.dataset.theme = next
  for (const fn of listeners) fn()
}

// Only 跟随系统 can move without being told; the other two pins ignore the OS.
media.addEventListener('change', paint)

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function applyTheme(next: ThemePref) {
  pref = next
  paint()
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, () => pref)
}

/** What the user actually gets right now — 深色 under 跟随系统 is only known after resolution. */
export function useResolvedTheme(): 'dark' | 'light' {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme as 'dark' | 'light')
}
