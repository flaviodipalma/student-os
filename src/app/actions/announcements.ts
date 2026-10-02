"use server"

import type { ActionResult } from "@/lib/action-result"
import type { AnnouncementFinding, ClassCancellation, Task } from "@/lib/types"
import { idSchema } from "@/lib/validation"
import { parse, runAction } from "@/server/actions"
import { acceptFinding, dismissFinding, removeClassCancellation } from "@/server/services/announcements"

// The Dashboard's "From your announcements" card: accept a suggestion (it becomes a
// task, or that day's class is cancelled), dismiss it, or take a cancelled class back.
// The signed-in student only; ids come from their own suggestions.

export async function acceptFindingAction(
  id: unknown
): Promise<ActionResult<{ finding: AnnouncementFinding; task?: Task; cancellation?: ClassCancellation }>> {
  return runAction(({ db, userId }) => acceptFinding(db, userId, parse(idSchema, id)))
}

export async function dismissFindingAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await dismissFinding(db, userId, parse(idSchema, id))
    return null
  })
}

export async function removeClassCancellationAction(id: unknown): Promise<ActionResult<{ finding: AnnouncementFinding | null }>> {
  return runAction(({ db, userId }) => removeClassCancellation(db, userId, parse(idSchema, id)))
}
