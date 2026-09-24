import "server-only"

import { z } from "zod"
import { feedback } from "../db/schema"
import type { Database } from "../db/types"

// Beta feedback: saved for the signed-in student, nothing else collected.

export const feedbackKinds = ["bug", "confusing", "idea", "other"] as const

export const feedbackSchema = z.object({
  kind: z.enum(feedbackKinds, { error: "Choose what kind of feedback this is." }),
  message: z.string().trim().min(1, "Write a few words first.").max(2000, "Keep it under 2,000 characters."),
  // The page it's about: a path only (no query string, which can hold ids).
  page: z
    .string()
    .max(500)
    .optional()
    .transform((value) => {
      const path = value?.split(/[?#]/)[0]
      return path && path.startsWith("/") && !path.startsWith("//") ? path.slice(0, 200) : null
    }),
})
export type FeedbackInput = z.input<typeof feedbackSchema>

export async function saveFeedback(db: Database, userId: string, input: z.output<typeof feedbackSchema>): Promise<void> {
  await db.insert(feedback).values({ userId, kind: input.kind, message: input.message, page: input.page })
}
