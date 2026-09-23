import type { StudentPreferences } from "@/lib/types"

// The one place study-preference defaults are defined. New students start with
// these; onboarding and Settings let them change every value. The Planner reads
// the student's saved preferences, never these numbers directly.

export const DEFAULT_STUDENT_PREFERENCES: StudentPreferences = {
  studyStart: "08:00",
  studyEnd: "22:00",
  maxStudyMinutesPerDay: 240,
  preferredBlockMinutes: 60,
  breakMinutes: 15,
}

// The choices offered in onboarding and Settings.
export const STUDY_BLOCK_OPTIONS = [30, 45, 60, 90] as const
export const BREAK_OPTIONS = [0, 5, 10, 15, 20, 30] as const

// Planner settings that come from the student's preferences.
export function plannerSettingsFor(preferences: StudentPreferences) {
  return {
    dayStart: preferences.studyStart,
    dayEnd: preferences.studyEnd,
    maxStudyMinutesPerDay: preferences.maxStudyMinutesPerDay,
    preferredBlockMinutes: preferences.preferredBlockMinutes,
    breakMinutes: preferences.breakMinutes,
  }
}
