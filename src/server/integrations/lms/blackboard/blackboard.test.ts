import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generatePlan } from "@/lib/planner"
import { loadAppData } from "../../../services/app-data"
import { updateTask } from "../../../services/tasks"
import { BLACKBOARD_BASE as BASE, bbColumn, bbMembership } from "../../../test-utils/fake-blackboard"
import { createTestDb } from "../../../test-utils/test-db"
import { importBlackboardFromExtension } from "../../extension/blackboard-import"
import { importCanvasFromExtension } from "../../extension/canvas-import"
import { disconnectLms, listLmsConnections } from "../connections"
import { attemptsStatus, blackboardAssignmentToLms, blackboardCourseToLms, gradedColumns, parseBlackboardColumn } from "./mapping"

// Blackboard Learn data in Student OS: the mapping (blackboard/mapping.ts) and whole
// syncs through the only way in, the browser extension's import, against a real
// Postgres. Fixtures: src/server/test-utils/fake-blackboard.ts.

const NOW = new Date("2026-09-23T12:00:00Z")

describe("mapping Blackboard data", () => {
  it("imports the courses the student takes; skips organizations, teaching roles and unavailable courses", () => {
    expect(blackboardCourseToLms(bbMembership("_215_1", {}, { courseId: "BIO-101", name: "Biology" }), BASE)).toEqual({
      provider: "blackboard",
      externalId: "_215_1",
      courseCode: "BIO-101",
      courseName: "Biology",
      description: "Intro course",
      instructor: null,
      url: `${BASE}/ultra/courses/_215_1/outline`,
    })
    expect(blackboardCourseToLms(bbMembership("_1_1", {}, { availability: { available: "Term" } }), BASE)).not.toBeNull()
    expect(blackboardCourseToLms(bbMembership("_2_1", {}, { organization: true }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_3_1", { courseRoleId: "Instructor" }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_4_1", { courseRoleId: "TeachingAssistant" }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_5_1", {}, { availability: { available: "No" } }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_6_1", { availability: { available: "Disabled" } }), BASE)).toBeNull()
    expect(blackboardCourseToLms({ courseId: "_7_1" }, BASE)).toBeNull() // course not expanded
    expect(blackboardCourseToLms("garbage", BASE)).toBeNull()
  })

  it("only keeps links to the student's own Blackboard", () => {
    const course = (url: string) => blackboardCourseToLms(bbMembership("_1_1", {}, { externalAccessUrl: url }), BASE)?.url
    expect(course("https://evil.example.com/ultra/courses/_1_1")).toBeNull()
    expect(course("javascript:alert(1)")).toBeNull()
    expect(course("http://school.blackboard.com/ultra")).toBeNull()
    expect(course(`${BASE}/webapps/blackboard/execute/courseMain?course_id=_1_1`)).toBe(
      `${BASE}/webapps/blackboard/execute/courseMain?course_id=_1_1`
    )
  })

  it("keeps real work: drops totals, calculated and hidden columns", () => {
    expect(parseBlackboardColumn(bbColumn("_1_1"))).not.toBeNull()
    expect(parseBlackboardColumn(bbColumn("_2_1", { externalGrade: true }))).toBeNull()
    expect(parseBlackboardColumn(bbColumn("_3_1", { grading: { type: "Calculated" } }))).toBeNull()
    expect(parseBlackboardColumn(bbColumn("_4_1", { availability: { available: "No" } }))).toBeNull()
    expect(parseBlackboardColumn(bbColumn("_5_1", { name: " ", displayName: null }))).toBeNull()
    expect(parseBlackboardColumn({ name: "No id" })).toBeNull()
  })

  it("maps a column: local due date/time, plain-text description, course link, type; no invented estimate", () => {
    const column = parseBlackboardColumn(bbColumn("_9_1", { displayName: "Lab report 2" }))!
    expect(
      blackboardAssignmentToLms(column, "_215_1", { timeZone: "America/New_York", courseUrl: `${BASE}/ultra/courses/_215_1/outline`, submissionStatus: "unknown" })
    ).toEqual({
      provider: "blackboard",
      externalId: "_9_1",
      courseExternalId: "_215_1",
      title: "Lab report 2",
      description: "Read chapter 3 & answer",
      dueDate: "2026-09-25",
      dueTime: "23:59",
      type: "assignment",
      url: `${BASE}/ultra/courses/_215_1/outline`,
      estimatedMinutes: null,
      submissionStatus: "unknown",
    })
    const typeOf = (handle: string) =>
      blackboardAssignmentToLms(parseBlackboardColumn(bbColumn("_1_1", { scoreProviderHandle: handle }))!, "c", {
        timeZone: undefined,
        courseUrl: null,
        submissionStatus: "unknown",
      }).type
    expect(typeOf("resource/x-bb-asmt-test-link")).toBe("quiz")
    expect(typeOf("resource/x-bb-forumlink")).toBe("other")
    expect(typeOf("resource/x-bb-assignment")).toBe("assignment")
    const undated = parseBlackboardColumn(bbColumn("_2_1", { grading: { type: "Manual" } }))!
    expect(blackboardAssignmentToLms(undated, "c", { timeZone: undefined, courseUrl: null, submissionStatus: "unknown" })).toMatchObject({
      dueDate: null,
      dueTime: null,
    })
  })

  it("reads submission status conservatively", () => {
    // A grade counts only with a real score or text; Learn's unreliable "status" field is ignored.
    expect(gradedColumns([{ columnId: "a", score: 8 }, { columnId: "b", text: "A-" }, { columnId: "c", status: "Graded" }, "junk"])).toEqual(
      new Set(["a", "b"])
    )
    expect(attemptsStatus([{ status: "NeedsGrading" }])).toBe("submitted")
    expect(attemptsStatus([{ status: "InProgress" }, { status: "Completed" }])).toBe("submitted")
    expect(attemptsStatus([{ status: "InProgress" }])).toBe("not_submitted")
    expect(attemptsStatus([])).toBe("not_submitted")
    expect(attemptsStatus([{ status: "InProgress" }, { unexpected: true }])).toBe("unknown")
  })
})

