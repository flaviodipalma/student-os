import "server-only"

import type { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { firstIssue } from "@/lib/validation"
import { getCurrentUser } from "./auth"
import { getDb } from "./db"
import type { Database } from "./db/types"
import { RateLimitedError, toAppError, UnauthorizedError, ValidationError } from "./errors"
import { takeRateLimit, type RateLimit } from "./rate-limit"

// The shared shape of every server action:
//   1. who is signed in? (never trusted from the request; read from the verified session)
//   2. validate the input
//   3. call the service with that user's id
//   4. turn any failure into a safe message
export async function runAction<T>(
  work: (context: { db: Database; userId: string }) => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const user = await getCurrentUser()
    if (!user) throw new UnauthorizedError()
    return { ok: true, data: await work({ db: getDb(), userId: user.id }) }
  } catch (error) {
    const appError = toAppError(error)
    return { ok: false, error: appError.message, code: appError.code }
  }
}

// Counts one expensive request (AI, an external sync) for this student; throws if
// they've made too many recently (the action returns a friendly message).
export function limitRate(userId: string, bucket: string, limits: RateLimit[]): void {
  if (!takeRateLimit(`${bucket}:${userId}`, limits).ok) throw new RateLimitedError()
}

// Validates untrusted input from the browser; throws a ValidationError with the first problem.
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new ValidationError(firstIssue(result.error))
  return result.data
}
