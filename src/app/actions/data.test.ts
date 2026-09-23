import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { createCourse } from "@/server/services/courses"
import { createEvent } from "@/server/services/events"
import { loadAppData } from "@/server/services/app-data"
import { createTestDb } from "@/server/test-utils/test-db"

// The server actions, as the browser calls them. Who is signed in comes from the
// (mocked) verified session, never from the request, so changing an id in a
// request can't reach another student's data.

const session = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown }))
vi.mock("@/server/auth", () => ({
  getCurrentUser: async () => (session.userId ? { id: session.userId, email: null } : null),
}))
vi.mock("@/server/db", () => ({ getDb: () => session.db }))

const { createStudySessionAction, createTaskAction, deleteEventAction, updateEventAction, updateStudySessionAction, updateTaskAction } =
  await import("./data")
const { createPlanner, whatNow } = await import("@/lib/planner")
const { plannerInputFor } = await import("@/lib/planner-input")

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  session.db = t.db as Database
})
afterEach(() => {
  session.userId = null
  return t.close()
})

const event = { title: "Soccer Practice", date: "2026-09-22", startTime: "10:30", endTime: "13:00", type: "sports" as const }

describe("server actions", () => {
  it("refuse to do anything when nobody is signed in", async () => {
    const result = await updateEventAction(crypto.randomUUID(), { title: "x" })
    expect(result).toEqual({ ok: false, code: "unauthorized", error: "Your session has expired. Please log in again." })
  })

  it("User A can't modify or delete User B's event", async () => {
    const alice = await t.addUser("Alice")
    const bob = await t.addUser("Bob")
    const bobsEvent = await createEvent(t.db, bob, event)

    session.userId = alice
    const update = await updateEventAction(bobsEvent.id, { title: "Hacked" })
    const remove = await deleteEventAction(bobsEvent.id)

    expect(update).toMatchObject({ ok: false, code: "not-found" })
    expect(remove).toMatchObject({ ok: false, code: "not-found" })
    expect((await loadAppData(t.db, bob)).events[0].title).toBe("Soccer Practice")
  })

  it("validate input and return a friendly message", async () => {
    const alice = await t.addUser()
    session.userId = alice
    const course = await createCourse(t.db, alice, { code: "CSC215", name: "DS", professor: "", description: "" })

    const badId = await updateTaskAction("not-an-id", { title: "x" })
    expect(badId).toMatchObject({ ok: false, code: "validation" })

    const noTitle = await createTaskAction({
      id: crypto.randomUUID(),
      courseId: course.id,
      title: "   ",
      type: "assignment",
      dueDate: "2026-09-30",
      priority: "medium",
      estimateMinutes: 30,
      status: "not_started",
    })
    expect(noTitle).toEqual({ ok: false, code: "validation", error: "Give the task a title." })

    const badTimes = await updateEventAction(crypto.randomUUID(), { startTime: "15:00", endTime: "14:00" })
    expect(badTimes).toMatchObject({ ok: false, error: "End time must be after the start time." })
  })

  it("save valid changes for the signed-in student", async () => {
    const alice = await t.addUser()
    session.userId = alice
    const course = await createCourse(t.db, alice, { code: "CSC215", name: "DS", professor: "", description: "" })
    const id = crypto.randomUUID()

    const created = await createTaskAction({
      id,
      courseId: course.id,
      title: "  Problem Set 3 ",
      type: "assignment",
      dueDate: "2026-09-28",
      priority: "medium",
      estimateMinutes: 60,
      status: "not_started",
    })
    expect(created).toMatchObject({ ok: true, data: { id, title: "Problem Set 3" } })
    expect((await loadAppData(t.db, alice)).tasks.map((task) => task.id)).toEqual([id])
  })
})

describe("study session progress (partly done)", () => {
  it("saves the minutes worked; the planner then plans only what's left, and 'What now' uses it", async () => {
    const alice = await t.addUser("Alice")
    session.userId = alice
    const course = await createCourse(t.db, alice, { code: "PSY101", name: "Psychology", professor: "", description: "" })
    const created = await createTaskAction({
      id: crypto.randomUUID(),
      courseId: course.id,
      title: "Psychology Reading",
      description: "",
      type: "reading",
      dueDate: "2026-09-23",
      priority: "medium",
      estimateMinutes: 90,
      status: "not_started",
    })
    if (!created.ok) throw new Error(created.error)
    const planned = await createStudySessionAction({
      id: crypto.randomUUID(),
      taskId: created.data.id,
      date: "2026-09-21",
      startTime: "18:00",
      endTime: "19:30",
      status: "scheduled",
    })
    if (!planned.ok) throw new Error(planned.error)

    // Worked 45 of the 90 minutes.
    expect(await updateStudySessionAction(planned.data.id, { status: "completed", completedMinutes: 45 })).toMatchObject({
      ok: true,
      data: { status: "completed", completedMinutes: 45 },
    })
    expect(await updateStudySessionAction(planned.data.id, { completedMinutes: 0 })).toMatchObject({ ok: false, code: "validation" })
    expect(await updateStudySessionAction(planned.data.id, { completedMinutes: 10_000 })).toMatchObject({ ok: false, code: "validation" })

    const data = await loadAppData(t.db, alice)
    const now = new Date(2026, 8, 22, 16, 0)
    const planner = createPlanner(plannerInputFor(data, now))
    const plan = planner.planFor("2026-09-22")
    expect(plan.ranked[0].remainingMinutes).toBe(45)
    expect(plan.suggestions.reduce((sum, s) => sum + (Number(s.endTime.slice(0, 2)) * 60 + Number(s.endTime.slice(3)) - (Number(s.startTime.slice(0, 2)) * 60 + Number(s.startTime.slice(3)))), 0)).toBe(45)
    const answer = whatNow({ planner, now, today: "2026-09-22", schedule: [], events: [], tasks: data.tasks })
    expect(answer).toMatchObject({ kind: "work", task: { title: "Psychology Reading" } })

    // Undo: back to the whole session planned (not done).
    expect(await updateStudySessionAction(planned.data.id, { status: "scheduled", completedMinutes: null })).toMatchObject({
      ok: true,
      data: { completedMinutes: null },
    })
  })
})
