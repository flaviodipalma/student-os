import "server-only"

import { and, asc, eq, sql } from "drizzle-orm"
import type { StudySessionRecord } from "@/lib/types"
import { toStudySession } from "../db/mappers"
import { studySessions } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"
import { getTaskForUser } from "./tasks"
import { hasChanges } from "./util"

export type SessionInput = Omit<StudySessionRecord, "id" | "rescheduleCount" | "firstDate" | "firstStartTime">
export type SessionChanges = Partial<Omit<SessionInput, "taskId">>

export async function listStudySessions(db: Database, userId: string): Promise<StudySessionRecord[]> {
  const rows = await db
    .select()
    .from(studySessions)
    .where(eq(studySessions.userId, userId))
    .orderBy(asc(studySessions.date), asc(studySessions.startTime))
  return rows.map(toStudySession)
}

export async function createStudySession(
  db: Database,
  userId: string,
  input: SessionInput & { id?: string }
): Promise<StudySessionRecord> {
  // The task must be one of this user's tasks.
  await getTaskForUser(db, userId, input.taskId)
  const [row] = await db
    .insert(studySessions)
    .values({ ...input, id: input.id, userId })
    .returning()
  return toStudySession(row)
}

export async function updateStudySession(
  db: Database,
  userId: string,
  sessionId: string,
  changes: SessionChanges
): Promise<StudySessionRecord> {
  if (!hasChanges(changes)) {
    const [existing] = await db
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
    if (!existing) throw new NotFoundError("study session")
    return toStudySession(existing)
  }
  // A scheduled session moved to another time counts as rescheduled (for adaptive
  // planning): one more move, and where it was first planned is kept.
  const moved = sql`${studySessions.status} = 'scheduled' and (${studySessions.date} <> ${changes.date ?? null}::date or ${studySessions.startTime} <> ${changes.startTime ?? null}::time)`
  const tracking =
    changes.date !== undefined || changes.startTime !== undefined
      ? {
          rescheduleCount: sql`case when ${moved} then ${studySessions.rescheduleCount} + 1 else ${studySessions.rescheduleCount} end`,
          firstDate: sql`case when ${moved} then coalesce(${studySessions.firstDate}, ${studySessions.date}) else ${studySessions.firstDate} end`,
          firstStartTime: sql`case when ${moved} then coalesce(${studySessions.firstStartTime}, ${studySessions.startTime}) else ${studySessions.firstStartTime} end`,
        }
      : {}
  const [row] = await db
    .update(studySessions)
    .set({ ...changes, ...tracking })
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
    .returning()
  if (!row) throw new NotFoundError("study session")
  return toStudySession(row)
}

export async function deleteStudySession(db: Database, userId: string, sessionId: string): Promise<void> {
  const deleted = await db
    .delete(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
    .returning({ id: studySessions.id })
  if (deleted.length === 0) throw new NotFoundError("study session")
}
