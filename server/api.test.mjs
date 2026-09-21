import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDisplayNameValue, alignDisplayNames, pickDisplayName, localizedNames, buildAppNameMap } from './api.mjs'

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
