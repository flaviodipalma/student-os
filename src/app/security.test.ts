import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { Database } from "@/server/db/types"
import { createTestDb } from "@/server/test-utils/test-db"

// Security audit (Prompt 27): what an attacker would try, against the real
// server actions, API route and database (PGlite). The signed-in user comes
// from a mocked verified session, exactly where the app reads it; everything
// else is real. No AI provider or external service is contacted.

const session = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown }))
vi.mock("@/server/auth", () => ({
  getCurrentUser: async () => (session.userId ? { id: session.userId, email: null } : null),
  createSupabaseServerClient: async () => ({ auth: { getUserIdentities: async () => ({ data: null, error: { code: "session_not_found" } }) } }),
}))
vi.mock("@/server/db", () => ({ getDb: () => session.db }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }), headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
}))

const data = await import("./actions/data")
const settings = await import("./actions/settings")
const notificationsActions = await import("./actions/notifications")
const assistant = await import("./actions/assistant")
const calendar = await import("./actions/calendar-integrations")
const integrations = await import("./actions/integrations")
const auth = await import("./actions/auth")
const { POST: extractSyllabus } = await import("./api/syllabus/extract/route")
const { makeManyPagesPdf, makeTextPdf } = await import("@/lib/syllabus/test-utils/make-pdf")
const { resetRateLimits } = await import("@/server/rate-limit")
const schema = await import("@/server/db/schema")
const { listNotifications } = await import("@/server/services/notifications")

let t: Awaited<ReturnType<typeof createTestDb>>
let alice: string
let mallory: string
const own = {} as Record<"course" | "task" | "event" | "session" | "commitment", string>

beforeAll(async () => {
  process.env.ASSISTANT_AI_PROVIDER = "mock"
  process.env.SYLLABUS_AI_PROVIDER = "mock"
  t = await createTestDb()
  session.db = t.db as Database
  alice = await t.addUser("Alice")
  mallory = await t.addUser("Mallory")
  session.userId = alice
  const ok = <T>(result: { ok: boolean; data?: T }) => {
    expect(result.ok).toBe(true)
    return result.data as T & { id: string }
  }
  own.course = ok(await data.createCourseAction({ id: crypto.randomUUID(), code: "CSC215", name: "Databases", professor: "", description: "" })).id
  own.task = ok(
    await data.createTaskAction({ id: crypto.randomUUID(), courseId: own.course, title: "Project", description: "", type: "project", dueDate: "2026-10-01", priority: "high", estimateMinutes: 120, status: "not_started" })
  ).id
  own.event = ok(await data.createEventAction({ id: crypto.randomUUID(), title: "Class", date: "2026-10-01", startTime: "09:00", endTime: "10:00", type: "class" })).id
  own.session = ok(await data.createStudySessionAction({ id: crypto.randomUUID(), taskId: own.task, date: "2026-09-30", startTime: "14:00", endTime: "15:00", status: "scheduled" })).id
  own.commitment = ok(await settings.createCommitmentAction({ id: crypto.randomUUID(), title: "Soccer", daysOfWeek: [1], startTime: "16:00", endTime: "18:00", type: "sports" })).id
})
afterAll(() => t.close())
beforeEach(() => {
  session.userId = alice
  resetRateLimits()
})

