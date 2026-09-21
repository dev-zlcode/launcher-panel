import { useEffect, useMemo, useRef, useState } from 'react'
import type { Item } from '../types'
import { scoreItem } from '../fuzzy'
import { ItemIcon, KIND_META } from './ItemCard'
import { Icon } from './Icon'

interface Props {
  items: Item[]
  onActivate: (item: Item) => void
  onReveal: (item: Item) => void
  onEdit: (item: Item) => void
  onClose: () => void
}

export function CommandPalette({ items, onActivate, onReveal, onEdit, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      return [...items]
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.useCount - a.useCount)
        .slice(0, 14)
    }
    return items
      .map((item) => ({ item, score: scoreItem(q, item) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score || b.item.useCount - a.item.useCount)
      .slice(0, 14)
      .map((r) => r.item)
  }, [items, query])

  useEffect(() => setCursor(0), [query])

  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const pick = (item: Item, reveal: boolean) => {
    onClose()
    if (reveal) onReveal(item)
    else onActivate(item)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ animation: 'pop-in 140ms ease-out' }}
        className="card-surface w-full max-w-xl overflow-hidden rounded-2xl bg-ink-900/95 shadow-2xl shadow-shadow/70"
      >
        <div className="flex items-center gap-2.5 border-b border-ink-700 px-4">
          <Icon name="search" size={16} className="text-mute-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const item = results[cursor]
                if (item) pick(item, e.metaKey || e.ctrlKey)
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
            placeholder="搜索应用、文件夹、文件、链接、命令…"
            className="flex-1 bg-transparent py-3.5 text-[14px] placeholder:text-mute-400/70 focus:outline-none"
          />
          <kbd className="chip font-mono text-[16px]">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="px-3 py-8 text-center text-[13px] text-mute-400">没有匹配项</div>
          )}
          {results.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(item, false)}
              className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition
                ${i === cursor ? 'bg-select' : 'hover:bg-ink-700'}`}
            >
              <ItemIcon item={item} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{item.name}</span>
                <span className="block truncate font-mono text-[10.5px] text-mute-400">{item.value}</span>
              </span>
              <span className="chip shrink-0" style={{ color: KIND_META[item.kind].color }}>
                {KIND_META[item.kind].label}
              </span>
              {i === cursor && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdit(item)
                    onClose()
                  }}
                  className="text-[11px] text-mute-400 underline decoration-dotted hover:text-paper"
                >
                  编辑
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-ink-700 px-4 py-2 text-[10.5px] text-mute-400">
          <span>↵ 打开</span>
          <span>⌘↵ 在 Finder 显示</span>
          <span>↑↓ 选择</span>
          <span className="ml-auto">{results.length} 条结果</span>
        </div>
      </div>
    </div>
  )
}
