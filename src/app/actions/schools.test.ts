import { afterEach, describe, expect, it, vi } from "vitest"

// School suggestions as the browser asks for them: signed-in students only.

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => (session.userId ? { id: session.userId, email: null } : null) }))
vi.mock("@/server/db", () => ({ getDb: () => null }))

const { searchSchoolsAction } = await import("./schools")

afterEach(() => {
  session.userId = null
})

describe("searchSchoolsAction", () => {
  it("needs a signed-in student", async () => {
    expect(await searchSchoolsAction("q", "US")).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("returns a few matches, the student's country first; a bad country hint is just ignored", async () => {
    session.userId = "11111111-1111-1111-1111-111111111111"
    const result = await searchSchoolsAction("quinnipiac", "US")
    expect(result).toMatchObject({ ok: true, data: [{ name: "Quinnipiac University", domain: "qu.edu", country: "US" }] })
    expect(await searchSchoolsAction("quinnipiac", "not-a-country")).toMatchObject({ ok: true })
    expect(await searchSchoolsAction(42)).toMatchObject({ ok: false, code: "validation" })
    expect(await searchSchoolsAction("x".repeat(101))).toMatchObject({ ok: false, code: "validation" })
  })
})
