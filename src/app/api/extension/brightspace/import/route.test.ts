import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { resetRateLimits } from "@/server/rate-limit"
import { listCourses } from "@/server/services/courses"
import { listTasks } from "@/server/services/tasks"
import { BRIGHTSPACE_BASE as BASE, bsEnrollment, bsFolder, bsQuiz, bsSubmitted } from "@/server/test-utils/fake-brightspace"
import { createTestDb } from "@/server/test-utils/test-db"

// The browser extension's Brightspace import, as real HTTP requests to the route.
// TEST FIXTURES shaped after D2L's Valence API reference; no Brightspace is contacted.

const state = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }))
vi.mock("@/server/db", () => ({ getDb: () => state.db }))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => (state.userId ? { id: state.userId, email: null } : null) }))

const { POST } = await import("./route")

const payload = {
  baseUrl: BASE,
  timeZone: "America/New_York",
  courses: [bsEnrollment(6606, { Name: "Data Structures", Code: "CS-215-01" })],
  folders: { "6606": [bsFolder(11), bsFolder(12)] },
  quizzes: { "6606": [bsQuiz(21)] },
  submissions: { "11": [bsSubmitted] },
}

const EXTENSION = { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-Quadernio-Extension": "1" }
const send = async (body: unknown, userId: string | null, headers: Record<string, string> = EXTENSION) => {
  state.userId = userId
  const response = await POST(
    new Request("http://localhost:3000/api/extension/brightspace/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  )
  return { status: response.status, body: await response.json() }
}

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  state.db = t.db as Database
  resetRateLimits()
})
afterEach(() => t.close())

describe("POST /api/extension/brightspace/import", () => {
  it("imports the student's courses, assignments and quizzes", async () => {
    const alex = await t.addUser("Alex")
    const { status, body } = await send(payload, alex)
    expect(status).toBe(200)
    expect(body.result).toMatchObject({ provider: "brightspace", coursesCreated: 1, assignmentsCreated: 3 })
    expect((await listCourses(t.db, alex)).map((course) => course.name)).toEqual(["Data Structures"])
    expect((await listTasks(t.db, alex)).map((task) => task.title).sort()).toEqual(["Assignment 11", "Assignment 12", "Quiz 21"])
  })

  it("only the extension, only for a logged-in student, only Brightspace data", async () => {
    const alex = await t.addUser("Alex")
    expect((await send(payload, alex, { "X-Quadernio-Extension": "1", Origin: "https://evil.example.com" })).status).toBe(403)
    expect((await send(payload, null)).status).toBe(401)
    expect(await send("{not json", alex)).toMatchObject({ status: 400, body: { error: expect.stringMatching(/Brightspace data/) } })
    expect(await send({ ...payload, folders: "nope" }, alex)).toMatchObject({ status: 400 })
    expect(await listTasks(t.db, alex)).toEqual([])
  })
})
