import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { Item, OpenByKind, OpenKind, ThemePref } from '../types'
import { applyTheme, useResolvedTheme, useThemePref } from '../theme'
import { appNameOf, type ExistMap } from '../paths'
import { AppChips } from './AppChips'
import { useInstalledApps, withStoredPaths } from './AppList'
import { Icon } from './Icon'
import { Select } from './Select'

const OPEN_ROWS: Array<{ kind: OpenKind; label: string; hint: string }> = [
  { kind: 'folder', label: '文件夹', hint: '在终端打开、在编辑器里打开之类' },
  { kind: 'file', label: '文件', hint: '新建文件条目时按这份列表带上候选' },
  { kind: 'url', label: '链接', hint: '想在默认浏览器之外换一个浏览器时加进来' },
]

const THEME_ROWS: Array<{ key: ThemePref; label: string }> = [
  { key: 'system', label: '跟随系统' },
  { key: 'dark', label: '深色' },
  { key: 'light', label: '浅色' },
]

interface Props {
  items: Item[]
  openByKind: OpenByKind
  terminals: string[]
  /** Server-side defaults; always kept, shown without a delete button. */
  defaultTerminals: string[]
  discoverDirs: string[]
  /** Server-side defaults; they're always scanned and can't be removed here. */
  defaultDirs: string[]
  appsExist: ExistMap
  onClose: () => void
  onChanged: (message: string) => void
  onError: (message: string) => void
}

function Card({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="card-surface rounded-xl bg-ink-900/70 p-4">
      <h3 className="text-[13.5px] font-semibold">{title}</h3>
      <p className="mt-0.5 mb-3 text-[11.5px] leading-relaxed text-mute-400">{desc}</p>
      {children}
    </section>
  )
}

