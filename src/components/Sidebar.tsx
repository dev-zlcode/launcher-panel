import type { Filter, Item, Kind, SmartKey } from '../types'
import { KIND_META } from './ItemCard'
import { Icon } from './Icon'

const SMART: Array<{ key: SmartKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '置顶' },
  { key: 'recent', label: '最近使用' },
  { key: 'frequent', label: '高频' },
]

const KIND_ORDER: Kind[] = ['app', 'folder', 'file', 'url', 'snippet', 'command']

interface Props {
  items: Item[]
  filter: Filter
  onPick: (f: Filter) => void
  onAdd: () => void
  onDiscover: () => void
  onSettings: () => void
}

function Row({
  label,
  count,
  active,
  accent,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  accent?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] transition
        ${active ? 'bg-select text-paper' : 'text-mute-300 hover:bg-ink-700 hover:text-paper'}`}
    >
      {accent && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className={`font-mono text-[10px] ${active ? 'text-mute-300' : 'text-mute-400/70'}`}>{count}</span>
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-mute-400/70">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function Sidebar({ items, filter, onPick, onAdd, onDiscover, onSettings }: Props) {
  const recentIds = new Set(
    [...items]
      .filter((i) => i.lastUsedAt)
      .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
      .slice(0, 20)
      .map((i) => i.id),
  )
  const frequentIds = new Set(
    [...items]
      .filter((i) => i.useCount > 0)
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, 20)
      .map((i) => i.id),
  )

  const smartCount: Record<SmartKey, number> = {
    all: items.length,
    pinned: items.filter((i) => i.pinned).length,
    recent: recentIds.size,
    frequent: frequentIds.size,
  }

  const groups = [...new Set(items.map((i) => i.group))].sort((a, b) => a.localeCompare(b))
  const tags = [...new Set(items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b))

  const isSame = (f: Filter) => f.scope === filter.scope && f.value === filter.value

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-ink-700 bg-ink-900/60 px-2.5 py-3">
      <div className="flex items-center gap-2 px-1.5 pb-1">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-[13px] font-bold text-white">L</span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">Launcher</div>
          <div className="truncate font-mono text-[10px] text-mute-400">{items.length} items</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 px-0.5">
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-accent/90 px-2 py-1.5 text-[12px] font-medium text-white transition hover:bg-accent"
        >
          <Icon name="plus" size={14} strokeWidth={2.5} />
          新增
        </button>
        <button
          type="button"
          onClick={onDiscover}
          className="card-surface rounded-lg px-2 py-1.5 text-[12px] transition hover:border-accent/60 hover:bg-ink-700"
        >
          发现应用
        </button>
      </div>

      <nav className="mt-1 flex-1 overflow-y-auto pb-4">
        <Section title="智能">
          {SMART.map(({ key, label }) => (
            <Row
              key={key}
              label={label}
              count={smartCount[key]}
              active={isSame({ scope: 'smart', value: key })}
              onClick={() => onPick({ scope: 'smart', value: key })}
            />
          ))}
        </Section>

        <Section title="类型">
          {KIND_ORDER.map((kind) => {
            const count = items.filter((i) => i.kind === kind).length
            if (!count) return null
            return (
              <Row
                key={kind}
                label={KIND_META[kind].label}
                accent={KIND_META[kind].color}
                count={count}
                active={isSame({ scope: 'kind', value: kind })}
                onClick={() => onPick({ scope: 'kind', value: kind })}
              />
            )
          })}
        </Section>

        <Section title="分组">
          {groups.map((g) => (
            <Row
              key={g}
              label={g}
              count={items.filter((i) => i.group === g).length}
              active={isSame({ scope: 'group', value: g })}
              onClick={() => onPick({ scope: 'group', value: g })}
            />
          ))}
        </Section>

        {tags.length > 0 && (
          <Section title="标签">
            {tags.map((t) => (
              <Row
                key={t}
                label={`# ${t}`}
                count={items.filter((i) => i.tags.includes(t)).length}
                active={isSame({ scope: 'tag', value: t })}
                onClick={() => onPick({ scope: 'tag', value: t })}
              />
            ))}
          </Section>
        )}
      </nav>

      <a
        href="/manage.html"
        className="mb-0.5 mt-auto flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-mute-300 transition hover:bg-ink-700 hover:text-paper"
      >
        <Icon name="library" size={13} strokeWidth={1.9} />
        <span className="flex-1 truncate">应用管理</span>
      </a>

      <button
        type="button"
        onClick={onSettings}
        className="mb-0.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-mute-300 transition hover:bg-ink-700 hover:text-paper"
      >
        <Icon name="settings" size={13} strokeWidth={1.9} />
        <span className="flex-1 text-left">设置</span>
        <kbd className="font-mono text-[16px] text-mute-300">⌘,</kbd>
      </button>
    </aside>
  )
}
