import { useRef } from 'react'
import type { Item, Kind, Layout, OpenByKind } from '../types'
import { colorFor, initials } from '../fuzzy'
import { appInstalled, appNameOf, candidateApps, liveCandidates, resolveDefaultApp, type ExistMap } from '../paths'
import { useIcon, useInView } from '../useIcon'
import { longPress } from '../longPress'

/** Applied through inline `style`, so the light block in index.css can flip the hue with the chip it sits on. */
export const KIND_META: Record<Kind, { label: string; color: string }> = {
  app: { label: '应用', color: 'var(--color-kind-app)' },
  folder: { label: '文件夹', color: 'var(--color-kind-folder)' },
  file: { label: '文件', color: 'var(--color-kind-file)' },
  url: { label: '链接', color: 'var(--color-kind-url)' },
  snippet: { label: '片段', color: 'var(--color-kind-snippet)' },
  command: { label: '命令', color: 'var(--color-kind-command)' },
}

/** Commands and snippets can span lines; a one-line subtitle has to show that break somehow. */
function previewValue(value: string) {
  return value.replace(/\s*\n+\s*/g, ' ⏎ ')
}

function faviconFor(url: string): string | null {
  try {
    const host = new URL(url).hostname
    return host ? `https://www.google.com/s2/favicons?sz=64&domain=${host}` : null
  } catch {
    return null
  }
}

export type IconSubject = Pick<Item, 'name' | 'value' | 'iconPath' | 'kind'>

export function ItemIcon({ item, size = 40 }: { item: IconSubject; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref)
  const fileIcon = useIcon(seen ? item.iconPath : null)
  const webIcon = item.kind === 'url' ? faviconFor(item.value) : null
  const src = fileIcon ?? webIcon

  return (
    <span ref={ref} style={{ width: size, height: size }} className="grid shrink-0 place-items-center">
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="select-none rounded-[22%] object-contain"
        />
      ) : (
        <span
          className="grid h-full w-full select-none place-items-center rounded-[22%] font-semibold text-white/90"
          style={{ background: colorFor(item.name), fontSize: size * 0.34 }}
        >
          {initials(item.name)}
        </span>
      )}
    </span>
  )
}

interface CardProps {
  item: Item
  /** 宫格 stacks name over path; 列表 puts them on one line and adds when it was last used. */
  layout: Layout
  appsExist?: ExistMap
  openByKind: OpenByKind
  onActivate: (item: Item, pos: { x: number; y: number }) => void
  onReveal: (item: Item) => void
  onMenu: (item: Item, pos: { x: number; y: number }) => void
}

/** MM-DD — the list view has room for a date, not for a timestamp. */
function lastUsed(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function ItemCard({ item, layout, appsExist, openByKind, onActivate, onReveal, onMenu }: CardProps) {
  const meta = KIND_META[item.kind]
  const press = longPress((pos) => onMenu(item, pos))
  const exist = appsExist ?? {}
  const { app: current } = resolveDefaultApp(item, exist, openByKind)
  const { dead } = liveCandidates(item.openWith, exist)
  const extra = candidateApps(item, openByKind).filter((app) => app !== current && appInstalled(app, exist)).length
  const gesture =
    item.kind === 'snippet'
      ? '单击复制'
      : item.kind === 'command'
        ? '单击运行'
        : `单击用${appNameOf(current)}打开${extra ? ` · 双击可选 ${extra + 1} 个应用` : ' · 双击可换应用'}`
  const title = (
    <>
      <span className="truncate text-[13px] font-medium text-paper">{item.name}</span>
      {extra > 0 && (
        <span className="chip shrink-0 border border-info/40 text-info" title="双击可选其他应用">
          双击 {extra + 1} 选
        </span>
      )}
      {dead.length > 0 && (
        <span className="chip shrink-0 border border-warn/40 text-warn" title="候选里有未安装的应用，打开时会自动跳过">
          {dead.length} 失效
        </span>
      )}
    </>
  )
  const value = (
    <span className={layout === 'list' ? 'min-w-0 flex-1 truncate font-mono text-[10.5px] text-mute-400' : 'mt-0.5 block truncate font-mono text-[10.5px] text-mute-400'}>
      {current && <span className="text-info/80">{appNameOf(current)} · </span>}
      {previewValue(item.value)}
    </span>
  )
  return (
    <button
      type="button"
      title={`${item.value}\n${item.note ? item.note + '\n' : ''}${gesture}${
        dead.length ? `（未安装：${dead.map(appNameOf).join('、')}）` : ''
      } · 已用 ${item.useCount} 次`}
      {...press}
      onClick={(e) =>
        e.metaKey || e.ctrlKey ? onReveal(item) : onActivate(item, { x: e.clientX, y: e.clientY })
      }
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(item, { x: e.clientX, y: e.clientY })
      }}
      className={`card-surface group relative flex w-full items-center gap-3 text-left transition
        hover:-translate-y-px hover:border-accent/60 hover:bg-ink-700 active:translate-y-0
        ${layout === 'list' ? 'rounded-lg px-3 py-1.5' : 'rounded-(--radius-card) px-3.5 py-3'}`}
    >
      <ItemIcon item={item} size={layout === 'list' ? 28 : 40} />
      {layout === 'list' ? (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex max-w-[46%] shrink-0 items-center gap-1.5">{title}</span>
          {value}
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">{title}</span>
          {value}
        </span>
      )}
      {layout === 'list' ? (
        <span className="flex shrink-0 items-center gap-2">
          <span className="chip" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {/* 次数与最近日期只有 hover 的 tooltip 补充意义，窄屏先让位给名字和路径。 */}
          <span className="w-7 text-right font-mono text-[10px] text-mute-400 max-md:hidden">
            {item.useCount > 0 ? `${item.useCount}×` : ''}
          </span>
          <span className="w-11 text-right font-mono text-[10px] text-mute-400 max-md:hidden">
            {item.lastUsedAt ? lastUsed(item.lastUsedAt) : '—'}
          </span>
        </span>
      ) : (
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="chip" style={{ color: meta.color }}>
            {meta.label}
          </span>
          {item.useCount > 0 && <span className="font-mono text-[10px] text-mute-400">{item.useCount}×</span>}
        </span>
      )}
    </button>
  )
}
