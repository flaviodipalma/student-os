// The Student OS planner: rule-based, no AI. Takes tasks + calendar events for a
// date and suggests study sessions. Pure functions only; no React in here.

export { generatePlan, plannedMinutesFor, dailyTarget, type PlanInput } from "./generate-plan"
export { calculateTaskUrgency, urgencyReasons } from "./urgency"
export { findFreeSlots } from "./availability"
export { buildDayTimeline, type TimelineItem } from "./timeline"
export { DEFAULT_MAX_STUDY_MINUTES_PER_DAY, DEFAULT_PLANNER_SETTINGS, type PlannerSettings } from "./settings"
export type { DailyPlan, StudySession, StudySessionStatus, UnscheduledTask, PlanStatus } from "./types"
