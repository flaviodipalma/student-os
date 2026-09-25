import "server-only"

import { and, eq } from "drizzle-orm"
import {
  planExternalEvents,
  type ExternalCalendarEvent,
  type StoredExternalEvent,
} from "@/lib/calendar/external-events"
import type { ExternalCalendarSource } from "@/lib/types"
import { externalCalendarEvents } from "../../db/schema"
import type { Database } from "../../db/types"
import { tryLock } from "../lms/sync"
import { logger } from "@/server/log"

// The calendar sync service: saves one provider's normalized events for one
// student (Google Calendar, Outlook). Shared by every provider; provider-specific
// reading lives in the provider's own folder.
//
//   new       -> created
//   unchanged -> nothing
//   changed   -> updated in place (same row, so no duplicate), hidden stays hidden
//   gone      -> marked removed (kept, not shown), if it hadn't ended yet
//
// Everything is scoped to `userId`, which always comes from the signed-in
// session. Each event is saved in its own savepoint: one bad event is skipped
// and reported, the rest are saved.

export type CalendarSyncResult = {
  added: number
  updated: number
  removed: number
  // Events the source had that can't be shown (all-day, no time, no length, too long).
  skipped: number
  failed: number
}

export async function syncExternalCalendar(
  db: Database,
  userId: string,
  source: ExternalCalendarSource,
  events: ExternalCalendarEvent[],
  options: { now: Date; skipped?: number }
): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = { added: 0, updated: 0, removed: 0, skipped: options.skipped ?? 0, failed: 0 }
  await db.transaction(async (tx) => {
    // One calendar sync per student and source at a time (a second one just stops).
    if (!(await tryLock(tx, `calendar-sync:${userId}:${source}`))) return

    const rows = await tx
      .select()
      .from(externalCalendarEvents)
      .where(and(eq(externalCalendarEvents.userId, userId), eq(externalCalendarEvents.source, source)))
    const existing: StoredExternalEvent[] = rows.map((row) => ({
      id: row.id,
      source: row.source,
      externalId: row.externalId,
      title: row.title,
      description: row.description,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      location: row.location,
      url: row.url,
      removedAt: row.removedAt?.toISOString() ?? null,
    }))

    const fields = (event: ExternalCalendarEvent) => ({
      title: event.title,
      description: event.description,
      startsAt: new Date(event.startsAt),
      endsAt: new Date(event.endsAt),
      location: event.location,
      url: event.url,
      removedAt: null,
      syncedAt: options.now,
    })
    for (const action of planExternalEvents(existing, events, { source, missingFrom: options.now })) {
      try {
        await tx.transaction(async (sp) => {
          if (action.kind === "create") {
            await sp.insert(externalCalendarEvents).values({ userId, source, externalId: action.event.externalId, ...fields(action.event) })
          } else if (action.kind === "update") {
            await sp
              .update(externalCalendarEvents)
              .set(fields(action.event))
              .where(and(eq(externalCalendarEvents.id, action.id), eq(externalCalendarEvents.userId, userId)))
          } else {
            await sp
              .update(externalCalendarEvents)
              .set({ removedAt: options.now })
              .where(and(eq(externalCalendarEvents.id, action.id), eq(externalCalendarEvents.userId, userId)))
          }
        })
        if (action.kind === "create") result.added++
        else if (action.kind === "update") result.updated++
        else result.removed++
      } catch (error) {
        // Only the error's type is logged: event data stays out of the logs.
        logger.error(`calendar:${source}`, `couldn't save an event`, { name: error instanceof Error ? error.name : typeof error })
        result.failed++
      }
    }
  })
  return result
}
