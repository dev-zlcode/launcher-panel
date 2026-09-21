import type { ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * The native macOS caret is painted into the border box and ignores `padding-right`, so it sits
 * flush against the frame. Dropping `appearance` and drawing the caret is the only way to gap it.
 */
export function Select({
  value,
  onChange,
  title,
  className = '',
  children,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span className="relative inline-flex">
      <select
        value={value}
        onChange={onChange}
        title={title}
        className={`w-full appearance-none rounded-lg border border-ink-600 bg-ink-900/70 pl-2 pr-7 text-[12px] focus:border-accent focus:outline-none ${className}`}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={13}
        strokeWidth={2.2}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-mute-400"
      />
    </span>
  )
}