// ---- The whole sync, through the real services and a real Postgres ------------------

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

// What Blackboard shows the student (what the extension sends), changed between
// syncs. A number is something the extension couldn't read (an HTTP error): a
// course's columns (the course is skipped) or its grades (statuses stay unknown).
type Fixture = {
  memberships?: unknown[]
  columns?: Record<string, unknown[] | number>
  grades?: Record<string, unknown[] | number>
  attempts?: Record<string, unknown[]>
  instructors?: Record<string, string[]>
}
const fakeBlackboard = (fixture: Fixture = {}) => ({
  state: { memberships: fixture.memberships ?? [], columns: fixture.columns ?? {}, grades: fixture.grades ?? {}, attempts: fixture.attempts ?? {}, instructors: fixture.instructors ?? {} },
})
const readable = (record: Record<string, unknown[] | number>) =>
  Object.fromEntries(Object.entries(record).filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1])))

const connected = async (name: string) => t.addUser(name)
const sync = (user: string, bb: ReturnType<typeof fakeBlackboard>) =>
  importBlackboardFromExtension(
    t.db,
    user,
    {
      baseUrl: BASE,
      timeZone: "America/New_York",
      courses: bb.state.memberships,
      columns: readable(bb.state.columns),
      grades: readable(bb.state.grades),
      attempts: bb.state.attempts,
      instructors: bb.state.instructors,
    },
    { now: NOW }
  )

