"use server"

import type { ActionResult } from "@/lib/action-result"
import { limitRate, parse, runAction } from "@/server/actions"
import { feedbackSchema, saveFeedback } from "@/server/services/feedback"

// "Send feedback": the signed-in student's own feedback (a few per hour at most).
export async function sendFeedbackAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    const parsed = parse(feedbackSchema, input)
    limitRate(userId, "feedback", [{ limit: 10, windowMs: 60 * 60_000 }])
    await saveFeedback(db, userId, parsed)
    return null
  })
}
