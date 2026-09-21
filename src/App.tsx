import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { scoreItem } from './fuzzy'
import { applyTheme } from './theme'
import type { Filter, Item, OpenByKind, PanelGroup, PanelSort, PanelView, RunMark } from './types'
import { CommandPalette } from './components/CommandPalette'
import { ContextMenu, type MenuEntry } from './components/ContextMenu'
import { Discover } from './components/Discover'
import { AppPicker } from './components/AppPicker'
import { ItemCard, KIND_META } from './components/ItemCard'
import { Icon } from './components/Icon'
import { ViewControls, type Choice } from './components/ViewControls'
import { ItemEditor } from './components/ItemEditor'
import { RunResult } from './components/RunResult'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { NavDrawer } from './components/NavDrawer'
import { useNarrow } from './useNarrow'
import { Toasts, type Toast } from './components/Toasts'
import { appNameOf, candidateApps, openWithLabel, primeAppNames, resolveDefaultApp, terminalRows, type ExistMap } from './paths'

const EMPTY_OPEN: OpenByKind = { folder: [], file: [], url: [] }

const GROUPS: Array<Choice<PanelGroup>> = [
  { key: 'none', label: '无' },
  { key: 'group', label: '按分组' },
  { key: 'kind', label: '按类型' },
  { key: 'tag', label: '按标签' },
]

/** The 按标签 catch-all bucket; it always sorts last. */
const NO_TAG = '无标签'

/** 「默认顺序」 rather than 「手动」: the panel has no drag, so this order is just the array in items.json. */
const SORTS: Array<Choice<PanelSort>> = [
  { key: 'manual', label: '默认顺序' },
  { key: 'name', label: '名称' },
  { key: 'used', label: '使用次数' },
  { key: 'recent', label: '最近使用' },
]

type Pos = { x: number; y: number }

interface MenuState extends Pos {
  title: string
  entries: MenuEntry[]
  numbered?: boolean
}

