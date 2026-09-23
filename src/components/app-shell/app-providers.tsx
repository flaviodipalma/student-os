"use client"

import { AppStoreProvider } from "@/lib/app-store"
import { ClockProvider } from "@/lib/clock"
import { FeedbackProvider } from "@/lib/feedback"
import { PlannerProvider } from "@/lib/planner-store"
import type { WallClock } from "@/lib/time-zone"
import type { AppData } from "@/server/services/app-data"

// The shared state every signed-in page runs inside: clock, error messages, and
// the student's data, and the shared planner. Used by the app shell and by onboarding.
export function AppProviders({
  data,
  wallClock,
  children,
}: {
  data: AppData
  wallClock: WallClock
  children: React.ReactNode
}) {
  return (
    <ClockProvider wallClock={wallClock}>
      <FeedbackProvider>
        <AppStoreProvider initial={data}>
          <PlannerProvider>{children}</PlannerProvider>
        </AppStoreProvider>
      </FeedbackProvider>
    </ClockProvider>
  )
}
