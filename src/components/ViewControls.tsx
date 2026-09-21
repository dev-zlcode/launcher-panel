import type { Layout } from '../types'
import { Select } from './Select'

export interface Choice<T extends string> {
  key: T
  label: string
}

const LAYOUTS: Array<Choice<Layout>> = [
  { key: 'grid', label: '宫格' },
  { key: 'list', label: '列表' },
]

/**
 * 分组 / 排序 / 视图 — the same three dropdowns on both pages, so the two axes stay separate controls
 * instead of one list where 「按分组」 and 「按名称」 pretend to be the same kind of choice.
 * The axis name rides in front of every option: a collapsed native select has nothing else to say what it is.
 */
export function ViewControls<TG extends string, TS extends string>({
  groups,
  group,
  onGroup,
  sorts,
  sort,
  onSort,
  sortTitle,
  layout,
  onLayout,
}: {
  groups: readonly Choice<TG>[]
  group: TG
  onGroup: (v: TG) => void
  sorts: readonly Choice<TS>[]
  sort: TS
  onSort: (v: TS) => void
  /** The manage page points out here that only 分组 + 默认顺序 can be dragged. */
  sortTitle?: string
  layout: Layout
  onLayout: (v: Layout) => void
}) {
  return (
    /** `basis-full` on narrow: the header is a wrapping row, and these three take their own line. */
    <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5 max-md:order-last max-md:basis-full max-md:min-w-0">
      <Select value={group} onChange={(e) => onGroup(e.target.value as TG)} className="py-1.5 text-mute-300 max-md:h-9">
        {groups.map((g) => (
          <option key={g.key} value={g.key}>
            分组：{g.label}
          </option>
        ))}
      </Select>
      <Select value={sort} onChange={(e) => onSort(e.target.value as TS)} title={sortTitle} className="py-1.5 text-mute-300 max-md:h-9">
        {sorts.map((s) => (
          <option key={s.key} value={s.key}>
            排序：{s.label}
          </option>
        ))}
      </Select>
      <Select value={layout} onChange={(e) => onLayout(e.target.value as Layout)} title="卡片宫格看图标，单列列表看路径" className="py-1.5 text-mute-300 max-md:h-9">
        {LAYOUTS.map((l) => (
          <option key={l.key} value={l.key}>
            视图：{l.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
