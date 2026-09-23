import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"

// Planner rules. The student-facing ones (study window, daily maximum, block
// length, breaks) come from the student's saved preferences via
// plannerSettingsFor() in src/lib/preferences.ts; the defaults below are only
// used when no preferences are passed (e.g. in unit tests).

// Never plan more than this much studying in one day, even if there's more free time.
export const DEFAULT_MAX_STUDY_MINUTES_PER_DAY = DEFAULT_STUDENT_PREFERENCES.maxStudyMinutesPerDay

export type PlannerSettings = {
  // Hard cap on study per day (existing study sessions count toward it).
  maxStudyMinutesPerDay: number
  // Never book more than this share of the day's free time, so there's room to breathe.
  maxShareOfFreeTime: number
  // Only plan inside these hours ("HH:MM").
  dayStart: string
  dayEnd: string
  // Study blocks are at least this long (unless the task needs less to finish)…
  minBlockMinutes: number
  // …and at most this long without a break.
  maxBlockMinutes: number
  // The student's preferred block length. Longer work is split into blocks of
  // this length (plus a shorter last one). Unset: split evenly up to maxBlockMinutes.
  preferredBlockMinutes?: number
  // When a block has to shrink to fit a gap, it snaps down to one of these lengths.
  blockSizes: number[]
  // Rest between two study blocks.
  breakMinutes: number
}

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  maxStudyMinutesPerDay: DEFAULT_MAX_STUDY_MINUTES_PER_DAY,
  maxShareOfFreeTime: 0.6,
  dayStart: DEFAULT_STUDENT_PREFERENCES.studyStart,
  dayEnd: DEFAULT_STUDENT_PREFERENCES.studyEnd,
  minBlockMinutes: 30,
  maxBlockMinutes: 120,
  blockSizes: [30, 45, 60, 90, 120],
  breakMinutes: DEFAULT_STUDENT_PREFERENCES.breakMinutes,
}
