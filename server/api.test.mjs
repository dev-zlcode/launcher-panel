import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDisplayNameValue, alignDisplayNames, pickDisplayName, localizedNames, buildAppNameMap, syncSeeds } from './api.mjs'

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
