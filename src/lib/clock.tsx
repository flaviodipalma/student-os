"use client"

import { createContext, use, useEffect, useState } from "react"
import { dateFromWallClock, type WallClock } from "@/lib/time-zone"

// The current time, shared by everything that shows "now" or "today" (the
// Dashboard, the Calendar's current-time line, the Planner).
//
// It starts from the student's wall-clock time when the server rendered the
// page (in the student's time zone, so server and browser render the same
// thing), then follows the browser's clock, ticking every 30 seconds.

const ClockContext = createContext<Date | null>(null)

export function ClockProvider({ wallClock, children }: { wallClock: WallClock; children: React.ReactNode }) {
  const [now, setNow] = useState(() => dateFromWallClock(wallClock))

  useEffect(() => {
    // Switch to the browser's own clock right after the first render, then keep ticking.
    const tick = () => setNow(new Date())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])

  return <ClockContext value={now}>{children}</ClockContext>
}

export function useNow(): Date {
  const now = use(ClockContext)
  if (!now) throw new Error("useNow must be used inside ClockProvider")
  return now
}
