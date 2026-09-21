import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(SERVER_DIR)
const DATA_DIR = path.join(ROOT, 'data')
const ICON_DIR = path.join(DATA_DIR, 'icons')
const DB_FILE = path.join(DATA_DIR, 'items.json')
const ICON_SCRIPT = path.join(SERVER_DIR, 'icon.jxa')

const KINDS = new Set(['app', 'folder', 'file', 'url', 'snippet', 'command'])

/** Kinds you open *with* another app; each holds one ordered list that new items of that kind start from. */
const OPEN_KINDS = ['folder', 'file', 'url']

/** What 「可用终端」 always contains — the system's own Terminal, not deletable. iTerm and friends are for the user to add. */
const DEFAULT_TERMINALS = ['/System/Applications/Utilities/Terminal.app']

// Recursive .app collection under these dirs (depth- and entry-capped), shared by
// 「发现应用」 and the open-with picker. No Utilities entries: the scan already descends.
const DEFAULT_DISCOVER_DIRS = [
  '/Applications',
  path.join(os.homedir(), 'Applications'),
  '/System/Applications',
]
const COMMON_FOLDERS = [
  ['Home', os.homedir()],
  ['Desktop', path.join(os.homedir(), 'Desktop')],
  ['Documents', path.join(os.homedir(), 'Documents')],
  ['Downloads', path.join(os.homedir(), 'Downloads')],
].filter(([, p]) => p)

const COMMON_URLS = [
  ['GitHub', 'https://github.com/'],
  ['Gmail', 'https://mail.google.com'],
]

const COMMON_APPS = [
  ['Terminal', '/System/Applications/Utilities/Terminal.app'],
]

/** Read-side cleanup for directory lists: absolute, deduped, never throws on a hand-edited file. */
function readDirList(list) {
  if (!Array.isArray(list)) return []
  const out = list
    .filter((v) => typeof v === 'string' && v.trim() && v.length < 4096)
    // Relative paths would resolve against the server cwd — drop them rather than guess.
    .map((v) => (expandHome(v.trim()).startsWith('/') ? path.resolve(expandHome(v.trim())) : null))
    .filter(Boolean)
  return [...new Set(out)]
}

/* -------------------------------- app library ------------------------------ */

/** The catch-all bucket's name. It is virtual (derived at read time) so it can never be a stored group name. */
const LIB_UNGROUPED = '未分组'
/**
 * A default group derived from the scan while no stored group owns the name: everything Apple wrote
 * (see `isAppleApp`), with the SIP volume prefix as a cheap first test. The first write that carries
 * it stores the snapshot, so dragging one card out turns the whole group into an ordinary, hand-editable one.
 */
const LIB_SYSTEM = '系统工具'
const SYSTEM_VOLUME = '/System/'
const LIB_SETAPP = 'Setapp'
const SETAPP_VOLUME = '/Applications/Setapp/'
/**
 * Third-party apps that ship an Xcode source-editor extension (see `isXcodePlugin`). The name matches
 * the extension point's own wording so a hand-made group called 「Xcode 插件」 reads as the same thing.
 */
const LIB_XCODE = 'Xcode 插件'
const XCODE_SOURCE_EDITOR_POINT = 'com.apple.dt.Xcode.extension.source-editor'
const LIB_MAX_GROUPS = 20
const LIB_MAX_APPS = 3000

/**
 * Read-side shape repair for `appLib`: a broken group is dropped, never thrown over.
 * `names` doubles as the "at most one 未分组" guard — a second one is a hand-edit artifact.
 */
function readAppLib(raw) {
  const groups = []
  const names = new Set()
  const paths = new Set()
  for (const g of Array.isArray(raw?.groups) ? raw.groups : []) {
    const name = String(g?.name ?? '').trim().slice(0, 40)
    if (!name || names.has(name)) continue
    names.add(name)
    const apps = []
    for (const v of Array.isArray(g?.apps) ? g.apps : []) {
      const p = typeof v === 'string' && v.trim() ? path.resolve(expandHome(v.trim())) : null
      if (!p || paths.has(p)) continue
      paths.add(p)
      apps.push(p)
    }
    groups.push({ name, apps })
  }
  return { groups: groups.slice(0, LIB_MAX_GROUPS) }
}

/**
 * Whole-table replace: the payload *is* the library, so group order and each group's app order
 * travel as array order — same convention as the per-kind open-with lists.
 */
function normalizeLibrary(input) {
  const bad = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 })
  }
  if (!Array.isArray(input)) bad('groups 需要是 [{ name, apps: [.app 路径…] }]')
  // The catch-all rides along on every write, so the cap counts only the user's own groups.
  if (input.filter((g) => String(g?.name ?? '').trim() !== LIB_UNGROUPED).length > LIB_MAX_GROUPS) bad(`最多 ${LIB_MAX_GROUPS} 个分组`)
  const names = new Set()
  const seen = new Set()
  let sawUngrouped = false
  let total = 0
  const groups = input.map((g) => {
    if (!g || typeof g !== 'object' || Array.isArray(g)) bad('分组需要是 { name, apps }')
    const name = String(g.name ?? '').trim()
    if (!name) bad('分组名不能为空')
    if (name.length > 40) bad('分组名最长 40 字')
    if (name === LIB_UNGROUPED && sawUngrouped) bad(`「${LIB_UNGROUPED}」只能有一个`)
    if (name === LIB_UNGROUPED) sawUngrouped = true
    if (names.has(name)) bad(`已有分组「${name}」`)
    names.add(name)
    if (!Array.isArray(g.apps)) bad(`分组「${name}」的 apps 需要是路径数组`)
    const apps = []
    for (const v of g.apps) {
      const raw = String(v ?? '').trim()
      if (!raw) bad('路径不能为空')
      if (!/\.app$/i.test(raw)) bad(`需要是 .app 路径: ${raw}`)
      const p = path.resolve(expandHome(raw))
      if (seen.has(p)) bad(`同一 App 不能出现在多个分组: ${p}`)
      seen.add(p)
      apps.push(p)
    }
    total += apps.length
    if (total > LIB_MAX_APPS) bad(`最多 ${LIB_MAX_APPS} 个 App`)
    return { name, apps }
  })
  return groups
}

/* ----------------------------------- view ---------------------------------- */

