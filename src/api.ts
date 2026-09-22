import type { AppEntry, DiscoverResult, Item, ItemDraft, Library, LibraryGroup, ManageView, OpenByKind, PanelView, RunOutput, State, ThemePref } from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(String(data.error ?? `${res.status} ${res.statusText}`))
  return data as T
}

const post = <T,>(url: string, body: unknown) =>
  request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export const api = {
  state: () => request<State>('/api/state'),
  create: (draft: ItemDraft) => request<{ item: Item }>('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) }),
  update: (id: string, draft: Partial<ItemDraft>) => request<{ item: Item }>(`/api/items/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) }),
  remove: (id: string) => request<{ ok: true }>(`/api/items/${id}`, { method: 'DELETE' }),
  use: (id: string) => request<{ item: Item }>(`/api/items/${id}/use`, { method: 'POST', body: '{}' }),
  open: (kind: Item['kind'], value: string, app?: string | null) => post<{ ok: true; usedApp: string | null }>('/api/open', { kind, value, app }),
  apps: () => request<{ apps: AppEntry[] }>('/api/apps'),
  /** The local app library: scanned apps with their group assignment and manual order. */
  library: () => request<Library>('/api/library'),
  /** Whole-table replace — group order and each group's app order travel as array order. */
  patchLibrary: (groups: LibraryGroup[]) =>
    request<Library>('/api/library', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups }),
    }),
  /** One settings patch: replace a kind's whole ordered list, the terminal list, the discover dirs, one page's view, or the theme. */
  patchSettings: (patch: {
    theme?: ThemePref
    openByKind?: Partial<OpenByKind>
    terminals?: string[]
    discoverDirs?: string[]
    /** Only the page present is replaced; a field inside it that is absent keeps its stored value. */
    view?: { panel?: Partial<PanelView>; manage?: Partial<ManageView> }
  }) =>
    request<{ settings: State['settings'] }>('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  reveal: (value: string) => post<{ ok: true }>('/api/reveal', { value }),
  /** `app` is a .app path from the terminal list; the server refuses anything not on it. */
  terminal: (value: string, app: string) => post<{ ok: true }>('/api/terminal', { value, app }),
  copy: (text: string) => post<{ ok: true }>('/api/copy', { text }),
  /**
   * Starts a stored `command` item in the background and returns at once; output goes to its log file.
   * `restart` stops the run this server started first — without it a live run answers 409.
   * `stop` only stops: no new run, and the log stays put.
   */
  run: (id: string, mode?: 'restart' | 'stop') =>
    post<{ ok: true }>('/api/run', mode ? { id, [mode]: true } : { id }),
  /** Live tail of one command's run. Poll this while the output view is open. */
  runOutput: (id: string) => request<RunOutput>(`/api/runs/${id}`),
  /** The same item, but a terminal app owns the window, the output and how long it lives. */
  runInTerminal: (id: string, app: string) => post<{ ok: true; launched: string }>('/api/run', { id, app }),
  discover: (q: string, limit = 120) =>
    request<{ total: number; results: DiscoverResult[]; dirs: string[] }>(`/api/discover?q=${encodeURIComponent(q)}&limit=${limit}`),
  import: (items: DiscoverResult[], group: string) => post<{ added: number; items: Item[] }>('/api/import', { items, group }),
  /** Native chooser for things with no list to search; apps come from `apps()` instead. */
  pick: (kind: 'folder' | 'file') =>
    post<{ cancelled: boolean; value?: string; kind?: Item['kind']; name?: string }>('/api/pick', { kind }),
  enrich: (p: string) => request<{ iconUrl: string | null }>(`/api/enrich?path=${encodeURIComponent(p)}`),
}
