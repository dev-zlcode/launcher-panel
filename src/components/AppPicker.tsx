import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { candidateApps, type ExistMap } from '../paths'
import type { AppEntry, Item, OpenByKind } from '../types'
import { AppChips } from './AppChips'
import { AppList, filterApps, useInstalledApps, withStoredPaths } from './AppList'
import { ItemIcon } from './ItemCard'

interface Props {
  target: Item
  openByKind: OpenByKind
  appsExist: ExistMap
  onClose: () => void
  onDone: (message: string) => void
  onError: (message: string) => void
}

type OpenScope = 'once' | 'item'

export function AppPicker({ target, openByKind, appsExist, onClose, onDone, onError }: Props) {
  const apps = useInstalledApps(onError)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<OpenScope>('once')
  // The same list the card badge and the double-click menu offer: the item's own candidates, else this
  // kind's settings list. Editing it below writes the whole thing into `openWith`, so the type list freezes.
  const [list, setList] = useState<string[]>(() => candidateApps(target, openByKind))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const options = useMemo(() => withStoredPaths(apps, list), [apps, list])
  const matches = useMemo(() => filterApps(options, q), [options, q])

  /** Candidate edits persist immediately but keep the dialog open, so several apps can be added in a row. */
  const persist = async (next: string[], message: string) => {
    try {
      await api.update(target.id, { openWith: next })
      setList(next)
      onDone(message)
    } catch (err) {
      onError(String((err as Error).message))
    }
  }

  const choose = async (app: AppEntry) => {
    if (scope === 'item') {
      if (list.includes(app.value)) return onError(`${app.name} 已在候选列表里`)
      return persist([...list, app.value], `「${target.name}」新增候选：${app.name}`)
    }
    try {
      await api.open(target.kind, target.value, app.value)
      onDone(`已用 ${app.name} 打开`)
      onClose()
    } catch (err) {
      onError(String((err as Error).message))
    }
  }

  const hint =
    scope === 'once'
      ? '点击立即用所选应用打开，不改动配置'
      : '拖动可调整顺序：第一个用于单击，其余在双击菜单里挑'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim px-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ animation: 'pop-in 140ms ease-out' }} className="card-surface flex max-h-[78vh] w-full max-w-md flex-col rounded-2xl bg-ink-900/95 shadow-2xl shadow-shadow/70">
        <div className="flex items-center gap-2.5 border-b border-ink-700 px-4 py-3">
          <ItemIcon item={target} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">打开方式</div>
            <div className="truncate font-mono text-[10.5px] text-mute-400">{target.value}</div>
          </div>
        </div>

        <div className="border-b border-ink-700 px-4 py-2.5">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(
              [
                { key: 'once', label: '仅本次打开' },
                { key: 'item', label: target.kind === 'folder' ? '管理此文件夹候选' : '管理此条目候选' },
              ] as Array<{ key: OpenScope; label: string }>
            ).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setScope(s.key)}
                className={`rounded-lg border px-2.5 py-1 text-[12px] transition ${
                  scope === s.key ? 'border-accent bg-accent/20 text-paper' : 'border-ink-600 text-mute-300 hover:border-ink-500 hover:text-paper'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="text-[10.5px] text-mute-400">{hint}</div>
        </div>

        {scope === 'item' && list.length > 0 && (
          <div className="border-b border-ink-700 px-4 py-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-mute-400">当前候选</span>
              <button
                type="button"
                onClick={() => persist([], `「${target.name}」已清空本条目候选：改回跟随设置里的类型清单`)}
                className="ml-auto text-[11px] text-mute-400 underline decoration-dotted hover:text-paper"
              >
                清空
              </button>
            </div>
            <AppChips
              value={list}
              onChange={(next) => persist(next, `「${target.name}」候选已更新（${next.length} 个）`)}
              options={options}
              exist={appsExist}
              placeholder="搜索并添加…"
            />
          </div>
        )}

        <div className="px-4 py-2.5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`在 ${apps.length} 个本机应用中筛选…`}
            className="w-full rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 text-[13px] focus:border-accent focus:outline-none"
          />
        </div>

        <AppList
          apps={matches}
          onPick={choose}
          className="min-h-0 flex-1 px-2 pb-2"
          picked={(a) => scope === 'item' && list.includes(a.value)}
          disabled={(a) => scope === 'item' && list.includes(a.value)}
          emptyText={apps.length ? '没有匹配的应用' : '加载中…'}
        />

        <div className="flex items-center gap-2 border-t border-ink-700 px-4 py-2.5">
          <span className="text-[11px] text-mute-400">
            {scope === 'item' ? `已选 ${list.length} 个候选` : '选择后即打开'}
          </span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-soft">
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