/**
 * Both pages' 分组/排序/视图 plus whether their sidebar is folded away. Stored like any other setting.
 * The default is the pre-split 「智能」: group by the user's own groups, keep the stored array order,
 * show cards, sidebar open.
 */
const DEFAULT_VIEW = { group: 'group', sort: 'manual', layout: 'grid', collapsed: false }
const LAYOUT_KEYS = ['grid', 'list']
const VIEW_KEYS = {
  panel: { group: ['none', 'group', 'kind', 'tag'], sort: ['manual', 'name', 'used', 'recent'] },
  manage: { group: ['none', 'group', 'dir'], sort: ['manual', 'name'] },
}

/** An unknown value falls back rather than throwing — a hand-edited items.json must not take the panel down. */
function readViewPage(raw, keys) {
  const pick = (v, allowed, fb) => (allowed.includes(v) ? v : fb)
  return {
    group: pick(raw?.group, keys.group, DEFAULT_VIEW.group),
    sort: pick(raw?.sort, keys.sort, DEFAULT_VIEW.sort),
    layout: pick(raw?.layout, LAYOUT_KEYS, DEFAULT_VIEW.layout),
    collapsed: raw?.collapsed === true,
  }
}

function readView(raw) {
  return { panel: readViewPage(raw?.panel, VIEW_KEYS.panel), manage: readViewPage(raw?.manage, VIEW_KEYS.manage) }
}

/* ----------------------------------- theme ---------------------------------- */

const THEME_KEYS = ['system', 'dark', 'light']
const DEFAULT_THEME = 'system'

/** Same fall-back-not-throw policy as the view axes: a hand-edited items.json must not take the panel down. */
function readTheme(raw) {
  return THEME_KEYS.includes(raw) ? raw : DEFAULT_THEME
}

/**
 * The served HTML has to carry the theme. A static `data-theme="dark"` paints the whole page dark until
 * the bundle runs and /api/state answers, which reads as a flash on every reload. Sync read because this
 * runs while the response is being built; 跟随系统 resolves in the browser, since only it knows the OS look.
 */
function themeBootstrapScript() {
  let pref = DEFAULT_THEME
  try {
    pref = readTheme(JSON.parse(fsSync.readFileSync(DB_FILE, 'utf8')).theme)
  } catch {
    // items.json missing or mid-write: the API will hand back the same default a moment later
  }
  const p = JSON.stringify(pref)
  return `(function(){var e=document.documentElement,d=${p};e.dataset.themePref=d;e.dataset.theme=d==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):d})()`
}

export function withThemeBootstrap(html) {
  return html.replace('</head>', `<script>${themeBootstrapScript()}</script></head>`)
}

/** The settings block both /api/state and PATCH /api/settings hand back; one shape, two callers. */
function settingsPayload(db) {
  return {
    theme: db.theme,
    openByKind: db.openByKind,
    terminals: db.terminals,
    defaultTerminals: DEFAULT_TERMINALS,
    discoverDirs: db.discoverDirs,
    defaultDiscoverDirs: DEFAULT_DISCOVER_DIRS,
    view: db.view,
  }
}

function defaultDb() {
  const items = [
    ...COMMON_FOLDERS.map(([name, p], i) => mkDiscovered('folder', name, p, i)),
    ...COMMON_URLS.map(([name, u], i) => mkDiscovered('url', name, u, i + 100)),
    ...COMMON_APPS.map(([name, p], i) => mkDiscovered('app', name, p, i + 200)),
  ]
  return { version: 1, theme: DEFAULT_THEME, items, tags: {}, openByKind: emptyOpenByKind(), terminals: [...DEFAULT_TERMINALS], discoverDirs: [...DEFAULT_DISCOVER_DIRS], appLib: { groups: [] }, view: readView() }
}

function emptyOpenByKind() {
  return Object.fromEntries(OPEN_KINDS.map((kind) => [kind, []]))
}

function mkDiscovered(kind, name, value, order) {
  return {
    id: randomUUID(),
    kind,
    name,
    value,
    iconPath: kind === 'url' ? null : value,
    group: '默认',
    tags: ['种子'],
    pinned: order < 4,
    useCount: 0,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    note: '',
    // ItemCard iterates this; a seed without it blanks the built panel on a first run.
    openWith: [],
  }
}

let dbCache = null
let saving = Promise.resolve()

async function loadDb() {
  if (dbCache) return dbCache
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.mkdir(ICON_DIR, { recursive: true })
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.items)) throw new Error('bad shape')
    parsed.tags ??= {}
    // Shape only — a path whose app has since been uninstalled stays put so the UI can report it as 失效.
    const legacyPool = Array.isArray(parsed.apps) ? parsed.apps : []
    delete parsed.apps
    const legacyByKind = parsed.appsByKind ?? {}
    delete parsed.appsByKind
    const stored = parsed.openByKind ?? {}
    parsed.openByKind = {}
    for (const kind of OPEN_KINDS) {
      const entry = stored[kind]
      // Earlier shapes: { default, candidates }, before that one bare array per kind.
      const list = cleanAppList(Array.isArray(entry) ? entry : [entry?.default, ...cleanAppList(entry?.candidates)])
      parsed.openByKind[kind] = list.length ? list : cleanAppList(legacyByKind[kind] ?? legacyPool)
    }
    // Absent means an older file. The default dirs are always on; the rest is the user's list.
    parsed.terminals = [...new Set([...readAppList(parsed.terminals), ...DEFAULT_TERMINALS])]
    parsed.discoverDirs = [...new Set([...readDirList(parsed.discoverDirs), ...DEFAULT_DISCOVER_DIRS])]
    // Absent on an older file → empty library, i.e. every scanned app lands in 未分组.
    parsed.appLib = readAppLib(parsed.appLib)
    // Absent on an older file → the default view, i.e. what 「智能」 used to mean.
    parsed.view = readView(parsed.view)
    // Absent on an older file → 跟随系统.
    parsed.theme = readTheme(parsed.theme)
    for (const item of parsed.items) {
      if (typeof item.openWith === 'string') item.openWith = item.openWith ? [item.openWith] : []
      if (!Array.isArray(item.openWith)) item.openWith = []
      // Anything landing on disk must not be trusted: the id becomes a runs/ filename (and a chmod +x
      // .command) in /api/run, so one with a slash or dots escapes it. A fresh UUID cannot collide with
      // an existing id, and useCount/lastUsedAt survive — only the file path the id encoded is lost.
      if (typeof item.id !== 'string' || !/^[\w-]{8,64}$/.test(item.id)) item.id = randomUUID()
      if (!KINDS.has(item.kind)) item.kind = 'file'
      if (!Array.isArray(item.tags)) item.tags = []
    }
    dbCache = parsed
    return dbCache
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // The file is about to be replaced by the seed — keep the bytes, a parse error is not empty.
      const bad = `${DB_FILE}.corrupt-${Date.now()}`
      await fs.copyFile(DB_FILE, bad).catch(() => {})
      console.warn('[launcher] items.json unreadable, reseeded; previous file kept at', bad, ':', err.message)
    }
    dbCache = defaultDb()
    await flushDb()
    return dbCache
  }
}

