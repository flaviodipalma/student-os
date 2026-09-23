"use client"

import { useSyncExternalStore } from "react"

// True while the media query matches (e.g. "(max-width: 639px)"). False on the
// server and during the first render, then follows the browser.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}
