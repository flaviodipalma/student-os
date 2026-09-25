import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generatePlan } from "@/lib/planner"
import { createTestDb } from "../../../test-utils/test-db"
import { loadAppData } from "../../../services/app-data"
import { updateTask } from "../../../services/tasks"
import { importCanvasFromExtension } from "../../extension/canvas-import"
import { canvasAssignmentToLms, canvasCourseToLms, canvasDueToLocal, htmlToText } from "./mapping"

// Canvas data in Student OS: the mapping (canvas/mapping.ts) and whole syncs through
// the only way in, the browser extension's import, against a real Postgres. TEST
// FIXTURES are hand-written, shaped after the fields documented in the Canvas REST
// API (Courses, Assignments); they aren't real Canvas data.

const BASE = "https://school.instructure.com"

const course = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Course ${id}`,
  course_code: `CSC${id}`,
  workflow_state: "available",
  teachers: [{ display_name: "Prof. Smith" }],
  ...overrides,
})
const assignment = (id: number, courseId: number, overrides: Record<string, unknown> = {}) => ({
  id,
  course_id: courseId,
  name: `Assignment ${id}`,
  description: "<p>Read <b>chapter 3</b> &amp; answer</p>",
  due_at: "2026-09-26T03:59:00Z", // Friday 11:59 PM in New York
  html_url: `${BASE}/courses/${courseId}/assignments/${id}`,
  submission_types: ["online_upload"],
  published: true,
  submission: { workflow_state: "unsubmitted" },
  ...overrides,
})
describe("mapping Canvas data", () => {
  it("maps a course; skips deleted, date-restricted and nameless ones", () => {
    expect(canvasCourseToLms(course(215, { name: "Data Structures", course_code: "CSC 215" }))).toEqual({
      provider: "canvas",
      externalId: "215",
      courseCode: "CSC 215",
      courseName: "Data Structures",
      description: null,
      instructor: "Prof. Smith",
      url: null,
    })
    expect(canvasCourseToLms(course(1, { workflow_state: "deleted" }))).toBeNull()
    expect(canvasCourseToLms({ id: 2, access_restricted_by_date: true })).toBeNull()
    expect(canvasCourseToLms({ id: 3 })).toBeNull()
    expect(canvasCourseToLms("not an object")).toBeNull()
  })

  it("maps an assignment: local due date/time, plain-text description, link, type", () => {
    const context = { baseUrl: BASE, timeZone: "America/New_York" }
    expect(canvasAssignmentToLms(assignment(7, 215), "215", context)).toEqual({
      provider: "canvas",
      externalId: "7",
      courseExternalId: "215",
      title: "Assignment 7",
      description: "Read chapter 3 & answer",
      dueDate: "2026-09-25",
      dueTime: "23:59",
      type: "assignment",
      url: `${BASE}/courses/215/assignments/7`,
      estimatedMinutes: null, // never invented
      submissionStatus: "not_submitted",
    })
    expect(canvasAssignmentToLms(assignment(8, 215, { is_quiz_assignment: true }), "215", context)?.type).toBe("quiz")
    expect(canvasAssignmentToLms(assignment(9, 215, { submission: { workflow_state: "graded" } }), "215", context)?.submissionStatus).toBe("graded")
  })

  it("keeps a missing due date missing, and drops unpublished or malformed items", () => {
    const context = { baseUrl: BASE, timeZone: "America/New_York" }
    expect(canvasAssignmentToLms(assignment(1, 215, { due_at: null }), "215", context)).toMatchObject({ dueDate: null, dueTime: null })
    expect(canvasAssignmentToLms(assignment(2, 215, { published: false }), "215", context)).toBeNull()
    expect(canvasAssignmentToLms({ id: 3, name: "" }, "215", context)).toBeNull()
    expect(canvasAssignmentToLms({ name: "no id" }, "215", context)).toBeNull()
  })

  it("only keeps links to the student's own Canvas", () => {
    const context = { baseUrl: BASE, timeZone: undefined }
    expect(canvasAssignmentToLms(assignment(1, 215, { html_url: "https://evil.example.com/x" }), "215", context)?.url).toBeNull()
    expect(canvasAssignmentToLms(assignment(1, 215, { html_url: "javascript:alert(1)" }), "215", context)?.url).toBeNull()
  })

  it("converts UTC due dates to the student's time zone", () => {
    expect(canvasDueToLocal("2026-09-26T03:59:00Z", "America/New_York")).toEqual({ dueDate: "2026-09-25", dueTime: "23:59" })
    expect(canvasDueToLocal("2026-09-26T03:59:00Z", "Asia/Tokyo")).toEqual({ dueDate: "2026-09-26", dueTime: "12:59" })
    expect(canvasDueToLocal("not a date", "UTC")).toBeNull()
  })

  it("strips HTML from descriptions", () => {
    expect(htmlToText("<p>One</p><p>Two &lt;3</p><script>alert(1)</script>")).toBe("One\nTwo <3")
  })
})

// ---- The whole sync, through the real services and a real Postgres ------------------

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const NOW = new Date("2026-09-23T12:00:00Z")

// What Canvas shows the student (what the extension sends), changed between syncs.
const fakeCanvas = (fixture: { courses?: unknown[]; assignments?: Record<string, unknown[] | number> }) => ({
  state: { courses: fixture.courses ?? [], assignments: fixture.assignments ?? {} },
})

const connected = async (name: string) => t.addUser(name)

// One sync: every course, with the assignments of those it could read (a number is
// a course the extension couldn't read, like an HTTP error).
const sync = (user: string, canvas: ReturnType<typeof fakeCanvas>) =>
  importCanvasFromExtension(
    t.db,
    user,
    {
      baseUrl: BASE,
      timeZone: "America/New_York",
      courses: canvas.state.courses,
      assignments: Object.fromEntries(
        Object.entries(canvas.state.assignments).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      ),
    },
    { now: NOW }
  )

describe("syncing Canvas into Student OS", () => {
  it("imports courses and assignments as normal courses and tasks", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({
      courses: [course(215, { name: "Data Structures", course_code: "CSC 215" }), course(9, { access_restricted_by_date: true })],
      assignments: { "215": [assignment(1, 215), assignment(2, 215, { due_at: null })] },
    })
    const result = await sync(user, canvas)
    expect(result).toMatchObject({ coursesCreated: 1, assignmentsCreated: 1, assignmentsWithoutDueDate: 1, errors: [] })

    const data = await loadAppData(t.db, user)
    expect(data.courses).toEqual([
      expect.objectContaining({
        code: "CSC 215",
        name: "Data Structures",
        source: { provider: "canvas", externalId: "215", url: `${BASE}/courses/215` },
      }),
    ])
    expect(data.tasks).toEqual([
      expect.objectContaining({
        title: "Assignment 1",
        dueDate: "2026-09-25",
        dueTime: "23:59",
        priority: "medium",
        estimateMinutes: null, // Canvas has no estimate, so none is invented
        source: {
          provider: "canvas",
          externalId: "1",
          url: `${BASE}/courses/215/assignments/1`,
          submissionStatus: "not_submitted",
        },
      }),
    ])
  })

  it("repeat syncs don't duplicate; changes update; removed assignments are kept and reported", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215), assignment(2, 215)] } })
    await sync(user, canvas)
    const again = await sync(user, canvas)
    expect(again).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 0 })
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)

    // Canvas moves assignment 1 and drops assignment 2.
    canvas.state.assignments["215"] = [assignment(1, 215, { due_at: "2026-09-28T03:59:00Z" })]
    const changed = await sync(user, canvas)
    expect(changed).toMatchObject({ assignmentsUpdated: 1, assignmentsMissing: 1, missing: [{ taskId: expect.any(String), title: "Assignment 2" }] })
    const tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.find((task) => task.title === "Assignment 1")?.dueDate).toBe("2026-09-27")
  })

  it("keeps the student's own due date when Canvas changes it too", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } })
    await sync(user, canvas)
    const [task] = (await loadAppData(t.db, user)).tasks
    await updateTask(t.db, user, task.id, { dueDate: "2026-09-26" }) // the student moves it to Saturday
    canvas.state.assignments["215"] = [assignment(1, 215, { due_at: "2026-09-28T03:59:00Z" })] // Canvas: Sunday
    const result = await sync(user, canvas)
    expect(result.conflicts).toEqual([
      { taskId: task.id, title: "Assignment 1", field: "dueDate", studentValue: "2026-09-26", lmsValue: "2026-09-27" },
    ])
    expect((await loadAppData(t.db, user)).tasks[0].dueDate).toBe("2026-09-26")
  })

  it("skips a course Canvas won't show, without losing that course's tasks or the rest", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({
      courses: [course(1), course(2)],
      assignments: { "1": [assignment(10, 1)], "2": [assignment(20, 2)] },
    })
    await sync(user, canvas)
    canvas.state.assignments["2"] = 403
    const result = await sync(user, canvas)
    expect(result.errors).toEqual(["Course 2: The extension couldn't read this course's assignments."])
    expect(result.assignmentsMissing).toBe(0) // not "missing": it just couldn't be read
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)
  })

  it("keeps each student's Canvas data separate", async () => {
    const alice = await connected("Alice")
    const bob = await connected("Bob")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } })
    await sync(alice, canvas)
    expect((await loadAppData(t.db, bob)).tasks).toEqual([])
    await sync(bob, canvas)
    const [a, b] = [(await loadAppData(t.db, alice)).tasks[0], (await loadAppData(t.db, bob)).tasks[0]]
    expect(a.id).not.toBe(b.id)
  })

  it("imported Canvas tasks go straight into the Planner", async () => {
    const user = await connected("Alex")
    await sync(user, fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } }))
    const data = await loadAppData(t.db, user)
    const plan = generatePlan({ date: "2026-09-23", tasks: data.tasks, events: data.events, now: new Date(2026, 8, 23, 8, 0) })
    expect(plan.suggestions.map((s) => s.taskId)).toContain(data.tasks[0].id)
  })
})

describe("syncing over time", () => {
  it("marks tasks done from Canvas only conservatively, and never un-completes", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({
      courses: [course(215)],
      assignments: {
        "215": [
          assignment(1, 215), // not submitted
          assignment(2, 215, { submission: { workflow_state: "graded" } }), // already graded
        ],
      },
    })
    const first = await sync(user, canvas)
    expect(first.assignmentsCompleted).toBe(1)
    let tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks.find((task) => task.title === "Assignment 1")?.status).toBe("not_started")
    expect(tasks.find((task) => task.title === "Assignment 2")?.status).toBe("completed")

    // The student submits assignment 1 in Canvas: the next sync marks it done.
    canvas.state.assignments["215"] = [
      assignment(1, 215, { submission: { workflow_state: "submitted" } }),
      assignment(2, 215, { submission: { workflow_state: "graded" } }),
    ]
    expect((await sync(user, canvas)).assignmentsCompleted).toBe(1)
    tasks = (await loadAppData(t.db, user)).tasks
    const one = tasks.find((task) => task.title === "Assignment 1")!
    expect(one.status).toBe("completed")

    // The student reopens it (e.g. to revise): later syncs leave it open.
    await updateTask(t.db, user, one.id, { status: "in_progress" })
    expect((await sync(user, canvas)).assignmentsCompleted).toBe(0)
    expect((await loadAppData(t.db, user)).tasks.find((task) => task.id === one.id)?.status).toBe("in_progress")
  })

  it("updates Canvas's fields but never the student's: priority, estimate, notes, status", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } })
    await sync(user, canvas)
    const [task] = (await loadAppData(t.db, user)).tasks
    expect(task.estimateMinutes).toBeNull()
    await updateTask(t.db, user, task.id, { priority: "critical", estimateMinutes: 150, notes: "Ask about Q3", status: "in_progress" })

    // Canvas renames the assignment, rewrites the description and moves it from Sep 25 to Sep 27.
    canvas.state.assignments["215"] = [
      assignment(1, 215, { name: "Assignment 1 (updated)", description: "<p>New brief</p>", due_at: "2026-09-28T03:59:00Z" }),
    ]
    const result = await sync(user, canvas)
    expect(result).toMatchObject({ assignmentsUpdated: 1, assignmentsCreated: 0, conflicts: [] })
    expect((await loadAppData(t.db, user)).tasks).toEqual([
      expect.objectContaining({
        id: task.id,
        title: "Assignment 1 (updated)",
        description: "New brief",
        dueDate: "2026-09-27",
        priority: "critical",
        estimateMinutes: 150,
        notes: "Ask about Q3",
        status: "in_progress",
      }),
    ])
  })

  it("updates a renamed course, unless the student renamed it; a course no longer sent is kept, not reported", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(1, { name: "Algebra" }), course(2, { name: "Biology" })], assignments: {} })
    await sync(user, canvas)
    const biology = (await loadAppData(t.db, user)).courses.find((c) => c.name === "Biology")!
    await (await import("../../../services/courses")).updateCourse(t.db, user, biology.id, { name: "Bio (my name)" })

    canvas.state.courses = [course(1, { name: "Algebra II" }), course(2, { name: "Biology 101" })]
    expect(await sync(user, canvas)).toMatchObject({ coursesUpdated: 1, coursesCreated: 0 })
    let names = (await loadAppData(t.db, user)).courses.map((c) => c.name).sort()
    expect(names).toEqual(["Algebra II", "Bio (my name)"])

    // The student unchecks Algebra (or the term ends): it's kept, and not reported as gone,
    // since the extension only sends the courses the student chose.
    canvas.state.courses = [course(2, { name: "Biology 101" })]
    const ended = await sync(user, canvas)
    expect(ended.missingCourses).toEqual([])
    names = (await loadAppData(t.db, user)).courses.map((c) => c.name).sort()
    expect(names).toEqual(["Algebra II", "Bio (my name)"])
  })

  it("one item that can't be saved doesn't stop the rest (partial failure)", async () => {
    const user = await connected("Alex")
    // Two Canvas courses whose codes are the same to Student OS ("CSC 215" and "CSC215"):
    // the second can't be created, but everything else still syncs.
    const canvas = fakeCanvas({
      courses: [course(1, { course_code: "CSC 215", name: "Data Structures" }), course(2, { course_code: "CSC215", name: "Data Structures (lab)" }), course(3)],
      assignments: { "1": [assignment(10, 1)], "2": [assignment(20, 2)], "3": [assignment(30, 3)] },
    })
    const result = await sync(user, canvas)
    expect(result.coursesCreated).toBe(2)
    expect(result.coursesSkipped).toBe(1)
    expect(result.errors).toEqual(["Data Structures (lab): You already have a course with the code CSC 215."])
    expect(result.assignmentsCreated).toBe(2) // the lab's assignment has no course to go in
    expect((await loadAppData(t.db, user)).tasks.map((task) => task.title).sort()).toEqual(["Assignment 10", "Assignment 30"])
  })

  it("keeps due dates right around midnight and across time zones", () => {
    const ny = "America/New_York"
    expect(canvasDueToLocal("2026-09-26T04:00:00Z", ny)).toEqual({ dueDate: "2026-09-26", dueTime: "00:00" }) // midnight
    expect(canvasDueToLocal("2026-09-26T03:59:59Z", ny)).toEqual({ dueDate: "2026-09-25", dueTime: "23:59" }) // just before
    // Daylight saving ends Nov 1, 2026 at 06:00 UTC: before it is EDT (-4), after it EST (-5).
    expect(canvasDueToLocal("2026-11-01T05:30:00Z", ny)).toEqual({ dueDate: "2026-11-01", dueTime: "01:30" })
    expect(canvasDueToLocal("2026-11-01T07:30:00Z", ny)).toEqual({ dueDate: "2026-11-01", dueTime: "02:30" })
    expect(canvasDueToLocal("2026-09-26T03:59:00Z", "Europe/Berlin")).toEqual({ dueDate: "2026-09-26", dueTime: "05:59" })
    // An assignment with only optional fields missing still maps; only the due date is empty.
    expect(canvasAssignmentToLms({ id: 5, name: "Bare" }, "215", { baseUrl: BASE, timeZone: ny })).toMatchObject({
      title: "Bare",
      description: null,
      dueDate: null,
      dueTime: null,
      url: null,
      submissionStatus: "unknown",
    })
  })
})
