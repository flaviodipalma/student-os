"use client"

import { AppStoreProvider } from "@/lib/app-store"
import { ClockProvider } from "@/lib/clock"
import { FeedbackProvider } from "@/lib/feedback"
import { PlannerProvider } from "@/lib/planner-store"
import type { AppData } from "@/server/services/app-data"

// The shared state every signed-in page runs inside: clock, error messages, and
// the student's data, and the shared planner. Used by the app shell and by onboarding.
export function AppProviders({
  data,
  today,
  serverNow,
  children,
}: {
  data: AppData
  today: string
  serverNow: number
  children: React.ReactNode
}) {
  return (
    <ClockProvider serverNow={serverNow}>
      <FeedbackProvider>
        <AppStoreProvider initial={data} today={today}>
          <PlannerProvider>{children}</PlannerProvider>
        </AppStoreProvider>
      </FeedbackProvider>
    </ClockProvider>
  )
}
