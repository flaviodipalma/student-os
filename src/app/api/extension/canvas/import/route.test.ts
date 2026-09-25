import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { lmsConnections } from "@/server/db/schema"
import type { Database } from "@/server/db/types"
import { MAX_IMPORT_BYTES } from "@/server/integrations/extension/canvas-import"
import { saveLmsFeedConnection } from "@/server/integrations/lms/connections"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { syncCanvasFeed } from "@/server/integrations/lms/canvas/feed-sync"
import { resetRateLimits } from "@/server/rate-limit"
import { listCourses } from "@/server/services/courses"
import { listExternalEvents } from "@/server/services/external-events"
import { listTasks } from "@/server/services/tasks"
import { createTestDb } from "@/server/test-utils/test-db"

// The browser extension's Canvas import, as real HTTP requests to the route.
// TEST FIXTURES shaped after the documented Canvas API fields; no Canvas is contacted.

// The logged-in student comes from the (mocked) verified session, as for pages and actions.
const state = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }))
vi.mock("@/server/db", () => ({ getDb: () => state.db }))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => (state.userId ? { id: state.userId, email: null } : null) }))

const { POST } = await import("./route")

const BASE = "https://school.instructure.com"
const course = { id: 215, name: "Data Structures", course_code: "CSC 215", workflow_state: "available", teachers: [{ display_name: "Prof. Smith" }] }
const project = {
  id: 1,
  course_id: 215,
  name: "Project 1",
  due_at: "2026-09-26T03:59:00Z",
  html_url: `${BASE}/courses/215/assignments/1`,
  published: true,
  submission: { workflow_state: "unsubmitted" },
}
const quiz = { ...project, id: 2, name: "Quiz 1", is_quiz_assignment: true, submission: { workflow_state: "graded" } }
const payload = (overrides: Record<string, unknown> = {}) => ({
  baseUrl: BASE,
  timeZone: "America/New_York",
  courses: [course],
  assignments: { "215": [project, quiz] },
  ...overrides,
})

// What the extension sends: its own Origin and the custom header (plus the login cookies).
const EXTENSION = { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-Student-OS-Extension": "1" }
const request = (body: unknown, headers: Record<string, string>) =>
  new Request("http://localhost:3000/api/extension/canvas/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
// Sends as `userId` (logged in in that browser), or logged out.
const send = async (body: unknown, userId: string | null, headers: Record<string, string> = EXTENSION) => {
  state.userId = userId
  const response = await POST(request(body, headers))
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") }
}

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  state.db = t.db as Database
  resetRateLimits()
})
afterEach(() => {
  state.userId = null
  vi.unstubAllEnvs()
  return t.close()
})

async function student(name: string) {
  return { userId: await t.addUser(name) }
}

const connectionOf = async (userId: string) => (await t.db.select().from(lmsConnections).where(eq(lmsConnections.userId, userId)))[0]

