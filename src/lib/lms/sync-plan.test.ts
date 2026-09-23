import { describe, expect, it } from "vitest"
import {
  courseFieldsFrom,
  mergeFields,
  planCourses,
  planTasks,
  type ExistingCourse,
  type ExistingTask,
} from "./sync-plan"
import type { LmsAssignment, LmsCourse } from "./types"

// TEST FIXTURES: hand-written data in Student OS's own NORMALIZED LMS format
// (src/lib/lms/types.ts). They are not Canvas or Blackboard API responses and
// don't imitate them; they only exercise the provider-independent logic.

const lmsCourse = (overrides: Partial<LmsCourse> = {}): LmsCourse => ({
  provider: "canvas",
  externalId: "course-1",
  courseCode: "CSC 215",
  courseName: "Data Structures",
  description: null,
  instructor: "Prof. Smith",
  url: null,
  ...overrides,
})

const lmsAssignment = (overrides: Partial<LmsAssignment> = {}): LmsAssignment => ({
  provider: "canvas",
  externalId: "assignment-1",
  courseExternalId: "course-1",
  title: "Project 1",
  description: null,
  dueDate: "2026-10-10",
  dueTime: "23:59",
  type: "project",
  url: null,
  estimatedMinutes: null,
  submissionStatus: "not_submitted",
  ...overrides,
})

const course = (overrides: Partial<ExistingCourse> = {}): ExistingCourse => ({
  id: "c1",
  code: "CSC215",
  name: "Data Structures",
  professor: "",
  description: "",
  color: "sky",
  synced: null,
  ...overrides,
})

const task = (overrides: Partial<ExistingTask> = {}): ExistingTask => ({
  id: "t1",
  courseId: "c1",
  title: "Project 1",
  description: "",
  type: "project",
  dueDate: "2026-10-10",
  dueTime: "23:59",
  priority: "medium",
  estimateMinutes: 240,
  status: "not_started",
  synced: null,
  ...overrides,
})

const imported = (externalId: string) => ({ source: { provider: "canvas" as const, externalId } })
const scope = { provider: "canvas" as const, courseIds: ["c1"] }
const inCourse1 = (id: string) => (id === "course-1" ? "c1" : undefined)

describe("normalized course mapping", () => {
  it("fills Student OS course fields from an LMS course", () => {
    expect(courseFieldsFrom(lmsCourse())).toEqual({
      code: "CSC 215",
      name: "Data Structures",
      professor: "Prof. Smith",
      description: "",
    })
  })

  it("uses the name as the code when the LMS has none, and keeps within limits", () => {
    const fields = courseFieldsFrom(lmsCourse({ courseCode: null, courseName: "A very long course name that goes on and on" }))
    expect(fields.code).toBe("A very long course name that g")
    expect(fields.code.length).toBe(30)
  })
})

describe("three-way merge", () => {
  const base = { title: "A", dueDate: "2026-10-10" }
  it("takes LMS changes the student didn't touch", () => {
    expect(mergeFields(base, { title: "A", dueDate: "2026-10-10" }, { title: "A", dueDate: "2026-10-12" })).toEqual({
      values: { title: "A", dueDate: "2026-10-12" },
      changed: { dueDate: "2026-10-12" },
      conflicts: [],
    })
  })
  it("keeps the student's own changes when the LMS didn't change", () => {
    expect(mergeFields(base, { title: "A", dueDate: "2026-10-11" }, base).changed).toEqual({})
  })
  it("reports a conflict and keeps the student's value when both changed", () => {
    const merged = mergeFields(base, { title: "A", dueDate: "2026-10-11" }, { title: "A", dueDate: "2026-10-12" })
    expect(merged.conflicts).toEqual(["dueDate"])
    expect(merged.values.dueDate).toBe("2026-10-11")
  })
  it("does nothing when both sides agree", () => {
    expect(mergeFields(base, { title: "B", dueDate: "2026-10-10" }, { title: "B", dueDate: "2026-10-10" }).conflicts).toEqual([])
  })
})

describe("course matching", () => {
  it("creates a course that doesn't exist yet", () => {
    expect(planCourses([], [lmsCourse()])).toEqual([expect.objectContaining({ kind: "create" })])
  })

  it("links a course the student already has (same code, however it's spaced) instead of duplicating it", () => {
    const [action] = planCourses([course({ code: "csc-215" })], [lmsCourse()])
    expect(action).toMatchObject({ kind: "link", courseId: "c1" })
  })

  it("matches a previously imported course by its external id, even if renamed", () => {
    const [action] = planCourses(
      [course({ code: "MY CODE", ...imported("course-1"), synced: courseFieldsFrom(lmsCourse()) })],
      [lmsCourse()]
    )
    expect(action).toMatchObject({ kind: "unchanged", courseId: "c1" })
  })

  it("doesn't link another provider's or another LMS course's record by code", () => {
    const other = course({ source: { provider: "blackboard", externalId: "x" } })
    expect(planCourses([other], [lmsCourse()])).toEqual([expect.objectContaining({ kind: "create" })])
  })
})

