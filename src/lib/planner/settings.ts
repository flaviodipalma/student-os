// Planner rules that are easy to tweak. Change a number here and the whole app
// (Planner page, Dashboard, tests) picks it up.

// Never plan more than this much studying in one day, even if there's more free time.
export const DEFAULT_MAX_STUDY_MINUTES_PER_DAY = 240

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
  // When a block has to shrink to fit a gap, it snaps down to one of these lengths.
  blockSizes: number[]
  // Rest between two study blocks.
  breakMinutes: number
}

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  maxStudyMinutesPerDay: DEFAULT_MAX_STUDY_MINUTES_PER_DAY,
  maxShareOfFreeTime: 0.6,
  dayStart: "08:00",
  dayEnd: "22:00",
  minBlockMinutes: 30,
  maxBlockMinutes: 120,
  blockSizes: [30, 45, 60, 90, 120],
  breakMinutes: 15,
}