export function App() {
  const [items, setItems] = useState<Item[]>([])
  const [openByKind, setOpenByKind] = useState<OpenByKind>(EMPTY_OPEN)
  const [terminalList, setTerminalList] = useState<string[]>([])
  const [defaultTerminals, setDefaultTerminals] = useState<string[]>([])
  const [discoverDirs, setDiscoverDirs] = useState<string[]>([])
  const [defaultDirs, setDefaultDirs] = useState<string[]>([])
  const [appsExist, setAppsExist] = useState<ExistMap>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>({ scope: 'smart', value: 'all' })
  const [view, setView] = useState<PanelView>({ group: 'group', sort: 'manual', layout: 'grid', collapsed: false })
  const prefsLoaded = useRef(false)
  const { group, sort, layout } = view
  /** 窄屏专用：侧栏改成抽屉，开合是临时视图状态，不落盘（落盘的 collapsed 只在宽屏有意义）。 */
  const narrow = useNarrow()
  const [drawer, setDrawer] = useState(false)

  const [palette, setPalette] = useState(false)
  const [settings, setSettings] = useState(false)
  const [editor, setEditor] = useState<{ open: boolean; editing: Item | null }>({ open: false, editing: null })
  const [discover, setDiscover] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [picker, setPicker] = useState<Item | null>(null)
  /** Last run per command item, and which item's output is on screen. Memory only — nothing here is config. */
  const [runs, setRuns] = useState<Record<string, RunMark>>({})
  const [resultFor, setResultFor] = useState<string | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const push = useCallback((message: string, tone: Toast['tone'] = 'info', action?: () => void) => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-3), { id, message, tone, action }])
    // An actionable toast has to live long enough to aim at.
    const life = tone === 'error' ? 5200 : action ? 6000 : 2600
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), life)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const s = await api.state()
      primeAppNames(s.appNames ?? {})
      setItems(s.items)
      setOpenByKind(s.settings.openByKind)
      setTerminalList(s.settings.terminals ?? [])
      setDefaultTerminals(s.settings.defaultTerminals ?? [])
      setDiscoverDirs(s.settings.discoverDirs ?? [])
      setDefaultDirs(s.settings.defaultDiscoverDirs ?? [])
      setAppsExist(s.appsExist ?? {})
      // Once only: refresh() also runs after every item edit, and a read that loses the race against a
      // PATCH of our own would snap the dropdowns — and the theme — back.
      if (!prefsLoaded.current) {
        prefsLoaded.current = true
        setView(s.settings.view.panel)
        applyTheme(s.settings.theme)
      }
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

  // Every entry point (sidebar button, ⌘,) shares one fresh read, so the dialog can't show stale config.
  useEffect(() => {
    if (settings) refresh()
  }, [settings, refresh])

  const modalOpen = useRef(false)
  modalOpen.current = palette || settings || editor.open || discover || picker !== null || resultFor !== null || drawer

  const groups = useMemo(() => [...new Set(items.map((i) => i.group))].sort((a, b) => a.localeCompare(b)), [items])

  const visible = useMemo(() => {
    let pool = items
    if (filter.scope === 'smart' && filter.value !== 'all') {
      if (filter.value === 'pinned') pool = items.filter((i) => i.pinned)
      else if (filter.value === 'recent')
        pool = [...items].filter((i) => i.lastUsedAt).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
      else pool = [...items].filter((i) => i.useCount > 0).sort((a, b) => b.useCount - a.useCount)
    } else if (filter.scope === 'kind') pool = items.filter((i) => i.kind === filter.value)
    else if (filter.scope === 'group') pool = items.filter((i) => i.group === filter.value)
    else if (filter.scope === 'tag') pool = items.filter((i) => i.tags.includes(filter.value))

    const q = query.trim()
    if (q) {
      pool = pool
        .map((item) => ({ item, score: scoreItem(q, item) }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.item)
    } else if (sort === 'name') pool = [...pool].sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'used') pool = [...pool].sort((a, b) => b.useCount - a.useCount)
    else if (sort === 'recent') pool = [...pool].sort((a, b) => String(b.lastUsedAt ?? '').localeCompare(String(a.lastUsedAt ?? '')))

    return pool
  }, [items, filter, query, sort])

  const sections = useMemo(() => {
    // 置顶/最近/常用 already carry their own order, and a sidebar group or kind filter has already done
    // the bucketing — grouping again would only repeat the heading.
    const smartSub = filter.scope === 'smart' && filter.value !== 'all'
    const redone =
      (filter.scope === 'group' && group === 'group') ||
      (filter.scope === 'kind' && group === 'kind') ||
      (filter.scope === 'tag' && group === 'tag')
    const flat = !!query.trim() || group === 'none' || smartSub || redone
    if (flat) return [{ title: '', items: visible }]
    // 按标签 is the one axis where hoisting 置顶 would be a lie: the item belongs to those buckets too,
    // and pulling it out silently drops it from every tag it carries.
    const hoistPinned = group !== 'tag'
    const pinned = hoistPinned ? visible.filter((i) => i.pinned) : []
    const rest = hoistPinned ? visible.filter((i) => !i.pinned) : visible
    const byTitle = new Map<string, Item[]>()
    for (const i of rest) {
      // Tags are multi-valued, so 按标签 is the one axis where an item legitimately lands in several buckets.
      const titles =
        group === 'kind' ? [KIND_META[i.kind].label] : group === 'tag' ? (i.tags.length ? i.tags : [NO_TAG]) : [i.group]
      for (const title of titles) {
        if (!byTitle.has(title)) byTitle.set(title, [])
        byTitle.get(title)!.push(i)
      }
    }
    // Groups read alphabetically; kinds keep the fixed KIND_META order (应用 → … → 命令); 无标签 always trails.
    const kindOrder = Object.values(KIND_META).map((m) => m.label)
    const cmp =
      group === 'kind'
        ? (a: [string, Item[]], b: [string, Item[]]) => kindOrder.indexOf(a[0]) - kindOrder.indexOf(b[0])
        : group === 'tag'
          ? (a: [string, Item[]], b: [string, Item[]]) =>
              Number(a[0] === NO_TAG) - Number(b[0] === NO_TAG) || a[0].localeCompare(b[0])
          : (a: [string, Item[]], b: [string, Item[]]) => a[0].localeCompare(b[0])
    const out: Array<{ title: string; items: Item[] }> = []
    if (pinned.length) out.push({ title: '置顶', items: pinned })
    // Bucketing keeps insertion order, so whatever 排序 did to the flat pool survives inside each group.
    for (const [title, list] of [...byTitle.entries()].sort(cmp)) out.push({ title, items: list })
    return out
  }, [visible, query, filter, group])

  const toastErr = useCallback((err: unknown) => push(String((err as Error).message), 'error'), [push])

  /**
   * Optimistic: the dropdown has to move now. A failed write only toasts — the next load reads the
   * server's truth back, and a hand-edited value falls back to the default rather than breaking the page.
   */
  const setAxis = useCallback(
    (next: Partial<PanelView>) => {
      const merged = { ...view, ...next }
      setView(merged)
      api.patchSettings({ view: { panel: merged } }).catch(toastErr)
    },
    [view, toastErr],
  )

  /** One control, two meanings: on a desktop it folds the column away (and remembers), on a phone it opens the drawer. */
  const toggleNav = useCallback(() => {
    if (narrow) setDrawer((d) => !d)
    else setAxis({ collapsed: !view.collapsed })
  }, [narrow, setAxis, view.collapsed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(input|textarea)$/i.test((e.target as HTMLElement | null)?.tagName ?? '')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      } else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettings(true)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleNav()
      } else if (modalOpen.current) {
        // bare-letter shortcuts belong to the card view only; a modal owns the keyboard otherwise
      } else if (!typing && e.key === '/') {
        e.preventDefault()
        document.getElementById('filter-input')?.focus()
      } else if (!typing && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        setEditor({ open: true, editing: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // setAxis changes identity with every view field, so the handler never merges from a stale one.
  }, [setAxis, toggleNav])

  const openWithApp = useCallback(
    async (item: Item, app: string | null) => {
      try {
        await api.open(item.kind, item.value, app)
        const r = await api.use(item.id)
        setItems((prev) => prev.map((i) => (i.id === item.id ? r.item : i)))
      } catch (err) {
        toastErr(err)
      }
    },
    [toastErr],
  )

  /**
   * No double-click wait and no app chooser: the command is the whole point. This starts the process
   * and returns — output streams into `data/runs/<id>.log`, and the toast is the door to watching it.
   */
  const runCommand = useCallback(
    async (item: Item) => {
      try {
        await api.run(item.id)
        setRuns((prev) => ({ ...prev, [item.id]: { running: true, code: null, at: Date.now() } }))
        push(`已启动「${item.name}」· 点这里看实时输出`, 'ok', () => setResultFor(item.id))
      } catch (err) {
        toastErr(err)
      }
    },
    [push, toastErr],
  )

  /**
   * The double-click chooser (and 「本次用其他应用打开」): the item's own candidates, then this kind's list,
   * with whatever a single click would have used marked 默认. Nothing writes config.
   */
  const openAppMenu = useCallback(
    (item: Item, pos?: Pos) => {
      const { app: current } = resolveDefaultApp(item, appsExist, openByKind)
      const entries: MenuEntry[] = candidateApps(item, openByKind).map((app) => {
        const gone = appsExist[app] === false
        return {
          label: gone ? `${appNameOf(app)}（未安装）` : `${appNameOf(app)}${app === current ? '（默认）' : ''}`,
          iconPath: app,
          disabled: gone,
          onSelect: () => (gone ? undefined : openWithApp(item, app)),
        }
      })
      entries.push({
        label: current === null ? '系统默认（默认）' : '系统默认',
        divider: entries.length > 0,
        onSelect: () => openWithApp(item, null),
      })
      setMenu({
        title: `用哪个应用打开「${item.name}」`,
        x: pos?.x ?? Math.round(window.innerWidth / 2),
        y: pos?.y ?? Math.round(window.innerHeight / 3),
        numbered: true,
        entries,
      })
    },
    [appsExist, openByKind, openWithApp],
  )

  /** Open the way a single click would: this kind's ordered pool, first live entry, otherwise macOS decides. */
  const openDefault = useCallback(
    (item: Item) => {
      const { app, dead } = resolveDefaultApp(item, appsExist, openByKind)
      if (dead.length) push(`${appNameOf(dead[0])} 未安装，改用${app ? appNameOf(app) : '系统默认'}`, 'info')
      openWithApp(item, app)
    },
    [appsExist, openByKind, openWithApp, push],
  )

  const tap = useRef<{ id: string; at: number; timer: number } | null>(null)

  /**
   * Single click waits 250ms on purpose: a second click on the same card should mean "let me pick",
   * and by then the first click must not have launched anything. Snippets and commands have nothing
   * to pick, so they act straight away.
   */
  const activate = useCallback(
    (item: Item, pos?: Pos) => {
      if (item.kind === 'snippet') {
        api
          .copy(item.value)
          .then(() => push(`已复制「${item.name}」`, 'ok'))
          .catch(toastErr)
        return
      }
      if (item.kind === 'command') {
        runCommand(item)
        return
      }
      const now = Date.now()
      const prev = tap.current
      if (prev && prev.id === item.id && now - prev.at < 400) {
        window.clearTimeout(prev.timer)
        tap.current = null
        openAppMenu(item, pos)
        return
      }
      const timer = window.setTimeout(() => {
        tap.current = null
        openDefault(item)
      }, 250)
      tap.current = { id: item.id, at: now, timer }
    },
    [openAppMenu, openDefault, push, runCommand, toastErr],
  )

  const reveal = useCallback(
    async (item: Item) => {
      try {
        if (!item.iconPath) return push('该项没有本地路径', 'info')
        await api.reveal(item.value)
      } catch (err) {
        toastErr(err)
      }
    },
    [push, toastErr],
  )

  const runTerminal = useCallback(
    async (item: Item, app: string) => {
      try {
        await api.terminal(item.value, app)
      } catch (err) {
        toastErr(err)
      }
    },
    [toastErr],
  )

  /** A command handed to a terminal app instead of captured: no output comes back, so no result view. */
  const launchInTerminal = useCallback(
    async (item: Item, app: string) => {
      try {
        await api.runInTerminal(item.id, app)
        push(`已在 ${appNameOf(app)} 里运行「${item.name}」`, 'ok')
        const u = await api.use(item.id)
        setItems((prev) => prev.map((i) => (i.id === item.id ? u.item : i)))
      } catch (err) {
        toastErr(err)
      }
    },
    [push, toastErr],
  )

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await api.copy(text)
        push(`已复制${label}`, 'ok')
      } catch (err) {
        toastErr(err)
      }
    },
    [push, toastErr],
  )

  const togglePin = useCallback(
    async (item: Item) => {
      try {
        const r = await api.update(item.id, { pinned: !item.pinned })
        setItems((prev) => prev.map((i) => (i.id === item.id ? r.item : i)))
      } catch (err) {
        toastErr(err)
      }
    },
    [toastErr],
  )

  const remove = useCallback(
    async (item: Item) => {
      if (!window.confirm(`从面板移除「${item.name}」？\n不会删除磁盘上的实际文件。`)) return
      try {
        await api.remove(item.id)
        setItems((prev) => prev.filter((i) => i.id !== item.id))
        push(`已移除「${item.name}」`, 'ok')
      } catch (err) {
        toastErr(err)
      }
    },
    [push, toastErr],
  )

  const terminals = useMemo(() => terminalRows(terminalList), [terminalList])

  /** Looked up every render: an item removed or edited mid-view retires the dialog on its own. */
  const resultItem = resultFor ? items.find((i) => i.id === resultFor) : undefined

  const menuFor = (item: Item): MenuEntry[] => {
    const entries: MenuEntry[] = []
    if (item.kind === 'snippet') entries.push({ label: '复制内容', onSelect: () => copy(item.value, '内容') })
    else if (item.kind === 'command') entries.push({ label: '运行', onSelect: () => runCommand(item) })
    else entries.push({ label: '打开', onSelect: () => openDefault(item) })
    if (item.iconPath) {
      entries.push({ label: '在 Finder 显示', hint: '⌘click', hintKey: true, onSelect: () => reveal(item) })
      entries.push({ label: '复制路径', onSelect: () => copy(item.value, '路径') })
    }
    // Launching a terminal at an .app bundle means nothing; only locations cd somewhere useful.
    if (item.kind === 'folder' || item.kind === 'file') {
      for (const t of terminals) entries.push({ label: t.open, onSelect: () => runTerminal(item, t.path) })
    }
    if (item.kind === 'url') entries.push({ label: '复制链接', onSelect: () => copy(item.value, '链接') })
    if (item.kind === 'command') {
      // The row above runs it in the background; these hand the window to a terminal, which is what
      // a resident command (`dsh web`) actually needs.
      for (const t of terminals) entries.push({ label: t.run, onSelect: () => launchInTerminal(item, t.path) })
      entries.push({ label: '复制命令', onSelect: () => copy(item.value, '命令') })
      // Only once it has run: a greyed-out row for a command you never started is just noise.
      if (runs[item.id]) entries.push({ label: '运行输出', onSelect: () => setResultFor(item.id) })
    }
    // A snippet has nothing to open with, and neither does a command. 「本次用其他应用打开」 was a
    // duplicate of the double-click menu, so the right-click keeps only the persistent 「打开方式…」.
    if (item.kind !== 'snippet' && item.kind !== 'command') {
      entries.push({
        label: '打开方式…',
        hint: openWithLabel(candidateApps(item, openByKind)) || undefined,
        onSelect: () => setPicker(item),
      })
    }
    entries.push({ label: item.pinned ? '取消置顶' : '置顶', onSelect: () => togglePin(item) })
    entries.push({ label: '编辑…', onSelect: () => setEditor({ open: true, editing: item }) })
    entries.push({ label: '移除', danger: true, onSelect: () => remove(item) })
    return entries
  }

  const openItemMenu = (item: Item, pos: Pos) => setMenu({ title: item.name, ...pos, entries: menuFor(item) })

  const scopeLabel =
    filter.scope === 'smart'
      ? { all: '全部条目', pinned: '置顶', recent: '最近使用', frequent: '高频' }[filter.value] ?? '全部条目'
      : filter.scope === 'kind'
        ? `类型：${KIND_META[filter.value as keyof typeof KIND_META]?.label ?? filter.value}`
        : filter.scope === 'group'
          ? `分组：${filter.value}`
          : `# ${filter.value}`

  const nav = (
    <Sidebar
      items={items}
      filter={filter}
      onPick={(f) => {
        setFilter(f)
        setDrawer(false)
      }}
      onAdd={() => {
        setEditor({ open: true, editing: null })
        setDrawer(false)
      }}
      onDiscover={() => {
        setDiscover(true)
        setDrawer(false)
      }}
      onSettings={() => {
        setSettings(true)
        setDrawer(false)
      }}
    />
  )

  return (
    <div className="flex h-full">
      {narrow ? drawer && <NavDrawer onClose={() => setDrawer(false)}>{nav}</NavDrawer> : !view.collapsed && nav}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-ink-700 bg-ink-900/40 px-5 py-3 max-md:gap-x-2 max-md:px-3 max-md:py-2">
          <button
            type="button"
            onClick={toggleNav}
            title={narrow ? '筛选' : `${view.collapsed ? '展开' : '收起'}侧栏 ⌘B`}
            aria-pressed={narrow ? drawer : view.collapsed}
            className="-ml-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-mute-400 transition hover:bg-ink-700 hover:text-paper"
          >
            <Icon name="sidebar" size={15} strokeWidth={1.8} />
          </button>
          <div className="relative max-w-md flex-1 max-md:order-2 max-md:max-w-none max-md:min-w-0">
            <input
              id="filter-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="过滤当前视图…"
              className="w-full rounded-lg border border-ink-600 bg-ink-900/70 py-1.5 pl-8 pr-3 text-[13px] placeholder:text-mute-400/60 focus:border-accent focus:outline-none max-md:h-9"
            />
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute-400"
            />
          </div>

          <button
            type="button"
            onClick={() => setPalette(true)}
            className="card-surface flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-mute-300 transition hover:border-accent/60 hover:text-paper max-md:order-3 max-md:h-9"
          >
            全局搜索
            <kbd className="font-mono text-[13px] text-mute-400 max-md:hidden">⌘K</kbd>
          </button>

          <ViewControls
            groups={GROUPS}
            group={group}
            onGroup={(v) => setAxis({ group: v })}
            sorts={SORTS}
            sort={sort}
            onSort={(v) => setAxis({ sort: v })}
            layout={layout}
            onLayout={(v) => setAxis({ layout: v })}
          />
        </header>

        <div className="flex items-baseline gap-2 px-5 pt-3 text-[11.5px] text-mute-400 max-md:px-3">
          <span className="text-[13px] font-medium text-paper">{scopeLabel}</span>
          <span>{visible.length} 项</span>
          <span className="ml-auto">{narrow ? '轻点启动 · 长按更多' : '单击用默认打开 · 双击选应用 · ⌘单击定位 · 右键更多 · N 新增'}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-2 max-md:px-3">
          {loadError && (
            <div className="mt-10 rounded-xl border border-danger/40 bg-danger/10 p-4 text-[13px] text-danger">
              无法连接本地服务：{loadError}
              <button type="button" onClick={refresh} className="ml-3 rounded-lg border border-danger/40 px-2 py-0.5 text-[12px] hover:bg-danger/20">
                重试
              </button>
            </div>
          )}

          {!loadError && loading && <div className="mt-10 text-[13px] text-mute-400">载入中…</div>}

          {!loadError && !loading && visible.length === 0 && (
            <div className="mt-16 text-center">
              <div className="text-[15px] text-mute-300">这个视图是空的</div>
              <div className="mt-1 text-[12.5px] text-mute-400">
                {query ? '换个关键词，或按 ' : ''}
                <button type="button" onClick={() => setDiscover(true)} className="text-accent-soft underline decoration-dotted">
                  发现应用
                </button>
                {' '}一键批量收录本机 App
              </div>
            </div>
          )}

          {!loading &&
            sections.map((section) => (
              <section key={section.title || '__flat'} className="mt-4 first:mt-2">
                {section.title && (
                  <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-mute-400">
                    {section.title}
                    <span className="font-mono text-[10px] normal-case tracking-normal">{section.items.length}</span>
                  </h3>
                )}
                <div
                  className={`grid gap-2 ${
                    layout === 'list' ? 'grid-cols-1 gap-1.5' : 'grid-cols-[repeat(auto-fill,minmax(268px,1fr))]'
                  }`}
                >
                  {section.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      layout={layout}
                      appsExist={appsExist}
                      openByKind={openByKind}
                      onActivate={activate}
                      onReveal={reveal}
                      onMenu={openItemMenu}
                    />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </main>

      {palette && (
        <CommandPalette items={items} onActivate={openDefault} onReveal={reveal} onEdit={(item) => setEditor({ open: true, editing: item })} onClose={() => setPalette(false)} />
      )}
      {editor.open && (
        <ItemEditor
          editing={editor.editing}
          groups={groups}
          appsExist={appsExist}
          openByKind={openByKind}
          onClose={() => setEditor({ open: false, editing: null })}
          onSaved={() => {
            refresh()
            push('已保存', 'ok')
          }}
          onError={toastErr}
        />
      )}
      {settings && (
        <Settings
          items={items}
          openByKind={openByKind}
          terminals={terminalList}
          defaultTerminals={defaultTerminals}
          discoverDirs={discoverDirs}
          defaultDirs={defaultDirs}
          appsExist={appsExist}
          onClose={() => setSettings(false)}
          onChanged={(message) => {
            push(message, 'ok')
            refresh()
          }}
          onError={toastErr}
        />
      )}
      {discover && (
        <Discover
          groups={groups}
          onClose={() => setDiscover(false)}
          onImported={(count) => {
            refresh()
            push(`已收录 ${count} 项`, 'ok')
          }}
          onError={toastErr}
        />
      )}
      {picker && (
        <AppPicker
          target={picker}
          openByKind={openByKind}
          appsExist={appsExist}
          onClose={() => setPicker(null)}
          onDone={(message) => {
            push(message, 'ok')
            refresh()
          }}
          onError={toastErr}
        />
      )}
      {resultItem && (
        <RunResult item={resultItem} onRerun={runCommand} onCopy={copy} onClose={() => setResultFor(null)} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} title={menu.title} entries={menu.entries} numbered={menu.numbered} onClose={() => setMenu(null)} />}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
