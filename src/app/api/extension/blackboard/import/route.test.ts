import { randomBytes } from "node:crypto"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { lmsConnections } from "@/server/db/schema"
import type { Database } from "@/server/db/types"
import { syncBlackboardFeed } from "@/server/integrations/lms/blackboard/feed-sync"
import { saveLmsFeedConnection } from "@/server/integrations/lms/connections"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { resetRateLimits } from "@/server/rate-limit"
import { listCourses } from "@/server/services/courses"
import { listExternalEvents } from "@/server/services/external-events"
import { listTasks } from "@/server/services/tasks"
import { createTestDb } from "@/server/test-utils/test-db"

// The browser extension's Blackboard import, as real HTTP requests to the route.
// TEST FIXTURES shaped after the Learn REST API spec (and what a real Ultra site
// returned to the student's session); no Blackboard is contacted.

const state = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }))
vi.mock("@/server/db", () => ({ getDb: () => state.db }))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => (state.userId ? { id: state.userId, email: null } : null) }))

const { POST } = await import("./route")

const BASE = "https://school.blackboard.com"
const membership = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  courseId: id,
  courseRoleId: "Student",
  availability: { available: "Yes" },
  course: { id, courseId: `${name.slice(0, 3).toUpperCase()}-101-F26`, name, availability: { available: "Yes" }, externalAccessUrl: `${BASE}/ultra/courses/${id}/outline` },
  ...extra,
})
const dataStructures = membership("_215_1", "Data Structures")
const project = { id: "_1_1", name: "Project 1", scoreProviderHandle: "resource/x-bb-assignment", grading: { type: "Attempts", due: "2026-10-02T03:59:00.000Z" } }
const quiz = { id: "_2_1", name: "Quiz 1", scoreProviderHandle: "resource/x-bb-asmt-test-link", grading: { type: "Attempts", due: "2026-10-03T03:59:00.000Z" } }
const participation = { id: "_4_1", name: "Participation", grading: { type: "Manual", due: "2026-10-09T03:59:00.000Z" } }
const total = { id: "_3_1", name: "Total", grading: { type: "Calculated" } }

const payload = (overrides: Record<string, unknown> = {}) => ({
  baseUrl: BASE,
  timeZone: "America/New_York",
  courses: [dataStructures],
  columns: { _215_1: [project, quiz, participation, total] },
  grades: { _215_1: [{ columnId: "_2_1", score: 9 }] },
  attempts: { _1_1: [] },
  ...overrides,
})

