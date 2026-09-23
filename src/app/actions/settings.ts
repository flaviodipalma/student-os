"use server"

import type { ActionResult } from "@/lib/action-result"
import type { RecurringCommitment, Student, StudentPreferences } from "@/lib/types"
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
import { savePreferences } from "@/server/services/preferences"
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