async function flushDb() {
  const snapshot = JSON.stringify(dbCache, null, 2)
  saving = saving.then(async () => {
    const tmp = DB_FILE + '.tmp'
    await fs.writeFile(tmp, snapshot, 'utf8')
    await fs.rename(tmp, DB_FILE)
  }).catch((err) => console.error('[launcher] save failed', err))
  return saving
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeout ?? 15000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err && !opts.allowFail) reject(err)
      else resolve(stdout ?? '')
    })
  })
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 })
  }
}

function isSafePath(p) {
  return typeof p === 'string' && p.length > 0 && p.length < 4096
}

function requireAppPath(value, label = '应用') {
  const raw = String(value ?? '').trim()
  if (!/\.app$/i.test(raw)) throw Object.assign(new Error(`${label}必须指向 .app`), { status: 400 })
  const resolved = path.resolve(expandHome(raw))
  if (!fsSync.existsSync(resolved)) throw Object.assign(new Error(`${label}不存在: ${resolved}`), { status: 404 })
  return resolved
}

/**
 * Shape check only, for values we *store* rather than launch: an app uninstalled after the fact
 * must stay in the config so the UI can flag it as 失效 instead of the save failing outright.
 */
function appRefShape(value, label = '应用') {
  const raw = String(value ?? '').trim()
  if (!/\.app$/i.test(raw)) throw Object.assign(new Error(`${label}必须指向 .app`), { status: 400 })
  return path.resolve(expandHome(raw))
}

/** Read-side cleanup: never rejects, so a hand-edited items.json can't make the whole panel unreadable. */
function cleanAppList(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter((a) => typeof a === 'string' && a.trim()))]
}

/** Same, but resolved to absolute paths and with anything that isn't a .app dropped rather than thrown. */
function readAppList(list) {
  return cleanAppList(list)
    .map((v) => (/\.app$/i.test(v.trim()) ? path.resolve(expandHome(v.trim())) : null))
    .filter(Boolean)
}

/** `current` is the item's existing candidate array — callers pass item.openWith. */
function normalizeOpenWith(input, current) {
  if (input === undefined) return current ?? []
  if (input === null || input === '') return []
  const list = Array.isArray(input) ? input : [input]
  return [...new Set(list.filter(Boolean).map((v) => appRefShape(v, '候选应用')))].slice(0, 12)
}

/**
 * One kind's ordered list: the first app is the default, an empty list means "let macOS decide".
 * The whole list is replaced on every write — order is the payload's business.
 */
function normalizeKindList(input) {
  if (input === null) return []
  if (!Array.isArray(input)) {
    throw Object.assign(new Error('每类的打开方式需要是应用数组，第一个为默认'), { status: 400 })
  }
  return normalizeOpenWith(input, [])
}

