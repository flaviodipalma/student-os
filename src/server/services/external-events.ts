import "server-only"

import { and, asc, eq, isNull } from "drizzle-orm"
import type { ExternalCalendarSource, ExternalEventRecord } from "@/lib/types"
import { externalCalendarEvents } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"

// A student's copies of external calendar events (Canvas, Blackboard). Every
// function is scoped to the signed-in student's id. The events themselves are
// read-only (only the calendar sync writes them); students can only hide or
// restore their own copies. See src/lib/calendar/external-events.ts.

type Row = typeof externalCalendarEvents.$inferSelect

export function toExternalEventRecord(row: Row): ExternalEventRecord {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    location: row.location,
    url: row.url,
    hidden: row.hidden,
  }
}

// Events still in their provider (hidden ones included, so they can be restored).
export async function listExternalEvents(db: Database, userId: string): Promise<ExternalEventRecord[]> {
  const rows = await db
    .select()
    .from(externalCalendarEvents)
    .where(and(eq(externalCalendarEvents.userId, userId), isNull(externalCalendarEvents.removedAt)))
    .orderBy(asc(externalCalendarEvents.startsAt))
  return rows.map(toExternalEventRecord)
}

// "Hide from Student OS" / "Restore": a local flag only; the original is never touched.
export async function setExternalEventHidden(
  db: Database,
  userId: string,
  id: string,
  hidden: boolean
): Promise<ExternalEventRecord> {
  const [row] = await db
    .update(externalCalendarEvents)
    .set({ hidden })
    .where(and(eq(externalCalendarEvents.id, id), eq(externalCalendarEvents.userId, userId)))
    .returning()
  if (!row) throw new NotFoundError("event")
  return toExternalEventRecord(row)
}

// Disconnecting a calendar: its events stop showing (and stop blocking study
// time). They're kept, and come back if the same calendar is connected again.
export async function removeExternalEventsFrom(
  db: Database,
  userId: string,
  source: ExternalCalendarSource,
  now = new Date()
): Promise<void> {
  await db
    .update(externalCalendarEvents)
    .set({ removedAt: now })
    .where(
      and(
        eq(externalCalendarEvents.userId, userId),
        eq(externalCalendarEvents.source, source),
        isNull(externalCalendarEvents.removedAt)
      )
    )
}

// Disconnecting a personal calendar (Google Calendar, Outlook): its copied events
// are deleted, since they can be private appointments. Connecting again downloads
// them again. Only this source's rows, only this student's.
export async function deleteExternalEventsFrom(db: Database, userId: string, source: ExternalCalendarSource): Promise<number> {
  const deleted = await db
    .delete(externalCalendarEvents)
    .where(and(eq(externalCalendarEvents.userId, userId), eq(externalCalendarEvents.source, source)))
    .returning({ id: externalCalendarEvents.id })
  return deleted.length
}
