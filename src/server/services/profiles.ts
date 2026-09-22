import { eq } from "drizzle-orm"
import type { Student } from "@/lib/types"
import { profiles } from "../db/schema"
import type { Database } from "../db/types"

// The app's record for a signed-in user (same id as their Supabase Auth user).

// Creates the profile if it doesn't exist yet; never overwrites an existing name.
export async function ensureProfile(db: Database, userId: string, firstName = ""): Promise<void> {
  await db
    .insert(profiles)
    .values({ id: userId, firstName: firstName.trim().slice(0, 80) })
    .onConflictDoNothing({ target: profiles.id })
}

export async function getProfile(db: Database, userId: string): Promise<Student> {
  const [row] = await db.select({ firstName: profiles.firstName }).from(profiles).where(eq(profiles.id, userId))
  return { firstName: row?.firstName ?? "" }
}
