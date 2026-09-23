import { test } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import {
  parseDisplayNameValue,
  alignDisplayNames,
  pickDisplayName,
  localizedNames,
  peekDisplayNames,
  pendingNamePaths,
  refreshDisplayNames,
  loadNameCache,
  buildAppNameMap,
  syncSeeds,
} from './api.mjs'

let tmpSeq = 0
/** Each write test gets its own file, so the shared memo is the only thing under test. */
const tmpName = async () => {
  const dir = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'lp-names-'))
  return nodePath.join(dir, `names-${tmpSeq++}.json`)
}

test('parseDisplayNameValue 取出引号内的中文名', () => {
  assert.equal(parseDisplayNameValue('kMDItemDisplayName = "预览"'), '预览')
})

test('parseDisplayNameValue 未索引的 (null) 与空行返回 null', () => {
  assert.equal(parseDisplayNameValue('kMDItemDisplayName = "(null)"'), null)
  assert.equal(parseDisplayNameValue(''), null)
  assert.equal(parseDisplayNameValue('could not find /nope.app.'), null)
})

test('parseDisplayNameValue 保留含空格与转义引号的名称', () => {
  assert.equal(parseDisplayNameValue('kMDItemDisplayName = "Alfred 5"'), 'Alfred 5')
  assert.equal(parseDisplayNameValue('kMDItemDisplayName = "带\\"引号"'), '带"引号')
})

test('alignDisplayNames 行数与路径数一致才按序配对', () => {
  const paths = ['/a/Preview.app', '/a/Games.app']
  assert.deepEqual(
    alignDisplayNames(paths, ['预览', '游戏']),
    new Map([
      ['/a/Preview.app', '预览'],
      ['/a/Games.app', '游戏'],
    ]),
  )
})

test('alignDisplayNames 有路径缺索引（行数不等）返回 null 触发回退', () => {
  assert.equal(alignDisplayNames(['/a.app', '/b.app', '/c.app'], ['甲', '乙']), null)
})

test('pickDisplayName 只在真拿到不同的中文名时保留', () => {
  assert.equal(pickDisplayName('Preview', '预览'), '预览')
  assert.equal(pickDisplayName('Alfred 5', 'Alfred 5'), null)
  assert.equal(pickDisplayName('Games', null), null)
  assert.equal(pickDisplayName('Games', '  '), null)
})

const mdlsLine = (v) => `kMDItemDisplayName = "${v}"`

test('localizedNames 批量全命中时按一次调用取回', async () => {
  const calls = []
  const exec = async (args) => {
    calls.push(args.length)
    return [mdlsLine('预览'), mdlsLine('游戏')].join('\n')
  }
  const map = await localizedNames(['/a/Preview.app', '/a/Games.app'], exec)
  assert.deepEqual([...map], [['/a/Preview.app', '预览'], ['/a/Games.app', '游戏']])
  assert.deepEqual(calls, [4], 'paths+2 flags in one batch call')
})

test('localizedNames 批量有路径缺索引时逐条回退，命中的仍收', async () => {
  const exec = async (args) => {
    if (args.length > 3) return mdlsLine('预览') // batch: 3 paths, only 1 line -> misaligned
    const p = args.at(-1)
    if (p === '/a/Preview.app') return mdlsLine('预览')
    if (p === '/a/Games.app') return mdlsLine('游戏')
    return 'could not find /a/Nope.app.' // 未索引
  }
  const map = await localizedNames(['/a/Preview.app', '/a/Games.app', '/a/Nope.app'], exec)
  assert.equal(map.get('/a/Preview.app'), '预览')
  assert.equal(map.get('/a/Games.app'), '游戏')
  assert.equal(map.has('/a/Nope.app'), false)
})

test('refreshDisplayNames 按路径进程内 memo：第二轮一次 mdls 都不打', async () => {
  let calls = 0
  const exec = async (args) => {
    calls += 1
    return args.slice(2).map((p) => mdlsLine(`中-${p.split('/').pop()}`)).join('\n')
  }
  const paths = ['/memo/A.app', '/memo/B.app']
  const first = await refreshDisplayNames(paths, exec, await tmpName())
  assert.equal(calls, 1)
  const second = await refreshDisplayNames(paths, exec, await tmpName())
  assert.equal(calls, 1, 'memoized paths never re-query mdls')
  assert.deepEqual([...second], [...first])
  assert.deepEqual(peekDisplayNames(paths), second)
})

