import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { AppEntry, Item, ItemDraft, Kind, OpenByKind, OpenKind } from '../types'
import type { ExistMap } from '../paths'
import { AppChips } from './AppChips'
import { AppList, filterApps, moveCursor, useInstalledApps, withStoredPaths } from './AppList'
import { KIND_META } from './ItemCard'

const KINDS: Kind[] = ['app', 'folder', 'file', 'url', 'snippet', 'command']

const VALUE_FIELD: Record<Kind, { label: string; placeholder: string }> = {
  app: { label: '应用', placeholder: '搜索已安装应用，或填 .app 路径' },
  folder: { label: '绝对路径', placeholder: '/Applications/…  或 ~/…' },
  file: { label: '绝对路径', placeholder: '/Applications/…  或 ~/…' },
  url: { label: '链接', placeholder: 'https://…' },
  snippet: { label: '文本', placeholder: '要复制的内容' },
  command: { label: '命令', placeholder: '如：brew update\n多行按顺序依次执行' },
}

const CANDIDATE_HINT = [
  '未选：交给 macOS 默认打开',
  '仅 1 个：单击直接用它打开',
  '2 个以上：第一个用于单击，其余在双击菜单里挑，拖动可排序',
]

interface Props {
  editing: Item | null
  groups: string[]
  appsExist: ExistMap
  openByKind: OpenByKind
  onClose: () => void
  onSaved: () => void
  onError: (message: string) => void
}

function emptyDraft(): ItemDraft {
  return { kind: 'app', name: '', nameEn: '', value: '', group: '默认', tags: [], note: '', pinned: false, openWith: [] }
}

function toDraft(item: Item): ItemDraft {
  const { kind, name, nameEn, value, group, tags, note, pinned, openWith } = item
  return { kind, name, nameEn: nameEn ?? '', value, group, tags, note, pinned, openWith }
}