function expandHome(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

/* ---------------------------------- items --------------------------------- */

function normalizeItem(input, existing, openByKind) {
  const kind = KINDS.has(input.kind) ? input.kind : existing?.kind ?? 'file'
  const value = String(input.value ?? existing?.value ?? '').trim()
  if (!value) throw Object.assign(new Error('value is required'), { status: 400 })
  const isFs = kind === 'app' || kind === 'folder' || kind === 'file'
  const resolved = isFs ? path.resolve(expandHome(value)) : value
  const base = resolved.replace(/\/$/, '')
  const guess = kind === 'url' ? value : kind === 'command' ? value.split(/\s+/)[0] : path.basename(base)
  const name = String(input.name ?? existing?.name ?? '').trim() || guess || value
  const nameEn = String(input.nameEn ?? '').trim()
  const picked = normalizeOpenWith(input.openWith, existing?.openWith)
  return {
    ...(existing ?? {}),
    id: existing?.id ?? randomUUID(),
    kind,
    name,
    // English record rides alongside the (possibly Chinese) display name; cleared once they coincide.
    nameEn: nameEn && nameEn !== name ? nameEn : undefined,
    value: resolved,
    iconPath: isFs ? resolved : null,
    group: String(input.group ?? existing?.group ?? '默认').trim() || '默认',
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(String).filter(Boolean))].slice(0, 24) : existing?.tags ?? [],
    pinned: typeof input.pinned === 'boolean' ? input.pinned : existing?.pinned ?? false,
    note: String(input.note ?? existing?.note ?? '').slice(0, 2000),
    // A brand-new item inherits its kind's list once; from then on the two are managed separately.
    openWith: !existing && openByKind && !picked.length ? cleanAppList(openByKind[kind]) : picked,
    useCount: existing?.useCount ?? 0,
    lastUsedAt: existing?.lastUsedAt ?? null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/** Every app path the panel might show: items, the per-kind lists, and the terminal list. */
function referencedApps(db) {
  const set = new Set(db.terminals ?? [])
  for (const list of Object.values(db.openByKind ?? {})) for (const app of list ?? []) set.add(app)
  for (const item of db.items) for (const app of item.openWith ?? []) set.add(app)
  return [...set].filter(Boolean)
}

async function hState(req, res) {
  const db = await loadDb()
  const refs = referencedApps(db)
  const appsExist = Object.fromEntries(refs.map((app) => [app, fsSync.existsSync(expandHome(app))]))
  // Chain B labels (card default app, menus, badges, toasts, terminal rows) only ever see these paths;
  // resolving their localized names here lets the panel render Chinese on the first frame.
  const appNames = buildAppNameMap(refs, await localizedNames(refs))
  json(res, 200, {
    items: db.items,
    tags: db.tags,
    settings: settingsPayload(db),
    appsExist,
    appNames,
    groups: [...new Set(db.items.map((i) => i.group))].sort(),
  })
}

async function hPatchSettings(req, res) {
  const body = await readBody(req)
  const db = await loadDb()
  const patch = body.openByKind
  if (patch !== undefined) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw Object.assign(new Error('openByKind 需要是 { folder | file | url: [应用路径…] }'), { status: 400 })
    }
    // Validate the whole patch before touching dbCache, so a bad kind can't half-apply.
    const next = Object.entries(patch).map(([kind, input]) => {
      if (!OPEN_KINDS.includes(kind)) throw Object.assign(new Error(`没有「${kind}」这类打开方式配置`), { status: 400 })
      return [kind, normalizeKindList(input)]
    })
    for (const [kind, list] of next) db.openByKind[kind] = list
  }
  if (body.terminals !== undefined) {
    if (!Array.isArray(body.terminals)) throw Object.assign(new Error('终端清单需要是 [.app 路径…]'), { status: 400 })
    // Capped because every entry becomes a right-click row in two menus; the system Terminal is always on.
    db.terminals = [...new Set([...body.terminals.map((v) => appRefShape(v, '终端')), ...DEFAULT_TERMINALS])].slice(0, 8)
  }
  if (body.discoverDirs !== undefined) {
    if (!Array.isArray(body.discoverDirs)) throw Object.assign(new Error('扫描路径需要是目录路径数组'), { status: 400 })
    const bad = body.discoverDirs.find((v) => typeof v !== 'string' || !v.trim() || !expandHome(v.trim()).startsWith('/'))
    if (bad !== undefined) throw Object.assign(new Error('扫描路径需要是 / 或 ~/ 开头的绝对路径'), { status: 400 })
    // The default dirs are the machine's own app locations — always on, not deletable.
    db.discoverDirs = [...new Set([...readDirList(body.discoverDirs), ...DEFAULT_DISCOVER_DIRS])].slice(0, 12)
    // /api/apps scans the same list now — drop the memo so the picker follows immediately.
    appsCache = { at: 0, list: [] }
  }
  if (body.view !== undefined) {
    const bad = (msg) => {
      throw Object.assign(new Error(msg), { status: 400 })
    }
    if (!body.view || typeof body.view !== 'object' || Array.isArray(body.view)) bad('view 需要是 { panel | manage: { group, sort, layout, collapsed } }')
    // A page name nothing can render is a contract violation, unlike a bad leaf value — those just fall back.
    for (const k of Object.keys(body.view)) if (k !== 'panel' && k !== 'manage') bad(`没有「${k}」这一页的视图配置`)
    for (const page of ['panel', 'manage']) {
      const v = body.view[page]
      if (v === undefined) continue
      if (!v || typeof v !== 'object' || Array.isArray(v)) bad(`view.${page} 需要是 { group, sort, layout, collapsed }`)
      // Merged over the stored page, so a PATCH that names only `layout` keeps `group` and `sort`,
      // and the two pages can't clobber each other.
      db.view[page] = readViewPage({ ...db.view[page], ...v }, VIEW_KEYS[page])
    }
  }
  if (body.theme !== undefined) {
    if (!THEME_KEYS.includes(body.theme)) {
      throw Object.assign(new Error(`theme 需要是 ${THEME_KEYS.join(' | ')}`), { status: 400 })
    }
    db.theme = body.theme
  }
  await flushDb()
  json(res, 200, { settings: settingsPayload(db) })
}

async function hCreateItem(req, res) {
  const db = await loadDb()
  const body = await readBody(req)
  const item = normalizeItem(body, null, db.openByKind)
  if (db.items.some((i) => i.kind === item.kind && i.value === item.value)) {
    throw Object.assign(new Error('该项已存在'), { status: 409 })
  }
  db.items.push(item)
  await flushDb()
  json(res, 200, { item })
}

async function hPatchItem(req, res, { id }) {
  const db = await loadDb()
  const existing = db.items.find((i) => i.id === id)
  if (!existing) throw Object.assign(new Error('not found'), { status: 404 })
  const body = await readBody(req)
  const item = normalizeItem(body, existing)
  Object.assign(existing, item)
  await flushDb()
  json(res, 200, { item })
}

async function hDeleteItem(req, res, { id }) {
  const db = await loadDb()
  const before = db.items.length
  db.items = db.items.filter((i) => i.id !== id)
  if (db.items.length === before) throw Object.assign(new Error('not found'), { status: 404 })
  await flushDb()
  json(res, 200, { ok: true })
}

async function hUse(req, res, { id }) {
  const db = await loadDb()
  const item = db.items.find((i) => i.id === id)
  if (!item) throw Object.assign(new Error('not found'), { status: 404 })
  item.useCount += 1
  item.lastUsedAt = new Date().toISOString()
  await flushDb()
  json(res, 200, { item })
}

/* --------------------------------- actions -------------------------------- */

