"use server"

import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { lmsProviderIds, type ExternalEventRecord } from "@/lib/types"
import { parse, runAction } from "@/server/actions"
import { disconnectLms, listLmsConnections } from "@/server/integrations/lms/connections"
import { listCourses } from "@/server/services/courses"
import { removeExternalEventsFrom, setExternalEventHidden } from "@/server/services/external-events"

// Server actions for Canvas and Blackboard (the Integrations page). Connecting and
// syncing happen in the Student OS browser extension, with the student's own LMS
// login (src/server/integrations/extension); here the student can only disconnect.
// The student is always the signed-in one (from the session), never from the request.

const providerSchema = z.enum(lmsProviderIds)

// Disconnects: deletes the connection. Imported courses and tasks stay; the LMS's
// calendar events (from before, if any) stop showing. The next Sync now in the
// extension connects it again.
export async function disconnectLmsAction(provider: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    const id = parse(providerSchema, provider)
    await disconnectLms(db, userId, id)
    await removeExternalEventsFrom(db, userId, id)
    return null
  })
}

// Onboarding's tutorial waits for the student's first sync from the extension:
// has this LMS synced yet, and how many of its courses are in Student OS.
export async function lmsSyncStatusAction(provider: unknown): Promise<ActionResult<{ syncedAt: string | null; courses: number }>> {
  return runAction(async ({ db, userId }) => {
    const id = parse(providerSchema, provider)
    const connection = (await listLmsConnections(db, userId)).find((c) => c.provider === id)
    const courses = (await listCourses(db, userId)).filter((course) => course.source?.provider === id).length
    return { syncedAt: connection?.lastSyncedAt ?? null, courses }
  })
}

// "Hide from Student OS" / "Restore" for an external calendar event: a local
// flag on the student's own copy. Nothing is sent to the calendar or LMS.
const eventIdSchema = z.string().uuid()

export async function setExternalEventHiddenAction(id: unknown, hidden: unknown): Promise<ActionResult<ExternalEventRecord>> {
  return runAction(async ({ db, userId }) => setExternalEventHidden(db, userId, parse(eventIdSchema, id), parse(z.boolean(), hidden)))
}
