import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'

interface Props {
  /** 输入框里的文字，由外面拿着（保存时那半截还没敲回车的也算数）。 */
  text: string
  onText: (next: string) => void
  options: string[]
  /** 已选中的名字；单选模式最多一项。 */
  value: string[]
  multiple: boolean
  /** 点一行或按 Enter：选中（单选＝换过去）/ 添加（多选）。文字怎么落地由外面决定。 */
  onPick: (name: string) => void
  onRemove?: (name: string) => void
  placeholder: string
  /** 敲了一个没见过的名字时，那一行叫什么：新建分组 / 新标签。 */
  createLabel: string
  /** 多选的上限；到了就不给输入框了。 */
  max?: number
}

/**
 * 分组/标签共用的下拉：输入框＋就地展开的候选，和候选应用那套（AppChips）同一节律——
 * 展开写在流内而不是浮层，因为这个控件活在一个会滚动的弹窗里。
 */
export function NamePicker({ text, onText, options, value, multiple, onPick, onRemove, placeholder, createLabel, max }: Props) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [dirty, setDirty] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, cursor])

  const typed = text.trim()
  /**
   * 单选的输入框里挂的就是当前值：拿它当过滤条件，点开只剩自己那一行。
   * 所以只有这一轮真敲过字（`dirty`）才开始过滤；收起或选完即复位。
   */
  const q = multiple || dirty ? typed : ''
  const matches = useMemo(
    () => options.filter((o) => (!q || o.toLowerCase().includes(q.toLowerCase())) && (!multiple || !value.includes(o))),
    [options, q, multiple, value],
  )
  /** 敲的名字没在候选里 = 新建。单选时 `value` 就是输入框自己，不能参与判断。 */
  const creating = !!q && !options.includes(q) && (!multiple || !value.includes(q))
  const rows = creating ? [...matches, q] : matches
  const full = multiple && max !== undefined && value.length >= max

  const pick = (name: string) => {
    onPick(name)
    setCursor(0)
    setDirty(false)
    if (!multiple) setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      setDirty(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setCursor((c) => (rows.length ? (c + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length : 0))
      return
    }
    if (e.key === 'Enter') {
      const hit = rows[cursor] ?? null
      if (!hit) return
      e.preventDefault()
      pick(hit)
    }
  }

  const type =
    'w-full rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 text-[13px] focus:border-accent focus:outline-none'

  return (
    <div>
      {full ? (
        <div className="rounded-lg border border-ink-700 bg-ink-800/40 px-2.5 py-1.5 text-[12px] text-mute-400">已到上限 {max} 个</div>
      ) : (
        <input
          className={type}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            onText(e.target.value)
            setDirty(true)
            setCursor(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setDirty(false)
          }}
          onKeyDown={onKeyDown}
        />
      )}

      {/* 已选的带 × 摘掉，写在输入框下面：和分组那一栏的候选位置同一侧。 */}
      {multiple && value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {value.map((v) => (
            <span key={v} className="chip max-w-full truncate border border-ink-600 bg-ink-800/70 py-0.5 pl-2 pr-0.5 text-paper">
              {v}
              <button
                type="button"
                onClick={() => onRemove?.(v)}
                className="grid place-items-center rounded p-0.5 text-mute-400 transition hover:bg-ink-600 hover:text-paper"
                aria-label={`移除 ${v}`}
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && !full && (
        <div className="mt-1 rounded-xl border border-ink-600 bg-ink-800/60 p-1">
          <div ref={list} className="max-h-40 overflow-y-auto">
            {rows.map((name, i) => (
              <button
                key={name}
                type="button"
                data-row={i}
                onMouseDown={(e) => {
                  // mousedown, not click：先点会让输入框 blur，列表在手指落下之前就收掉了。
                  e.preventDefault()
                  pick(name)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition hover:bg-ink-700 ${
                  i === cursor ? 'bg-select text-paper' : 'text-mute-300 hover:text-paper'
                }`}
              >
                <span className={`min-w-0 flex-1 truncate ${name === q && creating ? 'text-accent-soft' : ''}`}>
                  {creating && name === q ? (
                    <>
                      ＋ {createLabel}「{q}」
                    </>
                  ) : (
                    name
                  )}
                </span>
                {value.includes(name) && <span className="chip shrink-0">当前</span>}
              </button>
            ))}
            {!rows.length && <div className="px-2 py-1.5 text-[12px] text-mute-400">没有可选的，敲一个名字就是新建</div>}
          </div>
        </div>
      )}
    </div>
  )
}
