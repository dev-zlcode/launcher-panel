import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { scoreField } from './fuzzy'
import { primeAppNames } from './paths'
import { applyTheme } from './theme'
import type { LibGroup, LibSort, Library, LibraryGroup, ManageView } from './types'
import { ContextMenu, type MenuEntry } from './components/ContextMenu'
import { ItemIcon, type IconSubject } from './components/ItemCard'
import { Icon } from './components/Icon'
import { NavDrawer } from './components/NavDrawer'
import { Select } from './components/Select'
import { Toasts, type Toast } from './components/Toasts'
import { ViewControls, type Choice } from './components/ViewControls'
import { longPress } from './longPress'
import { useNarrow } from './useNarrow'

type Scope = { scope: 'all' } | { scope: 'group'; value: string }

const LIB_GROUPS: Array<Choice<LibGroup>> = [
  { key: 'none', label: '无' },
  /** The stored one: group order and each group's app order are the config, and this is the only place dragging means anything. */
  { key: 'group', label: '按分组' },
  { key: 'dir', label: '按所在目录' },
]

const LIB_SORTS: Array<Choice<LibSort>> = [
  { key: 'manual', label: '默认顺序' },
  { key: 'name', label: '名称' },
]

/** One rendered block of cards: a group (stored or derived), or a derived bucket (名称 / 目录). */
interface Section {
  key: string
  /** The catch-all bucket: droppable like any group, but its membership stays derived. */
  ungrouped: boolean
  /** Scan-derived default group: the note naming its rule — still not stored until the first write. */
  auto: string | null
  apps: string[]
}

type Drag =
  | { kind: 'group'; from: number }
  | { kind: 'card'; from: { section: string; index: number }; ids: string[] }
  | null

const asIcon = (name: string, appPath: string): IconSubject => ({ name, kind: 'app', value: appPath, iconPath: appPath })

/** App name from the scan, falling back to the bundle file name for an unsynced render. */
function baseName(appPath: string) {
  return appPath.replace(/\/$/, '').split('/').pop()?.replace(/\.app$/i, '') ?? appPath
}

