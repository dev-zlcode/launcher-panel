import { useMemo, useRef, useState } from 'react'
import type { AppEntry } from '../types'
import { appNameOf, type ExistMap } from '../paths'
import { AppList, filterApps, moveCursor } from './AppList'
import { Icon } from './Icon'

const MAX_CANDIDATES = 12

interface Props {
  /** Ordered; the first entry is the default. */
  value: string[]
  onChange: (next: string[]) => void
  options: AppEntry[]
  /** Server-reported existence; keys the server never reported count as installed. */
  exist?: ExistMap
  max?: number
  placeholder?: string
  /** False for lists where the first entry is only "first row of a menu", not a one-click default. */
  firstIsDefault?: boolean
  /** Entries that are always on: shown with a 默认 badge instead of a delete button. */
  locked?: string[]
  /** 传了就给 chip 正文挂上点击（弹窗里「顺手用这个应用打开」）；不传保持纯管理控件。 */
  onPick?: (app: string) => void
}

function move(list: string[], from: number, to: number): string[] {
  if (from === to) return list
  const next = [...list]
  const [picked] = next.splice(from, 1)
  next.splice(to, 0, picked)
  return next
}

export function AppChips({
  value,
  onChange,
  options,
  exist,
  max = MAX_CANDIDATES,
  placeholder = '搜索并添加应用…',
  firstIsDefault = true,
  locked = [],
  onPick,
}: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const dragFrom = useRef<number | null>(null)

  const matches = useMemo(() => filterApps(options, q, value), [options, q, value])

  const add = (app: string) => {
    if (!app || value.includes(app)) return
    onChange([...value, app].slice(0, max))
    setQ('')
    setCursor(0)
  }

  /** Live reordering while a chip passes over its siblings, so the drop target is what you see. */
  const onDragEnter = (idx: number) => {
    const from = dragFrom.current
    if (from === null || from === idx) return
    onChange(move(value, from, idx))
    dragFrom.current = idx
  }

  const type = 'w-40 rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1 text-[12px] focus:border-accent focus:outline-none'

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {value.map((app, idx) => {
        const reported = exist?.[app]
        // The scan list only covers a few /Applications dirs, so trust a server-side stat first.
        const missing = reported === false || (reported === undefined && !options.some((o) => o.value === app))
        const isLocked = locked.includes(app)
        return (
          <span
            key={app}
            draggable
            onDragStart={(e) => {
              dragFrom.current = idx
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnter={() => onDragEnter(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={() => (dragFrom.current = null)}
            title={`${app}\n拖动可调整顺序${idx === 0 && firstIsDefault ? '，第一个即默认' : ''}${isLocked ? ' · 系统自带，不可删除' : ''}${onPick ? ` · 点一下用${appNameOf(app)}打开` : ''}`}
            onClick={onPick ? () => onPick(app) : undefined}
            className={`chip flex items-center gap-1 border border-ink-600 py-1 pl-2 pr-1 text-[12px] text-paper ${
              onPick ? 'cursor-pointer hover:border-accent/60' : 'cursor-grab active:cursor-grabbing'
            } ${isLocked ? 'bg-ink-700/70' : 'bg-ink-800/70'} ${missing ? 'opacity-70' : ''}`}
          >
            <span className="font-mono text-[10px] text-mute-400">{idx + 1}</span>
            {appNameOf(app)}
            {idx === 0 && firstIsDefault && <em className="text-[10px] not-italic text-info">默认</em>}
            {missing && <em className="text-[10px] not-italic text-mute-400">{reported === false ? '未安装' : '未找到'}</em>}
            {isLocked ? (
              <span className="px-1 text-[10px] text-mute-400" title="系统自带，始终保留">
                系统
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  // chip 正文现在可点（打开），移除必须挡住冒泡，否则一次点击又删又开。
                  e.stopPropagation()
                  onChange(value.filter((a) => a !== app))
                }}
                className="grid place-items-center rounded p-1 text-mute-400 transition hover:bg-ink-600 hover:text-paper"
                aria-label={`移除 ${appNameOf(app)}`}
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </span>
        )
      })}

      {value.length < max && (
        <input
          className={type}
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value)
            setCursor(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
              return
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setOpen(true)
              setCursor((c) => moveCursor(matches.length, c, e.key === 'ArrowDown'))
            } else if (e.key === 'Enter' && matches[cursor]) {
              e.preventDefault()
              add(matches[cursor].value)
            }
          }}
        />
      )}

      {/* Inline rather than an overlay: this control lives inside scrolling dialogs, where a
          positioned popup escapes its card and lands on whatever is below. */}
      {open && value.length < max && (
        <div className="basis-full rounded-xl border border-ink-600 bg-ink-800/60 p-1">
          <div className="px-2 py-1 text-[10.5px] text-mute-400">
            {matches.length ? `${matches.length} 个可选 · 回车添加第 ${cursor + 1} 项 · esc 收起` : '没有匹配的应用'}
          </div>
          <AppList apps={matches} cursor={cursor} onPick={(a) => add(a.value)} emptyText={null} />
        </div>
      )}
    </div>
  )
}