describe("syncing Blackboard into Student OS", () => {
  it("imports courses and gradebook items as normal courses and tasks", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({
      memberships: [
        bbMembership("_215_1", {}, { courseId: "BIO-215", name: "Biology" }),
        bbMembership("_300_1", {}, { organization: true, name: "Chess Club" }),
      ],
      columns: {
        "_215_1": [
          bbColumn("_1_1"),
          bbColumn("_2_1", { grading: { type: "Manual" } }), // no due date
          bbColumn("_3_1", { name: "Total", externalGrade: true, grading: { type: "Calculated" } }),
        ],
      },
      grades: { "_215_1": [] },
      attempts: { "_1_1": [] },
      instructors: { "_215_1": ["Jane Smith"] },
    })
    const result = await sync(user, bb)
    expect(result).toMatchObject({ provider: "blackboard", coursesCreated: 1, assignmentsCreated: 1, assignmentsWithoutDueDate: 1, errors: [] })

    const data = await loadAppData(t.db, user)
    expect(data.courses).toEqual([
      expect.objectContaining({
        code: "BIO-215",
        name: "Biology",
        professor: "Jane Smith",
        source: { provider: "blackboard", externalId: "_215_1", url: `${BASE}/ultra/courses/_215_1/outline` },
      }),
    ])
    expect(data.tasks).toEqual([
      expect.objectContaining({
        title: "Assignment _1_1",
        dueDate: "2026-09-25",
        dueTime: "23:59",
        priority: "medium",
        status: "not_started",
        estimateMinutes: null,
        source: {
          provider: "blackboard",
          externalId: "_1_1",
          url: `${BASE}/ultra/courses/_215_1/outline`,
          submissionStatus: "not_submitted",
        },
      }),
    ])
  })

  it("repeat syncs don't duplicate; changes update; removed items are kept and reported", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1"), bbColumn("_2_1")] } })
    await sync(user, bb)
    expect(await sync(user, bb)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 0 })
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)

    bb.state.columns["_215_1"] = [bbColumn("_1_1", { grading: { type: "Attempts", due: "2026-09-28T03:59:00.000Z" } })]
    const changed = await sync(user, bb)
    expect(changed).toMatchObject({ assignmentsUpdated: 1, assignmentsMissing: 1, missing: [{ taskId: expect.any(String), title: "Assignment _2_1" }] })
    const tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.find((task) => task.title === "Assignment _1_1")?.dueDate).toBe("2026-09-27")
  })

  it("keeps the student's own changes when Blackboard changes the same field", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] } })
    await sync(user, bb)
    const task = (await loadAppData(t.db, user)).tasks[0]
    await updateTask(t.db, user, task.id, { dueDate: "2026-09-27", priority: "high", notes: "Start early" })

    bb.state.columns["_215_1"] = [bbColumn("_1_1", { name: "Lab 1 (updated)", grading: { type: "Attempts", due: "2026-09-29T03:59:00.000Z" } })]
    const result = await sync(user, bb)
    expect(result.conflicts).toEqual([
      { taskId: task.id, title: "Assignment _1_1", field: "dueDate", studentValue: "2026-09-27", lmsValue: "2026-09-28" },
    ])
    const after = (await loadAppData(t.db, user)).tasks[0]
    expect(after).toMatchObject({ title: "Lab 1 (updated)", dueDate: "2026-09-27", priority: "high", notes: "Start early" })
  })

  it("marks tasks done only on a real submission or grade, and never un-completes", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({
      memberships: [bbMembership("_215_1")],
      columns: {
        "_215_1": [
          bbColumn("_1_1"), // not submitted yet
          bbColumn("_2_1"), // already graded
          bbColumn("_3_1", { grading: { type: "Manual", due: "2026-09-30T03:59:00.000Z" } }), // manual, no grade: unknown
          bbColumn("_4_1", { grading: { type: "Attempts", due: "2026-07-01T03:59:00.000Z" } }), // long past: not looked up by the extension
        ],
      },
      grades: { "_215_1": [{ columnId: "_2_1", score: 9 }] },
      attempts: { "_1_1": [] },
    })
    const first = await sync(user, bb)
    expect(first.assignmentsCreated).toBe(4)
    const status = async () =>
      Object.fromEntries((await loadAppData(t.db, user)).tasks.map((task) => [task.source?.externalId, [task.status, task.source?.submissionStatus]]))
    expect(await status()).toEqual({
      "_1_1": ["not_started", "not_submitted"],
      "_2_1": ["completed", "graded"],
      "_3_1": ["not_started", undefined], // unknown: nothing stored, nothing assumed
      "_4_1": ["not_started", undefined],
    })

    // The student turns in _1_1 in Blackboard.
    bb.state.attempts["_1_1"] = [{ status: "NeedsGrading" }]
    expect((await sync(user, bb)).assignmentsCompleted).toBe(1)
    expect((await status())["_1_1"]).toEqual(["completed", "submitted"])

    // The student reopens it in Student OS; Blackboard still says submitted: left alone.
    const reopened = (await loadAppData(t.db, user)).tasks.find((task) => task.source?.externalId === "_1_1")!
    await updateTask(t.db, user, reopened.id, { status: "in_progress" })
    expect((await sync(user, bb)).assignmentsCompleted).toBe(0)
    expect((await status())["_1_1"][0]).toBe("in_progress")
  })

  it("imports a course whose grades can't be read, with statuses left unknown", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] }, grades: { "_215_1": 403 } })
    const result = await sync(user, bb)
    expect(result).toMatchObject({ assignmentsCreated: 1, errors: [] })
    expect((await loadAppData(t.db, user)).tasks[0]).toMatchObject({ status: "not_started" })
    expect((await loadAppData(t.db, user)).tasks[0].source?.submissionStatus).toBeUndefined()
  })

  it("skips a course the extension couldn't read, without losing the rest", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({
      memberships: [bbMembership("_1_1", {}, { name: "Biology" }), bbMembership("_2_1", {}, { name: "Chemistry" })],
      columns: { "_1_1": 403, "_2_1": [bbColumn("_9_1")] },
    })
    const result = await sync(user, bb)
    expect(result).toMatchObject({
      coursesSkipped: 1,
      assignmentsCreated: 1,
      errors: ["Biology: The extension couldn't read this course's assignments."],
    })
  })

  it("keeps each student's Blackboard data separate", async () => {
    const alice = await connected("Alice")
    const bob = await connected("Bob")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] } })
    await sync(alice, bb)
    expect((await loadAppData(t.db, bob)).tasks).toEqual([])
    await sync(bob, bb)
    expect((await loadAppData(t.db, alice)).tasks[0].id).not.toBe((await loadAppData(t.db, bob)).tasks[0].id)
  })

  it("imported Blackboard tasks go straight into the Planner", async () => {
    const user = await connected("Alex")
    await sync(user, fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] } }))
    const data = await loadAppData(t.db, user)
    const plan = generatePlan({ date: "2026-09-23", tasks: data.tasks, events: data.events, now: new Date(2026, 8, 23, 8, 0) })
    expect(plan.suggestions.map((s) => s.taskId)).toContain(data.tasks[0].id)
  })
})

