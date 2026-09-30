import "server-only"

import { eq } from "drizzle-orm"
import { authUsers } from "drizzle-orm/supabase"
import type { CalendarProviderId } from "@/lib/types"
import { calendarConnections } from "../db/schema"
import type { Database } from "../db/types"

// Deletes a student's account and everything in it (Settings > Delete account).
// Removing the Supabase Auth user removes their logins and sessions, and cascades
// to the profile and from there to every table (courses, tasks, events, calendar
// connections and tokens, push devices, reminders, feedback…).
// Connected calendars are revoked first, as a courtesy: a failure there never
// stops the deletion. Returns false when there was no such account.
export async function deleteAccount(
  db: Database,
  userId: string,
  revokeCalendar: (provider: CalendarProviderId) => Promise<void>
): Promise<boolean> {
  const calendars = await db.select({ provider: calendarConnections.provider }).from(calendarConnections).where(eq(calendarConnections.userId, userId))
  for (const { provider } of calendars) await revokeCalendar(provider).catch(() => {})
  const deleted = await db.delete(authUsers).where(eq(authUsers.id, userId)).returning({ id: authUsers.id })
  return deleted.length > 0
}
