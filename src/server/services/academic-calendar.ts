import "server-only"

import { and, asc, eq } from "drizzle-orm"
import type { AcademicEvent, AcademicEventInput } from "@/lib/types"
import { academicEvents } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"

// The student's academic calendar (semesters, breaks, exams, deadlines). Only the
// signed-in student's own rows are read or changed.

function toAcademicEvent(row: typeof academicEvents.$inferSelect): AcademicEvent {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    startDate: row.startDate,
    endDate: row.endDate,
    ...(row.term ? { term: row.term } : {}),
  }
}

const toRow = (input: AcademicEventInput) => ({
  kind: input.kind,
  title: input.title,
  startDate: input.startDate,
  endDate: input.endDate,
  term: input.term || null,
})

export async function listAcademicEvents(db: Database, userId: string): Promise<AcademicEvent[]> {
  const rows = await db
    .select()
    .from(academicEvents)
    .where(eq(academicEvents.userId, userId))
    .orderBy(asc(academicEvents.startDate), asc(academicEvents.endDate), asc(academicEvents.createdAt))
  return rows.map(toAcademicEvent)
}

export async function createAcademicEvent(
  db: Database,
  userId: string,
  input: AcademicEventInput & { id?: string }
): Promise<AcademicEvent> {
  const [row] = await db
    .insert(academicEvents)
    .values({ ...toRow(input), id: input.id, userId })
    .returning()
  return toAcademicEvent(row)
}

export async function updateAcademicEvent(db: Database, userId: string, id: string, input: AcademicEventInput): Promise<AcademicEvent> {
  const [row] = await db
    .update(academicEvents)
    .set(toRow(input))
    .where(and(eq(academicEvents.id, id), eq(academicEvents.userId, userId)))
    .returning()
  if (!row) throw new NotFoundError("date")
  return toAcademicEvent(row)
}

export async function deleteAcademicEvent(db: Database, userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(academicEvents)
    .where(and(eq(academicEvents.id, id), eq(academicEvents.userId, userId)))
    .returning({ id: academicEvents.id })
  if (deleted.length === 0) throw new NotFoundError("date")
}

// Replaces the whole calendar (e.g. after the student confirms one found on their
// school's website).
export async function replaceAcademicEvents(db: Database, userId: string, events: AcademicEventInput[]): Promise<AcademicEvent[]> {
  await db.transaction(async (tx) => {
    await tx.delete(academicEvents).where(eq(academicEvents.userId, userId))
    if (events.length > 0) await tx.insert(academicEvents).values(events.map((event) => ({ ...toRow(event), userId })))
  })
  return listAcademicEvents(db, userId)
}
