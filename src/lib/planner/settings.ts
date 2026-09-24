import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import type { Priority, TaskType } from "@/lib/types"

// Every planner rule and number lives here, so the planner's behaviour can be
// read (and tuned) in one place. The student-facing ones (study window, daily
// maximum, block length, breaks) come from the student's saved preferences via
// plannerSettingsFor() in src/lib/preferences.ts; the defaults below are used
// when no preferences are passed (e.g. in unit tests).

// Never plan more than this much studying in one day, even if there's more free time.
export const DEFAULT_MAX_STUDY_MINUTES_PER_DAY = DEFAULT_STUDENT_PREFERENCES.maxStudyMinutesPerDay

// ---- Task scoring ----------------------------------------------------------
//
// A task's planning score is the sum of a few simple factors (see scoring.ts):
//
//   deadline  + priority  + major work  + large task  + already started
//   + tight on time  + competing deadlines  + missed session
//
// Higher score = planned first. The deadline and priority carry most of the
// weight, so e.g. a critical task due tomorrow (75 + 40) comes well before a
// low-priority task due next week (35 + 5), but a low-priority task due today
// (90 + 5) still beats a critical one due in a week (35 + 40).
export type ScoringWeights = {
  deadline: {
    overdue: number
    today: number
    tomorrow: number
    // due in 2-3 days
    soon: number
    // due in 4-7 days
    thisWeek: number
    // due in more than a week
    later: number
  }
  priority: Record<Priority, number>
  // Exams, projects, papers and presentations, when due within `majorWorkDays`.
  majorWork: number
  majorWorkDays: number
  majorTypes: TaskType[]
  // Big remaining work (>= largeTaskMinutes) due within largeTaskDays: start early.
  largeTask: number
  largeTaskMinutes: number
  largeTaskDays: number
  // Some work is already done: keep the momentum.
  inProgress: number
  // The remaining work doesn't fit in the study time left before the deadline.
  tightOnTime: number
  // It would fit on its own, but not together with the other work due by the
  // same deadline (fewer real opportunities than it looks).
  competingDeadlines: number
  // A planned session for it was missed recently: its work is back in the plan.
  missedSession: number
  // Today: it can be finished in the (short) free time starting now.
  fitsNow?: number
}

export const DEFAULT_SCORING: ScoringWeights = {
  deadline: { overdue: 100, today: 90, tomorrow: 75, soon: 55, thisWeek: 35, later: 15 },
  priority: { critical: 40, high: 30, medium: 15, low: 5 },
  majorWork: 10,
  majorWorkDays: 7,
  majorTypes: ["exam", "project", "paper", "presentation"],
  largeTask: 10,
  largeTaskMinutes: 120,
  largeTaskDays: 7,
  inProgress: 5,
  tightOnTime: 15,
  competingDeadlines: 8,
  missedSession: 8,
  fitsNow: 10,
}

// ---- Scheduling ------------------------------------------------------------

export type PlannerSettings = {
  // Hard cap on study per day (existing study sessions count toward it).
  maxStudyMinutesPerDay: number
  // Never book more than this share of the day's free time, so there's room to breathe.
  maxShareOfFreeTime: number
  // Only plan inside these hours ("HH:MM").
  dayStart: string
  dayEnd: string
  // Study blocks are at least this long (unless the task needs less to finish);
  // free gaps shorter than this aren't used for study.
  minBlockMinutes: number
  // …and at most this long without a break (the longest continuous study).
  maxBlockMinutes: number
  // The student's preferred block length. Longer work is split into blocks of
  // this length (plus a shorter last one). Unset: split evenly up to maxBlockMinutes.
  preferredBlockMinutes?: number
  // Rest between two study blocks (also after study already on the calendar).
  breakMinutes: number
  // Time to get from a fixed event (class, practice, work) to studying: no study
  // block starts right as one ends.
  transitionMinutes: number
  // Used when a task has no usable time estimate; the student is asked to add one.
  fallbackEstimateMinutes: number
  // How many days ahead the planner simulates when planning a later date, and
  // looks when judging whether there's enough time before a deadline.
  lookaheadDays: number
  // Less usable free time than this on a day with work to do is flagged.
  lowTimeMinutes: number
  // At most this many "Needs attention" items per day.
  maxWarnings: number
  scoring: ScoringWeights
}

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  maxStudyMinutesPerDay: DEFAULT_MAX_STUDY_MINUTES_PER_DAY,
  maxShareOfFreeTime: 0.6,
  dayStart: DEFAULT_STUDENT_PREFERENCES.studyStart,
  dayEnd: DEFAULT_STUDENT_PREFERENCES.studyEnd,
  minBlockMinutes: 30,
  maxBlockMinutes: 120,
  breakMinutes: DEFAULT_STUDENT_PREFERENCES.breakMinutes,
  transitionMinutes: 15,
  fallbackEstimateMinutes: 60,
  lookaheadDays: 14,
  lowTimeMinutes: 60,
  maxWarnings: 4,
  scoring: DEFAULT_SCORING,
}
