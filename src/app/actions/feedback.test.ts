import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { createTestDb } from "@/server/test-utils/test-db"

// Beta feedback: the server action with a real database (PGlite) and a mocked
// verified session.

const session = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown }))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => (session.userId ? { id: session.userId, email: null } : null) }))
vi.mock("@/server/db", () => ({ getDb: () => session.db }))

const { sendFeedbackAction } = await import("./feedback")
const { resetRateLimits } = await import("@/server/rate-limit")
const { feedback } = await import("@/server/db/schema")

let t: Awaited<ReturnType<typeof createTestDb>>
let student: string
beforeAll(async () => {
  t = await createTestDb()
  session.db = t.db as Database
  student = await t.addUser("Sam")
})
afterAll(() => t.close())
beforeEach(() => {
  session.userId = student
  resetRateLimits()
})

describe("Send feedback", () => {
  it("saves the kind, message and page (a path only: no query string, which can hold ids) for the signed-in student", async () => {
    expect(await sendFeedbackAction({ kind: "confusing", message: "  Where do I add soccer?  ", page: "/planner?date=2026-09-24#x" })).toEqual({ ok: true, data: null })
    const [row] = await t.db.select().from(feedback)
    expect(row).toMatchObject({ userId: student, kind: "confusing", message: "Where do I add soccer?", page: "/planner" })
  })

  it("refuses signed-out requests, empty or oversized messages and unknown kinds; drops non-path pages", async () => {
    session.userId = null
    expect(await sendFeedbackAction({ kind: "bug", message: "x" })).toMatchObject({ ok: false, code: "unauthorized" })
    session.userId = student
    expect(await sendFeedbackAction({ kind: "bug", message: "   " })).toMatchObject({ ok: false, code: "validation", error: "Write a few words first." })
    expect(await sendFeedbackAction({ kind: "bug", message: "x".repeat(2001) })).toMatchObject({ ok: false, code: "validation" })
    expect(await sendFeedbackAction({ kind: "spam", message: "x" })).toMatchObject({ ok: false, code: "validation" })
    expect(await sendFeedbackAction({ kind: "idea", message: "Dark calendar", page: "https://evil.example/x" })).toMatchObject({ ok: true })
    const rows = await t.db.select().from(feedback)
    expect(rows.find((r) => r.message === "Dark calendar")?.page).toBeNull()
  })

  it("rate limited (10 an hour per student)", async () => {
    for (let i = 0; i < 10; i++) expect((await sendFeedbackAction({ kind: "other", message: `note ${i}` })).ok).toBe(true)
    expect(await sendFeedbackAction({ kind: "other", message: "one more" })).toMatchObject({ ok: false, code: "unavailable" })
  })
})
