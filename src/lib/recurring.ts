import { byStart } from "@/lib/events"
import { addDays, fromDateKey } from "@/lib/format"
import type { CalendarEvent, RecurringCommitment } from "@/lib/types"

// Weekly commitments are stored once, as a rule ("Mon/Wed 3:30–5:30 PM, from
// Sep 1 until Dec 12"). These helpers turn the rule into the busy blocks for the
// days something needs: the Planner (to avoid those times) and the Calendar and
// Dashboard (to show them). Nothing is written to the database.

export const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

// Does the commitment happen on this date? Right weekday, and inside its date range.
export function occursOn(commitment: RecurringCommitment, date: string): boolean {
  if (commitment.startDate && date < commitment.startDate) return false
  if (commitment.endDate && date > commitment.endDate) return false
  return commitment.daysOfWeek.includes(fromDateKey(date).getDay())
}

// One calendar item per commitment happening on `date`. The id is unique per
// day ("<commitment id>@<date>"); commitmentId points back to the rule.
export function commitmentsOn(commitments: RecurringCommitment[], date: string): CalendarEvent[] {
  return commitments
    .filter((commitment) => occursOn(commitment, date))
    .map((commitment) => ({
      id: `${commitment.id}@${date}`,
      commitmentId: commitment.id,
      title: commitment.title,
      date,
      startTime: commitment.startTime,
      endTime: commitment.endTime,
      type: commitment.type,
      description: commitment.description,
    }))
}

// Every occurrence between two dates (inclusive).
export function commitmentsBetween(commitments: RecurringCommitment[], from: string, to: string): CalendarEvent[] {
  const items: CalendarEvent[] = []
  if (commitments.length === 0) return items
  for (let date = from; date <= to; date = addDays(date, 1)) items.push(...commitmentsOn(commitments, date))
  return items
}

// The student's schedule for a range of days: one-time items (events and study
// sessions) plus the weekly commitments that happen in that range, sorted by
// day and start time. The Calendar, Dashboard and Planner page all use this, so
// they always show the same thing.
export function scheduleBetween(
  items: CalendarEvent[],
  commitments: RecurringCommitment[],
  from: string,
  to: string
): CalendarEvent[] {
  return [
    ...items.filter((item) => !item.commitmentId && item.date >= from && item.date <= to),
    ...commitmentsBetween(commitments, from, to),
  ].sort(byStart)
}

// Monday first, e.g. "Mon, Wed, Fri"; "Weekdays" and "Every day" for the common sets.
export function formatDays(daysOfWeek: number[]): string {
  const days = [...new Set(daysOfWeek)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  if (days.length === 7) return "Every day"
  if (days.join() === "1,2,3,4,5") return "Weekdays"
  return days.map((day) => weekdayLabels[day]).join(", ")
}

// "From Sep 1 until Dec 12", "Until Dec 12", or "" when it has no date limits.
export function formatDateRange(commitment: Pick<RecurringCommitment, "startDate" | "endDate">): string {
  const day = (key: string) => fromDateKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const { startDate, endDate } = commitment
  if (startDate && endDate) return `${day(startDate)} – ${day(endDate)}`
  if (startDate) return `From ${day(startDate)}`
  if (endDate) return `Until ${day(endDate)}`
  return ""
}
