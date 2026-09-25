"use server"

import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { lmsProviderIds, type ExternalEventRecord } from "@/lib/types"
import { parse, runAction } from "@/server/actions"
import { disconnectLms } from "@/server/integrations/lms/connections"
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

// "Hide from Student OS" / "Restore" for an external calendar event: a local
// flag on the student's own copy. Nothing is sent to the calendar or LMS.
const eventIdSchema = z.string().uuid()

export async function setExternalEventHiddenAction(id: unknown, hidden: unknown): Promise<ActionResult<ExternalEventRecord>> {
  return runAction(async ({ db, userId }) => setExternalEventHidden(db, userId, parse(eventIdSchema, id), parse(z.boolean(), hidden)))
}