// ---- Canvas and Blackboard at the same time -----------------------------------------

describe("Canvas and Blackboard connected together", () => {
  const CANVAS = "https://school.instructure.com"
  // Canvas data that deliberately uses the SAME ids as the Blackboard data below.
  const syncCanvas = (user: string, course = { id: "215", name: "Canvas Biology", course_code: "BIO 215" }) =>
    importCanvasFromExtension(
      t.db,
      user,
      {
        baseUrl: CANVAS,
        timeZone: "America/New_York",
        courses: [course],
        assignments: { "215": [{ id: "1", name: "Canvas essay", due_at: "2026-09-26T03:59:00Z", html_url: `${CANVAS}/courses/215/assignments/1`, published: true }] },
      },
      { now: NOW }
    )
  const bb = () =>
    fakeBlackboard({
      memberships: [bbMembership("_215_1", {}, { name: "Blackboard Chemistry", courseId: "CHEM-110" })],
      columns: { "_215_1": [bbColumn("_1_1", { name: "Blackboard lab" })] },
    })

  it("identical-looking ids from the two LMSs never collide", async () => {
    const user = await connected("Alex")
    const blackboard = bb()
    await syncCanvas(user)
    await sync(user, blackboard)
    // Syncing again, in either order, changes nothing and reports nothing missing.
    expect(await syncCanvas(user)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsMissing: 0, missingCourses: [] })
    expect(await sync(user, blackboard)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsMissing: 0, missingCourses: [] })

    const data = await loadAppData(t.db, user)
    expect(data.courses.map((c) => [c.source?.provider, c.name]).sort()).toEqual([
      ["blackboard", "Blackboard Chemistry"],
      ["canvas", "Canvas Biology"],
    ])
    // Each task belongs to its own LMS's course, and both show up in the Planner.
    const courseOf = (provider: string) => data.courses.find((c) => c.source?.provider === provider)!.id
    for (const task of data.tasks) expect(task.courseId).toBe(courseOf(task.source!.provider))
    const plan = generatePlan({ date: "2026-09-23", tasks: data.tasks, events: data.events, now: new Date(2026, 8, 23, 8, 0) })
    expect(plan.suggestions.map((s) => s.taskId).sort()).toEqual(data.tasks.map((task) => task.id).sort())
  })

  it("the same course code in both LMSs is reported, never merged into the other LMS's course", async () => {
    const user = await connected("Alex")
    await syncCanvas(user)
    const result = await sync(user, fakeBlackboard({ memberships: [bbMembership("_215_1", {}, { name: "Blackboard Biology", courseId: "BIO-215" })], columns: { "_215_1": [bbColumn("_1_1")] } }))
    expect(result).toMatchObject({ coursesCreated: 0, coursesLinked: 0, coursesSkipped: 1 })
    expect(result.errors).toEqual(["Blackboard Biology: You already have a course with the code BIO 215."])
    expect((await loadAppData(t.db, user)).courses.map((c) => c.source?.provider)).toEqual(["canvas"])
  })

  it("disconnecting one leaves the other connected; imported data stays", async () => {
    const user = await connected("Alex")
    await syncCanvas(user)
    await sync(user, bb())
    await disconnectLms(t.db, user, "blackboard")
    expect((await listLmsConnections(t.db, user)).map((c) => c.provider)).toEqual(["canvas"])
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)
    expect(await syncCanvas(user)).toMatchObject({ assignmentsMissing: 0 })
  })
})
