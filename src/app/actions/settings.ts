"use server"

import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { themePreferences, type ThemePreference } from "@/lib/theme"
import { toDateKey } from "@/lib/format"
import { planningModes, studyPeriods, type LearningSettings, type RecurringCommitment, type Student, type StudentPreferences } from "@/lib/types"
import {
  createCommitmentSchema,
  idSchema,
  onboardingDetailsSchema,
  preferencesSchema,
  profileSchema,
  updateCommitmentSchema,
} from "@/lib/validation"
import { parse, runAction } from "@/server/actions"
import { saveOnboardingDetails, type OnboardingSaved } from "@/server/services/onboarding"
import { resetLearning, saveLearningSettings, savePreferences, saveThemePreference } from "@/server/services/preferences"
import { getStudentClock } from "@/server/student-clock"
import { completeOnboarding, updateProfile } from "@/server/services/profiles"
import {
  createRecurringCommitment,
  deleteRecurringCommitment,
  updateRecurringCommitment,
} from "@/server/services/recurring-commitments"

// Server actions for the student's profile, study preferences and weekly
// commitments. Onboarding and the Settings page both use these.

export async function updateProfileAction(input: unknown): Promise<ActionResult<Student>> {
  return runAction(({ db, userId }) => updateProfile(db, userId, parse(profileSchema, input)))
}

export async function updatePreferencesAction(input: unknown): Promise<ActionResult<StudentPreferences>> {
  return runAction(({ db, userId }) => savePreferences(db, userId, parse(preferencesSchema, input)))
}

export async function createCommitmentAction(input: unknown): Promise<ActionResult<RecurringCommitment>> {
  return runAction(({ db, userId }) => createRecurringCommitment(db, userId, parse(createCommitmentSchema, input)))
}

export async function updateCommitmentAction(id: unknown, changes: unknown): Promise<ActionResult<RecurringCommitment>> {
  return runAction(({ db, userId }) =>
    updateRecurringCommitment(db, userId, parse(idSchema, id), parse(updateCommitmentSchema, changes))
  )
}

export async function deleteCommitmentAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await deleteRecurringCommitment(db, userId, parse(idSchema, id))
    return null
  })
}

// Onboarding steps 1-3, saved together.
export async function saveOnboardingAction(details: unknown): Promise<ActionResult<OnboardingSaved>> {
  return runAction(({ db, userId }) => saveOnboardingDetails(db, userId, parse(onboardingDetailsSchema, details)))
}

// The last step: the student is sent to the normal app from now on.
export async function completeOnboardingAction(): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await completeOnboarding(db, userId)
    return null
  })
}

// Header theme menu: Light / Dark / System, saved for the signed-in student.
export async function updateThemeAction(theme: unknown): Promise<ActionResult<ThemePreference>> {
  return runAction(({ db, userId }) => saveThemePreference(db, userId, parse(z.enum(themePreferences, { error: "Choose Light, Dark or System." }), theme)))
}

// Settings > Personalization: switches, planning mode, preferred times, turned-off
// patterns and "use my estimate" tasks (only the fields sent change).
const learningChangesSchema = z
  .object({
    enabled: z.boolean(),
    useEstimates: z.boolean(),
    useStudyTimes: z.boolean(),
    useWorkload: z.boolean(),
    planningMode: z.enum(planningModes),
    preferredPeriods: z.array(z.enum(studyPeriods)).max(4),
    dismissedPatterns: z.array(z.string().regex(/^[a-z]+(:[a-z0-9-]+){0,3}$/i).max(80)).max(50),
    ownEstimateTaskIds: z.array(idSchema).max(500),
  })
  .partial()
  .strict()

export async function updateLearningAction(changes: unknown): Promise<ActionResult<LearningSettings>> {
  return runAction(({ db, userId }) => saveLearningSettings(db, userId, parse(learningChangesSchema, changes)))
}

// Settings > Planning: reset what Student OS learned (history from today on counts).
export async function resetLearningAction(): Promise<ActionResult<LearningSettings>> {
  return runAction(async ({ db, userId }) => {
    const { now } = await getStudentClock()
    return resetLearning(db, userId, toDateKey(now))
  })
}
