import { useRef } from 'react'
import type { Item, Kind, Layout, OpenByKind } from '../types'
import { colorFor, initials } from '../fuzzy'
import { appInstalled, appNameOf, candidateApps, liveCandidates, ownApps, resolveDefaultApp, type ExistMap } from '../paths'
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

export function ItemIcon({
  item,
  size = 40,
  badge,
}: {
  item: IconSubject
  size?: number
  /** 另有几个候选应用。渲染在图标右下角，替掉名称行里那个占位的文字徽标。 */
  badge?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref)
  const fileIcon = useIcon(seen ? item.iconPath : null)
  const webIcon = item.kind === 'url' ? faviconFor(item.value) : null
  const src = fileIcon ?? webIcon

  return (
    <span ref={ref} style={{ width: size, height: size }} className="relative grid shrink-0 place-items-center">
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
      {badge ? (
        <span className="absolute -bottom-[3px] -right-1.5 rounded-full border border-ink-600 bg-ink-900 px-[4px] font-mono text-[9px] leading-[14px] text-mute-300">
          +{badge}
        </span>
      ) : null}
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
  /** 命令面板定位到这张卡片时框一下，1.8s 后自己退掉。 */
  flash?: boolean
}

/** MM-DD — the list view has room for a date, not for a timestamp. */
function lastUsed(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export function ItemCard({ item, layout, appsExist, openByKind, onActivate, onReveal, onMenu, flash }: CardProps) {
  const meta = KIND_META[item.kind]
  const press = longPress((pos) => onMenu(item, pos))
  const exist = appsExist ?? {}
  const { app: current } = resolveDefaultApp(item, exist, openByKind)
  const { dead } = liveCandidates(ownApps(item), exist)
  const extra = candidateApps(item, openByKind).filter((app) => app !== current && appInstalled(app, exist)).length
  const gesture =
    item.kind === 'snippet'
      ? '单击复制'
      : item.kind === 'command'
        ? '单击运行'
        : item.kind === 'app'
          ? '单击启动该应用'
          : `单击用${appNameOf(current)}打开${extra ? ` · 双击可选其他 ${extra} 个应用` : ' · 双击可换应用'}`
  const title = (
    <>
      <span
        className={`truncate font-medium text-paper ${layout === 'list' ? 'text-[13px]' : 'text-[14px] leading-[20px]'}`}
      >
        {item.name}
      </span>
      {/* 警示不能藏进 hover，但也不该和名称抢分量：比 chip 小一档，且不借用 chip 类免得覆盖打架。 */}
      {dead.length > 0 && (
        <span
          className="shrink-0 rounded-full border border-warn/40 px-[5px] text-[10px] leading-[14px] text-warn"
          title="候选里有未安装的应用，打开时会自动跳过"
        >
          {dead.length} 失效
        </span>
      )}
    </>
  )
  const value = (
    <span
      className={
        layout === 'list'
          ? 'min-w-0 flex-1 truncate font-mono text-[10.5px] text-mute-400'
          : 'mt-[7px] block truncate font-mono text-[11px] text-mute-400'
      }
    >
      {current && <span className="text-info/80">{appNameOf(current)} · </span>}
      {previewValue(item.value)}
    </span>
  )
  return (
    <button
      id={`card-${item.id}`}
      type="button"
      title={`${item.value}\n${item.note ? item.note + '\n' : ''}${gesture}${
        dead.length ? `（未安装：${dead.map(appNameOf).join('、')}）` : ''
      }`}
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
        ${layout === 'list' ? 'rounded-lg px-3 py-1.5' : 'rounded-(--radius-card) px-4 py-3.5'}
        ${flash ? 'bg-select ring-2 ring-accent' : ''}`}
    >
      <ItemIcon item={item} size={layout === 'list' ? 28 : 40} badge={layout === 'grid' ? extra : undefined} />
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
          {/* 最近日期只有 hover 的 tooltip 补充意义，窄屏先让位给名字和路径。 */}
          <span className="w-11 text-right font-mono text-[10px] text-mute-400 max-md:hidden">
            {item.lastUsedAt ? lastUsed(item.lastUsedAt) : '—'}
          </span>
        </span>
      ) : (
        <span className="chip shrink-0" style={{ color: meta.color }}>
          {meta.label}
        </span>
      )}
    </button>
  )
}