async function hOpen(req, res) {
  const body = await readBody(req)
  const { kind, value } = body
  if (!isSafePath(value)) throw Object.assign(new Error('bad value'), { status: 400 })
  if (kind === 'snippet') return json(res, 200, { ok: true, note: 'snippet 走复制' })
  if (kind === 'command') throw Object.assign(new Error('命令条目要用「运行」'), { status: 400 })
  const app = body.app ? requireAppPath(body.app, '打开方式') : null

  if (kind === 'url' || /^https?:\/\//i.test(value)) {
    if (!/^https?:\/\//i.test(value)) throw Object.assign(new Error('只允许 http/https'), { status: 400 })
    await run('open', app ? ['-a', app, value] : [value])
    return json(res, 200, { ok: true })
  }

  const target = expandHome(value)
  if (!fsSync.existsSync(target)) throw Object.assign(new Error(`路径不存在: ${target}`), { status: 404 })
  await run('open', app ? ['-a', app, target] : [target])
  json(res, 200, { ok: true, usedApp: app })
}

async function hReveal(req, res) {
  const body = await readBody(req)
  if (!isSafePath(body.value)) throw Object.assign(new Error('bad value'), { status: 400 })
  const target = expandHome(body.value)
  if (!fsSync.existsSync(target)) throw Object.assign(new Error(`路径不存在: ${target}`), { status: 404 })
  await run('open', ['-R', target])
  json(res, 200, { ok: true })
}

/**
 * The one gate for "may we launch this app at something": it has to be an entry the user put in
 * 「可用终端」. Both terminal paths (folder menu and command menu) go through it, so a request can
 * name an app but never a fresh one.
 */
function terminalApp(db, requested) {
  const raw = String(requested ?? '').trim()
  if (!raw) throw Object.assign(new Error('缺少终端应用'), { status: 400 })
  const resolved = /\.app$/i.test(raw) ? path.resolve(expandHome(raw)) : null
  if (!resolved || !(db.terminals ?? []).includes(resolved)) {
    throw Object.assign(new Error('这个应用不在「可用终端」清单里'), { status: 400 })
  }
  if (!fsSync.existsSync(resolved)) throw Object.assign(new Error(`终端应用不存在：${resolved}`), { status: 404 })
  return resolved
}

async function hTerminal(req, res) {
  const body = await readBody(req)
  if (!isSafePath(body.value)) throw Object.assign(new Error('bad value'), { status: 400 })
  const db = await loadDb()
  const app = terminalApp(db, body.app)
  let target = expandHome(body.value)
  const stat = await fs.stat(target).catch(() => null)
  if (stat?.isFile()) target = path.dirname(target)
  if (!fsSync.existsSync(target)) throw Object.assign(new Error(`路径不存在: ${target}`), { status: 404 })
  await run('open', ['-a', app, target])
  json(res, 200, { ok: true })
}

async function hCopy(req, res) {
  const body = await readBody(req)
  const text = String(body.text ?? '')
  await new Promise((resolve, reject) => {
    const child = spawn('pbcopy')
    child.on('error', reject)
    child.on('close', resolve)
    child.stdin.end(text)
  })
  json(res, 200, { ok: true, length: text.length })
}

/* --------------------------------- commands --------------------------------- */

const SHELL_NOISE = /job control|terminal process group|TIOCGPGRP|not a tty/i

/**
 * Strip ANSI and the shell's own complaints. Shared by the live output view, so what you see in the
 * panel is what the log file says minus the noise.
 */
function cleanOutput(text) {
  const lines = String(text)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !SHELL_NOISE.test(l))
  const kept = lines.slice(-400).join('\n')
  return kept.length > 40000 ? `…\n${kept.slice(-40000)}` : kept
}

const RUNS_DIR = path.join(DATA_DIR, 'runs')
const logPathOf = (id) => path.join(RUNS_DIR, `${id}.log`)

/** id → { child, startedAt }. In-memory on purpose: the .log files survive a restart, this doesn't. */
const liveRuns = new Map()
/** Exit codes of runs this process saw finish, so the view can say 退出码 1 right after it ends. */
const finishedRuns = new Map()

/**
 * A `.command` file is the one door all three terminals share — Warp ships no AppleScript dictionary,
 * so there is no scripting path that covers it. It lands next to items.json so you can read back
 * exactly what got run.
 */
async function commandScript(item) {
  await fs.mkdir(RUNS_DIR, { recursive: true })
  const file = path.join(RUNS_DIR, `${item.id}.command`)
  const who = String(item.name).replace(/\s+/g, ' ')
  // `-i` in the shebang is what makes his rc functions (`killport`) exist before the body runs.
  await fs.writeFile(file, `#!/bin/zsh -i\n# 条目「${who}」(${item.id}) · launcher-panel 生成\n${item.value}\n`, 'utf8')
  await fs.chmod(file, 0o755)
  return file
}

/**
 * The only path from a stored string to a shell: the request carries an item id, never a command,
 * so another local page can trigger entries that exist but cannot inject one that doesn't.
 *
 * Output goes to a file descriptor rather than a pipe: a resident command (`dsh web`) outlives the
 * request that started it, and a pipe breaks the moment this middleware reloads.
 */
async function hRun(req, res) {
  const body = await readBody(req)
  const db = await loadDb()
  const item = db.items.find((i) => i.id === body.id && i.kind === 'command')
  if (!item) throw Object.assign(new Error('没有这条命令条目'), { status: 404 })
  if (body.app) {
    const app = terminalApp(db, body.app)
    // Nothing to capture: the terminal owns the window, the output and how long it lives.
    await run('open', ['-a', app, await commandScript(item)])
    json(res, 200, { ok: true, launched: app })
    return
  }
  if (liveRuns.has(item.id)) throw Object.assign(new Error('这条命令正在运行中'), { status: 409 })
  await fs.mkdir(RUNS_DIR, { recursive: true })
  // Truncate: the log always holds exactly the run you are looking at.
  const fd = fsSync.openSync(logPathOf(item.id), 'w')
  // -i so functions and aliases from the rc files exist; `killport` is a function, not a binary.
  const child = spawn(process.env.SHELL || '/bin/zsh', ['-i', '-c', item.value], {
    cwd: os.homedir(),
    stdio: ['ignore', fd, fd],
    env: { ...process.env, TERM: 'dumb' },
  })
  fsSync.closeSync(fd)
  const startedAt = new Date().toISOString()
  liveRuns.set(item.id, { child, startedAt })
  finishedRuns.delete(item.id)
  child.on('exit', (code, signal) => {
    liveRuns.delete(item.id)
    finishedRuns.set(item.id, { code, signal, endedAt: new Date().toISOString() })
    if (code !== 0) return
    // His rule: only a clean exit counts as a use. The panel picks it up on its next refresh.
    item.useCount += 1
    item.lastUsedAt = new Date().toISOString()
    flushDb().catch((err) => console.error('[launcher] use count save failed', err))
  })
  json(res, 200, { ok: true, started: true, command: item.value, log: logPathOf(item.id) })
}

