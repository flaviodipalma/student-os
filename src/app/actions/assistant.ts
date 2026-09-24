"use server"

import type { ActionResult } from "@/lib/action-result"
import type { AssistantReply, ConfirmedChange } from "@/lib/assistant"
import { limitRate, parse, runAction } from "@/server/actions"
import { getAssistantAIService } from "@/server/assistant"
import { askAssistant, askAssistantSchema, confirmAssistantChange, proposedActionSchema } from "@/server/assistant/service"
import { RATE_LIMITS } from "@/server/rate-limit"
import { getStudentClock, getStudentTimeZone } from "@/server/student-clock"

// The Assistant's two server actions. The signed-in student comes from the
// verified session (runAction); nothing from the browser is trusted until parsed.

export async function askAssistantAction(input: unknown): Promise<ActionResult<AssistantReply>> {
  return runAction(async ({ db, userId }) => {
    const request = parse(askAssistantSchema, input)
    // Every message is a paid AI request.
    limitRate(userId, "assistant", RATE_LIMITS.assistant)
    const [{ now }, timeZone] = await Promise.all([getStudentClock(), getStudentTimeZone()])
    return askAssistant({ db, userId, now, timeZone, ai: getAssistantAIService() }, request)
  })
}

// Saves a change the student confirmed (checked again first).
export async function confirmAssistantAction(action: unknown): Promise<ActionResult<ConfirmedChange>> {
  return runAction(async ({ db, userId }) => {
    const parsed = parse(proposedActionSchema, action)
    const [{ now }, timeZone] = await Promise.all([getStudentClock(), getStudentTimeZone()])
    return confirmAssistantChange({ db, userId, now, timeZone }, parsed)
  })
}
