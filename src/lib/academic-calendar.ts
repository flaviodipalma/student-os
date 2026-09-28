import { addDays, fromDateKey } from "@/lib/format"
import type { AcademicEvent, AcademicEventKind, RecurringCommitment } from "@/lib/types"

// The student's academic calendar: semesters, days without classes (breaks,
// holidays), the exam period, deadlines. Class times don't meet on no-class and
// exam days; class times start and end with the semester.

export const academicKindLabel: Record<AcademicEventKind, string> = {
  term: "Semester",
  no_classes: "No classes",
  exams: "Exams",
  deadline: "Deadline",
  other: "Other",
}

const byStart = (a: AcademicEvent, b: AcademicEvent) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)

export const sortAcademicEvents = (events: AcademicEvent[]) => [...events].sort(byStart)

// Every day of breaks, holidays and exam periods (no regular classes).
export function noClassDates(events: AcademicEvent[]): string[] {
  const days = new Set<string>()
  for (const event of events) {
    if (event.kind !== "no_classes" && event.kind !== "exams") continue
    // At most ~a year per item (the database allows 400 days).
    for (let day = event.startDate, n = 0; day <= event.endDate && n <= 400; day = addDays(day, 1), n++) days.add(day)
  }
  return [...days].sort()
}

// Class times (commitments with a courseId) skip the days without classes.
export function withAcademicCalendar(commitments: RecurringCommitment[], events: AcademicEvent[]): RecurringCommitment[] {
  const skip = noClassDates(events)
  return commitments.map((commitment) => {
    if (!commitment.courseId) return commitment
    const next: RecurringCommitment = { ...commitment, skipDates: skip }
    if (skip.length === 0) delete next.skipDates
    return next
  })
}

// The semester for class times: the one going on today, else the next one, else
// the latest one. Undefined without semesters.
export function semesterFor(events: AcademicEvent[], today: string): AcademicEvent | undefined {
  const terms = sortAcademicEvents(events.filter((event) => event.kind === "term"))
  return (
    terms.find((term) => term.startDate <= today && today <= term.endDate) ??
    terms.find((term) => term.startDate > today) ??
    terms[terms.length - 1]
  )
}

// What to show in the calendar's all-day row on `date`: a semester only on its first
// and last day ("Fall 2026 begins"), everything else on each of its days.
export type AcademicDayItem = { id: string; kind: AcademicEventKind; label: string }

export function academicItemsOn(events: AcademicEvent[], date: string): AcademicDayItem[] {
  const items: AcademicDayItem[] = []
  for (const event of sortAcademicEvents(events)) {
    if (date < event.startDate || date > event.endDate) continue
    if (event.kind === "term") {
      if (date === event.startDate) items.push({ id: `${event.id}@start`, kind: "term", label: `${event.title} begins` })
      else if (date === event.endDate) items.push({ id: `${event.id}@end`, kind: "term", label: `${event.title} ends` })
      continue
    }
    items.push({ id: event.id, kind: event.kind, label: event.title })
  }
  return items
}

const day = (key: string, withYear = false) =>
  fromDateKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) })

// "Sep 7" / "Nov 25 – Nov 29" / "Aug 24, 2026 – Dec 18, 2026" (semesters show the year).
export function academicDates(event: Pick<AcademicEvent, "startDate" | "endDate" | "kind">): string {
  const year = event.kind === "term"
  return event.startDate === event.endDate ? day(event.startDate, year) : `${day(event.startDate, year)} – ${day(event.endDate, year)}`
}

// ---- Heads-up (Dashboard) ----------------------------------------------------------------

export type AcademicHeadsUp = {
  id: string
  kind: AcademicEventKind
  title: string
  startDate: string
  endDate: string
  // "now": going on today (a break, the exam period); "soon": starts within the horizon;
  // "ends": a semester ending within the horizon.
  when: "now" | "soon" | "ends"
  // Days from today to the start ("soon") or to the end ("now", "ends").
  days: number
}

const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

// What's happening at school now and in the next `horizon` days: breaks and the exam
// period going on, breaks, exams, deadlines and semesters starting soon, and a
// semester ending soon. Soonest first, at most `max`.
export function academicHeadsUp(events: AcademicEvent[], today: string, horizon = 14, max = 4): AcademicHeadsUp[] {
  const items: AcademicHeadsUp[] = []
  for (const event of events) {
    const base = { id: event.id, kind: event.kind, title: event.title, startDate: event.startDate, endDate: event.endDate }
    const toStart = daysFrom(today, event.startDate)
    const toEnd = daysFrom(today, event.endDate)
    if (event.kind === "term") {
      if (toStart > 0 && toStart <= horizon) items.push({ ...base, when: "soon", days: toStart })
      else if (toStart <= 0 && toEnd >= 0 && toEnd <= horizon) items.push({ ...base, when: "ends", days: toEnd })
      continue
    }
    if (event.kind === "other") continue
    if (toStart <= 0 && toEnd >= 0 && (event.kind === "no_classes" || event.kind === "exams")) items.push({ ...base, when: "now", days: toEnd })
    else if (toStart >= 0 && toStart <= horizon) items.push({ ...base, when: "soon", days: toStart })
  }
  const order = { now: 0, soon: 1, ends: 1 }
  return items.sort((a, b) => order[a.when] - order[b.when] || a.days - b.days).slice(0, max)
}