describe("assignment -> task matching", () => {
  it("creates a normal Student OS task, with the importer's default estimate when the LMS has none", () => {
    const { actions } = planTasks([], [lmsAssignment()], inCourse1, scope)
    expect(actions[0]).toMatchObject({
      kind: "create",
      input: {
        courseId: "c1",
        title: "Project 1",
        type: "project",
        dueDate: "2026-10-10",
        dueTime: "23:59",
        priority: "medium",
        estimateMinutes: 240,
        status: "not_started",
      },
    })
  })

  it("uses the LMS's estimate only when it states one", () => {
    const { actions } = planTasks([], [lmsAssignment({ estimatedMinutes: 45 })], inCourse1, scope)
    expect(actions[0]).toMatchObject({ kind: "create", input: { estimateMinutes: 45 } })
  })

  it("skips assignments without a due date, or in a course that wasn't synced", () => {
    const { actions } = planTasks(
      [],
      [lmsAssignment({ dueDate: null }), lmsAssignment({ externalId: "a2", courseExternalId: "other" })],
      inCourse1,
      scope
    )
    expect(actions.map((a) => a.kind === "skip" && a.reason)).toEqual(["no-due-date", "unknown-course"])
  })

  it("links a task already added by hand or from a syllabus, instead of duplicating it", () => {
    const syllabusTask = task({ title: "Project #1: Linked lists" })
    const { actions } = planTasks([syllabusTask], [lmsAssignment()], inCourse1, scope)
    expect(actions[0]).toMatchObject({ kind: "link", taskId: "t1" })
  })

  it("links each existing task at most once", () => {
    const { actions } = planTasks(
      [task()],
      [lmsAssignment(), lmsAssignment({ externalId: "assignment-2", title: "Project 1 (resubmission)" })],
      inCourse1,
      scope
    )
    expect(actions.map((a) => a.kind)).toEqual(["link", "create"])
  })

  it("updates a due date the LMS changed (and the student didn't)", () => {
    const synced = { title: "Project 1", description: "", dueDate: "2026-10-10", dueTime: "23:59" }
    const { actions, conflicts } = planTasks(
      [task({ ...imported("assignment-1"), synced })],
      [lmsAssignment({ dueDate: "2026-10-12" })],
      inCourse1,
      scope
    )
    expect(actions[0]).toMatchObject({ kind: "update", changes: { dueDate: "2026-10-12" } })
    expect(conflicts).toEqual([])
  })

  it("keeps a student's own due date and reports the conflict when the LMS changed it too", () => {
    const synced = { title: "Project 1", description: "", dueDate: "2026-10-10", dueTime: "23:59" }
    const studentMoved = task({ ...imported("assignment-1"), synced, dueDate: "2026-10-11" })
    const { actions, conflicts } = planTasks([studentMoved], [lmsAssignment({ dueDate: "2026-10-12" })], inCourse1, scope)
    expect(actions[0]).toMatchObject({ kind: "unchanged" })
    expect(conflicts).toEqual([
      { taskId: "t1", title: "Project 1", field: "dueDate", studentValue: "2026-10-11", lmsValue: "2026-10-12" },
    ])
  })

  it("never changes priority or status, and never completes a task because it was submitted", () => {
    const synced = { title: "Project 1", description: "", dueDate: "2026-10-10", dueTime: "23:59" }
    const { actions } = planTasks(
      [task({ ...imported("assignment-1"), synced, priority: "critical", status: "in_progress" })],
      [lmsAssignment({ submissionStatus: "graded" })],
      inCourse1,
      scope
    )
    expect(actions[0].kind).toBe("unchanged")
  })

  it("flags imported tasks the LMS no longer lists, without deleting them", () => {
    const gone = task({ id: "t9", ...imported("assignment-9") })
    const manual = task({ id: "t8", title: "My own note" })
    const { missingTaskIds } = planTasks([gone, manual], [lmsAssignment()], inCourse1, scope)
    expect(missingTaskIds).toEqual(["t9"])
  })

  it("only flags tasks from the synced provider and courses", () => {
    const blackboardTask = task({ id: "t7", source: { provider: "blackboard", externalId: "x" } })
    const otherCourse = task({ id: "t6", courseId: "c2", ...imported("assignment-6") })
    expect(planTasks([blackboardTask, otherCourse], [], inCourse1, scope).missingTaskIds).toEqual([])
  })
})
