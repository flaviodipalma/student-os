import { analyzeHistory, learnedPlanning, type AdaptivePlanningContext } from "@/lib/adaptive"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { sessionsAsCalendarItems } from "@/lib/calendar-items"
import { DEFAULT_PLANNER_SETTINGS, type PlannerInput } from "@/lib/planner"
import { toDateKey } from "@/lib/format"
import { plannerSettingsFor } from "@/lib/preferences"
import type {
  CalendarEvent,
  Course,
  ExternalEventRecord,
  LearningSettings,
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
  // Canvas / Blackboard calendar events, and the zone to place them in.
  externalEvents?: ExternalEventRecord[]
  timeZone?: string
  // Adaptive planning settings. Without them, nothing learned is used.
  learning?: LearningSettings
}

// What adaptive planning learned (src/lib/adaptive), for this data. It changes
// only with the data or the date, so callers can compute it once and pass it in.
export function adaptiveContextFor(data: PlannerSource, now: Date): AdaptivePlanningContext | undefined {
  if (!data.learning) return undefined
  return analyzeHistory(
    { tasks: data.tasks, courses: data.courses, studySessions: data.studySessions, learning: data.learning, fallbackEstimateMinutes: DEFAULT_PLANNER_SETTINGS.fallbackEstimateMinutes },
    toDateKey(now)
  )
}

export function plannerInputFor(data: PlannerSource, now: Date, adaptive = adaptiveContextFor(data, now)): PlannerInput {
  // Tasks removed from a day's plan, by date.
  const skipped: Record<string, string[]> = {}
  for (const session of data.studySessions) {
    if (session.status === "skipped") (skipped[session.date] ??= []).push(session.taskId)
  }
  return {
    tasks: data.tasks,
    // Events (the student's own and external calendar events, except hidden
    // ones) and scheduled/completed study sessions (all dates, so time already
    // planned for a task counts), plus the weekly commitments: the planner
    // treats all of them as busy time, using the same items as the Calendar.
    events: [
      ...data.events,
      ...externalEventsAsCalendarItems(data.externalEvents ?? [], data.timeZone),
      ...sessionsAsCalendarItems(data.studySessions, data.tasks, data.courses),
    ],
    recurringCommitments: data.recurringCommitments,
    now,
    skipped,
    settings: plannerSettingsFor(data.preferences),
    ...(adaptive ? { learned: learnedPlanning(adaptive) } : {}),
  }
}
