import type { CalendarEvent, EventType, NativeEventType } from "@/lib/types"

// Labels and time maths for calendar events, shared by the Calendar and Dashboard.

export const eventTypeLabel: Record<EventType, string> = {
  class: "Class",
  study: "Study",
  sports: "Sports",
  work: "Work",
  personal: "Personal",
  other: "Other",
}

// The types a student can give their own events and commitments ("Other" is
// only for external calendar events whose kind isn't known).
export const eventTypes: NativeEventType[] = ["class", "study", "sports", "work", "personal"]

// "14:30" -> 870 (minutes since midnight)
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

// 870 -> "14:30"
export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function durationMinutes(event: CalendarEvent): number {
  return toMinutes(event.endTime) - toMinutes(event.startTime)
}

export function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || b.endTime.localeCompare(a.endTime)
}

export function eventsOn(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((event) => event.date === date).sort(byStart)
}

// ---- Overlaps ------------------------------------------------------------

export type PositionedEvent = {
  event: CalendarEvent
  // Overlapping events share the width: this one sits in `column` of `columns`.
  column: number
  columns: number
}

// Places one day's events side by side where they overlap.
// Events that overlap (directly or through a chain) form a group; each gets the
// first column that's free at its start time, and the whole group shares a width.
export function layoutDay(events: CalendarEvent[]): PositionedEvent[] {
  const result: PositionedEvent[] = []
  let group: PositionedEvent[] = []
  let columnEnds: number[] = []
  let groupEnd = -1

  const closeGroup = () => {
    for (const item of group) item.columns = columnEnds.length
    result.push(...group)
    group = []
    columnEnds = []
    groupEnd = -1
  }

  for (const event of [...events].sort(byStart)) {
    const start = toMinutes(event.startTime)
    const end = toMinutes(event.endTime)
    if (group.length > 0 && start >= groupEnd) closeGroup()

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(end)
    } else {
      columnEnds[column] = end
    }
    group.push({ event, column, columns: 0 })
    groupEnd = Math.max(groupEnd, end)
  }
  closeGroup()
  return result
}

// ---- Busy / free time ----------------------------------------------------

// Merges overlapping events into busy [start, end] ranges, in minutes.
export function busyRanges(events: CalendarEvent[]): [number, number][] {
  const ranges: [number, number][] = []
  for (const event of [...events].sort(byStart)) {
    const start = toMinutes(event.startTime)
    const end = toMinutes(event.endTime)
    const last = ranges.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }
  return ranges
}

// Gaps of at least `minMinutes` between one day's events.
export function freeGaps(events: CalendarEvent[], minMinutes = 30): { start: string; end: string }[] {
  const ranges = busyRanges(events)
  const gaps: { start: string; end: string }[] = []
  for (let i = 1; i < ranges.length; i++) {
    const start = ranges[i - 1][1]
    const end = ranges[i][0]
    if (end - start >= minMinutes) gaps.push({ start: fromMinutes(start), end: fromMinutes(end) })
  }
  return gaps
}
