import { sessionsAsCalendarItems } from "@/lib/calendar-items"
import type { PlannerInput } from "@/lib/planner"
import { plannerSettingsFor } from "@/lib/preferences"
import type {
  CalendarEvent,
  Course,
  RecurringCommitment,
  StudentPreferences,
  StudySessionRecord,
  Task,
} from "@/lib/types"

// The student's saved data -> the planner's input. The one place this mapping
// lives: the app (PlannerProvider) and the end-to-end tests both use it.
export type PlannerSource = {
  tasks: Task[]
  courses: Course[]
  events: CalendarEvent[]
  studySessions: StudySessionRecord[]
  recurringCommitments: RecurringCommitment[]
  preferences: StudentPreferences
}

export function plannerInputFor(data: PlannerSource, now: Date): PlannerInput {
  // Tasks removed from a day's plan, by date.
  const skipped: Record<string, string[]> = {}
  for (const session of data.studySessions) {
    if (session.status === "skipped") (skipped[session.date] ??= []).push(session.taskId)
  }
  return {
    tasks: data.tasks,
    // Events and scheduled/completed study sessions (all dates, so time already
    // planned for a task counts), plus the weekly commitments: the planner
    // treats both as busy time, using the same occurrence rules as the Calendar.
    events: [...data.events, ...sessionsAsCalendarItems(data.studySessions, data.tasks, data.courses)],
    recurringCommitments: data.recurringCommitments,
    now,
    skipped,
    settings: plannerSettingsFor(data.preferences),
  }
}