/** Tail of one command's log, plus whether it is live right now. Read-only; id only, like /api/run. */
async function hRunOutput(req, res, { id }) {
  const db = await loadDb()
  const item = db.items.find((i) => i.id === id && i.kind === 'command')
  if (!item) throw Object.assign(new Error('没有这条命令条目'), { status: 404 })
  const TAIL = 64 * 1024
  const file = logPathOf(id)
  const size = (await fs.stat(file).catch(() => null))?.size ?? 0
  const from = Math.max(0, size - TAIL)
  let text = ''
  if (size) {
    const buf = Buffer.alloc(size - from)
    const fh = await fs.open(file, 'r')
    try {
      await fh.read(buf, 0, buf.length, from)
    } finally {
      await fh.close()
    }
    text = buf.toString('utf8')
  }
  const live = liveRuns.get(id)
  const done = finishedRuns.get(id)
  json(res, 200, {
    running: !!live,
    startedAt: live?.startedAt ?? done?.endedAt ?? null,
    code: live ? null : (done?.code ?? null),
    command: item.value,
    text: cleanOutput(text),
    // How many bytes of this run's output the panel didn't send; the file itself has all of it.
    droppedBytes: from,
  })
}

/* -------------------------------- discover -------------------------------- */

// One recursive scan feeds both 「发现应用」 and the open-with picker (/api/apps).
async function readDirEntries(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

const APP_MAX_DEPTH = 8
const APP_ENTRY_BUDGET = 20_000

/** All .app bundles at any depth under the configured dirs; first hit per name wins. */
async function collectApps(dirs) {
  const found = new Map()
  let visited = 0
  const walk = async (dir, depth) => {
    if (visited >= APP_ENTRY_BUDGET || depth > APP_MAX_DEPTH) return
    const entries = await readDirEntries(dir)
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.name.endsWith('.app')) {
        // Symlinked bundles (Homebrew casks) count too; never descend into a bundle.
        if (!(e.isDirectory() || e.isSymbolicLink())) continue
        const name = e.name.replace(/\.app$/, '')
        if (!found.has(name)) found.set(name, { name, value: p })
        continue
      }
      if (e.isDirectory()) {
        visited += 1
        await walk(p, depth + 1)
      }
    }
  }
  for (const raw of dirs) {
    const dir = path.resolve(expandHome(raw))
    if (!fsSync.existsSync(dir)) continue
    await walk(dir, 0)
  }
  const apps = [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
  const display = await localizedNames(apps.map((a) => a.value))
  for (const a of apps) {
    const zh = pickDisplayName(a.name, display.get(a.value))
    if (zh) a.displayName = zh
  }
  return apps
}

/** One line of `mdls -name kMDItemDisplayName`; the value is quoted, "(null)" and misses are null. */
function parseDisplayNameValue(line) {
  const m = /^kMDItemDisplayName = "(.*)"$/.exec(line.trim())
  if (!m) return null
  const v = m[1].replace(/\\"/g, '"').trim()
  return v && v !== '(null)' ? v : null
}

/**
 * Batch mdls emits one line per *indexed* path, silently dropping the rest — so the positional
 * map is only safe when every path yielded a value. Any gap returns null to trigger per-path retry.
 */
function alignDisplayNames(paths, values) {
  if (paths.length !== values.length) return null
  return new Map(paths.map((p, i) => [p, values[i]]))
}

/** Keep the localized name only when it actually differs — "Alfred 5" isn't a second name. */
function pickDisplayName(english, localized) {
  const v = typeof localized === 'string' ? localized.trim() : ''
  return v && v !== english ? v : null
}

const MDLS_ARG = ['-name', 'kMDItemDisplayName']
const MDLS_CHUNK = 60

/** value → localized display name. Batched, chunk falls back to per-path on any misalignment. */
async function localizedNames(paths, execMdls = (args) => run('mdls', args)) {
  const out = new Map()
  for (let i = 0; i < paths.length; i += MDLS_CHUNK) {
    const chunk = paths.slice(i, i + MDLS_CHUNK)
    let aligned = null
    const stdout = await execMdls([...MDLS_ARG, ...chunk]).catch(() => null)
    if (stdout != null) {
      const values = stdout.split('\n').filter(Boolean).map(parseDisplayNameValue)
      if (values.length === chunk.length && values.every((v) => v)) aligned = alignDisplayNames(chunk, values)
    }
    if (aligned) for (const [p, v] of aligned) out.set(p, v)
    else
      for (const p of chunk) {
        const one = (await execMdls([...MDLS_ARG, p]).catch(() => null)) ?? ''
        const v = parseDisplayNameValue(one.split('\n').filter(Boolean)[0] ?? '')
        if (v) out.set(p, v)
      }
  }
  return out
}

/** Path -> localized name, but only where it differs from the basename the panel would otherwise show. */
function buildAppNameMap(paths, display) {
  const out = {}
  for (const p of paths) {
    const zh = typeof display.get(p) === 'string' ? display.get(p).trim() : ''
    const en = p.replace(/\.app$/i, '').split('/').pop()
    if (zh && zh !== en) out[p] = zh
  }
  return out
}

let appsCache = { at: 0, list: [] }


/** Cached against the configured dirs; hPatchSettings drops this when the list changes. */
async function allApps() {
  if (Date.now() - appsCache.at > 30_000) {
    appsCache = { at: Date.now(), list: await collectApps((await loadDb()).discoverDirs) }
  }
  return appsCache.list
}

async function hDiscover(req, res) {
  const url = new URL(req.url, 'http://local')
  const q = url.searchParams.get('q')?.trim().toLowerCase()
  const limit = Number(url.searchParams.get('limit') ?? 80)
  const db = await loadDb()
  const existing = new Set(db.items.map((i) => i.value))
  let results = (await allApps())
    .filter((a) => !existing.has(a.value))
    .map((a) => ({ kind: 'app', ...a }))
  if (q)
    results = results.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q) || r.displayName?.toLowerCase().includes(q),
    )
  json(res, 200, { total: results.length, results: results.slice(0, limit), dirs: db.discoverDirs })
}

async function hImport(req, res) {
  const body = await readBody(req)
  const db = await loadDb()
  const existing = new Set(db.items.map((i) => i.value))
  const added = []
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    if (existing.has(raw.value)) continue
    try {
      // A scanned app carries displayName (中文) + name (英文); the display name wins the name slot.
      const zh = typeof raw.displayName === 'string' ? raw.displayName.trim() : ''
      const item = normalizeItem(
        { ...raw, name: zh || raw.name, nameEn: zh && zh !== raw.name ? raw.name : raw.nameEn, group: body.group ?? '默认', tags: body.tags ?? ['自动发现'] },
        null,
        db.openByKind,
      )
      db.items.push(item)
      existing.add(item.value)
      added.push(item)
    } catch {
      /* skip malformed */
    }
  }
  if (added.length) await flushDb()
  json(res, 200, { added: added.length, items: added })
}

