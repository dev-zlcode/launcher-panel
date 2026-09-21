const BOUNDARY = /[ /\-_.,·]/

/** Returns -1 when `q` does not match `text`; higher is better. */
export function scoreField(rawQuery: string, text: string): number {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()

  const idx = t.indexOf(q)
  if (idx === 0) return 1000
  if (idx > 0) {
    const boundary = BOUNDARY.test(t[idx - 1]) ? 220 : 0
    return 700 + boundary - Math.min(idx, 60)
  }

  let cursor = 0
  let gaps = 0
  let prev = -1
  for (const ch of q) {
    const found = t.indexOf(ch, cursor)
    if (found === -1) return -1
    if (prev >= 0) gaps += Math.max(0, found - prev - 1)
    prev = found
    cursor = found + 1
  }
  return 260 - Math.min(gaps, 200) - Math.min(t.length, 120) * 0.15
}

interface Scorable {
  name: string
  nameEn?: string
  value: string
  group: string
  tags: string[]
  note: string
}

export function scoreItem(rawQuery: string, item: Scorable): number {
  const q = rawQuery.trim()
  if (!q) return 0
  const candidates: Array<[number, string]> = [
    [2, item.name],
    [1, item.value],
    [0.6, item.group],
    [0.5, item.note],
    ...item.tags.map((t) => [0.8, t] as [number, string]),
  ]
  if (item.nameEn) candidates.push([1.5, item.nameEn])
  let best = -1
  for (const [weight, text] of candidates) {
    const s = scoreField(q, text)
    if (s >= 0) best = Math.max(best, s * weight)
  }
  return best
}

const PALETTE = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#22c55e', '#0ea5e9', '#a855f7', '#ef4444']

export function initials(name: string): string {
  const cleaned = name.replace(/^(the|a|an)\s+/i, '').trim()
  const cjk = cleaned.match(/[\u4e00-\u9fa5]/g)
  if (cjk && cjk.length >= 1) return cjk.slice(0, 2).join('')
  const words = cleaned.split(/[\s\-_.]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (cleaned.slice(0, 2) || '?').toUpperCase()
}

export function colorFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
