import { addDays, fromDateKey } from "@/lib/format"
import type { CalendarEvent, RecurringCommitment } from "@/lib/types"

// Weekly commitments are stored once, as a rule ("Mon/Wed 3:30–5:30 PM"). These
// helpers turn the rule into that day's busy blocks when something needs them:
// the Planner (to avoid those times) and the Calendar/Dashboard (to show them).
// Nothing is written to the database.

export const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

export function commitmentsOn(commitments: RecurringCommitment[], date: string): CalendarEvent[] {
  const weekday = fromDateKey(date).getDay()
  return commitments
    .filter((commitment) => commitment.daysOfWeek.includes(weekday))
    .map((commitment) => ({
      id: `${commitment.id}@${date}`,
      commitmentId: commitment.id,
      title: commitment.title,
      date,
      startTime: commitment.startTime,
      endTime: commitment.endTime,
      type: commitment.type,
      description: "Weekly commitment",
    }))
}

// Every occurrence between two dates (inclusive), for showing on the calendar.
export function commitmentsBetween(commitments: RecurringCommitment[], from: string, to: string): CalendarEvent[] {
  const items: CalendarEvent[] = []
  if (commitments.length === 0) return items
  for (let date = from; date <= to; date = addDays(date, 1)) items.push(...commitmentsOn(commitments, date))
  return items
}

// "Mon, Wed, Fri"
export function formatDays(daysOfWeek: number[]): string {
  return [...daysOfWeek]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((day) => weekdayLabels[day])
    .join(", ")
}