export function Settings({ items, openByKind, terminals, defaultTerminals, discoverDirs, defaultDirs, appsExist, onClose, onChanged, onError }: Props) {
  const apps = useInstalledApps(onError)
  const [local, setLocal] = useState<OpenByKind>(openByKind)
  const [terminalList, setTerminalList] = useState<string[]>(terminals)
  const [dirList, setDirList] = useState<string[]>(discoverDirs)
  const [dirDraft, setDirDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const themePref = useThemePref()
  const resolvedTheme = useResolvedTheme()

  useEffect(() => setLocal(openByKind), [openByKind])
  useEffect(() => setTerminalList(terminals), [terminals])
  useEffect(() => setDirList(discoverDirs), [discoverDirs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fail = (err: unknown) => onError(String((err as Error).message))

  const options = useMemo(
    () => withStoredPaths(apps, [...Object.values(local).flat(), ...terminalList]),
    [apps, local, terminalList],
  )

  const commit = async (kind: OpenKind, next: string[]) => {
    const prev = local
    setLocal({ ...local, [kind]: next })
    try {
      await api.patchSettings({ openByKind: { [kind]: next } })
      const label = OPEN_ROWS.find((r) => r.kind === kind)?.label ?? kind
      onChanged(next.length ? `${label}：${appNameOf(next[0])} 为默认，共 ${next.length} 个` : `${label}列表已清空`)
    } catch (err) {
      setLocal(prev)
      fail(err)
    }
  }

  /** Same optimistic-then-rollback shape as a kind's list; the two menus rebuild from the server value. */
  const commitTerminals = async (next: string[]) => {
    const prev = terminalList
    setTerminalList(next)
    try {
      await api.patchSettings({ terminals: next })
      onChanged(`可用终端：${next.map((a) => appNameOf(a)).join('、')}`)
    } catch (err) {
      setTerminalList(prev)
      fail(err)
    }
  }

  const commitDirs = async (next: string[]) => {
    const prev = dirList
    setDirList(next)
    try {
      await api.patchSettings({ discoverDirs: next })
      onChanged(`扫描路径已更新，共 ${next.length} 个目录`)
    } catch (err) {
      setDirList(prev)
      fail(err)
    }
  }

  /** The store repaints at once, so a failed PATCH has to roll the <html> attribute back too. */
  const commitTheme = async (next: ThemePref) => {
    const prev = themePref
    applyTheme(next)
    try {
      await api.patchSettings({ theme: next })
      onChanged(`外观：${THEME_ROWS.find((r) => r.key === next)?.label}`)
    } catch (err) {
      applyTheme(prev)
      fail(err)
    }
  }

  const dirDragFrom = useRef<number | null>(null)

  const addDir = async (raw: string) => {
    const p = raw.trim()
    if (!p) return
    if (p === '~' || p.startsWith('~/') || p.startsWith('/')) {
      if (!dirList.includes(p)) await commitDirs([...dirList, p].slice(0, 12))
      setDirDraft('')
    } else {
      onError('路径需要以 / 或 ~/ 开头')
    }
  }

  const dead = (app: string) => appsExist[app] === false

  const brokenItems = items.map((item) => ({ item, dead: item.openWith.filter(dead) })).filter((x) => x.dead.length > 0)
  const deadByKind = OPEN_ROWS.map(({ kind, label }) => ({ kind, label, dead: local[kind].filter(dead) })).filter(
    (x) => x.dead.length > 0,
  )
  const deadTerminals = terminalList.filter(dead)
  const deadCount =
    brokenItems.reduce((n, x) => n + x.dead.length, 0) + deadByKind.reduce((n, x) => n + x.dead.length, 0) + deadTerminals.length

  const cleanup = async () => {
    setBusy(true)
    try {
      for (const { item, dead: list } of brokenItems) {
        await api.update(item.id, { openWith: item.openWith.filter((a) => !list.includes(a)) })
      }
      for (const { kind, dead: list } of deadByKind) {
        await api.patchSettings({ openByKind: { [kind]: local[kind].filter((a) => !list.includes(a)) } })
      }
      if (deadTerminals.length) await commitTerminals(terminalList.filter((a) => !dead(a)))
      onChanged(`已清理 ${deadCount} 处失效应用引用`)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-scrim px-4 py-[6vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ animation: 'pop-in 140ms ease-out' }}
        className="card-surface w-full max-w-2xl rounded-2xl bg-ink-900/95 p-5 shadow-2xl shadow-shadow/70"
      >
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="shrink-0 text-[15px] font-semibold">设置</h2>
          {/* CJK breaks after a single glyph, so an unwrapped title needs shrink-0, not just room. */}
          <span className="text-[11.5px] text-mute-400 max-md:order-3 max-md:basis-full">
            保存在 data/items.json，换机器直接拷贝该文件
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 text-[12px] text-mute-300 transition hover:text-paper"
          >
            关闭 <kbd className="font-mono">esc</kbd>
          </button>
        </div>

        <div className="space-y-4">
          <Card title="外观" desc="深色或浅色，也可以跟着 macOS 一起切。面板和应用管理共用这一档。">
            <div className="flex items-center gap-2">
              <Select
                value={themePref}
                onChange={(e) => commitTheme(e.target.value as ThemePref)}
                title="切换立即生效，不需要刷新"
                className="w-40 py-1.5 text-mute-300"
              >
                {THEME_ROWS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </Select>
              {themePref === 'system' && (
                <span className="text-[11.5px] text-mute-400">
                  系统当前是{resolvedTheme === 'dark' ? '深色' : '浅色'}
                </span>
              )}
            </div>
          </Card>

          <Card
            title="按类型的打开方式"
            desc="每类一个列表，拖动可以排序：第一个是这条类型的默认应用，其余是备选。新建条目时按当时的列表带上候选，之后条目自己管理；列表为空就交给 macOS。已有条目的双击菜单会实时并入这份列表，不需要逐个同步。"
          >
            <div className="space-y-2.5">
              {OPEN_ROWS.map(({ kind, label, hint }) => (
                <div key={kind} className="rounded-lg border border-ink-600/60 bg-ink-800/40 p-2.5">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="text-[12.5px] text-paper">{label}</span>
                    <span className="text-[10.5px] text-mute-400">{hint}</span>
                  </div>
                  <AppChips
                    value={local[kind]}
                    onChange={(next) => commit(kind, next)}
                    options={options}
                    exist={appsExist}
                    placeholder={`搜索${label}应用，或从列表直接选…`}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="可用终端"
            desc="文件夹右键的「在终端中打开」和命令条目右键的「在终端里运行」都按这一份生成，拖动排序。系统自带的 Terminal 始终保留、不可删除，iTerm 等其他终端自己加。"
          >
            <AppChips
              value={terminalList}
              onChange={commitTerminals}
              options={options}
              exist={appsExist}
              firstIsDefault={false}
              locked={defaultTerminals}
              max={8}
              placeholder="搜索终端应用，或从列表直接选…"
            />
          </Card>

          <Card
            title="应用扫描路径"
            desc="「发现应用」和右键/设置里的应用选择列表共用这一份：递归收录目录下的 .app（不列文件夹）；拖动排序。/Applications、~/Applications、/System/Applications 是系统路径，始终扫描、不可删除，其余自己加。"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {dirList.map((d, idx) => {
                const locked = defaultDirs.includes(d)
                return (
                <span
                  key={d}
                  draggable
                  onDragStart={(e) => {
                    dirDragFrom.current = idx
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnter={() => {
                    const from = dirDragFrom.current
                    if (from === null || from === idx) return
                    dirDragFrom.current = idx
                    const next = [...dirList]
                    const [picked] = next.splice(from, 1)
                    next.splice(idx, 0, picked)
                    commitDirs(next)
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => e.preventDefault()}
                  onDragEnd={() => (dirDragFrom.current = null)}
                  title={`${d}\n拖动可调整顺序${locked ? ' · 系统路径，不可删除' : ''}`}
                  className={`chip flex max-w-full cursor-grab items-center gap-1 border border-ink-600 py-1 pl-2 pr-1 text-[12px] text-paper active:cursor-grabbing ${
                    locked ? 'bg-ink-700/70' : 'bg-ink-800/70'
                  }`}
                >
                  <span className="font-mono text-[10px] text-mute-400">{idx + 1}</span>
                  <span className="truncate font-mono text-[11px]">{d}</span>
                  {locked ? (
                    <span className="px-1 text-[10px] text-mute-400" title="系统路径，始终扫描">系统</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => commitDirs(dirList.filter((x) => x !== d))}
                      className="grid place-items-center rounded p-1 text-mute-400 transition hover:bg-ink-600 hover:text-paper"
                      aria-label={`移除 ${d}`}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  )}
                </span>
                )
              })}
              {dirList.length < 12 && (
                <input
                  value={dirDraft}
                  onChange={(e) => setDirDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addDir(dirDraft)
                    }
                  }}
                  placeholder="输入路径（/ 或 ~/ 开头），回车添加…"
                  className="w-64 rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1 font-mono text-[12px] focus:border-accent focus:outline-none"
                />
              )}
              {dirList.length < 12 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const r = await api.pick('folder')
                      if (!r.cancelled && r.value) await addDir(r.value)
                    } catch (err) {
                      fail(err)
                    }
                  }}
                  className="rounded-lg border border-ink-600 px-2.5 py-1 text-[12px] text-mute-300 transition hover:bg-ink-700 hover:text-paper"
                >
                  选择文件夹…
                </button>
              )}
            </div>
          </Card>

          <Card title="已失效引用" desc="指向已卸载应用的配置。清理只会从面板里去掉这些应用路径，不会动磁盘文件。">
            {deadCount === 0 ? (
              <div className="text-[12px] text-mute-400">没有失效引用。</div>
            ) : (
              <div className="space-y-2">
                <ul className="space-y-1 text-[12px] text-mute-300">
                  {brokenItems.map(({ item, dead: list }) => (
                    <li key={item.id} className="truncate">
                      条目「{item.name}」候选：<span className="text-mute-400">{list.map(appNameOf).join('、')}</span>
                    </li>
                  ))}
                  {deadByKind.map(({ kind, label, dead: list }) => (
                    <li key={kind} className="truncate">
                      {label}列表：<span className="text-mute-400">{list.map(appNameOf).join('、')}</span>
                    </li>
                  ))}
                  {deadTerminals.length > 0 && (
                    <li className="truncate">
                      可用终端：<span className="text-mute-400">{deadTerminals.map(appNameOf).join('、')}</span>
                    </li>
                  )}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cleanup}
                  className="rounded-lg border border-danger/40 px-3 py-1.5 text-[12.5px] text-danger transition hover:bg-danger/15 disabled:opacity-50"
                >
                  {busy ? '清理中…' : `清理 ${deadCount} 处失效引用`}
                </button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
