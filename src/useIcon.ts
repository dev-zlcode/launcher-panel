import { useEffect, useReducer, useState, type RefObject } from 'react'
import { api } from './api'

type RefElement = RefObject<HTMLElement | null>

const cache = new Map<string, string | null>()
const inFlight = new Set<string>()
const queue: string[] = []
const listeners = new Set<() => void>()
const CONCURRENCY = 4
let running = 0

function notify() {
  for (const l of listeners) l()
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const target = queue.shift()!
    running += 1
    api
      .enrich(target)
      .then((r) => cache.set(target, r.iconUrl))
      .catch(() => cache.set(target, null))
      .finally(() => {
        inFlight.delete(target)
        running -= 1
        notify()
        pump()
      })
  }
}

/** Resolves a macOS file icon progressively; returns null until generated. */
export function useIcon(fsPath: string | null): string | null {
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!fsPath) return
    const listener = () => rerender()
    listeners.add(listener)
    if (!cache.has(fsPath) && !inFlight.has(fsPath)) {
      inFlight.add(fsPath)
      queue.push(fsPath)
      pump()
    }
    return () => {
      listeners.delete(listener)
    }
  }, [fsPath])

  return fsPath ? (cache.get(fsPath) ?? null) : null
}

/** True once the referenced element is near the viewport, so expensive icons are only built when needed. */
export function useInView(ref: RefElement): boolean {
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, seen])

  return seen
}
