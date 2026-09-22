import type { Item, OpenByKind, OpenKind } from './types'

/**
 * The one funnel every path-derived app label reads through (card default app, 打开方式 menus, chips,
 * toasts, terminal rows). Seeded once per page from the state's `appNames`; apps without a distinct
 * Chinese name simply aren't in here, so they keep falling back to the basename.
 */
let appZh: Record<string, string> = {}

/** Replace the whole localized-name table; pass the latest snapshot, it is not merged. */
export function primeAppNames(map: Record<string, string>): void {
  appZh = map ?? {}
}

/** "/Applications/Visual Studio Code.app" -> "Visual Studio Code", or its localized name when known. */
export function appNameOf(appPath: string | null): string {
  if (!appPath) return '系统默认'
  return appZh[appPath] ?? (appPath.replace(/\.app$/i, '').split('/').pop() || appPath)
}

/** Compact label for an item's candidate apps; '' means "系统默认". */
export function openWithLabel(apps: string[]): string {
  if (apps.length === 0) return ''
  if (apps.length === 1) return appNameOf(apps[0])
  if (apps.length === 2) return `${appNameOf(apps[0])}、${appNameOf(apps[1])}`
  return `${appNameOf(apps[0])} +${apps.length - 1}`
}

export type ExistMap = Record<string, boolean>

/** Apps the backend has not reported on are treated as installed, so opening never stalls on a gap. */
export function appInstalled(app: string, exist: ExistMap): boolean {
  return exist[app] !== false
}

/** Split stored candidates into what is still installed and what has to be skipped. */
export function liveCandidates(apps: string[], exist: ExistMap): { alive: string[]; dead: string[] } {
  const alive: string[] = []
  const dead: string[] = []
  for (const app of apps) (appInstalled(app, exist) ? alive : dead).push(app)
  return { alive, dead }
}

/** This kind's settings list; kinds with no per-type config get an empty one. */
export function kindApps(kind: Item['kind'], openByKind: OpenByKind): string[] {
  return openByKind[kind as OpenKind] ?? []
}

/**
 * Only these three can be opened *by* another app, so `app`/`snippet`/`command` have no candidates at
 * all — the editor hides them and the read side ignores whatever an old record still carries.
 * For `app` the server would run `open -a 候选 X.app` — handing one app to another as a document.
 */
export function canPickApps(kind: Item['kind']): boolean {
  return kind === 'folder' || kind === 'file' || kind === 'url'
}

/**
 * What a single click opens with: this kind's ordered pool (the item's own candidates, then its kind's
 * settings list) taken down to what is still installed — first live entry wins, otherwise null = macOS.
 * `dead` only counts what the item itself wrote, so a stale app in the shared type list is not this
 * card's problem.
 */
export function resolveDefaultApp(
  item: Item,
  exist: ExistMap,
  openByKind: OpenByKind,
): { app: string | null; dead: string[] } {
  const { alive } = liveCandidates(candidateApps(item, openByKind), exist)
  return { app: alive[0] ?? null, dead: liveCandidates(ownApps(item), exist).dead }
}

/** The item's own candidates — kinds that can't be opened by another app have none, however stale the record. */
export function ownApps(item: Item): string[] {
  return canPickApps(item.kind) ? item.openWith : []
}

/** Every app the chooser may offer: the item's own candidates, then this kind's list. */
export function candidateApps(item: Item, openByKind: OpenByKind): string[] {
  const out: string[] = []
  for (const app of [...ownApps(item), ...kindApps(item.kind, openByKind)]) {
    if (!out.includes(app)) out.push(app)
  }
  return out
}

/**
 * Menu rows for the terminals the user listed, in their order (settings.terminals, default Terminal +
 * iTerm). Nothing filters them: an entry he added deliberately stays visible and fails loudly.
 */
export function terminalRows(list: readonly string[]) {
  return list.map((p) => {
    const name = appNameOf(p)
    // Detect the built-in by its English basename, which the localized `name` may no longer equal.
    const en = p.replace(/\.app$/i, '').split('/').pop()
    // Terminal is the one people call 终端, so its row keeps the wording the menu shipped with.
    return en === 'Terminal'
      ? { path: p, name, open: '在终端中打开', run: '在终端中运行' }
      : { path: p, name, open: `用 ${name} 打开`, run: `用 ${name} 运行` }
  })
}