const EXTENSION = { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-Student-OS-Extension": "1" }
const send = async (body: unknown, userId: string | null, headers: Record<string, string> = EXTENSION) => {
  state.userId = userId
  const response = await POST(
    new Request("http://localhost:3000/api/extension/blackboard/import", {
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
afterEach(() => {
  state.userId = null
  vi.unstubAllEnvs()
  return t.close()
})

const connectionOf = async (userId: string) => (await t.db.select().from(lmsConnections).where(eq(lmsConnections.userId, userId)))[0]

describe("POST /api/extension/blackboard/import", () => {
  it("imports courses and assignments through the normal sync; grades and attempts decide what's done", async () => {
    const alex = await t.addUser("Alex")
    const response = await send(payload(), alex)
    expect(response).toMatchObject({ status: 200, body: { result: { provider: "blackboard", coursesCreated: 1, assignmentsCreated: 3, assignmentsCompleted: 1 } } })

    expect(await listCourses(t.db, alex)).toEqual([expect.objectContaining({ name: "Data Structures", code: "DAT-101-F26" })])
    const tasks = await listTasks(t.db, alex)
    // The total column is skipped. Due dates in the browser's time zone.
    expect(tasks.map((task) => task.title).sort()).toEqual(["Participation", "Project 1", "Quiz 1"])
    expect(tasks.find((task) => task.title === "Project 1")).toMatchObject({ dueDate: "2026-10-01", dueTime: "23:59", status: "not_started" })
    // Graded in Blackboard: nothing left to plan.
    expect(tasks.find((task) => task.title === "Quiz 1")).toMatchObject({ type: "quiz", status: "completed" })
    // "Open in Blackboard" opens the course (the API has no per-item student link).
    expect(tasks.find((task) => task.title === "Project 1")?.source?.url).toBe(`${BASE}/ultra/courses/_215_1/outline`)
    expect(await connectionOf(alex)).toMatchObject({ provider: "blackboard", method: "extension", baseUrl: BASE, status: "connected" })
  })

  it("the instructors' names become the course's professor (co-teachers joined); updated on the next sync", async () => {
    const alex = await t.addUser("Alex")
    const math = membership("_216_1", "Calculus")
    await send(payload({ courses: [dataStructures, math], columns: { _215_1: [project], _216_1: [participation] }, instructors: { _216_1: ["Jane Smith", "Ali Khan"] } }), alex)
    const professors = async () => Object.fromEntries((await listCourses(t.db, alex)).map((course) => [course.name, course.professor]))
    expect(await professors()).toEqual({ "Data Structures": "", Calculus: "Jane Smith, Ali Khan" })

    // A course imported before its professor was known gets it on the next sync.
    await send(payload({ courses: [dataStructures, math], columns: { _215_1: [project], _216_1: [participation] }, instructors: { _215_1: ["Maria Lopez"], _216_1: ["Jane Smith", "Ali Khan"] } }), alex)
    expect(await professors()).toEqual({ "Data Structures": "Maria Lopez", Calculus: "Jane Smith, Ali Khan" })
  })

  it("instructor names are checked like everything else", async () => {
    const alex = await t.addUser("Alex")
    expect(await send(payload({ instructors: { _215_1: ["x".repeat(101)] } }), alex)).toMatchObject({ status: 400 })
    expect(await send(payload({ instructors: { _215_1: Array.from({ length: 11 }, () => "Prof") } }), alex)).toMatchObject({ status: 400 })
    expect(await send(payload({ instructors: { _215_1: [42] } }), alex)).toMatchObject({ status: 400 })
  })

  it("a turned-in attempt marks the task done; without grades, status stays unknown", async () => {
    const alex = await t.addUser("Alex")
    await send(payload({ grades: {}, attempts: { _1_1: [{ status: "NeedsGrading" }] } }), alex)
    const tasks = await listTasks(t.db, alex)
    expect(tasks.find((task) => task.title === "Project 1")?.status).toBe("completed")
    // Graded quiz, but the extension sent no grades for the course: not assumed done.
    expect(tasks.find((task) => task.title === "Quiz 1")?.status).toBe("not_started")
  })

  it("a second import updates instead of duplicating", async () => {
    const alex = await t.addUser("Alex")
    await send(payload(), alex)
    const again = await send(payload({ columns: { _215_1: [{ ...project, name: "Project 1 (final)" }, quiz, participation] } }), alex)
    expect(again.body.result).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 1 })
    expect(await listTasks(t.db, alex)).toHaveLength(3)
  })

  it("needs the Student OS login and the extension, like every extension endpoint", async () => {
    const alex = await t.addUser("Alex")
    expect(await send(payload(), null)).toMatchObject({ status: 401, body: { loggedOut: true } })
    expect(await send(payload(), alex, { Origin: "https://evil.example.com", "X-Student-OS-Extension": "1" })).toMatchObject({ status: 403 })
    expect(await connectionOf(alex)).toBeUndefined()
  })

  it("accepts a school's own Blackboard domain; refuses addresses that aren't public HTTPS; keeps no links to other sites", async () => {
    const alex = await t.addUser("Alex")
    for (const baseUrl of ["http://school.blackboard.com", "https://10.0.0.5", "https://learn.local", "https://learn"]) {
      expect((await send(payload({ baseUrl }), alex)).status, baseUrl).toBe(400)
    }
    const own = "https://learn.myschool.edu"
    const onOwnDomain = membership("_215_1", "Data Structures", { course: { ...dataStructures.course, externalAccessUrl: "https://evil.example.com/phish" } })
    expect((await send(payload({ baseUrl: own, courses: [onOwnDomain] }), alex)).status).toBe(200)
    expect(await connectionOf(alex)).toMatchObject({ baseUrl: own })
    expect((await listTasks(t.db, alex)).every((task) => task.source?.url === undefined)).toBe(true)
  })

  it("imports only courses the student takes, and skips malformed data", async () => {
    const alex = await t.addUser("Alex")
    const response = await send(
      payload({
        courses: [
          dataStructures,
          membership("_300_1", "Teaching Assistants", { courseRoleId: "TeachingAssistant" }),
          membership("_301_1", "Chess Club", { course: { ...membership("_301_1", "Chess Club").course, organization: true } }),
          { nonsense: true },
        ],
        columns: { _215_1: [project, { id: "" }, { name: "No id" }, "junk", { ...quiz, availability: { available: "No" } }] },
      }),
      alex
    )
    expect(response).toMatchObject({ status: 200, body: { result: { coursesCreated: 1, assignmentsCreated: 1 } } })
  })

  it("rejects data that isn't shaped like a Blackboard import", async () => {
    const alex = await t.addUser("Alex")
    expect(await send("{not json", alex)).toMatchObject({ status: 400 })
    expect(await send({ courses: "all" }, alex)).toMatchObject({ status: 400 })
    const tooManyAttemptLists = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`_${i}_1`, []]))
    expect(await send(payload({ attempts: tooManyAttemptLists }), alex)).toMatchObject({ status: 400 })
    expect(await connectionOf(alex)).toBeUndefined()
  })

  it("a course the extension couldn't read is skipped; an unchecked one isn't reported as gone", async () => {
    const alex = await t.addUser("Alex")
    const math = membership("_216_1", "Calculus")
    const first = await send(payload({ courses: [dataStructures, math], columns: { _215_1: [project], _216_1: [participation] } }), alex)
    expect(first.body.result).toMatchObject({ coursesCreated: 2 })
    const next = await send(payload({ courses: [dataStructures, math], columns: { _215_1: [project] }, grades: {} }), alex)
    expect(next.body.result).toMatchObject({ coursesSkipped: 1, assignmentsMissing: 0 })
    const unchecked = await send(payload({ courses: [dataStructures], columns: { _215_1: [project] }, grades: {} }), alex)
    expect(unchecked.body.result).toMatchObject({ missingCourses: [], assignmentsMissing: 0 })
    expect(await listTasks(t.db, alex)).toHaveLength(2)
  })

  it("an id like __proto__ is just a missing list, not a crash", async () => {
    const alex = await t.addUser("Alex")
    const proto = membership("__proto__", "Weird")
    const response = await send(payload({ courses: [dataStructures, proto] }), alex)
    expect(response.status).toBe(200)
  })

  it("switching from the calendar link links its tasks (no duplicates) and hides its calendar events", async () => {
    vi.stubEnv("LMS_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
    const alex = await t.addUser("Alex")
    const feedUrl = `${BASE}/webapps/calendar/calendarFeed/0a1b2c3d4e5f60718293a4b5c6d7e8f9/learn.ics`
    await saveLmsFeedConnection(t.db, alex, "blackboard", { baseUrl: BASE, feedUrl }, getCredentialVault())
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20261001T235900",
      "SUMMARY:Project 1",
      "UID:_blackboard.platform.gradebook2.GradableItem-_1_1",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:office-hours-1",
      "SUMMARY:Office hours",
      "DTSTART:20261001T150000Z",
      "DTEND:20261001T160000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n")
    const fromFeed = await syncBlackboardFeed(t.db, alex, getCredentialVault(), {
      timeZone: "America/New_York",
      now: new Date("2026-09-25T12:00:00Z"),
      fetch: (async () => new Response(feed)) as typeof fetch,
    })
    expect(fromFeed).toMatchObject({ assignmentsCreated: 1 })
    expect(await listExternalEvents(t.db, alex)).toEqual([expect.objectContaining({ title: "Office hours" })])

    const fromExtension = await send(payload({ columns: { _215_1: [project] }, grades: {} }), alex)
    expect(fromExtension.body.result).toMatchObject({ assignmentsCreated: 0 })
    const tasks = await listTasks(t.db, alex)
    expect(tasks.filter((task) => task.title === "Project 1")).toHaveLength(1)
    expect(await connectionOf(alex)).toMatchObject({ method: "extension", feedUrlEncrypted: null })
    expect(await listExternalEvents(t.db, alex)).toEqual([])
  })
})
