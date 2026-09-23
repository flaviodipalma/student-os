import { fromMinutes, toMinutes } from "@/lib/events"
import type { CalendarEvent } from "@/lib/types"
import type { DailyPlan, StudySession } from "./types"

// One day as a single ordered list: fixed events, study sessions (booked or
// suggested), and the free time / breaks between them. Used by the Planner page
// and the Dashboard so both show the day the same way.

export type TimelineItem =
  | { kind: "event"; key: string; start: string; end: string; event: CalendarEvent }
  | { kind: "session"; key: string; start: string; end: string; session: StudySession; event?: CalendarEvent }
  | { kind: "free"; key: string; start: string; end: string }
  | { kind: "break"; key: string; start: string; end: string }

// Gaps shorter than this between two items aren't shown as free time.
const MIN_FREE_MINUTES = 30

export function buildDayTimeline(plan: DailyPlan, eventsOnDay: CalendarEvent[]): TimelineItem[] {
  const sessionByEvent = new Map(plan.existingSessions.map((s) => [s.eventId, s]))

  const items: TimelineItem[] = [
    ...eventsOnDay.map((event): TimelineItem => {
      const session = sessionByEvent.get(event.id)
      return session
        ? { kind: "session", key: event.id, start: event.startTime, end: event.endTime, session, event }
        : { kind: "event", key: event.id, start: event.startTime, end: event.endTime, event }
    }),
    ...plan.suggestions.map((session): TimelineItem => ({
      kind: "session",
      key: session.id,
      start: session.startTime,
      end: session.endTime,
      session,
    })),
  ].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))

  // Add the gaps: free time (30+ min), or a break between two study sessions.
  const withGaps: TimelineItem[] = []
  let busyUntil = -1
  let previous: TimelineItem | undefined
  for (const item of items) {
    const start = toMinutes(item.start)
    if (previous && start > busyUntil) {
      const gap = start - busyUntil
      const between = [previous, item].every((i) => i.kind === "session")
      const gapItem = { key: `gap-${busyUntil}`, start: fromMinutes(busyUntil), end: item.start }
      if (gap >= MIN_FREE_MINUTES) withGaps.push({ kind: "free", ...gapItem })
      else if (between) withGaps.push({ kind: "break", ...gapItem })
    }
    withGaps.push(item)
    busyUntil = Math.max(busyUntil, toMinutes(item.end))
    previous = item
  }
  return withGaps
}


// Morning (before noon), afternoon (noon-5 PM), evening (5 PM on), by start time.
export type PartOfDay = "morning" | "afternoon" | "evening"

export function partOfDay(start: string): PartOfDay {
  const minutes = toMinutes(start)
  if (minutes < 12 * 60) return "morning"
  if (minutes < 17 * 60) return "afternoon"
  return "evening"
}
