import { busyRanges } from "@/lib/events"
import type { CalendarEvent } from "@/lib/types"

export type Slot = { start: number; end: number }

// Free time on one day, in minutes since midnight, between `from` and `to`.
// Every event counts as busy: classes, practice, work, personal, and study sessions.
export function findFreeSlots(eventsOnDay: CalendarEvent[], from: number, to: number): Slot[] {
  const slots: Slot[] = []
  let cursor = from
  for (const [start, end] of busyRanges(eventsOnDay)) {
    if (end <= cursor) continue
    if (start >= to) break
    if (start > cursor) slots.push({ start: cursor, end: Math.min(start, to) })
    cursor = Math.max(cursor, end)
  }
  if (cursor < to) slots.push({ start: cursor, end: to })
  return slots
}

export function totalMinutes(slots: Slot[]): number {
  return slots.reduce((sum, slot) => sum + (slot.end - slot.start), 0)
}

// Rounds up to the next multiple of `step` (e.g. 16:07 -> 16:15 for step 15).
export function roundUp(minutes: number, step: number): number {
  return Math.ceil(minutes / step) * step
}
