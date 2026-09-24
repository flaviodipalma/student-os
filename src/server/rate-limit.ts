import "server-only"

// Per-student limits on the expensive requests: AI (the Assistant, syllabus
// import) and external syncs (Canvas, Blackboard, Google, Outlook). Login and
// sign-up are limited by Supabase Auth itself.
//
// In memory, per server instance: enough for one server (development, a single
// deployment). With several instances, each has its own counts; a shared store
// (e.g. Redis / the hosting platform's rate limiting) is a production item
// (docs/security.md).

export type RateLimit = { limit: number; windowMs: number }

export const RATE_LIMITS = {
  // A conversation, not a script: a message every few seconds is plenty.
  assistant: [
    { limit: 20, windowMs: 60_000 },
    { limit: 300, windowMs: 24 * 60 * 60_000 },
  ],
  syllabus: [{ limit: 10, windowMs: 60 * 60_000 }],
  sync: [{ limit: 20, windowMs: 60 * 60_000 }],
} satisfies Record<string, RateLimit[]>

const hits = new Map<string, number[]>()
let lastSweep = 0

// Records one request for `key` and says whether it's allowed under every limit.
export function takeRateLimit(key: string, limits: RateLimit[], now = Date.now()): { ok: true } | { ok: false; retryAfterMs: number } {
  sweep(now)
  const longest = Math.max(...limits.map((l) => l.windowMs))
  const recent = (hits.get(key) ?? []).filter((at) => now - at < longest)
  for (const { limit, windowMs } of limits) {
    const inWindow = recent.filter((at) => now - at < windowMs)
    if (inWindow.length >= limit) {
      hits.set(key, recent)
      return { ok: false, retryAfterMs: windowMs - (now - inWindow[0]) }
    }
  }
  recent.push(now)
  hits.set(key, recent)
  return { ok: true }
}

// Forget keys with no recent requests (at most once a minute).
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, times] of hits) {
    if (times.every((at) => now - at > 24 * 60 * 60_000)) hits.delete(key)
  }
}

// Only for tests.
export function resetRateLimits() {
  hits.clear()
}

export const RATE_LIMITED_MESSAGE = "You're doing that a lot right now. Please wait a few minutes and try again."
