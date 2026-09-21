import { useEffect, type ReactNode } from 'react'

/**
 * The sidebar's overlay form for narrow screens. Only mounted when it should be open, and only on the narrow
 * side — on a desktop the same children stay a column, so nothing here has to know about that.
 */
export function NavDrawer({ label = '筛选', onClose, children }: { label?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" onPointerDown={onClose} />
      <div
        style={{ animation: 'slide-in 160ms ease-out' }}
        className="absolute inset-y-0 left-0 overflow-y-auto border-r border-ink-700 bg-ink-900 shadow-2xl shadow-shadow/70"
      >
        {children}
      </div>
    </div>
  )
}