test('refreshDisplayNames 未索引的路径也记成 null，不会每轮重扫时逐条回退', async () => {
  let single = 0
  const exec = async (args) => {
    if (args.length > 3) return mdlsLine('预览') // 3 个路径只回 1 行 → 触发逐条回退
    if (args.at(-1) === '/miss/Preview.app') return mdlsLine('预览')
    single += 1
    return 'could not find /miss/Nope.app.'
  }
  const paths = ['/miss/Preview.app', '/miss/Nope.app', '/miss/Gone.app']
  const first = await refreshDisplayNames(paths, exec, await tmpName())
  assert.equal(first.get('/miss/Preview.app'), '预览')
  assert.equal(first.has('/miss/Nope.app'), false)
  assert.deepEqual(pendingNamePaths(paths), [], 'a resolved miss stays resolved')
  const callsAfterFirst = single
  const second = await refreshDisplayNames(paths, exec, await tmpName())
  assert.equal(single, callsAfterFirst, 'the miss is memoized too, so no repeat per-path mdls')
  assert.equal(second.get('/miss/Preview.app'), '预览')
})

test('refreshDisplayNames 跨批次（>60 个路径）仍按路径对齐', async () => {
  const paths = Array.from({ length: 130 }, (_, i) => `/batch/App${i}.app`)
  const exec = async (args) => args.slice(2).map((p) => mdlsLine(`名-${p.replace('.app', '').split('/').pop()}`)).join('\n')
  const map = await refreshDisplayNames(paths, exec, await tmpName())
  assert.equal(map.size, 130)
  assert.equal(map.get('/batch/App0.app'), '名-App0')
  assert.equal(map.get('/batch/App129.app'), '名-App129')
})

test('mdls 一次都没答话时不盖章：不算「这台机器上没有中文名」', async () => {
  const file = await tmpName()
  const paths = ['/broken/Preview.app', '/broken/Nope.app']
  const exec = async () => {
    throw new Error('spawn mdls ENOENT')
  }
  const map = await refreshDisplayNames(paths, exec, file)
  assert.equal(map.size, 0)
  assert.deepEqual(pendingNamePaths(paths), paths, '全部留在队列里，下一轮接着试')
  await assert.rejects(fsp.access(file), '没有写盘，所以重启也不会把失败固化')
})

test('重查窗口：拿到名字按 30 天，未索引按 1 小时', async () => {
  const file = await tmpName()
  const paths = ['/ttl/Preview.app', '/ttl/NotIndexed.app']
  await refreshDisplayNames(
    paths,
    async (args) => {
      if (args.length > 3) return mdlsLine('预览') // 2 个路径只回 1 行 → 逐条回退
      return args.at(-1) === '/ttl/Preview.app' ? mdlsLine('预览') : ''
    },
    file,
  )
  const hour = 60 * 60_000
  const day = 24 * hour
  assert.deepEqual(pendingNamePaths(paths, Date.now() + 30 * 60_000), [], '两个都还在各自窗口内')
  assert.deepEqual(pendingNamePaths(paths, Date.now() + 2 * hour), ['/ttl/NotIndexed.app'], '刚装还没进 Spotlight 的，1 小时就回来')
  assert.deepEqual(pendingNamePaths(paths, Date.now() + 31 * day), paths, '30 天后连有名字的一起重查')
})

test('冷启动从落盘表回放：已知路径不再进 pending，超龄的重新排队', async () => {
  const file = await tmpName()
  const fresh = Date.now()
  const staleAt = fresh - 31 * 24 * 60 * 60_000
  await fsp.writeFile(
    file,
    JSON.stringify({
      '/disk/Preview.app': { name: '预览', at: fresh },
      '/disk/Nope.app': { name: null, at: fresh },
      '/disk/Old.app': { name: '旧名', at: staleAt },
    }),
    'utf8',
  )
  await loadNameCache(file)
  assert.deepEqual(pendingNamePaths(['/disk/Preview.app', '/disk/Nope.app']), [])
  assert.deepEqual(pendingNamePaths(['/disk/Old.app']), ['/disk/Old.app'], '超龄条目回到刷新队列')
  const never = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'lp-names-'))
  await loadNameCache(nodePath.join(never, 'missing.json'))
  assert.equal(peekDisplayNames(['/disk/Preview.app']).get('/disk/Preview.app'), '预览', 'misses never overwrite a known name')
})

test('refreshDisplayNames 写盘：文件里就是 memo 的形状，回放后零 mdls', async () => {
  const file = await tmpName()
  const exec = async (args) => {
    if (args.length > 3) return '' // 2 个路径 0 行 → 逐条回退
    return args.at(-1) === '/save/Preview.app' ? mdlsLine('预览') : 'could not find /save/Nope.app.'
  }
  await refreshDisplayNames(['/save/Preview.app', '/save/Nope.app'], exec, file)
  const saved = JSON.parse(await fsp.readFile(file, 'utf8'))
  assert.equal(saved['/save/Preview.app'].name, '预览')
  assert.equal(saved['/save/Nope.app'].name, null)
  await fsp.writeFile(file, JSON.stringify({ '/replay/Preview.app': { name: '预览', at: Date.now() } }), 'utf8')
  await loadNameCache(file)
  const map = await refreshDisplayNames(['/replay/Preview.app'], async () => {
    throw new Error('mdls should not run for a replayed path')
  }, file)
  assert.equal(map.get('/replay/Preview.app'), '预览')
})

