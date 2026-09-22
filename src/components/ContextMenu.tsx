import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useIcon } from '../useIcon'

export interface MenuEntry {
  label: string
  hint?: string
  /** Hint is a keystroke (⌘click, a digit): draw it in the enlarged mono style. Words stay label-sized. */
  hintKey?: boolean
  danger?: boolean
  /** Rendered greyed out and skipped by digit shortcuts. */
  disabled?: boolean
  /** Draw a separator above this row, to group sources (candidates vs. common apps). */
  divider?: boolean
  iconPath?: string | null
  onSelect: () => void
}

function Glyph({ path }: { path: string }) {
  const url = useIcon(path)
  return (
    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center overflow-hidden rounded-[22%]">
      {url ? <img src={url} width={18} height={18} alt="" draggable={false} /> : <span className="h-3.5 w-3.5 rounded-[22%] bg-ink-500" />}
    </span>
  )
}

interface Props {
  x: number
  y: number
  title: string
  entries: MenuEntry[]
  /** Enables 1..9 keyboard picking and shows the digit gutter — used by the open-with chooser. */
  numbered?: boolean
  onClose: () => void
}

export function ContextMenu({ x, y, title, entries, numbered = false, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Never clamp past the top-left corner: a menu taller than the window would otherwise become unreachable.
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    })
  }, [x, y, entries.length])

  const pickable = entries.filter((e) => !e.disabled)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      const n = Number(e.key)
      if (!numbered || !Number.isInteger(n) || n < 1) return
      const entry = pickable[n - 1]
      if (entry) {
        e.preventDefault()
        // Close first: an entry may open another menu, and that update must win.
        onClose()
        entry.onSelect()
      }
    }
    // pointerdown, not mousedown: a tap outside has to dismiss it too.
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose, entries, numbered])

  return (
    <div className="fixed inset-0 z-50" aria-hidden>
      <div
        ref={ref}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        className="card-surface absolute max-h-[calc(100vh-16px)] w-64 overflow-y-auto rounded-xl bg-ink-800/95 p-1 shadow-2xl shadow-shadow/60"
      >
        <div className="truncate px-2.5 py-1.5 text-[11px] text-mute-400">{title}</div>
        {entries.map((entry, i) => {
          const digit = entry.disabled ? '' : String(pickable.indexOf(entry) + 1)
          const hint = entry.hint ?? (numbered && digit && Number(digit) <= 9 ? digit : '')
          const hintKey = entry.hintKey || (!entry.hint && numbered)
          return (
            <div key={`${entry.label}-${i}`}>
              {entry.divider && <div className="mx-2 my-1 h-px bg-ink-600" />}
              <button
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => {
                  if (entry.disabled) return
                  onClose()
                  entry.onSelect()
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition max-md:py-2.5
                  ${
                    entry.disabled
                      ? 'cursor-default text-mute-400/60'
                      : entry.danger
                        ? 'text-danger hover:bg-danger/15'
                        : 'text-paper hover:bg-ink-600'
                  }`}
              >
                {entry.iconPath && <Glyph path={entry.iconPath} />}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {hint && (
                  <span className={`shrink-0 text-[13px] font-medium text-mute-300 ${hintKey ? 'font-mono' : ''}`}>{hint}</span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
