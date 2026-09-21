type Pos = { x: number; y: number }

interface Press {
  timer: number
  from: Pos
  fired: boolean
}

/**
 * Per-element rather than per-hook: the manage page builds one of these per card inside a map, where a hook
 * cannot live. The DOM node survives the re-render the menu itself triggers, which is what lets the trailing
 * click still be recognised as belonging to a press that already fired.
 */
const presses = new WeakMap<EventTarget, Press>()

function stop(el: EventTarget, keepFired = false) {
  const p = presses.get(el)
  if (!p) return
  window.clearTimeout(p.timer)
  if (keepFired && p.fired) return
  presses.delete(el)
}

/**
 * Touch has no right button, so a held finger opens the same menu the 右键 gesture does. Mouse is deliberately
 * ignored — a held left button means drag or select here, and the real contextmenu event still fires for it.
 *
 * Spread the result onto the element and leave its own onClick alone: a long press swallows the click that
 * follows the lift, so a card does not launch right after its menu opened.
 */
export function longPress(onLongPress: (pos: Pos) => void, ms = 500) {
  return {
    onPointerDown: (e: { currentTarget: EventTarget; pointerType: string; clientX: number; clientY: number }) => {
      const el = e.currentTarget
      stop(el)
      if (e.pointerType === 'mouse') return
      const from = { x: e.clientX, y: e.clientY }
      const p: Press = { from, fired: false, timer: 0 }
      p.timer = window.setTimeout(() => {
        p.fired = true
        onLongPress(from)
      }, ms)
      presses.set(el, p)
    },
    // A scroll starts as a pointer down on the card; bailing past 12px keeps flicking the list from opening menus.
    onPointerMove: (e: { currentTarget: EventTarget; clientX: number; clientY: number }) => {
      const p = presses.get(e.currentTarget)
      if (!p || p.fired) return
      if (Math.abs(e.clientX - p.from.x) > 12 || Math.abs(e.clientY - p.from.y) > 12) stop(e.currentTarget)
    },
    onPointerUp: (e: { currentTarget: EventTarget }) => stop(e.currentTarget, true),
    onPointerCancel: (e: { currentTarget: EventTarget }) => stop(e.currentTarget, true),
    onClickCapture: (e: { currentTarget: EventTarget; stopPropagation: () => void; preventDefault: () => void }) => {
      if (!presses.get(e.currentTarget)?.fired) return
      presses.delete(e.currentTarget)
      e.stopPropagation()
      e.preventDefault()
    },
  }
}