describe("POST /api/extension/canvas/import", () => {
  it("imports the student's courses and assignments through the normal sync", async () => {
    const alex = await student("Alex")
    const response = await send(payload(), alex.userId)
    expect(response).toMatchObject({ status: 200, cache: "no-store" })
    expect(response.body.result).toMatchObject({ provider: "canvas", coursesCreated: 1, assignmentsCreated: 2, assignmentsCompleted: 1 })

    expect(await listCourses(t.db, alex.userId)).toEqual([expect.objectContaining({ code: "CSC 215", name: "Data Structures" })])
    const tasks = await listTasks(t.db, alex.userId)
    // Due in the browser's time zone: 03:59 UTC is 23:59 the day before in New York.
    expect(tasks.find((task) => task.title === "Project 1")).toMatchObject({ dueDate: "2026-09-25", dueTime: "23:59", status: "not_started" })
    // Already graded in Canvas: nothing left to plan.
    expect(tasks.find((task) => task.title === "Quiz 1")).toMatchObject({ type: "quiz", status: "completed" })

    expect(await connectionOf(alex.userId)).toMatchObject({ provider: "canvas", method: "extension", baseUrl: BASE, status: "connected" })
    expect((await connectionOf(alex.userId)).lastSyncedAt).not.toBeNull()
  })

  it("a second import updates instead of duplicating", async () => {
    const alex = await student("Alex")
    await send(payload(), alex.userId)
    const again = await send(payload({ assignments: { "215": [{ ...project, name: "Project 1 (final)" }, quiz] } }), alex.userId)
    expect(again.body.result).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 1 })
    expect(await listTasks(t.db, alex.userId)).toHaveLength(2)
  })

  it("logged out: 401 with a hint for the extension, and nothing written", async () => {
    const alex = await student("Alex")
    expect(await send(payload(), null)).toMatchObject({ status: 401, body: { loggedOut: true, error: expect.stringMatching(/Log in to Student OS/) } })
    expect(await listCourses(t.db, alex.userId)).toEqual([])
  })

  it("only the extension can use the login: other websites are refused (403) even when logged in", async () => {
    const alex = await student("Alex")
    const refused: Record<string, string>[] = [
      {},
      { Origin: "https://evil.example.com", "X-Student-OS-Extension": "1" },
      // A POST always has an Origin in a browser; one without isn't the extension.
      { "X-Student-OS-Extension": "1" },
      { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
      { ...EXTENSION, "X-Student-OS-Extension": "yes" },
      { ...EXTENSION, Origin: "chrome-extension://not-an-extension-id" },
      { ...EXTENSION, Origin: "moz-extension://abcdefghijklmnopabcdefghijklmnop" },
    ]
    for (const headers of refused) {
      expect(await send(payload(), alex.userId, headers), JSON.stringify(headers)).toMatchObject({ status: 403 })
    }
    expect(await connectionOf(alex.userId)).toBeUndefined()
  })

  it("with STUDENT_OS_EXTENSION_IDS set, only those extensions", async () => {
    const alex = await student("Alex")
    vi.stubEnv("STUDENT_OS_EXTENSION_IDS", "ponmlkjihgfedcbaponmlkjihgfedcba, abcdefghijklmnopabcdefghijklmnop")
    expect((await send(payload(), alex.userId)).status).toBe(200)
    vi.stubEnv("STUDENT_OS_EXTENSION_IDS", "ponmlkjihgfedcbaponmlkjihgfedcba")
    expect((await send(payload(), alex.userId)).status).toBe(403)
  })

  it("the login decides the student: Bob's browser only ever writes to Bob", async () => {
    const alex = await student("Alex")
    const bob = await student("Bob")
    // Nothing in the body can name another student.
    await send({ ...payload(), userId: alex.userId }, bob.userId)
    expect(await listTasks(t.db, bob.userId)).toHaveLength(2)
    expect(await listTasks(t.db, alex.userId)).toEqual([])
    expect(await connectionOf(alex.userId)).toBeUndefined()
  })

  it("only accepts an allowed Canvas address, and keeps no links to other sites", async () => {
    const alex = await student("Alex")
    for (const baseUrl of ["https://evil.example.com", "http://school.instructure.com", "https://127.0.0.1", "not a url"]) {
      expect((await send(payload({ baseUrl }), alex.userId)).status).toBe(400)
    }
    expect(await connectionOf(alex.userId)).toBeUndefined()

    await send(payload({ assignments: { "215": [project, { ...quiz, html_url: "https://evil.example.com/phish" }] } }), alex.userId)
    const tasks = await listTasks(t.db, alex.userId)
    expect(tasks.find((task) => task.title === "Project 1")?.source?.url).toBe(`${BASE}/courses/215/assignments/1`)
    expect(tasks.find((task) => task.title === "Quiz 1")?.source?.url).toBeUndefined()
  })

  it("rejects data that isn't JSON or isn't shaped like an import", async () => {
    const alex = await student("Alex")
    expect(await send("{not json", alex.userId)).toMatchObject({ status: 400 })
    expect(await send({ courses: "all of them" }, alex.userId)).toMatchObject({ status: 400 })
    expect(await send(payload({ courses: Array.from({ length: 101 }, () => course) }), alex.userId)).toMatchObject({ status: 400 })
    expect(await connectionOf(alex.userId)).toBeUndefined()
  })

  it("skips malformed courses and assignments, and imports the rest", async () => {
    const alex = await student("Alex")
    const response = await send(
      payload({
        courses: [course, { id: 9, name: "" }, { nonsense: true }, { id: 10, name: "Old", access_restricted_by_date: true }],
        assignments: { "215": [project, { id: 3 }, { name: "No id" }, { ...project, id: 4, published: false }, "junk"] },
      }),
      alex.userId
    )
    expect(response).toMatchObject({ status: 200, body: { result: { coursesCreated: 1, assignmentsCreated: 1 } } })
  })

  it("a course the extension couldn't read is skipped, not reported as gone", async () => {
    const alex = await student("Alex")
    const math = { id: 300, name: "Calculus", course_code: "MAT 141" }
    const response = await send(payload({ courses: [course, math], assignments: { "215": [project] } }), alex.userId)
    expect(response.body.result).toMatchObject({ coursesSkipped: 1, assignmentsCreated: 1, assignmentsMissing: 0 })
  })

  it("a course the student unchecks isn't reported as gone, and its tasks stay", async () => {
    const alex = await student("Alex")
    const math = { id: 300, name: "Calculus", course_code: "MAT 141" }
    const problemSet = { ...project, id: 30, course_id: 300, name: "Problem Set 1" }
    await send(payload({ courses: [course, math], assignments: { "215": [project], "300": [problemSet] } }), alex.userId)
    const next = await send(payload({ courses: [course], assignments: { "215": [project] } }), alex.userId)
    expect(next.body.result).toMatchObject({ missingCourses: [], assignmentsMissing: 0 })
    expect((await listTasks(t.db, alex.userId)).map((task) => task.title).sort()).toEqual(["Problem Set 1", "Project 1"])
  })

  it("refuses oversized imports (413)", async () => {
    const alex = await student("Alex")
    const big = JSON.stringify(payload({ padding: "x".repeat(MAX_IMPORT_BYTES) }))
    expect(await send(big, alex.userId)).toMatchObject({ status: 413 })
    // Even when the declared length lies.
    expect(await send(big, alex.userId, { ...EXTENSION, "Content-Length": "100" })).toMatchObject({ status: 413 })
    expect(await connectionOf(alex.userId)).toBeUndefined()
  })

  it("is rate-limited per student, like Sync now", async () => {
    const alex = await student("Alex")
    for (let i = 0; i < 20; i++) expect((await send(payload(), alex.userId)).status).toBe(200)
    expect(await send(payload(), alex.userId)).toMatchObject({ status: 429, body: { error: expect.stringMatching(/a lot right now/) } })
    // Someone else's allowance is their own.
    expect((await send(payload(), (await student("Bob")).userId)).status).toBe(200)
  })

  it("switching from the calendar feed links the tasks it already imported (no duplicates)", async () => {
    vi.stubEnv("LMS_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
    const alex = await student("Alex")
    const feedUrl = `${BASE}/feeds/calendars/user_secretfeed.ics`
    await saveLmsFeedConnection(t.db, alex.userId, "canvas", { baseUrl: BASE, feedUrl }, getCredentialVault())
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:event-assignment-1",
      "SUMMARY:Project 1 [CSC 215]",
      "DTSTART;TZID=UTC:20260926T035900",
      `URL;VALUE=URI:${BASE}/calendar?include_contexts=course_215&month=09&year=2026#assignment_1`,
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:event-calendar-event-5",
      "SUMMARY:Midterm review session",
      "DTSTART:20261001T180000Z",
      "DTEND:20261001T190000Z",
      `URL;VALUE=URI:${BASE}/calendar?include_contexts=course_215#calendar_event_5`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n")
    const fromFeed = await syncCanvasFeed(t.db, alex.userId, getCredentialVault(), {
      timeZone: "America/New_York",
      fetch: (async () => new Response(feed)) as typeof fetch,
    })
    expect(fromFeed).toMatchObject({ coursesCreated: 1, assignmentsCreated: 1 })
    expect(await listExternalEvents(t.db, alex.userId)).toEqual([expect.objectContaining({ title: "Midterm review session" })])

    const fromExtension = await send(payload({ assignments: { "215": [project] } }), alex.userId)
    expect(fromExtension.body.result).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0 })
    expect(await listCourses(t.db, alex.userId)).toHaveLength(1)
    expect(await listTasks(t.db, alex.userId)).toEqual([expect.objectContaining({ title: "Project 1", dueDate: "2026-09-25" })])
    // Now an extension connection: the feed link is gone from the database, and the
    // feed's calendar events (which would never update again) stop showing.
    expect(await connectionOf(alex.userId)).toMatchObject({ method: "extension", feedUrlEncrypted: null })
    expect(await listExternalEvents(t.db, alex.userId)).toEqual([])
  })
})
