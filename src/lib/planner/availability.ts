import { busyRanges, toMinutes } from "@/lib/events"
import { toDateKey } from "@/lib/format"
import { commitmentsOn } from "@/lib/recurring"
import type { CalendarEvent, RecurringCommitment } from "@/lib/types"
import { isMissed, workedMinutes } from "./scoring"
import type { PlannerSettings } from "./settings"
import type { AvailableTimeBlock } from "./types"

// Available study time on one day:
//
//   study window (from now, if it's today)
//   − one-time events (the student's own, Canvas, Blackboard)
//   − weekly commitments
//   − study sessions already on the calendar (plus a break after them)
//   − a transition after fixed events (getting from class/practice to studying)
//   = free blocks
//
// Then a study budget for the day: the daily limit minus study already booked,
// and never more than a share of the free time, so the day isn't packed.

export type Slot = AvailableTimeBlock

export type DayAvailability = {
  // Everything that takes time that day: events, study sessions, commitments.
  items: CalendarEvent[]
  // Free time before breaks are applied (what the student sees as "free").
  free: AvailableTimeBlock[]
  freeMinutes: number
  // Free time the planner can use: like `free`, but starting a break after any
  // study already on the calendar. Shrinks as sessions are placed.
  slots: AvailableTimeBlock[]
  // Study already on the calendar that day (any study event, done or not).
  bookedStudyMinutes: number
  // Minutes of new study the planner may add that day.
  budget: number
  // What the daily limit alone would still allow (to tell the two limits apart).
  limitLeft: number
}

// Free time on one day, in minutes since midnight, between `from` and `to`.
// Every item counts as busy: classes, practice, work, personal, and study sessions.
export function findFreeSlots(itemsOnDay: CalendarEvent[], from: number, to: number): Slot[] {
  const slots: Slot[] = []
  let cursor = from
  for (const [start, end] of busyRanges(itemsOnDay)) {
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

export function roundDown(minutes: number, step: number): number {
  return Math.floor(minutes / step) * step
}

export function dayAvailability(
  date: string,
  events: CalendarEvent[],
  commitments: RecurringCommitment[],
  now: Date,
  settings: PlannerSettings
): DayAvailability {
  const items = [...events.filter((e) => e.date === date), ...commitmentsOn(commitments, date)]
  const dayEnd = toMinutes(settings.dayEnd)
  let dayStart = toMinutes(settings.dayStart)
  if (date === toDateKey(now)) dayStart = Math.max(dayStart, roundUp(now.getHours() * 60 + now.getMinutes(), 15))

  const free = findFreeSlots(items, dayStart, Math.max(dayStart, dayEnd))
  // A block right after booked study starts after a break; one right before it ends a break early.
  // A block right after a fixed event starts after the transition time.
  const study = items.filter((e) => e.type === "study")
  const studyStarts = new Set(study.map((e) => toMinutes(e.startTime)))
  const studyEnds = new Set(study.map((e) => toMinutes(e.endTime)))
  const fixedEnds = new Set(items.filter((e) => e.type !== "study").map((e) => toMinutes(e.endTime)))
  const slots = free
    .map((slot) => ({
      start: studyEnds.has(slot.start)
        ? slot.start + settings.breakMinutes
        : fixedEnds.has(slot.start)
          ? slot.start + settings.transitionMinutes
          : slot.start,
      end: studyStarts.has(slot.end) ? slot.end - settings.breakMinutes : slot.end,
    }))
    .filter((slot) => slot.end > slot.start)

  const freeMinutes = totalMinutes(free)
  // Study counted against the daily limit: booked sessions, and the minutes actually
  // worked in a partly done one (45 of 90 counts 45). A missed session doesn't count:
  // that time wasn't used for studying, and its work is planned again.
  const today = toDateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const bookedStudyMinutes = study.filter((e) => !isMissed(e, today, nowMinutes)).reduce((sum, e) => sum + workedMinutes(e), 0)
  // Booked study counts as used free time, so accepting a suggestion doesn't make room for more.
  const limitLeft = settings.maxStudyMinutesPerDay - bookedStudyMinutes
  const shareLeft = Math.floor((freeMinutes + bookedStudyMinutes) * settings.maxShareOfFreeTime) - bookedStudyMinutes
  return {
    items,
    free,
    freeMinutes,
    slots,
    bookedStudyMinutes,
    budget: Math.max(0, Math.min(limitLeft, shareLeft)),
    limitLeft,
  }
}
