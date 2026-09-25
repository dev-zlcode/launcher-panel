import { useEffect, useRef, useState } from 'react'
import type { AxisKind, Filter, Item, Kind, SmartKey } from '../types'
import { KIND_META } from './ItemCard'
import { Icon } from './Icon'

const AXIS_WORD: Record<AxisKind, string> = { group: '分组', tag: '标签' }

const SMART: Array<{ key: SmartKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '置顶' },
  { key: 'recent', label: '最近使用' },
  { key: 'frequent', label: '高频' },
]

const KIND_ORDER: Kind[] = ['app', 'folder', 'file', 'url', 'snippet', 'command']

interface Props {
  items: Item[]
  groups: string[]
  tags: string[]
  filter: Filter
  onPick: (f: Filter) => void
  onAdd: () => void
  /** 点名建一个空桶：分组写 `itemGroups`，标签写 `itemTags`，两边同一节律。 */
  onCreateAxis: (axis: AxisKind, name: string) => void
  /** 正在改名的那一行（分组或标签）；null = 没有行处于编辑态。由外层拿着，右键菜单才能决定改哪一行。 */
  renaming: { axis: AxisKind; name: string } | null
  /** 右键/长按分组或标签行：把菜单位置交给外层，菜单用的是卡片那份 `ContextMenu`。 */
  onAxisMenu: (axis: AxisKind, name: string, pos: { x: number; y: number }) => void
  /** Enter/blur 提交。`to` 与 `from` 相同＝取消，外层负责把这一行放回普通状态。 */
  onRenameAxis: (axis: AxisKind, from: string, to: string) => void
  onDiscover: () => void
  onSettings: () => void
}

function Row({
  label,
  count,
  active,
  accent,
  onClick,
  onContext,
}: {
  label: string
  count: number
  active: boolean
  accent?: string
  onClick: () => void
  onContext?: (pos: { x: number; y: number }) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={
        onContext
          ? (e) => {
              e.preventDefault()
              onContext({ x: e.clientX, y: e.clientY })
            }
          : undefined
      }
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

export function Sidebar({
  items,
  groups,
  tags,
  filter,
  onPick,
  onAdd,
  onCreateAxis,
  renaming,
  onAxisMenu,
  onRenameAxis,
  onDiscover,
  onSettings,
}: Props) {
  const [creating, setCreating] = useState<AxisKind | null>(null)
  const committed = useRef(false)
  /** Enter and blur race to the same commit; Esc must not leave one behind when the input unmounts. */
  const commitCreate = (axis: AxisKind, raw: string) => {
    if (committed.current) return
    committed.current = true
    setCreating(null)
    onCreateAxis(axis, raw)
  }
  // 改名那一行同理，只是它必须自己按 Enter/blur 计一次，不能借用新建的闸门。
  const renameCommitted = useRef(false)
  const commitRename = (axis: AxisKind, from: string, raw: string) => {
    if (renameCommitted.current) return
    renameCommitted.current = true
    onRenameAxis(axis, from, raw)
  }
  useEffect(() => {
    renameCommitted.current = false
    if (renaming) queueMicrotask(() => document.querySelector<HTMLInputElement>('[data-rename-row]')?.select())
  }, [renaming])
  /** 分组/标签同一套：行＝「名字 + 计数」，右键进改名，改名态下这一行就地变输入框。 */
  const axisRows = (axis: AxisKind, names: string[], count: (name: string) => number) =>
    names.map((name) =>
      renaming?.axis === axis && renaming.name === name ? (
        <input
          key={name}
          data-rename-row
          autoFocus
          defaultValue={name}
          aria-label={`重命名${AXIS_WORD[axis]} ${name}`}
          onBlur={(e) => commitRename(axis, name, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(axis, name, (e.target as HTMLInputElement).value)
            if (e.key === 'Escape') {
              renameCommitted.current = true
              onRenameAxis(axis, name, name)
            }
          }}
          className="mt-0.5 w-full rounded-lg border border-accent bg-ink-900/70 px-2.5 py-1.5 text-[12.5px] focus:outline-none"
        />
      ) : (
        <Row
          key={name}
          label={axis === 'tag' ? `# ${name}` : name}
          count={count(name)}
          active={isSame({ scope: axis, value: name })}
          onClick={() => onPick({ scope: axis, value: name })}
          onContext={(pos) => onAxisMenu(axis, name, pos)}
        />
      ),
    )
  /** 底部那一行：点一下原地出输入框，Enter 即写盘并切进这个桶（分组、标签同一条路）。 */
  const createRow = (axis: AxisKind) =>
    creating === axis ? (
      <input
        autoFocus
        placeholder={`${AXIS_WORD[axis]}名，Enter 确认`}
        onBlur={(e) => commitCreate(axis, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitCreate(axis, (e.target as HTMLInputElement).value)
          if (e.key === 'Escape') {
            committed.current = true
            setCreating(null)
          }
        }}
        className="mt-1 w-full rounded-lg border border-accent bg-ink-900/70 px-2.5 py-1.5 text-[12.5px] focus:outline-none"
      />
    ) : (
      <button
        type="button"
        onClick={() => {
          committed.current = false
          setCreating(axis)
        }}
        className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-mute-400 transition hover:bg-ink-700 hover:text-paper"
      >
        <Icon name="plus" size={14} />
        新建{AXIS_WORD[axis]}
      </button>
    )
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
          {axisRows('group', groups, (g) => items.filter((i) => i.group === g).length)}
          {createRow('group')}
        </Section>

        <Section title="标签">{axisRows('tag', tags, (t) => items.filter((i) => i.tags.includes(t)).length)}{createRow('tag')}</Section>
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
