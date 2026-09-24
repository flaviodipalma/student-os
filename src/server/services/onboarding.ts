import "server-only"

import type { ProfileInput, RecurringCommitment, RecurringCommitmentInput, Student, StudentPreferences } from "@/lib/types"
import type { Database } from "../db/types"
import { savePreferences } from "./preferences"
import { getProfile, updateProfile } from "./profiles"
import { replaceRecurringCommitments } from "./recurring-commitments"

// Onboarding steps 1-3 (about you, study preferences, weekly schedule), saved
// together in one transaction. It reuses the same services Settings uses.

export type OnboardingDetails = {
  profile: ProfileInput
  preferences: StudentPreferences
  commitments: RecurringCommitmentInput[]
}

export type OnboardingSaved = {
  student: Student
  preferences: StudentPreferences
  recurringCommitments: RecurringCommitment[]
}

export async function saveOnboardingDetails(
  db: Database,
  userId: string,
  details: OnboardingDetails
): Promise<OnboardingSaved> {
  return db.transaction(async (tx) => {
    await updateProfile(tx, userId, details.profile)
    const preferences = await savePreferences(tx, userId, details.preferences)
    const recurringCommitments = await replaceRecurringCommitments(tx, userId, details.commitments)
    return { student: await getProfile(tx, userId), preferences, recurringCommitments }
  })
}