test('buildAppNameMap 只收中文名与路径英文名不同的项', () => {
  const display = new Map([
    ['/System/Applications/Preview.app', '预览'],
    ['/Applications/iTerm.app', 'iTerm'], // 与 basename 相同 → 冗余，丢
    ['/Applications/Foo.app', 'Foo'], // 相同 → 丢
  ])
  assert.deepEqual(buildAppNameMap([...display.keys()], display), {
    '/System/Applications/Preview.app': '预览',
  })
})

test('buildAppNameMap 对没有中文名或路径不在表里的项直接跳过', () => {
  const display = new Map([['/a/Bar.app', '  ']])
  assert.deepEqual(buildAppNameMap(['/a/Bar.app', '/a/Missing.app'], display), {})
})

// ---------- 出厂默认对账（syncSeeds）----------

const seeds = (gh = 'https://github.com/') => [
  { kind: 'folder', name: 'Home', value: '/Users/x/Home', order: 0 },
  { kind: 'url', name: 'GitHub', value: gh, order: 100 },
]
const urlItem = (value, over = {}) => ({
  id: 'aaaaaaaaaaaa1111',
  kind: 'url',
  name: 'GitHub',
  value,
  tags: ['种子'],
  iconPath: null,
  ...over,
})
const snap = (gh) => ({ folder: { Home: '/Users/x/Home' }, url: { GitHub: gh } })
const dbOf = (items, seed) => ({ items, seed })

test('老配置没有快照：还带种子标签的条目直接跟着代码走', () => {
  const db = dbOf([urlItem('https://old.example/')], undefined)
  const changed = syncSeeds(db, seeds())
  assert.equal(db.items[0].value, 'https://github.com/')
  assert.equal(changed.length, 1)
  assert.deepEqual(db.seed, snap('https://github.com/'))
})

test('老配置没有快照：分不清是用户删的还是没同步过，缺失的默认不补建', () => {
  const db = dbOf([urlItem('https://old.example/')], undefined)
  syncSeeds(db, seeds())
  assert.equal(db.items.length, 1, '只更新已有的 GitHub，不凭空建 Home')
  assert.equal(db.seed.folder.Home, '/Users/x/Home', '但仍记下出厂值，下次就能认出谁改过')
})

test('快照对得上＝没碰过 → 出厂值变了要跟上；folder 连 iconPath 一起换', () => {
  const db = dbOf(
    [urlItem('https://github.com/'), { id: 'bbbbbbbbbbbb2222', kind: 'folder', name: 'Home', value: '/Users/x/Home', tags: ['种子'], iconPath: '/Users/x/Home' }],
    snap('https://github.com/'),
  )
  syncSeeds(db, seeds('https://www.github.com/'))
  assert.equal(db.items[0].value, 'https://www.github.com/')
  assert.equal(db.items[1].iconPath, '/Users/x/Home')
  assert.equal(db.seed.url.GitHub, 'https://www.github.com/')
})

test('用户自己改过 value（≠快照）→ 不动', () => {
  const db = dbOf([urlItem('https://internal.example/')], snap('https://github.com/'))
  const changed = syncSeeds(db, seeds('https://www.github.com/'))
  assert.equal(db.items[0].value, 'https://internal.example/')
  assert.deepEqual(changed, [])
})

test('用户改过名字 → 对不上号，既不覆盖也不补建重复条目', () => {
  const mine = urlItem('https://github.com/', { name: '我的 GitHub' })
  const db = dbOf([mine], snap('https://github.com/'))
  const changed = syncSeeds(db, seeds('https://www.github.com/'))
  assert.equal(db.items.length, 1)
  assert.equal(db.items[0], mine)
  assert.deepEqual(changed, [])
})

test('用户删掉的默认条目不复活（快照里有它）', () => {
  const db = dbOf([], snap('https://github.com/'))
  const changed = syncSeeds(db, seeds())
  assert.equal(db.items.length, 0)
  assert.deepEqual(changed, [])
})

test('代码新增的默认 → 补建，带种子标签；同 kind+value 已存在则跳过', () => {
  const db = dbOf([], snap('https://github.com/'))
  db.seed.url = {}
  const changed = syncSeeds(db, seeds())
  assert.equal(changed.length, 1)
  assert.equal(db.items[0].name, 'GitHub')
  assert.deepEqual(db.items[0].tags, ['种子'])
  assert.equal(db.items[0].pinned, false)

  const dup = dbOf([{ ...urlItem('https://github.com/'), name: 'GH 手动加的', tags: ['链接'] }], snap('https://github.com/'))
  dup.seed.url = {}
  assert.deepEqual(syncSeeds(dup, seeds()), [])
  assert.equal(dup.items.length, 1)
})

test('连跑两次幂等：第二次零变更、零新增', () => {
  const db = dbOf([urlItem('https://github.com/')], undefined)
  syncSeeds(db, seeds())
  const again = syncSeeds(db, seeds())
  assert.deepEqual(again, [])
  assert.equal(db.items.length, 1)
})
