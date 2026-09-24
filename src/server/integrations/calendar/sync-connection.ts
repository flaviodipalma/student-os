import "server-only"

import { calendarSyncWindow } from "@/lib/calendar/sync-window"
import type { Database } from "../../db/types"
import type { CredentialVault } from "../lms/credential-vault"
import { syncExternalCalendar, type CalendarSyncResult } from "./calendar-sync"
import { createCalendarAccess, recordCalendarSync } from "./connections"
import { CalendarProviderError, type CalendarProvider } from "./provider"

// "Sync now" for a personal calendar:
//   1. valid tokens (refreshed if needed; a revoked grant -> "needs attention")
//   2. the provider's events in the sync window (paged; recurring -> occurrences)
//   3. normalized (ExternalCalendarEvent) and saved by the shared calendar sync:
//      one row per (student, source, external id), changes updated in place,
//      events gone from the provider marked removed
//   4. last synced time (or a safe error) on the connection
// Only this provider's events are touched; other calendars, the student's own
// events, tasks, courses and study sessions never are.

export async function syncCalendarConnection(
  db: Database,
  userId: string,
  provider: CalendarProvider,
  vault: CredentialVault,
  options: { now?: Date } = {}
): Promise<CalendarSyncResult> {
  const now = options.now ?? new Date()
  try {
    const access = await createCalendarAccess(db, userId, provider, vault, () => now)
    const fetched = await provider.listEvents(access, calendarSyncWindow(now))
    const result = await syncExternalCalendar(db, userId, provider.id, fetched.events, { now, skipped: fetched.skipped })
    await recordCalendarSync(db, userId, provider.id, { ok: true, at: now })
    return result
  } catch (error) {
    const safe = error instanceof CalendarProviderError ? error : new CalendarProviderError("failed", provider.name)
    // Only the error's type is logged: provider responses can contain tokens.
    console.error(`[calendar:${provider.id}] sync failed`, { kind: safe.kind, name: error instanceof Error ? error.name : typeof error })
    await recordCalendarSync(db, userId, provider.id, { ok: false, error: safe }).catch(() => {})
    throw safe
  }
}
