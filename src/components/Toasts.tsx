export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error' | 'ok'
  /** Clicking any toast dismisses it; with an action it also runs that first. */
  action?: () => void
}

const TONE: Record<Toast['tone'], string> = {
  info: 'border-ink-500 text-paper',
  ok: 'border-ok/50 text-ok',
  error: 'border-danger/50 text-danger',
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            t.action?.()
            onDismiss(t.id)
          }}
          style={{ animation: 'pop-in 160ms ease-out' }}
          className={`card-surface pointer-events-auto max-w-lg rounded-lg border px-3.5 py-2 text-[12.5px] shadow-xl shadow-shadow/50 ${TONE[t.tone]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
