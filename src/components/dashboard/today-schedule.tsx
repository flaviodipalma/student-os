"use client"

import Link from "next/link"
import { DayTimeline } from "@/components/planner/day-timeline"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useEvents } from "@/lib/event-store"
import { eventsOn } from "@/lib/events"
import { buildDayTimeline } from "@/lib/planner"
import { usePlan } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"

// Today's calendar events plus the Planner's suggested study sessions.
// Uses the same usePlan() as the Planner page, so both always agree.
export function TodaySchedule({ className }: { className?: string }) {
  const { events } = useEvents()
  const { today } = useTasks()
  const plan = usePlan(today)
  const todays = eventsOn(events, today)
  const items = buildDayTimeline(plan, todays)
  const suggested = plan.suggestions.length

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Today&apos;s schedule</CardTitle>
        <CardDescription>
          {items.length === 0
            ? "Nothing on your calendar today."
            : `${todays.length} ${todays.length === 1 ? "event" : "events"}` +
              (suggested > 0 ? ` · ${suggested} suggested study ${suggested === 1 ? "session" : "sessions"}` : "")}
        </CardDescription>
        <CardAction className="flex gap-3">
          {suggested > 0 && (
            <Link
              href="/planner"
              className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Review plan
            </Link>
          )}
          <Link
            href="/calendar"
            className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Calendar
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DayTimeline date={today} items={items} />
      </CardContent>
    </Card>
  )
}
