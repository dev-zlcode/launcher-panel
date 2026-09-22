import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Item, RunOutput } from '../types'

interface Props {
  item: Item
  onRerun: (item: Item) => void
  onStop: (item: Item) => void
  onCopy: (text: string, label: string) => void
  onClose: () => void
}

const btn = 'rounded-lg px-3 py-1.5 text-[13px] transition disabled:opacity-50'

function clock(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * Live view of one command's log: it polls while it is on screen and stops when it isn't, so closing
 * this never touches the process. The log file is the source of truth, which means reopening after a
 * panel restart still shows what the last run said.
 */
export function RunResult({ item, onRerun, onStop, onCopy, onClose }: Props) {
  const [data, setData] = useState<RunOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        const r = await api.runOutput(item.id)
        if (!alive) return
        setData(r)
        setError(null)
      } catch (err) {
        if (alive) setError(String((err as Error).message))
      }
    }
    pull()
    const timer = setInterval(pull, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [item.id])

  // Follow the output, unless he scrolled up to read something.
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [data?.text])

  const running = data?.running ?? false
  const out = data?.text ?? ''
  const at = clock(data?.startedAt ?? null)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim px-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ animation: 'pop-in 140ms ease-out' }}
        className="card-surface flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-ink-900/95 p-5 shadow-2xl shadow-shadow/70"
      >
        <div className="mb-3 flex shrink-0 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{item.name}</h2>
          {running ? (
            <span className="chip shrink-0 border border-info/40 text-info">运行中…</span>
          ) : data && data.code !== null ? (
            <span
              className={`chip shrink-0 border ${data.code === 0 ? 'border-ok/40 text-ok' : 'border-danger/40 text-danger'}`}
            >
              退出码 {data.code}
            </span>
          ) : (
            <span className="chip shrink-0 border border-ink-500 text-mute-400">未在运行</span>
          )}
          {at && <span className="shrink-0 font-mono text-[10.5px] text-mute-400">{at}</span>}
          <button
            type="button"
            onClick={onClose}
            className="ml-1 shrink-0 text-[12px] text-mute-300 transition hover:text-paper"
          >
            关闭 <kbd className="font-mono">esc</kbd>
          </button>
        </div>

        <div className="mb-3 shrink-0 rounded-lg border border-ink-600 bg-ink-800/60 px-2.5 py-2">
          <div className="mb-1 text-[10.5px] uppercase tracking-wider text-mute-400">命令</div>
          <pre className="font-mono text-[11.5px] whitespace-pre-wrap text-paper">{data?.command ?? item.value}</pre>
        </div>

        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
          }}
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-ink-600 bg-ink-950/80 px-2.5 py-2"
        >
          <div className="sticky top-0 mb-1 text-[10.5px] uppercase tracking-wider text-mute-400">
            输出
            {data?.droppedBytes ? ` · 前面 ${Math.round(data.droppedBytes / 1024)} KB 未显示，完整内容在日志文件里` : ''}
          </div>
          {error ? (
            <div className="text-[12px] text-danger">{error}</div>
          ) : out ? (
            <pre className="select-text whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-mute-300">{out}</pre>
          ) : (
            <div className="text-[12px] text-mute-400">
              {running ? '还没有输出。' : '这个条目还没跑过，或者日志已经被下一次运行覆盖了。'}
            </div>
          )}
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            disabled={!out}
            onClick={() => onCopy(out, '输出')}
            className={`${btn} border border-ink-600 text-paper hover:border-accent/60 hover:bg-ink-700`}
          >
            复制输出
          </button>
          {running && (
            <button
              type="button"
              onClick={() => onStop(item)}
              className={`${btn} border border-ink-600 text-paper hover:border-accent/60 hover:bg-ink-700`}
            >
              停止
            </button>
          )}
          <button
            type="button"
            onClick={() => onRerun(item)}
            className={`${btn} bg-accent font-medium text-white hover:bg-accent-soft`}
          >
            {running ? '重新执行' : '重新运行'}
          </button>
        </div>
      </div>
    </div>
  )
}
