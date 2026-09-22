"use client"

import { createContext, use, useEffect, useState } from "react"

// The current time, shared by everything that shows "now" (the Dashboard's
// Now/Up next labels, the Calendar's current-time line).
//
// It starts from the time the server rendered the page, so the first render in
// the browser matches the server's HTML exactly, then ticks every 30 seconds.

const ClockContext = createContext<Date | null>(null)

export function ClockProvider({ serverNow, children }: { serverNow: number; children: React.ReactNode }) {
  const [now, setNow] = useState(() => new Date(serverNow))

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  return <ClockContext value={now}>{children}</ClockContext>
}

export function useNow(): Date {
  const now = use(ClockContext)
  if (!now) throw new Error("useNow must be used inside ClockProvider")
  return now
}