export function ItemEditor({ editing, groups, appsExist, openByKind, onClose, onSaved, onError }: Props) {
  const [draft, setDraft] = useState<ItemDraft>(() => (editing ? toDraft(editing) : emptyDraft()))
  const [tagText, setTagText] = useState(() => (editing ? editing.tags.join(', ') : ''))
  const [busy, setBusy] = useState(false)
  const [appPick, setAppPick] = useState(false)
  const [appCursor, setAppCursor] = useState(0)

  useEffect(() => {
    setDraft(editing ? toDraft(editing) : emptyDraft())
    setTagText(editing ? editing.tags.join(', ') : '')
    setAppPick(false)
    setAppCursor(0)
  }, [editing])

  const canPickApp = draft.kind !== 'snippet' && draft.kind !== 'command'
  /** A command is a script and a snippet is pasted text: both lose their line breaks in an <input>. */
  const isMulti = draft.kind === 'snippet' || draft.kind === 'command'
  const apps = useInstalledApps(onError)

  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  /**
   * A new item follows its kind's list until the user edits it by hand — the same rule the server
   * applies on create, so what you see here is what gets saved.
   */
  const setKind = (kind: Kind) =>
    setDraft((d) => {
      if (editing || d.kind === kind) return { ...d, kind }
      const cur = d.openWith ?? []
      const template = openByKind[d.kind as OpenKind] ?? []
      // Hand-edited candidates survive a kind switch; a list still straight from the template follows along.
      const touched = !!cur.length && cur.join('|') !== template.join('|')
      return { ...d, kind, openWith: touched ? cur : [...(openByKind[kind as OpenKind] ?? [])] }
    })

  const candidates = draft.openWith ?? []
  const appOptions = useMemo(() => withStoredPaths(apps, [draft.value, ...candidates]), [apps, draft.value, candidates])

  // The path field doubles as an app search: the same list, filter and rows the candidate chips use.
  const appMatches = useMemo(
    () => (draft.kind === 'app' ? filterApps(appOptions, draft.value) : []),
    [appOptions, draft.kind, draft.value],
  )

  const pickApp = (a: AppEntry) => {
    set('value', a.value)
    if (!draft.name.trim()) {
      set('name', a.displayName ?? a.name)
      if (a.displayName) set('nameEn', a.name)
    }
    setAppPick(false)
  }

  const browse = async () => {
    const kind = draft.kind === 'file' ? 'file' : 'folder'
    setBusy(true)
    try {
      const r = await api.pick(kind)
      if (r.cancelled || !r.value) return
      set('value', r.value)
      setKind(r.kind ?? kind)
      if (!draft.name) set('name', r.name ?? '')
    } catch (err) {
      onError(String((err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (busy) return
    const tags = tagText.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    const payload = { ...draft, tags }
    if (!payload.value.trim()) {
      onError(`${VALUE_FIELD[draft.kind].label}不能为空`)
      return
    }
    setBusy(true)
    try {
      if (editing) await api.update(editing.id, payload)
      else await api.create(payload)
      onSaved()
      onClose()
    } catch (err) {
      onError(String((err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 text-[13px] focus:border-accent focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim px-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ animation: 'pop-in 140ms ease-out' }}
        className="card-surface w-full max-w-lg rounded-2xl bg-ink-900/95 p-5 shadow-2xl shadow-shadow/70"
      >
        <h2 className="mb-4 text-[15px] font-semibold">{editing ? '编辑条目' : '新增条目'}</h2>

        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-mute-400">类型</div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-lg border px-2.5 py-1 text-[12px] transition ${
                draft.kind === k
                  ? 'border-accent bg-accent/20 text-paper'
                  : 'border-ink-600 text-mute-300 hover:border-ink-500 hover:text-paper'
              }`}
            >
              {KIND_META[k].label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute-400">名称</span>
            <input className={field} value={draft.name} placeholder="留空则从下面这项推断" onChange={(e) => set('name', e.target.value)} />
          </label>

          {draft.kind === 'app' && (
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute-400">英文别名（可留空）</span>
              <input
                className={field}
                value={draft.nameEn ?? ''}
                placeholder="中文名对应的英文名，用于搜索匹配"
                onChange={(e) => set('nameEn', e.target.value)}
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute-400">
              {VALUE_FIELD[draft.kind].label}
            </span>
            <div
              className="flex gap-1.5"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  save()
                }
              }}
            >
              {isMulti ? (
                <textarea
                  className={`${field} h-20 min-w-0 resize-y font-mono text-[12px] leading-relaxed`}
                  value={draft.value}
                  placeholder={VALUE_FIELD[draft.kind].placeholder}
                  spellCheck={false}
                  onChange={(e) => set('value', e.target.value)}
                />
              ) : (
                <input
                  className={`${field} font-mono text-[12px]`}
                  value={draft.value}
                  placeholder={VALUE_FIELD[draft.kind].placeholder}
                  onChange={(e) => {
                    set('value', e.target.value)
                    if (draft.kind === 'app') {
                      setAppPick(true)
                      setAppCursor(0)
                    }
                  }}
                  onFocus={() => draft.kind === 'app' && setAppPick(true)}
                  onBlur={() => setAppPick(false)}
                  onKeyDown={(e) => {
                    if (draft.kind !== 'app') return
                    if (e.key === 'Escape' && appPick) {
                      e.stopPropagation()
                      setAppPick(false)
                      return
                    }
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      setAppPick(true)
                      setAppCursor((c) => moveCursor(appMatches.length, c, e.key === 'ArrowDown'))
                    } else if (e.key === 'Enter' && appPick && appMatches[appCursor]) {
                      e.preventDefault()
                      pickApp(appMatches[appCursor])
                    }
                  }}
                />
              )}
              {(draft.kind === 'folder' || draft.kind === 'file') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={browse}
                  className="card-surface shrink-0 rounded-lg px-3 text-[12px] transition hover:border-accent/60 hover:bg-ink-700 disabled:opacity-50"
                >
                  浏览…
                </button>
              )}
            </div>

            {isMulti && (
              <span className="mt-1 block text-[10.5px] text-mute-400">
                {draft.kind === 'command'
                  ? '换行＝逐行依次执行 · 支持 zsh 函数与别名 · ⌘↵ 保存'
                  : '保留换行 · ⌘↵ 保存'}
              </span>
            )}

            {draft.kind === 'app' && appPick && (
              <div className="mt-1.5 rounded-xl border border-ink-600 bg-ink-800/60 p-1">
                <div className="px-2 py-1 text-[10.5px] text-mute-400">
                  {appMatches.length
                    ? `${appMatches.length} 个可选 · 回车选中第 ${appCursor + 1} 项 · esc 收起`
                    : '没有匹配的已安装应用，路径可以直接填写'}
                </div>
                <AppList apps={appMatches} cursor={appCursor} onPick={pickApp} emptyText={null} />
              </div>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute-400">分组</span>
              <input className={field} list="group-options" value={draft.group} onChange={(e) => set('group', e.target.value)} />
              <datalist id="group-options">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute-400">标签</span>
              <input className={field} value={tagText} placeholder="逗号分隔" onChange={(e) => setTagText(e.target.value)} />
            </label>
          </div>

          {canPickApp && (
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute-400">候选打开应用</span>
              <AppChips value={candidates} onChange={(next) => set('openWith', next)} options={appOptions} exist={appsExist} />
              <span className="mt-1.5 block text-[10.5px] text-mute-400">{CANDIDATE_HINT[candidates.length] ?? `已选 ${candidates.length} 个：第一个用于单击，其余双击时挑`}</span>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute-400">备注</span>
            <textarea className={`${field} h-16 resize-none`} value={draft.note} onChange={(e) => set('note', e.target.value)} />
          </label>

          <label className="flex items-center gap-2 text-[12.5px] text-mute-300">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => set('pinned', e.target.checked)} />
            固定到置顶区
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-mute-300 transition hover:bg-ink-700 hover:text-paper">
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-soft disabled:opacity-50"
          >
            {busy ? '处理中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