/* -------------------------------- app library ------------------------------- */

const APPLE_BUNDLE_ID = /^(com|developer)\.apple\./
const appleMemo = new Map()

function plutilBundleId(plist) {
  return new Promise((resolve) => {
    execFile('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', plist], { encoding: 'utf8' }, (err, out) =>
      resolve(err ? '' : out.trim()),
    )
  })
}

/**
 * Written by Apple, wherever it happens to be installed. The path prefix alone is not enough:
 * Keynote, iMovie and TestFlight land in /Applications, and Safari is a symlink into a Cryptex.
 * Third-party App Store bundles share Apple's signing authority, so the bundle id is the signal
 * that actually separates them. Memoized per process — a bundle id never changes.
 */
async function isAppleApp(appPath) {
  const cached = appleMemo.get(appPath)
  if (cached !== undefined) return cached
  const plist = path.join(appPath, 'Contents', 'Info.plist')
  let bid = ''
  try {
    bid = (await fs.readFile(plist)).toString('latin1').match(/CFBundleIdentifier<\/key>\s*<string>([^<]*)</)?.[1] ?? ''
  } catch {
    /* binary or unreadable — plutil below */
  }
  if (!bid) bid = await plutilBundleId(plist)
  const apple = APPLE_BUNDLE_ID.test(bid)
  appleMemo.set(appPath, apple)
  return apple
}

/**
 * Third-party apps that plug into Xcode ship an appex declaring the source-editor extension point.
 * Substring match rather than a plist parse: the identifier appears in XML and binary plists alike,
 * and nothing else in an appex's Info.plist has a reason to carry it. Memoized — a bundle rarely
 * gains or loses an extension between two page loads, and the scan cache resets every 30s anyway.
 */
const pluginMemo = new Map()

async function isXcodePlugin(appPath) {
  const cached = pluginMemo.get(appPath)
  if (cached !== undefined) return cached
  let hit = false
  for (const dir of ['PlugIns', 'Extensions']) {
    const root = path.join(appPath, 'Contents', dir)
    let names = []
    try {
      names = await fs.readdir(root)
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith('.appex')) continue
      try {
        if ((await fs.readFile(path.join(root, n, 'Contents', 'Info.plist'))).includes(XCODE_SOURCE_EDITOR_POINT)) hit = true
      } catch {
        /* unreadable appex — not evidence of anything */
      }
      if (hit) break
    }
    if (hit) break
  }
  pluginMemo.set(appPath, hit)
  return hit
}

/**
 * Scan-derived default groups, in display order. Each owns its name only while no stored group has
 * it; `note` is what the UI shows to explain where the membership comes from.
 */
const AUTO_GROUPS = [
  {
    name: LIB_SYSTEM,
    note: '按 Apple 自家应用自动归入，未存储',
    test: async (p) => p.startsWith(SYSTEM_VOLUME) || (await isAppleApp(p)),
  },
  {
    name: LIB_XCODE,
    note: '按 Xcode 源码编辑器扩展自动归入，未存储',
    test: isXcodePlugin,
  },
  {
    name: LIB_SETAPP,
    note: '按 /Applications/Setapp 目录自动归入，未存储',
    test: async (p) => p.startsWith(SETAPP_VOLUME),
  },
]

/**
 * Join the scan with the stored library. An app that stopped being scanned (uninstalled, or its
 * directory temporarily off the list) disappears from the view but keeps its group assignment,
 * so putting it back needs no re-sorting — `stale` only feeds the footer count.
 *
 * 「未分组」 is a stored group like any other, except its *membership* stays derived: the scan minus
 * everything another group claims. Its stored list is only the manual order (plus the position of
 * the row itself); entries claimed elsewhere or no longer scanned simply drop out.
 */
async function buildLibrary(db) {
  const scanned = await allApps()
  const byPath = new Set(scanned.map((a) => a.value))
  let stale = 0
  const shown = new Set()
  const stored = db.appLib.groups
  const groups = []
  for (const g of stored) {
    if (g.name === LIB_UNGROUPED) {
      groups.push({ name: g.name, apps: [], ungrouped: true })
      continue
    }
    const apps = []
    for (const p of g.apps) {
      if (!byPath.has(p)) {
        stale += 1
        continue
      }
      shown.add(p)
      apps.push(p)
    }
    groups.push({ name: g.name, apps })
  }
  // A stored group owns its name and blocks derivation — but the UI still needs the rule's answer to
  // preview 「更新分组」, so a blocked rule is evaluated anyway over everything the *other* groups don't claim.
  const auto = []
  const autoAdd = {}
  for (const spec of AUTO_GROUPS) {
    const owner = groups.find((g) => g.name === spec.name)
    const own = owner ? new Set(owner.apps) : null
    const hits = []
    for (const a of scanned) {
      if (shown.has(a.value) && !own?.has(a.value)) continue
      if (await spec.test(a.value)) hits.push(a.value)
    }
    if (own) {
      // 「更新分组」 is additive, so only what the group is missing is worth sending.
      const adds = hits.filter((p) => !own.has(p))
      if (adds.length) autoAdd[spec.name] = adds
      continue
    }
    if (hits.length) {
      for (const p of hits) shown.add(p)
      auto.push({ name: spec.name, apps: hits, auto: spec.note })
    }
  }
  const slot = groups.findIndex((g) => g.ungrouped)
  // Hold the row itself: inserting above it shifts its index, and `groups[slot]` would then be the auto group.
  const ungroupedRow = slot === -1 ? null : groups[slot]
  if (auto.length) groups.splice(slot === -1 ? groups.length : slot, 0, ...auto)
  const kept = new Set()
  const ordered = (stored.find((g) => g.name === LIB_UNGROUPED)?.apps ?? []).filter((p) => byPath.has(p) && !shown.has(p) && !kept.has(p) && kept.add(p))
  const rest = scanned.map((a) => a.value).filter((p) => !shown.has(p) && !kept.has(p))
  const apps = [...ordered, ...rest]
  for (const p of apps) shown.add(p)
  if (ungroupedRow) ungroupedRow.apps = apps
  else groups.push({ name: LIB_UNGROUPED, apps, ungrouped: true })
  return {
    ungroupedName: LIB_UNGROUPED,
    autoGroupNames: AUTO_GROUPS.map((s) => s.name),
    autoAdd,
    groups,
    all: scanned,
    stale,
  }
}

