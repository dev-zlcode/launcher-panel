import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { appNameOf } from '../paths'
import type { AppEntry } from '../types'
import { ItemIcon } from './ItemCard'

/** The scan the server caches for 30s; every app chooser in the panel starts from this. */
export function useInstalledApps(onError: (message: string) => void): AppEntry[] {
  const [apps, setApps] = useState<AppEntry[]>([])
  useEffect(() => {
    let alive = true
    api
      .apps()
      .then((r) => alive && setApps(r.apps))
      .catch((err) => onError(String((err as Error).message)))
    return () => {
      alive = false
    }
  }, [onError])
  return apps
}

/** The scan only covers `APP_DIRS`; paths already stored must stay visible and removable. */
export function withStoredPaths(apps: AppEntry[], paths: Iterable<string>): AppEntry[] {
  const known = new Set(apps.map((a) => a.value))
  // Only real paths, not the half-typed search term the value field also holds ("游戏" must not become a phantom app).
  const isPath = (p: string) => p.startsWith('/') || p.startsWith('~') || p.toLowerCase().endsWith('.app')
  const stored = [...new Set([...paths].filter((p) => p && !known.has(p) && isPath(p)))]
  return [
    ...apps,
    ...stored.map((p) => {
      const en = p.replace(/\.app$/i, '').split('/').pop() || p
      const zh = appNameOf(p)
      return { name: en, value: p, displayName: zh !== en ? zh : undefined }
    }),
  ]
}

export function filterApps(apps: AppEntry[], q: string, exclude: Iterable<string> = []): AppEntry[] {
  const skip = new Set(exclude)
  const needle = q.trim().toLowerCase()
  return apps
    .filter((a) => !skip.has(a.value))
    .filter(
      (a) =>
        !needle ||
        a.displayName?.toLowerCase().includes(needle) ||
        a.name.toLowerCase().includes(needle) ||
        a.value.toLowerCase().includes(needle),
    )
}

export function moveCursor(len: number, cursor: number, down: boolean): number {
  if (!len) return 0
  return (cursor + (down ? 1 : -1) + len) % len
}

interface Props {
  /** Every match, not a page: the list scrolls instead of asking you to type more. */
  apps: AppEntry[]
  onPick: (app: AppEntry) => void
  /** Row index highlighted by the caller's ↑↓ cursor — the search box lives outside this list. */
  cursor?: number
  picked?: (app: AppEntry) => boolean
  disabled?: (app: AppEntry) => boolean
  /** Pass null where the caller already shows its own hint line. */
  emptyText?: string | null
  className?: string
  iconSize?: number
}

export function AppList({ apps, onPick, cursor = -1, picked, disabled, emptyText = '没有匹配的应用', className, iconSize = 22 }: Props) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (cursor >= 0) box.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!apps.length) return <div className="px-2 py-1.5 text-[12px] text-mute-400">{emptyText}</div>
  return (
    <div ref={box} className={`overflow-y-auto ${className ?? 'max-h-56'}`}>
      {apps.map((a, i) => (
        <button
          key={a.value}
          data-row={i}
          type="button"
          disabled={disabled?.(a)}
          onMouseDown={(e) => {
            // mousedown, not click: a neighbouring input must not blur and collapse the list first.
            e.preventDefault()
            onPick(a)
          }}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition enabled:hover:bg-ink-700 disabled:opacity-40 ${
            i === cursor ? 'enabled:bg-select text-paper' : 'enabled:text-mute-300 hover:enabled:text-paper'
          }`}
          title={a.value}
        >
          <ItemIcon item={{ name: a.displayName ?? a.name, value: a.value, iconPath: a.value, kind: 'app' }} size={iconSize} />
          <span className="min-w-0 flex-1 truncate text-[12.5px]">
            {a.displayName ?? a.name}
            {a.displayName && <span className="text-mute-400"> · {a.name}</span>}
          </span>
          {picked?.(a) && <span className="chip shrink-0">已选</span>}
        </button>
      ))}
    </div>
  )
}
