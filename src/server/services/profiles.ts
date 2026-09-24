import "server-only"

import { eq } from "drizzle-orm"
import type { ProfileInput, Student } from "@/lib/types"
import { profiles } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"

// The app's record for a signed-in user (same id as their Supabase Auth user).

// Creates the profile if it doesn't exist yet; never overwrites an existing name.
export async function ensureProfile(db: Database, userId: string, firstName = ""): Promise<void> {
  await db
    .insert(profiles)
    .values({ id: userId, firstName: firstName.trim().slice(0, 80) })
    .onConflictDoNothing({ target: profiles.id })
}

function toStudent(row: typeof profiles.$inferSelect | undefined): Student {
  return {
    firstName: row?.firstName ?? "",
    lastName: row?.lastName ?? "",
    academicTerm: row?.academicTerm ?? "",
    academicYear: row?.academicYear ?? null,
    onboardingCompleted: row?.onboardingCompleted ?? false,
  }
}

export async function getProfile(db: Database, userId: string): Promise<Student> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, userId))
  return toStudent(row)
}

export async function updateProfile(db: Database, userId: string, input: ProfileInput): Promise<Student> {
  const [row] = await db
    .update(profiles)
    .set({
      firstName: input.firstName,
      lastName: input.lastName,
      academicTerm: input.academicTerm,
      academicYear: input.academicYear,
    })
    .where(eq(profiles.id, userId))
    .returning()
  if (!row) throw new NotFoundError("profile")
  return toStudent(row)
}

export async function completeOnboarding(db: Database, userId: string): Promise<void> {
  const updated = await db
    .update(profiles)
    .set({ onboardingCompleted: true })
    .where(eq(profiles.id, userId))
    .returning({ id: profiles.id })
  if (updated.length === 0) throw new NotFoundError("profile")
}
