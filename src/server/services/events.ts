import "server-only"

import { and, asc, eq } from "drizzle-orm"
import type { CalendarEvent, EventInput } from "@/lib/types"
import { toEvent } from "../db/mappers"
import { events } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"
import { getCourseForUser } from "./courses"
import { hasChanges } from "./util"

export type EventChanges = Partial<Omit<EventInput, "description" | "courseId">> & {
  description?: string | null
  courseId?: string | null
}

export async function listEvents(db: Database, userId: string): Promise<CalendarEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.userId, userId))
    .orderBy(asc(events.date), asc(events.startTime))
  return rows.map(toEvent)
}

export async function createEvent(
  db: Database,
  userId: string,
  input: EventInput & { id?: string }
): Promise<CalendarEvent> {
  if (input.courseId) await getCourseForUser(db, userId, input.courseId)
  const [row] = await db
    .insert(events)
    .values({
      id: input.id,
      userId,
      title: input.title,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      type: input.type,
      description: input.description ?? null,
      courseId: input.courseId ?? null,
    })
    .returning()
  return toEvent(row)
}

export async function updateEvent(
  db: Database,
  userId: string,
  eventId: string,
  changes: EventChanges
): Promise<CalendarEvent> {
  if (changes.courseId) await getCourseForUser(db, userId, changes.courseId)
  const values = {
    title: changes.title,
    date: changes.date,
    startTime: changes.startTime,
    endTime: changes.endTime,
    type: changes.type,
    description: changes.description,
    courseId: changes.courseId,
  }
  if (!hasChanges(values)) {
    const [existing] = await db.select().from(events).where(and(eq(events.id, eventId), eq(events.userId, userId)))
    if (!existing) throw new NotFoundError("event")
    return toEvent(existing)
  }
  const [row] = await db
    .update(events)
    .set(values)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)))
    .returning()
  if (!row) throw new NotFoundError("event")
  return toEvent(row)
}

export async function deleteEvent(db: Database, userId: string, eventId: string): Promise<void> {
  const deleted = await db
    .delete(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)))
    .returning({ id: events.id })
  if (deleted.length === 0) throw new NotFoundError("event")
}
