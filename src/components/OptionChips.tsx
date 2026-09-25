interface Props {
  /** Already filtered by the caller; order is the caller's. */
  options: string[]
  onPick: (option: string) => void
}

/**
 * Clickable candidates for a field that also takes free text: the row is the discoverable half of
 * "候选 + 新建", since a `<datalist>` only reveals itself after you have typed a prefix.
 */
export function OptionChips({ options, onPick }: Props) {
  if (!options.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(o)}
          className="chip max-w-full truncate border border-ink-600 bg-ink-800/70 transition hover:border-accent/60 hover:text-paper"
        >
          {o}
        </button>
      ))}
    </div>
  )
}