describe("authentication: nothing runs without a signed-in student", () => {
  it("every kind of server action refuses a signed-out request", async () => {
    session.userId = null
    const id = crypto.randomUUID()
    const attempts = [
      data.updateTaskAction(id, { title: "x" }),
      data.deleteCourseAction(id),
      data.createEventAction({}),
      data.deleteStudySessionAction(id),
      settings.updatePreferencesAction({}),
      settings.deleteCommitmentAction(id),
      settings.updateThemeAction("dark"),
      notificationsActions.syncNotificationsAction(),
      notificationsActions.dismissNotificationAction(id),
      assistant.askAssistantAction({ messages: [{ role: "user", content: "hi" }] }),
      assistant.confirmAssistantAction({ kind: "complete-task", taskId: id }),
      calendar.syncCalendarAction("google"),
      calendar.disconnectCalendarAction("outlook"),
      integrations.syncLmsAction("canvas"),
      integrations.setExternalEventHiddenAction(id, true),
      auth.unlinkLoginMethodAction("identity"),
    ]
    for (const result of await Promise.all(attempts)) expect(result).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("the syllabus upload API refuses signed-out requests before reading the file", async () => {
    session.userId = null
    const response = await extractSyllabus(new Request("http://localhost/api/syllabus/extract", { method: "POST", body: "x" }))
    expect(response.status).toBe(401)
  })
})

describe("authorization: Mallory can't touch Alice's data by changing ids", () => {
  beforeEach(() => {
    session.userId = mallory
  })

  it("read, change or delete: every attempt is 'not found' (the same answer as a missing id)", async () => {
    const attempts = [
      data.updateCourseAction(own.course, { name: "pwned" }),
      data.deleteCourseAction(own.course),
      data.updateTaskAction(own.task, { title: "pwned" }),
      data.deleteTaskAction(own.task),
      data.updateEventAction(own.event, { title: "pwned" }),
      data.deleteEventAction(own.event),
      data.updateStudySessionAction(own.session, { status: "completed" }),
      data.deleteStudySessionAction(own.session),
      settings.updateCommitmentAction(own.commitment, { title: "pwned" }),
      settings.deleteCommitmentAction(own.commitment),
    ]
    for (const result of await Promise.all(attempts)) expect(result).toMatchObject({ ok: false, code: "not-found" })
  })

  it("can't attach her own records to Alice's course or task", async () => {
    expect(
      await data.createTaskAction({ id: crypto.randomUUID(), courseId: own.course, title: "Mine", description: "", type: "assignment", dueDate: "2026-10-01", priority: "low", estimateMinutes: 30, status: "not_started" })
    ).toMatchObject({ ok: false, code: "not-found" })
    expect(
      await data.createStudySessionAction({ id: crypto.randomUUID(), taskId: own.task, date: "2026-09-30", startTime: "18:00", endTime: "19:00", status: "scheduled" })
    ).toMatchObject({ ok: false, code: "not-found" })
    expect(await data.createEventAction({ id: crypto.randomUUID(), title: "x", date: "2026-10-01", startTime: "09:00", endTime: "10:00", type: "class", courseId: own.course })).toMatchObject({ ok: false, code: "not-found" })
  })

  it("the Assistant's Confirm checks ownership itself (the AI is not an authorization layer)", async () => {
    expect(await assistant.confirmAssistantAction({ kind: "complete-task", taskId: own.task })).toMatchObject({ ok: false })
    expect(await assistant.confirmAssistantAction({ kind: "schedule-session", taskId: own.task, sessionId: own.session, date: "2026-10-05", startTime: "10:00", endTime: "11:00" })).toMatchObject({ ok: false })
    // Malformed tool arguments never reach a service.
    expect(await assistant.confirmAssistantAction({ kind: "delete-everything" })).toMatchObject({ ok: false, code: "validation" })
  })

  it("Alice's data is unchanged after all of that", async () => {
    const [task] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, own.task))
    const [course] = await t.db.select().from(schema.courses).where(eq(schema.courses.id, own.course))
    const [studySession] = await t.db.select().from(schema.studySessions).where(eq(schema.studySessions.id, own.session))
    expect(task).toMatchObject({ title: "Project", userId: alice })
    expect(course.courseName).toBe("Databases")
    expect(studySession.status).toBe("scheduled")
  })

  it("mass assignment: extra fields (a user id, an id) are dropped, never written", async () => {
    session.userId = alice
    const result = await data.updateTaskAction(own.task, { title: "Project", userId: mallory, id: crypto.randomUUID(), source: { provider: "canvas" } })
    expect(result.ok).toBe(true)
    const [task] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, own.task))
    expect(task).toMatchObject({ id: own.task, userId: alice, externalSource: null })
  })
})

describe("database: ownership is enforced below the services too", () => {
  it("a task can't point at another student's course, nor a session at another student's task", async () => {
    const insertTask = t.db.insert(schema.tasks).values({ userId: mallory, courseId: own.course, title: "x", type: "assignment", dueDate: "2026-10-01", priority: "low", status: "not_started" })
    await expect(insertTask).rejects.toThrow()
    const insertSession = t.db.insert(schema.studySessions).values({ userId: mallory, taskId: own.task, date: "2026-10-01", startTime: "09:00", endTime: "10:00", status: "scheduled" })
    await expect(insertSession).rejects.toThrow()
  })
})

