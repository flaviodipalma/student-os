// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { generatePlan } from "@/lib/planner"
import { scheduleBetween } from "@/lib/recurring"
import type { CalendarEvent, ExternalEventRecord } from "@/lib/types"

// Today's plan on the Dashboard reads the same schedule as the Calendar (the
// store's scheduleBetween, external events included) and says where each item is from.

const TODAY = "2026-09-29"
const NY = "America/New_York"
const own: CalendarEvent[] = [{ id: "own-1", title: "Soccer Practice", date: TODAY, startTime: "10:30", endTime: "13:00", type: "sports" }]
const external: ExternalEventRecord[] = [
  { id: "c1", source: "canvas", title: "CSC215 Class", description: null, startsAt: "2026-09-29T18:00:00Z", endsAt: "2026-09-29T19:15:00Z", location: null, url: null, hidden: false },
  { id: "b1", source: "blackboard", title: "Psychology Meeting", description: null, startsAt: "2026-09-29T20:00:00Z", endsAt: "2026-09-29T21:00:00Z", location: null, url: null, hidden: false },
]
const items = [...own, ...externalEventsAsCalendarItems(external, NY)]

vi.mock("@/lib/event-store", () => ({
  useEvents: () => ({ scheduleOn: (date: string) => scheduleBetween(items, [], date, date) }),
}))
vi.mock("@/lib/task-store", () => ({ useTasks: () => ({ tasks: [], today: TODAY }) }))
vi.mock("@/lib/clock", () => ({ useNow: () => new Date(2026, 8, 29, 8, 0) }))
vi.mock("@/lib/planner-store", () => ({
  usePlan: () => generatePlan({ date: TODAY, tasks: [], events: items, now: new Date(2026, 8, 29, 8, 0) }),
}))

const { TodaySchedule } = await import("./today-schedule")
afterEach(cleanup)

describe("Dashboard: Today's plan", () => {
  it("lists Student OS, Canvas and Blackboard events in order, each with its source", () => {
    render(<TodaySchedule />)
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent)
    expect(rows).toEqual([
      "10:30 AM–1:00 PMSoccer PracticeStudent OS",
      "2:00 PM–3:15 PMCSC215 ClassCanvas",
      "4:00 PM–5:00 PMPsychology MeetingBlackboard",
    ])
  })
})
