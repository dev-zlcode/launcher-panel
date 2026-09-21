export type Kind = 'app' | 'folder' | 'file' | 'url' | 'snippet' | 'command'

export interface Item {
  id: string
  kind: Kind
  name: string
  /** English name kept beside a Chinese display name, for search. Absent when they coincide. */
  nameEn?: string
  value: string
  iconPath: string | null
  group: string
  tags: string[]
  pinned: boolean
  note: string
  openWith: string[]
  useCount: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt?: string
}

export interface DiscoverResult {
  kind: Kind
  name: string
  value: string
  /** Localized (中文) display name from Spotlight; present only when it differs from `name`. */
  displayName?: string
}

export interface AppEntry {
  name: string
  value: string
  displayName?: string
}

/** One group of the local app library. `apps` order *is* the displayed order. */
export interface LibraryGroup {
  name: string
  apps: string[]
  /** Scan-derived default group: the note explaining the rule. Any write turns it into a normal group. */
  auto?: string
  /** The catch-all: stored like any group (order + position), but its membership stays derived. */
  ungrouped?: boolean
}

/** GET /api/library — the configured scan joined with the stored assignments. */
export interface Library {
  /** Display name of the catch-all group; it appears in `groups` exactly once. */
  ungroupedName: string
  /** Names the derivation reserves; a stored group of one of these names is still an auto group in the UI. */
  autoGroupNames: string[]
  /**
   * For a reserved name a stored group already owns: the apps 「更新分组」 would add — what the rule
   * matches right now, in scan order, minus this group's members and anything another group claims.
   * Absent when the group already holds every match.
   */
  autoAdd: Record<string, string[]>
  groups: LibraryGroup[]
  /** Every scanned app, for path -> name lookup. */
  all: AppEntry[]
  /** Stored paths currently not scanned; hidden but kept. */
  stale: number
}

/** Kinds you open *with* another app; each holds one ordered list, first entry = default. */
export type OpenKind = 'folder' | 'file' | 'url'

/** Ordered app paths per kind. New items start from this list; empty means macOS decides. */
export type OpenByKind = Record<OpenKind, string[]>

/* ---------------------------------- view ---------------------------------- */

export type Layout = 'grid' | 'list'
/** Panel 分组轴. 'group' = item.group, 'kind' = the fixed KIND_META buckets, 'tag' = item.tags (one item can sit in several). */
export type PanelGroup = 'none' | 'group' | 'kind' | 'tag'
/** Panel 排序轴. 'manual' = items.json array order, i.e. what 「智能」 used to imply. */
export type PanelSort = 'manual' | 'name' | 'used' | 'recent'
export type LibGroup = 'none' | 'group' | 'dir'
/** Library apps carry no useCount, so 名称 is all there is to sort by besides the stored order. */
export type LibSort = 'manual' | 'name'

export interface PanelView {
  group: PanelGroup
  sort: PanelSort
  layout: Layout
  /** 侧栏收起：整条不渲染，主区占满。 */
  collapsed: boolean
}

export interface ManageView {
  group: LibGroup
  sort: LibSort
  layout: Layout
  collapsed: boolean
}

/** Both pages' 分组/排序/视图 + 侧栏收没收起. Config like any other — the panel's look survives a reload. */
export interface ViewPrefs {
  panel: PanelView
  manage: ManageView
}

/* ---------------------------------- theme ---------------------------------- */

/** 三档外观；'system' 跟着 macOS 走，是默认档。 */
export type ThemePref = 'system' | 'dark' | 'light'

export interface State {
  items: Item[]
  groups: string[]
  settings: {
    theme: ThemePref
    openByKind: OpenByKind
    terminals: string[]
    /** Always present in terminals; the UI hides their delete buttons. */
    defaultTerminals: string[]
    discoverDirs: string[]
    /** Always present in discoverDirs; the UI hides their delete buttons. */
    defaultDiscoverDirs: string[]
    view: ViewPrefs
  }
  /** Stored app path -> still installed on this machine. Absent keys are treated as installed. */
  appsExist: Record<string, boolean>
  /** Stored app path -> localized name, only where it differs from the basename. Feeds appNameOf. */
  appNames: Record<string, string>
}

export type SmartKey = 'all' | 'pinned' | 'recent' | 'frequent'

export interface Filter {
  scope: 'smart' | 'group' | 'kind' | 'tag'
  value: string
}

export interface ItemDraft {
  kind: Kind
  name: string
  nameEn?: string
  value: string
  group: string
  tags: string[]
  note: string
  pinned: boolean
  openWith?: string[]
}

/** What the panel remembers about one command's run, keyed by item id in memory. Never config. */
export interface RunMark {
  running: boolean
  /** null while it is still going, and null after a panel restart — the log file is the truth. */
  code: number | null
  at: number
}

/** One poll of a command's live output. `text` is the tail of data/runs/<id>.log, cleaned. */
export interface RunOutput {
  running: boolean
  startedAt: string | null
  code: number | null
  command: string
  text: string
  droppedBytes: number
}