describe("syllabus upload", () => {
  const upload = (bytes: Uint8Array | ReadableStream, init: RequestInit = {}) => {
    const form = new FormData()
    if (bytes instanceof Uint8Array) form.set("file", new File([bytes.slice()], "syllabus.pdf", { type: "application/pdf" }))
    return extractSyllabus(new Request("http://localhost/api/syllabus/extract", { method: "POST", body: bytes instanceof Uint8Array ? form : bytes, ...init }))
  }
  const messages = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line))

  it("a body larger than the limit is refused even without a Content-Length header (no unbounded buffering)", async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const stream = new ReadableStream({
      pull(controller) {
        if (sent++ > 12) return controller.close()
        controller.enqueue(chunk)
      },
    })
    const response = await upload(stream, { duplex: "half", headers: { "Content-Type": "multipart/form-data; boundary=x" } } as RequestInit)
    expect(response.status).toBe(413)
    expect(sent).toBeLessThan(13)
  })

  it("a file that isn't a PDF, and a PDF with hundreds of pages, are refused with a plain message", async () => {
    const notPdf = await messages(await upload(new TextEncoder().encode("<script>alert(1)</script>")))
    expect(notPdf.at(-1)).toMatchObject({ type: "error", code: "invalid-file-type" })
    const huge = await messages(await upload(makeManyPagesPdf(101)))
    expect(huge.at(-1)).toMatchObject({ type: "error", code: "too-long" })
  })

  it("a real syllabus still goes through (mock AI), and nothing is stored until the student imports", async () => {
    const result = await messages(await upload(makeTextPdf(["HIS210 — Modern History", "Instructor: Professor Rivera", "Fall 2026", "Essay 1 — October 9", "Midterm Exam — October 21"])))
    expect(result.at(-1)).toMatchObject({ type: "result" })
    expect(await t.db.select().from(schema.syllabusImports)).toEqual([])
  })

  it("rate limited per student (each import is a paid AI request)", async () => {
    let last: Response | null = null
    for (let i = 0; i < 11; i++) last = await upload(new TextEncoder().encode("x"))
    expect(last?.status).toBe(429)
    expect((await last!.json()).code).toBe("rate-limited")
  })
})

describe("abuse limits", () => {
  it("Assistant messages are rate limited per student, with a friendly message", async () => {
    const ask = () => assistant.askAssistantAction({ messages: [{ role: "user", content: "What's due this week?" }] })
    for (let i = 0; i < 20; i++) expect((await ask()).ok).toBe(true)
    expect(await ask()).toMatchObject({ ok: false, code: "unavailable", error: "You're doing that a lot right now. Please wait a few minutes and try again." })
    // Another student isn't affected.
    session.userId = mallory
    expect((await ask()).ok).toBe(true)
  })
})

describe("links and browser protections", () => {
  it("a reminder can only ever link inside the app (the database refuses anything else)", async () => {
    const insert = (link: string) =>
      t.db.insert(schema.notifications).values({ userId: alice, type: "task_due_soon", dedupeKey: `evil:${link}`, title: "x", message: "x", link, scheduledFor: new Date() })
    for (const link of ["//evil.example/phish", "https://evil.example", "javascript:alert(1)"]) await expect(insert(link)).rejects.toThrow()
    await insert("/tasks")
    expect((await listNotifications(t.db, alice)).find((n) => n.title === "x")?.link).toBe("/tasks")
  })

  it("security headers: CSP (no framing, no plugins), nosniff, referrer policy", async () => {
    const config = (await import("../../next.config")).default
    const rules = await config.headers!()
    const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))
    expect(rules[0].source).toBe("/(.*)")
    expect(headers["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/)
    expect(headers["Content-Security-Policy"]).toMatch(/object-src 'none'/)
    expect(headers["Content-Security-Policy"]).toMatch(/connect-src 'self'/)
    expect(headers["X-Frame-Options"]).toBe("DENY")
    expect(headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin")
    expect(config.poweredByHeader).toBe(false)
  })
})
