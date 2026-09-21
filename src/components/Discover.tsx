import { useEffect, useState } from 'react'
import { api } from '../api'
import type { DiscoverResult } from '../types'
import { ItemIcon, type IconSubject } from './ItemCard'
import { Icon } from './Icon'

interface Props {
  groups: string[]
  onClose: () => void
  onImported: (count: number) => void
  onError: (message: string) => void
}

const asIcon = (r: DiscoverResult): IconSubject => ({ name: r.name, kind: r.kind, value: r.value, iconPath: r.value })

export function Discover({ groups, onClose, onImported, onError }: Props) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<DiscoverResult[]>([])
  const [total, setTotal] = useState(0)
  const [dirs, setDirs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [group, setGroup] = useState('应用')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      api
        .discover(q, 300)
        .then((r) => {
          if (!alive) return
          setRows(r.results)
          setTotal(r.total)
          setDirs(r.dirs ?? [])
        })
        .catch((err) => alive && onError(String((err as Error).message)))
        .finally(() => alive && setLoading(false))
    }, 180)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q, onError])

  const toggle = (value: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })

  const importPicked = async () => {
    const items = rows.filter((r) => picked.has(r.value))
    if (!items.length) return
    setBusy(true)
    try {
      const r = await api.import(items, group)
      onImported(r.added)
      onClose()
    } catch (err) {
      onError(String((err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim px-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ animation: 'pop-in 140ms ease-out' }} className="card-surface flex max-h-[78vh] w-full max-w-2xl flex-col rounded-2xl bg-ink-900/95 shadow-2xl shadow-shadow/70">
        <div className="flex items-baseline gap-3 border-b border-ink-700 px-5 py-4">
          <h2 className="text-[15px] font-semibold">发现应用</h2>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-mute-400" title={dirs.join('\n')}>
            扫描 {dirs.length ? dirs.join('、') : '（未配置目录，到设置页添加）'} · {loading ? '扫描中…' : `${total} 个应用未收录`}
          </span>
        </div>

        <div className="flex items-center gap-2 border-b border-ink-700 px-5 py-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="过滤名称或路径…"
            className="flex-1 rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 text-[13px] focus:border-accent focus:outline-none"
          />
          <span className="text-[11.5px] text-mute-400">收录到</span>
          <input
            list="discover-groups"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="w-28 rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 text-[13px] focus:border-accent focus:outline-none"
          />
          <datalist id="discover-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {rows.map((r) => {
            const on = picked.has(r.value)
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => toggle(r.value)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition ${on ? 'bg-accent/15' : 'hover:bg-ink-700'}`}
              >
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-accent bg-accent text-white' : 'border-ink-500'}`}>
                  {on && <Icon name="check" size={12} strokeWidth={3} />}
                </span>
                <ItemIcon item={asIcon(r)} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{r.displayName ?? r.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-mute-400">
                    {r.displayName ? `${r.name} · ` : ''}
                    {r.value}
                  </span>
                </span>
              </button>
            )
          })}
          {!loading && rows.length === 0 && <div className="py-10 text-center text-[13px] text-mute-400">没有可新增的项</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-ink-700 px-5 py-3">
          <button
            type="button"
            onClick={() => setPicked(new Set(rows.map((r) => r.value)))}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-mute-300 transition hover:bg-ink-700 hover:text-paper"
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-mute-300 transition hover:bg-ink-700 hover:text-paper"
          >
            清空
          </button>
          <span className="ml-auto text-[11.5px] text-mute-400">已选 {picked.size}</span>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[13px] text-mute-300 transition hover:bg-ink-700 hover:text-paper">
            取消
          </button>
          <button
            type="button"
            disabled={busy || picked.size === 0}
            onClick={importPicked}
            className="rounded-lg bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-accent-soft disabled:opacity-40"
          >
            收录
          </button>
        </div>
      </div>
    </div>
  )
}