export function AppManage() {
  const [lib, setLib] = useState<Library | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [scope, setScope] = useState<Scope>({ scope: 'all' })
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ManageView>({ group: 'group', sort: 'manual', layout: 'grid', collapsed: false })
  const { group, sort, layout } = view
  const [sel, setSel] = useState<Set<string>>(new Set())
  /** Collapsed section headers — session only, unlike the view axes which are config. */
  const [foldedSections, setFoldedSections] = useState<Set<string>>(new Set())
  const toggleFold = useCallback((key: string) => {
    setFoldedSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  /** Last checkbox click — Shift+click selects the span from here. */
  const anchor = useRef<string | null>(null)

  const [newGroup, setNewGroup] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ title: string; x: number; y: number; entries: MenuEntry[] } | null>(null)

  /** 窄屏专用：侧栏改成抽屉，开合是临时视图状态，不落盘（落盘的 collapsed 只在宽屏有意义）。 */
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const push = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-3), { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5200 : 2600)
  }, [])
  const toastErr = useCallback((err: unknown) => push(String((err as Error).message), 'error'), [push])

  /**
   * Optimistic: the dropdown has to move now. A failed write only toasts — the next load reads the
   * server's value back.
   */
  const setAxis = useCallback(
    (next: Partial<ManageView>) => {
      const merged = { ...view, ...next }
      setView(merged)
      api.patchSettings({ view: { manage: merged } }).catch(toastErr)
    },
    [view, toastErr],
  )

  /** One control, two meanings: on a desktop it folds the column away (and remembers), on a phone it opens the drawer. */
  const toggleNav = useCallback(() => {
    if (narrow) setDrawer((d) => !d)
    else setAxis({ collapsed: !view.collapsed })
  }, [narrow, setAxis, view.collapsed])

  // The panel owns the rest of its keyboard; this page only answers ⌘B, and only outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return
      if (/^(input|textarea)$/i.test((e.target as HTMLElement | null)?.tagName ?? '')) return
      e.preventDefault()
      toggleNav()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleNav])

  const refresh = useCallback(async () => {
    try {
      const data = await api.library()
      const zh: Record<string, string> = {}
      for (const a of data.all) {
        const en = a.value.replace(/\.app$/i, '').split('/').pop() || a.value
        if (a.displayName && a.displayName !== en) zh[a.value] = a.displayName
      }
      primeAppNames(zh)
      setLib(data)
      setLoadError(null)
    } catch (err) {
      setLoadError(String((err as Error).message))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The view axes and the theme live in items.json with every other setting. Read once: /api/library is the
  // page's own data source and it refreshes after every drag, which must not snap these dropdowns back.
  useEffect(() => {
    api
      .state()
      .then((s) => {
        setView(s.settings.view.manage)
        applyTheme(s.settings.theme)
      })
      .catch(toastErr)
  }, [toastErr])

  const UNG = lib?.ungroupedName ?? '未分组'
  const groups = useMemo(() => lib?.groups ?? [], [lib])
  /** Show the localized name when macOS has one; the English name stays searchable via `nameEnByPath`. */
  const nameByPath = useMemo(() => new Map((lib?.all ?? []).map((a) => [a.value, a.displayName ?? a.name])), [lib])
  const nameEnByPath = useMemo(() => new Map((lib?.all ?? []).map((a) => [a.value, a.name])), [lib])
  /** A group is an auto group while its *name* is reserved, whether or not it is still derived. */
  const autoNames = useMemo(() => new Set(lib?.autoGroupNames ?? []), [lib])
  /** What 「更新分组」 would add: rule hits missing from this group. Other groups' apps are already excluded server-side. */
  const pendingAdds = useCallback(
    (name: string) => {
      const own = new Set(groups.find((g) => g.name === name)?.apps ?? [])
      return (lib?.autoAdd[name] ?? []).filter((p) => !own.has(p))
    },
    [groups, lib],
  )
  const drag = useRef<Drag>(null)
  /** Drag fires one PATCH per crossing; a late response must not roll back a newer table. */
  const seq = useRef(0)

  /** A scope whose group is gone (rename, or another window's write) must not render as an empty void. */
  useEffect(() => {
    if (lib && scope.scope === 'group' && !lib.groups.some((g) => g.name === scope.value)) setScope({ scope: 'all' })
  }, [lib, scope])

  /** Whole-table write: show it at once, keep whatever the server echoes back. */
  const commit = useCallback(
    (next: LibraryGroup[]) => {
      setLib((prev) => (prev ? { ...prev, groups: next } : prev))
      const mine = ++seq.current
      api
        .patchLibrary(next)
        .then((r) => {
          if (mine === seq.current) setLib(r)
        })
        .catch((err) => {
          toastErr(err)
          if (mine === seq.current) refresh()
        })
    },
    [refresh, toastErr],
  )

  const sections = useMemo<Section[]>(() => {
    if (!lib) return []
    /** 默认顺序 = whatever order the buckets already hold; 名称 re-orders inside each of them. */
    const order = (list: string[]) => (sort === 'name' ? [...list].sort(byName) : list)
    if (group === 'group') {
      return lib.groups
        .filter((g) => scope.scope !== 'group' || g.name === scope.value)
        .map((g) => ({ key: g.name, ungrouped: !!g.ungrouped, auto: g.auto ?? null, apps: order(g.apps) }))
    }
    const pool = [
      ...new Set(
        scope.scope === 'group'
          ? (lib.groups.find((g) => g.name === scope.value)?.apps ?? [])
          : lib.groups.flatMap((g) => g.apps),
      ),
    ]
    if (group === 'dir') {
      const dirs = new Map<string, string[]>()
      for (const p of pool) {
        const dir = p.replace(/\/[^/]+$/, '') || '/'
        dirs.set(dir, [...(dirs.get(dir) ?? []), p])
      }
      return [...dirs.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dir, list]) => ({ key: dir, ungrouped: false, auto: null, apps: order(list) }))
    }
    // One untitled block: the header only renders when there is more than one section.
    return [{ key: '全部', ungrouped: false, auto: null, apps: order(pool) }]

    function byName(a: string, b: string) {
      return (nameByPath.get(a) ?? a).localeCompare(nameByPath.get(b) ?? b)
    }
  }, [lib, scope, group, sort, nameByPath])

  /** Manual order is only *the* order when the buckets are the stored groups; dragging into a derived bucket would be a lie. */
  const sortable = group === 'group' && sort === 'manual'

  /** Which stored group owns this app — the list view's column, and 未分组 when none does. */
  const groupOf = useCallback((appPath: string) => groups.find((g) => g.apps.includes(appPath))?.name ?? UNG, [groups, UNG])

  const visible = useMemo<Section[]>(() => {
    const q = query.trim()
    if (!q) return sections
    return sections.map((s) => ({
      ...s,
      apps: s.apps.filter(
        (p) =>
          Math.max(
            scoreField(q, nameByPath.get(p) ?? baseName(p)),
            scoreField(q, nameEnByPath.get(p) ?? ''),
            scoreField(q, p),
          ) >= 0,
      ),
    }))
  }, [sections, query, nameByPath, nameEnByPath])

  const flatIds = useMemo(() => visible.flatMap((s) => s.apps), [visible])

  /** Move `ids` into `target`, landing before `before` (null = end). Target 未分组 means unassign. */
  const move = useCallback(
    (ids: string[], target: string, before: string | null = null) => {
      if (!lib || !ids.length) return
      const idSet = new Set(ids)
      if (before !== null && idSet.has(before)) return
      const next = lib.groups.map((g) => ({ name: g.name, apps: g.apps.filter((p) => !idSet.has(p)) }))
      const gi = next.findIndex((g) => g.name === target)
      if (gi >= 0) {
        const apps = [...next[gi].apps]
        const at = before === null ? apps.length : apps.indexOf(before)
        apps.splice(at === -1 ? apps.length : at, 0, ...ids)
        next[gi] = { name: target, apps }
      }
      commit(next)
    },
    [lib, commit],
  )

  const clearSel = useCallback(() => {
    setSel(new Set())
    anchor.current = null
  }, [])

  const createGroup = useCallback(
    (raw: string) => {
      const name = raw.trim()
      setNewGroup(false)
      if (!name) return
      if (name === UNG) return push(`「${UNG}」是保留名`, 'info')
      if (name.length > 40) return push('分组名最长 40 字', 'info')
      if (groups.some((g) => g.name === name)) return push(`已有分组「${name}」`, 'info')
      const at = groups.findIndex((g) => g.ungrouped)
      commit(at === -1 ? [...groups, { name, apps: [] }] : [...groups.slice(0, at), { name, apps: [] }, ...groups.slice(at)])
      setScope({ scope: 'group', value: name })
    },
    [groups, UNG, commit, push],
  )

  const renameGroup = useCallback(
    (from: string, raw: string) => {
      const to = raw.trim()
      setRenaming(null)
      if (!to || to === from) return
      if (to === UNG || groups.some((g) => g.name === to)) return push(to === UNG ? `「${UNG}」是保留名` : `已有分组「${to}」`, 'info')
      commit(groups.map((g) => (g.name === from ? { ...g, name: to } : g)))
      setScope((s) => (s.scope === 'group' && s.value === from ? { scope: 'group', value: to } : s))
    },
    [groups, UNG, commit, push],
  )

  const deleteGroup = useCallback(
    (name: string) => {
      const affected = groups.find((g) => g.name === name)?.apps.length ?? 0
      const again = autoNames.has(name)
        ? '\n注意：组名一空出来，规则会立即重新接管并生成同名自动组，成员以扫描结果为准。'
        : ''
      if (!window.confirm(`删除分组「${name}」？\n其中 ${affected} 个 App 会回到「${UNG}」，App 本身不受影响。${again}`)) return
      commit(groups.filter((g) => g.name !== name))
      setScope({ scope: 'all' })
      push(`已删除分组「${name}」`, 'ok')
    },
    [groups, autoNames, UNG, commit, push],
  )

  const toggleSel = useCallback(
    (appPath: string, shift: boolean) => {
      setSel((prev) => {
        const next = new Set(prev)
        if (shift && anchor.current) {
          const a = flatIds.indexOf(anchor.current)
          const b = flatIds.indexOf(appPath)
          if (a >= 0 && b >= 0) {
            for (const p of flatIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(p)
            return next
          }
        }
        if (next.has(appPath)) next.delete(appPath)
        else next.add(appPath)
        anchor.current = appPath
        return next
      })
    },
    [flatIds],
  )

  const launch = useCallback(
    (appPath: string, name: string) => {
      api
        .open('app', appPath)
        .then(() => push(`已启动 ${name}`, 'ok'))
        .catch(toastErr)
    },
    [push, toastErr],
  )

  /**
   * Stop the rule from claiming this name again: keep the (now empty) stored row as the placeholder.
   * Deleting or renaming it frees the name and the rule takes over once more.
   */
  const clearAutoGroup = useCallback(
    (name: string) => {
      const affected = groups.find((g) => g.name === name)?.apps.length ?? 0
      if (
        !window.confirm(
          `取消自动归入「${name}」？\n组内 ${affected} 个 App 会回到「${UNG}」，App 本身不受影响。\n此后新装/新扫到符合条件的 App 也不再自动进这个组。空组留着是为了占住组名，改名或删除它会重新启用自动归组。`,
        )
      )
        return
      commit(groups.map((g) => (g.name === name ? { ...g, apps: [] } : g)))
      push(`已取消自动归入，${affected} 个 App 回到「${UNG}」`, 'ok')
    },
    [groups, UNG, commit, push],
  )

  /** Additive on purpose: existing members and their order stay, and nobody is taken from another group. */
  const refreshAutoGroup = useCallback(
    (name: string) => {
      const adds = pendingAdds(name)
      if (!adds.length) return
      const listed = adds.map((p) => nameByPath.get(p) ?? p).join('、')
      const more = adds.length > 6 ? `\n（其余 ${adds.length - 6} 个见更新后的分组）` : ''
      if (!window.confirm(`更新分组「${name}」？\n按当前规则补入 ${adds.length} 个：${listed.split('、').slice(0, 6).join('、')}${more}\n现有成员和组内顺序不动，也不会从别的组挪人。`)) return
      const idSet = new Set(adds)
      // The catch-all still lists these apps until the server re-derives it, and a whole-table write
      // holding one path in two rows is exactly what the server rejects.
      commit(groups.map((g) => (g.name === name ? { ...g, apps: [...g.apps, ...adds] } : { name: g.name, apps: g.apps.filter((p) => !idSet.has(p)) })))
      push(`已按规则补入 ${adds.length} 个 App`, 'ok')
    },
    [groups, pendingAdds, nameByPath, commit, push],
  )

  const groupMenu = (name: string, auto: boolean, ungrouped: boolean): MenuEntry[] => {
    if (ungrouped)
      return [
        { label: `「${UNG}」是兜底分组：自动认领没分组的 App`, disabled: true, onSelect: () => {} },
        { label: '不能重命名或删除，可以拖动排序、拖入卡片', disabled: true, onSelect: () => {} },
      ]
    if (!autoNames.has(name))
      return [
        { label: '重命名…', onSelect: () => setRenaming(name) },
        { label: '删除…', danger: true, onSelect: () => deleteGroup(name) },
      ]
    const own = groups.find((g) => g.name === name)
    if (own && !own.apps.length)
      return [
        { label: '重命名…', onSelect: () => setRenaming(name) },
        { label: '删除空组…（重新启用自动归组）', danger: true, onSelect: () => deleteGroup(name) },
      ]
    const adds = pendingAdds(name)
    return [
      { label: '重命名…', onSelect: () => setRenaming(name) },
      { label: '取消自动归入…', danger: true, onSelect: () => clearAutoGroup(name) },
      auto
        ? { label: '更新分组…', hint: '已按规则', hintKey: false, disabled: true, onSelect: () => {} }
        : {
            label: adds.length ? `更新分组…（补入 ${adds.length} 个）` : '更新分组…',
            disabled: !adds.length,
            onSelect: () => refreshAutoGroup(name),
          },
    ]
  }

  const cardMenu = (appPath: string, name: string): MenuEntry[] => {
    const current = groups.find((g) => g.apps.includes(appPath))
    // Right-clicking a selected card acts on the whole selection, same as dragging it.
    const onSel = sel.has(appPath)
    const ids = onSel ? [...sel] : [appPath]
    const many = ids.length > 1 ? ` ${ids.length} 个` : ''
    const done = () => onSel && clearSel()
    const rows: MenuEntry[] = groups.map((g) => ({
      label: g.name,
      hint: current?.name === g.name ? '当前' : undefined,
      disabled: current?.name === g.name,
      onSelect: () => {
        move(ids, g.name)
        done()
      },
    }))
    return [
      { label: `打开${many}`, onSelect: () => launch(appPath, name) },
      { label: '在访达中显示', onSelect: () => api.reveal(appPath).catch(toastErr) },
      { label: `移到分组${many}`, disabled: true, divider: true, onSelect: () => {} },
      ...rows,
    ]
  }

  const scopeName = scope.scope === 'all' ? '全部' : scope.value

  /** A tap on a phone and a right-click on a desktop land in the same menu. */
  const openMenu = (title: string, at: { x: number; y: number }, entries: MenuEntry[]) =>
    setMenu({ title, x: at.x, y: at.y, entries })

  /** Choosing in the drawer has to dismiss it, or the list underneath stays unreachable. */
  const pickScope = (next: Scope) => {
    setScope(next)
    setDrawer(false)
  }

  /** 勾选框和菜单提示原本都挂在 hover/右键上，触摸两头都够不着。 */
  const menuWord = narrow ? '长按' : '右键'
  const boxHover = narrow ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'

  const nav = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900/60 px-2.5 py-3">
      <a href="/" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-mute-300 transition hover:bg-ink-700 hover:text-paper">
        <Icon name="back" size={15} strokeWidth={1.8} /> 返回面板
      </a>
      <div className="mt-1 px-1.5 pb-1 text-[13px] font-semibold">应用管理</div>

      <nav className="mt-1 flex-1 overflow-y-auto pb-4">
        <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-mute-400/70">分组</div>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => pickScope({ scope: 'all' })}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] transition
              ${scope.scope === 'all' ? 'bg-select text-paper' : 'text-mute-300 hover:bg-ink-700 hover:text-paper'}`}
          >
            <span className="min-w-0 flex-1 truncate text-left">全部</span>
            <span className="font-mono text-[10px] text-mute-400/70">{lib?.all.length ?? 0}</span>
          </button>

          {groups.map((g, idx) => {
            const active = scope.scope === 'group' && scope.value === g.name
            return (
              <div
                key={g.name}
                role="button"
                tabIndex={0}
                draggable={renaming !== g.name}
                onDragStart={(e) => {
                  drag.current = { kind: 'group', from: idx }
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnter={() => {
                  const d = drag.current
                  if (!d || d.kind !== 'group' || d.from === idx) return
                  const next = [...groups]
                  const [picked] = next.splice(d.from, 1)
                  next.splice(idx, 0, picked)
                  d.from = idx
                  commit(next)
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const d = drag.current
                  drag.current = null
                  if (d?.kind === 'card') move(d.ids, g.name)
                }}
                onDragEnd={() => (drag.current = null)}
                {...longPress((at) => openMenu(`分组「${g.name}」`, at, groupMenu(g.name, !!g.auto, !!g.ungrouped)))}
                onClick={() => pickScope({ scope: 'group', value: g.name })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pickScope({ scope: 'group', value: g.name })
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu(`分组「${g.name}」`, { x: e.clientX, y: e.clientY }, groupMenu(g.name, !!g.auto, !!g.ungrouped))
                }}
                title={g.ungrouped ? '兜底分组：没被任何组认领的 App 自动落在这里。可以拖动排序、拖入卡片，但不能改名或删除。' : undefined}
                className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition
                  ${active ? 'bg-select text-paper' : g.ungrouped ? 'text-mute-400 hover:bg-ink-700 hover:text-paper' : 'text-mute-300 hover:bg-ink-700 hover:text-paper'}`}
              >
                {renaming === g.name ? (
                  <input
                    autoFocus
                    defaultValue={g.name}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      // The row underneath also handles Enter/Space — without this it re-selects the old name mid-edit.
                      e.stopPropagation()
                      if (e.key === 'Enter') renameGroup(g.name, (e.target as HTMLInputElement).value)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={(e) => renameGroup(g.name, e.target.value)}
                    className="min-w-0 flex-1 rounded border border-accent bg-ink-900/70 px-1.5 py-0.5 text-[12.5px] focus:outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{g.name}</span>
                )}
                {autoNames.has(g.name) && (
                  <span
                    className="shrink-0 rounded bg-ink-600 px-1 font-mono text-[9px] text-mute-400"
                    title={
                      g.auto
                        ? `${g.auto}；任意一次改动即固化`
                        : g.apps.length
                          ? '名字仍归自动规则；右键「更新分组」按当前规则补入成员'
                          : '已停用自动归组：这个空组占着组名，改名或删除它会重新启用'
                    }
                  >
                    {g.auto ? '自动' : g.apps.length ? '自动·已固化' : '已停用'}
                  </span>
                )}
                <span className="font-mono text-[10px] text-mute-400/70">{g.apps.length}</span>
              </div>
            )
          })}
        </div>

        {newGroup ? (
          <input
            autoFocus
            placeholder="分组名，Enter 确认"
            onBlur={(e) => createGroup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createGroup((e.target as HTMLInputElement).value)
              if (e.key === 'Escape') setNewGroup(false)
            }}
            className="mt-2 w-full rounded-lg border border-accent bg-ink-900/70 px-2.5 py-1.5 text-[12.5px] focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNewGroup(true)}
            className="mt-2 flex w-full items-center gap-2 rounded-lg border-t border-ink-700 px-2.5 py-1.5 pt-2 text-[12.5px] text-mute-400 transition hover:bg-ink-700 hover:text-paper"
          >
            <Icon name="plus" size={14} />
            新建分组
          </button>
        )}
      </nav>

      <div className="border-t border-ink-700 pt-2 text-[11px] leading-5 text-mute-400">
        {narrow ? '轻点启动 · 长按更多' : '单击启动 · 拖动排序/换组 · 右键更多'}
        <br />
        扫描目录在面板「设置」里改，本页不影响面板条目。
      </div>
    </aside>
  )

  return (
    <div className="flex h-full">
      {narrow
        ? drawer && (
            <NavDrawer label="分组" onClose={() => setDrawer(false)}>
              {nav}
            </NavDrawer>
          )
        : !view.collapsed && nav}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-ink-700 bg-ink-900/40 px-5 py-3 max-md:gap-x-2 max-md:px-3 max-md:py-2">
          <button
            type="button"
            onClick={toggleNav}
            title={narrow ? '分组' : `${view.collapsed ? '展开' : '收起'}侧栏 ⌘B`}
            aria-pressed={narrow ? drawer : view.collapsed}
            className="-ml-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-mute-400 transition hover:bg-ink-700 hover:text-paper"
          >
            <Icon name="sidebar" size={15} strokeWidth={1.8} />
          </button>
          <span className="min-w-0 truncate text-[13px] font-medium text-paper max-md:order-2">{scopeName}</span>
          <span className="shrink-0 text-[11.5px] text-mute-400 max-md:order-3">{flatIds.length} 个 App</span>
          {!sortable && (
            <span className="text-[11.5px] text-mute-400/70 max-md:hidden">
              派生顺序，切回「分组 + 默认顺序」才能拖拽
            </span>
          )}
          <div className="relative ml-4 w-full max-w-md flex-1 max-md:order-4 max-md:ml-0 max-md:max-w-none max-md:min-w-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="在当前视图内过滤…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/70 py-1.5 pl-8 pr-3 text-[13px] placeholder:text-mute-400/60 focus:border-accent focus:outline-none max-md:h-9"
            />
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute-400"
            />
          </div>
          <ViewControls
            groups={LIB_GROUPS}
            group={group}
            onGroup={(v) => setAxis({ group: v })}
            sorts={LIB_SORTS}
            sort={sort}
            onSort={(v) => setAxis({ sort: v })}
            sortTitle={
              sortable
                ? '「分组 + 默认顺序」下可拖拽卡片排序、换组'
                : '顺序由系统算出，切回「分组 + 默认顺序」才能拖拽'
            }
            layout={layout}
            onLayout={(v) => setAxis({ layout: v })}
          />
        </header>

        {sel.size > 0 && (
          <div className="flex items-center gap-2 border-b border-ink-700 bg-accent/10 px-5 py-2 text-[12px] max-md:px-3">
            <span className="text-accent-soft">已选 {sel.size} 个</span>
            <span className="text-mute-400">移动到</span>
            <Select
              value=""
              onChange={(e) => {
                if (!e.target.value) return
                move([...sel], e.target.value)
                clearSel()
              }}
              className="py-1 text-paper"
            >
              <option value="" disabled>
                选择分组…
              </option>
              {groups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </Select>
            <button type="button" onClick={clearSel} className="ml-auto text-mute-400 hover:text-paper">
              清空选择
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
          {loadError && (
            <div className="mt-10 rounded-xl border border-danger/40 bg-danger/10 p-4 text-[13px] text-danger">
              无法连接本地服务：{loadError}
              <button type="button" onClick={refresh} className="ml-3 rounded-lg border border-danger/40 px-2 py-0.5 text-[12px] hover:bg-danger/20">
                重试
              </button>
            </div>
          )}

          {loading && !loadError && <div className="mt-10 text-[13px] text-mute-400">扫描应用目录中…</div>}

          {!loading && !loadError && flatIds.length === 0 && (
            <div className="mt-16 text-center">
              <div className="text-[15px] text-mute-300">{query ? '没有匹配项' : '这里还是空的'}</div>
              {!query && (
                <div className="mt-1 text-[12.5px] text-mute-400">
                  {scope.scope === 'all'
                    ? '没有扫到任何 App，到面板「设置」里确认扫描目录'
                    : '到「全部」视图把卡片拖进来，或勾选卡片后批量移动'}
                </div>
              )}
            </div>
          )}

          {visible.map((s) => {
            const folded = foldedSections.has(s.key)
            return (
            <section
              key={s.key}
              className="mb-5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const d = drag.current
                if (!sortable || d?.kind !== 'card') return
                drag.current = null
                move(d.ids, s.key)
              }}
            >
              {visible.length > 1 && (
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleFold(s.key)}
                    aria-expanded={!folded}
                    title={folded ? '展开' : '折叠'}
                    className="grid h-4 w-4 shrink-0 place-items-center text-mute-400 transition hover:text-paper"
                  >
                    <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={14} strokeWidth={2.2} />
                  </button>
                  <span className={`text-[12.5px] font-medium text-mute-300 ${layout === 'list' ? 'font-mono text-[11px]' : ''}`}>{s.key}</span>
                  <span className="font-mono text-[10px] text-mute-400/70">{s.apps.length}</span>
                  {s.auto ? (
                    <span className="text-[11px] text-mute-400/70">{s.auto}</span>
                  ) : (
                    group === 'group' &&
                    autoNames.has(s.key) && (
                      <span className="text-[11px] text-mute-400/70">
                        {s.apps.length ? `自动分组·已固化，${menuWord}「更新分组」可按规则补入` : `已停用自动归组，${menuWord}改名或删除本组可重新启用`}
                      </span>
                    )
                  )}
                </div>
              )}
              {!folded && (
              <div className={layout === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3' : 'flex flex-col'}>
                {s.apps.map((appPath, idx) => {
                  const name = nameByPath.get(appPath) ?? baseName(appPath)
                  const on = sel.has(appPath)
                  const handlers = {
                    role: 'button' as const,
                    tabIndex: 0,
                    draggable: sortable,
                    onDragStart: (e: React.DragEvent) => {
                      drag.current = { kind: 'card', from: { section: s.key, index: idx }, ids: on ? [...sel] : [appPath] }
                      e.dataTransfer.effectAllowed = 'move'
                    },
                    onDragEnter: () => {
                      const d = drag.current
                      if (!sortable || !d || d.kind !== 'card') return
                      if (d.from.section === s.key && d.from.index === idx) return
                      d.from = { section: s.key, index: idx }
                      move(d.ids, s.key, s.apps[idx])
                    },
                    onDragOver: (e: React.DragEvent) => e.preventDefault(),
                    onDrop: (e: React.DragEvent) => {
                      e.preventDefault()
                      drag.current = null
                    },
                    onDragEnd: () => (drag.current = null),
                    ...longPress((at) => openMenu(name, at, cardMenu(appPath, name))),
                    onClick: () => launch(appPath, name),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        launch(appPath, name)
                      }
                    },
                    onContextMenu: (e: React.MouseEvent) => {
                      e.preventDefault()
                      setMenu({ title: name, x: e.clientX, y: e.clientY, entries: cardMenu(appPath, name) })
                    },
                  }
                  const toggleBox = (e: React.MouseEvent) => {
                    e.stopPropagation()
                    toggleSel(appPath, e.shiftKey)
                  }
                  const check = (on: boolean, cls: string) => (
                    <span
                      role="checkbox"
                      aria-checked={on}
                      onClick={toggleBox}
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
                        on ? 'border-accent bg-accent text-white opacity-100' : `border-ink-500 ${cls}`
                      }`}
                    >
                      {on && <Icon name="check" size={12} strokeWidth={3} />}
                    </span>
                  )

                  if (layout === 'list') {
                    return (
                      <div
                        key={appPath}
                        {...handlers}
                        className={`group flex cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-2 py-1 transition hover:bg-ink-700 ${
                          on ? 'border-accent bg-accent/10' : ''
                        }`}
                        title={`${appPath}\n${groupOf(appPath)} · 单击启动`}
                      >
                        {check(on, boxHover)}
                        <ItemIcon item={asIcon(name, appPath)} size={28} />
                        <span className="w-44 shrink-0 truncate text-[12.5px] font-medium text-paper">{name}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-mute-400">{appPath}</span>
                        <span className="chip shrink-0">{groupOf(appPath)}</span>
                      </div>
                    )
                  }
                  return (
                    <div
                      key={appPath}
                      {...handlers}
                      className={`card-surface group relative flex cursor-grab flex-col items-center gap-1.5 rounded-(--radius-card) px-3 pb-2.5 pt-3.5 text-center transition
                        hover:-translate-y-px hover:border-accent/60 active:cursor-grabbing ${on ? 'border-accent bg-accent/10' : ''}`}
                      title={`${appPath}\n${groupOf(appPath)} · 单击启动`}
                    >
                      <span className="absolute left-1.5 top-1.5">{check(on, `bg-ink-900/80 ${boxHover}`)}</span>
                      <ItemIcon item={asIcon(name, appPath)} size={48} />
                      <span className="w-full truncate text-[12px] font-medium text-paper">{name}</span>
                    </div>
                  )
                })}
              </div>
              )}
            </section>
            )
          })}

          {!!lib?.stale && (
            <div className="mt-2 border-t border-ink-700 pt-3 text-[11.5px] text-mute-400">
              另有 {lib.stale} 个已分组路径当前没扫到（App 已卸载或其目录被移出扫描清单），放回目录后分组仍然在。
            </div>
          )}
        </div>
      </main>

      {menu && <ContextMenu x={menu.x} y={menu.y} title={menu.title} entries={menu.entries} onClose={() => setMenu(null)} />}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
