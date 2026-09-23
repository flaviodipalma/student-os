import { eq } from "drizzle-orm"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import type { StudentPreferences } from "@/lib/types"
import { studentPreferences } from "../db/schema"
import type { Database } from "../db/types"

const hhmm = (time: string) => time.slice(0, 5)

// The student's study preferences, or the defaults if they haven't saved any.
export async function getPreferences(db: Database, userId: string): Promise<StudentPreferences> {
  const [row] = await db.select().from(studentPreferences).where(eq(studentPreferences.userId, userId))
  if (!row) return DEFAULT_STUDENT_PREFERENCES
  return {
    studyStart: hhmm(row.studyStart),
    studyEnd: hhmm(row.studyEnd),
    maxStudyMinutesPerDay: row.maxStudyMinutesPerDay,
    preferredBlockMinutes: row.preferredBlockMinutes,
    breakMinutes: row.breakMinutes,
  }
}

// Creates or replaces the student's preferences (one row per student).
export async function savePreferences(
  db: Database,
  userId: string,
  preferences: StudentPreferences
): Promise<StudentPreferences> {
  await db
    .insert(studentPreferences)
    .values({ userId, ...preferences })
    .onConflictDoUpdate({ target: studentPreferences.userId, set: { ...preferences, updatedAt: new Date() } })
  return getPreferences(db, userId)
}
