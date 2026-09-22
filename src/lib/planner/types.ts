// Planner output shapes.
//
// Task → Planner → StudySession
// A task is something to get done. The planner suggests study sessions: blocks
// of time to work on a task. A suggestion becomes a real calendar event (type
// "study", with a taskId) only when the student accepts it.

export type StudySessionStatus =
  | "suggested" // proposed by the planner, not on the calendar yet
  | "scheduled" // accepted: stored as a calendar event
  | "completed" // done

export type StudySession = {
  id: string
  taskId: string
  date: string
  startTime: string
  endTime: string
  status: StudySessionStatus
  // Set once the session lives on the calendar (scheduled or completed).
  eventId?: string
}

export type UnscheduledTask = {
  taskId: string
  // Minutes the planner wanted to give this task today but couldn't.
  missingMinutes: number
  // Minutes it did manage to schedule today (0 if none).
  scheduledMinutes: number
  // daily-limit: the day's study budget ran out (the daily cap, or the share of
  // free time kept free). no-time: there was no free gap left that fits.
  reason: "daily-limit" | "no-time"
  // Due within 2 days (or overdue), so not fitting is a real problem.
  atRisk: boolean
}

export type PlanStatus =
  | "ok"
  | "past" // the date is before today
  | "no-tasks" // nothing needs time on this date
  | "no-time" // no usable free time on this date
  | "limit-reached" // existing study already hits the daily limit

export type DailyPlan = {
  date: string
  status: PlanStatus
  // New suggestions from the planner, earliest first.
  suggestions: StudySession[]
  // Study sessions already on the calendar for this date, linked to a task.
  existingSessions: StudySession[]
  // Tasks that needed time on this date but didn't fully fit.
  unscheduled: UnscheduledTask[]
  // Tasks the student removed from this date's plan.
  skippedTaskIds: string[]
  // Study minutes on this date (existing + suggested) and the cap.
  studyMinutes: number
  studyLimit: number
  // Usable free minutes on this date before the planner added anything.
  freeMinutes: number
}
