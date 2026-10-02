import type { LmsAssignment, LmsCalendarItem } from "@/lib/lms/types"

// What an item on a course's LMS calendar is, from its title. Structured dates make
// these safe to apply without asking (announcements are different: see the AI reader).
//   exam / quiz -> a task, so the Planner schedules study before it
//   no_class    -> that course's class skips that day
//   event       -> a read-only event on the student's calendar
// Kept deliberately simple and predictable: anything unclear is just an event.

export type CalendarItemKind = "exam" | "quiz" | "no_class" | "event"

const NO_CLASS = /\bno (class|classes|lecture|lectures|lab|meeting)\b|\b(class|classes|lecture|lectures)\b(\s+(is|are|has been|have been|will be))?\s+cancel+ed\b|\bcancel+ed:?\s+(class|lecture)\b/i
const QUIZ = /\bquiz(zes)?\b/i
const EXAM = /\b(exam|exams|midterm|midterms|mid-term|test|tests)\b|\bfinal\b(?!\s+(project|paper|presentation|essay|draft|report|portfolio))/i
// Sessions about an exam aren't the exam.
const ABOUT_IT = /\b(review|prep|preparation|study|office hours|help session|tutoring|solutions|results|grades?)\b/i

export function classifyCalendarItem(title: string): CalendarItemKind {
  if (NO_CLASS.test(title)) return "no_class"
  if (ABOUT_IT.test(title)) return "event"
  if (QUIZ.test(title)) return "quiz"
  if (EXAM.test(title)) return "exam"
  return "event"
}

// An exam or quiz from the calendar, as an assignment for the normal LMS sync (so a
// re-sync updates it, and the student's own changes are kept). Its due date and time
// are when it starts, in the student's time zone (all-day items: that day, no time).
export function calendarItemAsAssignment(
  item: LmsCalendarItem,
  kind: "exam" | "quiz",
  toLocal: (iso: string) => { dueDate: string; dueTime: string } | null
): LmsAssignment | null {
  const due = item.allDayDate ? { dueDate: item.allDayDate, dueTime: null } : item.startsAt ? toLocal(item.startsAt) : null
  if (!due) return null
  return {
    provider: item.provider,
    // A calendar item and an assignment can share a number in some LMSs.
    externalId: `event:${item.externalId}`,
    courseExternalId: item.courseExternalId,
    title: item.title,
    description: [item.location ? `Location: ${item.location}` : null, item.description].filter(Boolean).join("\n\n") || null,
    dueDate: due.dueDate,
    dueTime: due.dueTime,
    type: kind,
    url: item.url,
    estimatedMinutes: null,
    submissionStatus: "unknown",
  }
}
