// The Student OS planner: rule-based and deterministic, no AI. Takes the
// student's tasks, schedule and preferences and answers "What should I do
// today?" with recommended study sessions. Pure functions only; no React here.
//
//   settings.ts     every rule and weight, in one place
//   availability.ts free time and the study budget for a day
//   scoring.ts      remaining work, task scores and their reasons
//   generate-plan.ts  the day-by-day planner (createPlanner / generatePlan)
//   warnings.ts     "Needs attention"
//   what-now.ts     "What should I do now?" from today's plan and the current time
//   timeline.ts     one day as an ordered list, for display

export { createPlanner, generatePlan, dailyTarget, type Planner, type PlanInput } from "./generate-plan"
export {
  calculateTaskUrgency,
  compareScored,
  completedMinutesFor,
  isMissed,
  plannedMinutesFor,
  reasonsOf,
  scoreTask,
  workedMinutes,
} from "./scoring"
export { dayAvailability, findFreeSlots } from "./availability"
export { buildDayTimeline, partOfDay, type TimelineItem, type PartOfDay } from "./timeline"
export { whatNow, type NextStudy, type TaskDetails, type WhatNow } from "./what-now"
export {
  DEFAULT_MAX_STUDY_MINUTES_PER_DAY,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_SCORING,
  type PlannerSettings,
  type ScoringWeights,
} from "./settings"
export type {
  AvailableTimeBlock,
  DailyPlan,
  LearnedPlanning,
  PlannerInput,
  PlannerWarning,
  PlanStatus,
  PlanningStrategy,
  RecommendedStudySession,
  ScoreFactor,
  ScoredTask,
  StudySession,
  StudySessionStatus,
  UnscheduledTask,
} from "./types"
export { MODE_LABELS, modeStrategy, type Pacing } from "./modes"
