import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "./db/types"
import { createTestDb } from "./test-utils/test-db"

// Loading a signed-in student's app: their data, a session whose account was
// deleted (log this browser out), and an unreachable database (the error page).

const mocks = vi.hoisted(() => ({ db: null as unknown, user: { id: "", email: "" }, dbDown: false }))
vi.mock("./auth", () => ({ requireUser: async () => mocks.user }))
vi.mock("./db", () => ({
  getDb: () => {
    if (mocks.dbDown) throw new Error("connect ECONNREFUSED")
    return mocks.db
  },
}))
vi.mock("./student-clock", () => ({
  getStudentClock: async () => ({ wallClock: { date: "2026-09-30", minutes: 600 } }),
  getStudentTimeZone: async () => "America/New_York",
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
}))

const { loadSignedInApp } = await import("./app-loader")

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
  mocks.db = t.db as Database
})
afterAll(() => t.close())
beforeEach(() => {
  mocks.dbDown = false
})

describe("loadSignedInApp", () => {
  it("loads the signed-in student's data", async () => {
    const id = await t.addUser("Jordan")
    mocks.user = { id, email: "jordan@example.com" }
    const app = await loadSignedInApp()
    expect(app?.data.student.firstName).toBe("Jordan")
  })

  it("a session whose account was deleted goes to /auth/signed-out, not the database error", async () => {
    const id = await t.addUser("Gone")
    await t.client.query("delete from auth.users where id = $1", [id])
    mocks.user = { id, email: "gone@example.com" }
    await expect(loadSignedInApp()).rejects.toThrow("REDIRECT /auth/signed-out")
  })

  it("an unreachable database shows the database error (nobody is logged out)", async () => {
    mocks.user = { id: await t.addUser("Sam"), email: "sam@example.com" }
    mocks.dbDown = true
    expect(await loadSignedInApp()).toBeNull()
  })
})
