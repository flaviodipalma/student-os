import type { CalendarEvent, RecurringCommitment, Task } from "@/lib/types"
import type { PlannerSettings } from "./settings"

// Planner input and output shapes.
//
// Task → Planner → StudySession
// A task is something to get done. The planner recommends study sessions:
// blocks of time to work on a task. A recommendation is stored (as a study
// session) only when the student accepts, completes or removes it.

export type PlannerInput = {
  tasks: Task[]
  // One-time events and study sessions, as calendar items (any dates).
  // Study sessions have type "study" and a taskId.
  events: CalendarEvent[]
  // Weekly commitments; their occurrences count as busy time.
  recurringCommitments?: RecurringCommitment[]
  // The current time. Decides what "today" is and stops the planner using time that has passed.
  now: Date
  // Tasks the student removed from a date's plan, by date ("YYYY-MM-DD" -> task ids).
  skipped?: Record<string, string[]>
  settings?: Partial<PlannerSettings>
  // The student's own strategy for this plan (e.g. from the Assistant: "focus on
  // my exam", "keep today light"). It changes priorities and how much to study,
  // never what's possible: free time, commitments and the study window stay hard
  // rules. Usually temporary (a what-if); see src/server/planning.
  strategy?: PlanningStrategy
  // What adaptive planning learned from the student's own history
  // (src/lib/adaptive). Soft only: it changes how long the Planner expects a task
  // to take and which free time it uses first, never what's possible.
  learned?: LearnedPlanning
}

export type LearnedPlanning = {
  // A learned estimate per task (the task keeps the student's own), with why.
  estimates?: Record<string, { minutes: number; reason: string }>
  // Times of day (minutes since midnight) the Planner uses last, with why.
  avoidTimes?: { start: number; end: number; reason: string }[]
}

export type PlanningStrategy = {
  // Extra points for a task, with the reason shown under "Why this?".
  boosts?: Record<string, { points: number; label: string }>
  // A lower study limit for a date ("YYYY-MM-DD" -> minutes), e.g. a light day.
  dayLimits?: Record<string, number>
}

// A stretch of free time on one day, in minutes since midnight.
export type AvailableTimeBlock = {
  start: number
  end: number
}

// One reason a task scored the way it did. `label` is what the student sees
// under "Why this?"; null = counted, but not worth mentioning (e.g. low priority).
export type ScoreFactor = {
  key:
    | "deadline"
    | "priority"
    | "major-work"
    | "large-task"
    | "in-progress"
    | "tight-on-time"
    | "competing-deadlines"
    | "missed-session"
    | "focus"
  label: string | null
  points: number
}

export type ScoredTask = {
  task: Task
  // Sum of the factors' points. Higher = planned first.
  score: number
  factors: ScoreFactor[]
  // Whole days from the plan date to the due date (negative = overdue).
  daysLeft: number
  // Work still needed, in minutes, after completed and already-booked study.
  remainingMinutes: number
  // The task had no usable estimate, so the fallback estimate was used.
  estimateMissing: boolean
  // Study time the planner could find from the plan date until the day before the deadline (Infinity = plenty).
  capacityBeforeDue: number
  // …and including the due day itself (what "Needs attention" compares against).
  capacityThroughDue?: number
}

export type StudySessionStatus =
  | "suggested" // recommended by the planner, not on the calendar yet
  | "scheduled" // accepted: on the calendar
  | "completed" // done
  | "missed" // scheduled, but it ended without being marked done (its work is re-planned)

export type StudySession = {
  id: string
  taskId: string
  date: string
  startTime: string
  endTime: string
  status: StudySessionStatus
  // Set once the session is stored (scheduled or completed).
  eventId?: string
  // Done only partly: the minutes actually worked.
  completedMinutes?: number
}

// A new study session the planner recommends, with its reasons ("Why this?").
export type RecommendedStudySession = StudySession & {
  status: "suggested"
  // From the task's score factors, plus how it was placed. Most important first.
  reasons: string[]
  score: number
}

export type UnscheduledTask = {
  taskId: string
  // Minutes the planner wanted to give this task on this day but couldn't.
  missingMinutes: number
  // Minutes it did manage to schedule on this day (0 if none).
  scheduledMinutes: number
  // daily-limit: the day's study budget ran out (the daily cap, or the share of
  // free time kept free). no-time: there was no free gap left that fits.
  reason: "daily-limit" | "no-time"
  // Due within 2 days (or overdue), so not fitting is a real problem.
  atRisk: boolean
}

// Something the student should know about the day ("Needs attention").
export type PlannerWarning = {
  id: string
  kind: "overdue" | "unscheduled" | "due-soon" | "limited-time" | "no-estimate" | "not-enough-time" | "missed"
  severity: "high" | "medium" | "low"
  message: string
  taskIds: string[]
  // What the UI can offer: open the task, or look at the next day's plan.
  action?: "view-task" | "plan-next-day"
}

export type PlanStatus =
  | "ok"
  | "past" // the date is before today
  | "no-tasks" // the student has no tasks at all
  | "all-done" // every task is completed
  | "covered" // open tasks, but none needs new time on this date
  | "no-time" // no usable free time on this date
  | "limit-reached" // existing study already hits the daily limit

export type DailyPlan = {
  date: string
  status: PlanStatus
  // New recommendations, earliest first.
  suggestions: RecommendedStudySession[]
  // Study sessions already on the calendar for this date, linked to a task.
  existingSessions: StudySession[]
  // Tasks that needed time on this date but didn't fully fit.
  unscheduled: UnscheduledTask[]
  // Tasks the student removed from this date's plan.
  skippedTaskIds: string[]
  // Open tasks ranked for this date (highest score first).
  ranked: ScoredTask[]
  // Free time on this date (inside the study window, not in the past).
  available: AvailableTimeBlock[]
  // Study minutes on this date (existing + suggested) and the cap.
  studyMinutes: number
  studyLimit: number
  // Usable free minutes on this date before the planner added anything.
  freeMinutes: number
  warnings: PlannerWarning[]
}