async function hLibrary(req, res) {
  const db = await loadDb()
  json(res, 200, await buildLibrary(db))
}

async function hPatchLibrary(req, res) {
  const body = await readBody(req)
  const db = await loadDb()
  // Validate the full table before touching the cache, so a bad group can't half-apply.
  const groups = normalizeLibrary(body.groups)
  db.appLib = { groups }
  await flushDb()
  json(res, 200, await buildLibrary(db))
}

/* --------------------------------- opener --------------------------------- */

async function hApps(req, res) {
  json(res, 200, { apps: await allApps() })
}

/* ---------------------------------- icon ---------------------------------- */

async function hIcon(req, res) {
  const url = new URL(req.url, 'http://local')
  const hash = url.searchParams.get('hash')
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) throw Object.assign(new Error('bad hash'), { status: 400 })
  const file = path.join(ICON_DIR, `${hash}.png`)
  if (!fsSync.existsSync(file)) throw Object.assign(new Error('no icon'), { status: 404 })
  const buf = await fs.readFile(file)
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.end(buf)
}

const iconJobs = new Map()

async function ensureIcon(targetPath) {
  if (!isSafePath(targetPath)) return null
  const resolved = expandHome(targetPath)
  if (!resolved || !fsSync.existsSync(resolved)) return null
  const hash = createHash('sha256').update(resolved).digest('hex')
  const file = path.join(ICON_DIR, `${hash}.png`)
  if (fsSync.existsSync(file)) return `/api/icon?hash=${hash}`
  if (iconJobs.has(hash)) return iconJobs.get(hash)

  const job = (async () => {
    const raw = path.join(ICON_DIR, `.raw-${hash}.png`)
    try {
      // qlmanage -t hangs waiting on the QuickLook daemon when spawned from a server; NSWorkspace renders reliably.
      await run('osascript', ['-l', 'JavaScript', ICON_SCRIPT, resolved, raw], { timeout: 8000 })
      await run('sips', ['-Z', '128', '-s', 'format', 'png', raw, '--out', file], { timeout: 8000 })
      return `/api/icon?hash=${hash}`
    } catch (err) {
      console.warn('[launcher] icon render failed', resolved, err.message)
      return null
    } finally {
      await fs.rm(raw, { force: true }).catch(() => {})
      iconJobs.delete(hash)
    }
  })()
  iconJobs.set(hash, job)
  return job
}

/* ------------------------------ native picker ----------------------------- */

/**
 * Only paths with no list to search: folders and files. Apps are picked from `/api/apps` in the
 * panel instead — the native app chooser needs Apple Events authorization and fails after picking.
 */
const OSA = {
  folder: `POSIX path of (choose folder with prompt "选择文件夹")`,
  file: `POSIX path of (choose file with prompt "选择文件")`,
}

async function hPick(req, res) {
  const body = await readBody(req)
  const script = OSA[body.kind]
  if (!script) throw Object.assign(new Error('kind 需为 folder/file'), { status: 400 })
  let out
  try {
    out = await run('osascript', ['-e', script], { timeout: 120000 })
  } catch (err) {
    if (/-128/.test(String(err.message ?? '') + String(err.stderr ?? ''))) {
      return json(res, 200, { cancelled: true })
    }
    console.warn('[launcher] 原生选择器失败', body.kind, err.message, err.stderr)
    throw Object.assign(new Error('打开系统选择器失败'), { status: 500 })
  }
  const value = out.trim()
  if (!value) return json(res, 200, { cancelled: true })
  const st = fsSync.statSync(value, { throwIfNoEntry: false })
  const kind = /\.app\/?$/.test(value) ? 'app' : st?.isDirectory() ? 'folder' : 'file'
  json(res, 200, { cancelled: false, value: value.replace(/\/$/, ''), kind, name: path.basename(value.trim().replace(/\/$/, '')) })
}

/* --------------------------------- router --------------------------------- */

function json(res, status, payload) {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

const routes = [
  ['GET', /^\/api\/state$/, hState],
  ['PATCH', /^\/api\/settings$/, hPatchSettings],
  ['POST', /^\/api\/items$/, hCreateItem],
  ['PATCH', /^\/api\/items\/([\w-]+)$/, hPatchItem],
  ['DELETE', /^\/api\/items\/([\w-]+)$/, hDeleteItem],
  ['POST', /^\/api\/items\/([\w-]+)\/use$/, hUse],
  ['POST', /^\/api\/open$/, hOpen],
  ['GET', /^\/api\/apps$/, hApps],
  ['GET', /^\/api\/library$/, hLibrary],
  ['PATCH', /^\/api\/library$/, hPatchLibrary],
  ['POST', /^\/api\/reveal$/, hReveal],
  ['POST', /^\/api\/terminal$/, hTerminal],
  ['POST', /^\/api\/copy$/, hCopy],
  ['POST', /^\/api\/run$/, hRun],
  ['GET', /^\/api\/runs\/([\w-]+)$/, hRunOutput],
  ['POST', /^\/api\/import$/, hImport],
  ['POST', /^\/api\/pick$/, hPick],
  ['GET', /^\/api\/discover$/, hDiscover],
  ['GET', /^\/api\/icon$/, hIcon],
  ['GET', /^\/api\/enrich$/, async (req, res) => {
    const url = new URL(req.url, 'http://local')
    const p = url.searchParams.get('path')
    const iconUrl = p ? await ensureIcon(p) : null
    json(res, 200, { iconUrl })
  }],
]

export async function handleApi(req, res) {
  const pathname = new URL(req.url ?? '/', 'http://local').pathname
  for (const [method, re, handler] of routes) {
    if (method !== req.method) continue
    const m = re.exec(pathname)
    if (!m) continue
    try {
      await handler(req, res, { id: m[1] })
      return
    } catch (err) {
      const status = Number(err?.status) || 500
      if (status >= 500) console.error('[launcher]', err)
      json(res, status, { error: String(err?.message ?? err) })
      return
    }
  }
  json(res, 404, { error: `no route ${req.method} ${pathname}` })
}

export { ensureIcon, parseDisplayNameValue, alignDisplayNames, pickDisplayName, localizedNames, buildAppNameMap }
