import { useSyncExternalStore } from 'react'

/**
 * One breakpoint for the whole panel: under it the sidebar becomes an overlay, menus open on long press,
 * and the stored `collapsed` stops meaning anything (folding a drawer is not a desktop preference).
 */
const media = matchMedia('(max-width: 767px)')

function subscribe(cb: () => void) {
  media.addEventListener('change', cb)
  return () => media.removeEventListener('change', cb)
}

export function useNarrow() {
  return useSyncExternalStore(subscribe, () => media.matches)
}
