import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TaskInput } from "@/lib/types"
import { createEventSchema, createTaskSchema, updateTaskSchema } from "@/lib/validation"
import { DuplicateError, NotFoundError, toAppError } from "../errors"
import { createTestDb } from "../test-utils/test-db"
import { loadAppData } from "./app-data"
import { createCourse, deleteCourse, getCourseForUser, updateCourse } from "./courses"
import { createEvent, deleteEvent, updateEvent } from "./events"
import { createStudySession, deleteStudySession, updateStudySession } from "./study-sessions"
import { createTask, deleteTask, getTaskForUser, updateTask } from "./tasks"

// Runs the real services against a real Postgres (PGlite) with the app's migrations.

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const courseFields = { code: "CSC215", name: "Data Structures", professor: "Prof. Marsh", description: "" }
const taskFields = (courseId: string): TaskInput => ({
  courseId,
  title: "Assignment #2",
  description: "",
  type: "assignment",
  dueDate: "2026-09-23",
  dueTime: "23:59",
  priority: "high",
  estimateMinutes: 90,
  status: "not_started",
})
const eventFields = {
  title: "Soccer Practice",
  date: "2026-09-22",
  startTime: "10:30",
  endTime: "13:00",
  type: "sports" as const,
}

// Alice and Bob each have a course, a task, an event and a study session.
async function twoStudents() {
  const alice = await t.addUser("Alice")
  const bob = await t.addUser("Bob")
  const make = async (user: string) => {
    const course = await createCourse(t.db, user, courseFields)
    const task = await createTask(t.db, user, taskFields(course.id))
    const event = await createEvent(t.db, user, eventFields)
    const session = await createStudySession(t.db, user, {
      taskId: task.id,
      date: "2026-09-22",
      startTime: "17:15",
      endTime: "18:45",
      status: "scheduled",
    })
    return { course, task, event, session }
  }
  return { alice, bob, a: await make(alice), b: await make(bob) }
}

describe("user isolation", () => {
  it("each student only sees their own data", async () => {
    const { alice, a, b } = await twoStudents()
    const data = await loadAppData(t.db, alice)
    expect(data.student.firstName).toBe("Alice")
    expect(data.courses.map((c) => c.id)).toEqual([a.course.id])
    expect(data.tasks.map((x) => x.id)).toEqual([a.task.id])
    expect(data.events.map((x) => x.id)).toEqual([a.event.id])
    expect(data.studySessions.map((x) => x.id)).toEqual([a.session.id])
    expect(JSON.stringify(data)).not.toContain(b.course.id)
  })

  it("Alice can't read Bob's course or task by id", async () => {
    const { alice, b } = await twoStudents()
    await expect(getCourseForUser(t.db, alice, b.course.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(getTaskForUser(t.db, alice, b.task.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it("Alice can't change or delete Bob's course, task, event or study session", async () => {
    const { alice, bob, b } = await twoStudents()
    const attempts = [
      updateCourse(t.db, alice, b.course.id, { name: "Hacked" }),
      deleteCourse(t.db, alice, b.course.id),
      updateTask(t.db, alice, b.task.id, { title: "Hacked", status: "completed" }),
      deleteTask(t.db, alice, b.task.id),
      updateEvent(t.db, alice, b.event.id, { title: "Hacked" }),
      deleteEvent(t.db, alice, b.event.id),
      updateStudySession(t.db, alice, b.session.id, { status: "completed" }),
      deleteStudySession(t.db, alice, b.session.id),
    ]
    for (const attempt of attempts) await expect(attempt).rejects.toBeInstanceOf(NotFoundError)

    // Bob's data is untouched.
    const bobs = await loadAppData(t.db, bob)
    expect(bobs.courses[0].name).toBe("Data Structures")
    expect(bobs.tasks[0]).toMatchObject({ title: "Assignment #2", status: "not_started" })
    expect(bobs.events[0].title).toBe("Soccer Practice")
    expect(bobs.studySessions[0].status).toBe("scheduled")
  })

  it("Alice can't attach her records to Bob's course or task", async () => {
    const { alice, bob, a, b } = await twoStudents()
    await expect(createTask(t.db, alice, taskFields(b.course.id))).rejects.toBeInstanceOf(NotFoundError)
    await expect(updateTask(t.db, alice, a.task.id, { courseId: b.course.id })).rejects.toBeInstanceOf(NotFoundError)
    await expect(createEvent(t.db, alice, { ...eventFields, courseId: b.course.id })).rejects.toBeInstanceOf(
      NotFoundError
    )
    await expect(
      createStudySession(t.db, alice, { taskId: b.task.id, date: "2026-09-22", startTime: "09:00", endTime: "10:00", status: "scheduled" })
    ).rejects.toBeInstanceOf(NotFoundError)
    expect((await loadAppData(t.db, bob)).tasks).toHaveLength(1)
  })

  it("the database itself refuses a task that points at another user's course", async () => {
    const { alice, b } = await twoStudents()
    // Even if a service check were skipped, the (course, owner) foreign key stops it.
    const { tasks } = await import("../db/schema")
    await expect(
      t.db.insert(tasks).values({
        userId: alice,
        courseId: b.course.id,
        title: "Sneaky",
        dueDate: "2026-09-30",
        estimatedMinutes: 30,
      })
    ).rejects.toBeTruthy()
  })
})

describe("persistence", () => {
  it("saved records come back on the next load", async () => {
    const user = await t.addUser()
    const course = await createCourse(t.db, user, courseFields)
    const task = await createTask(t.db, user, { ...taskFields(course.id), id: crypto.randomUUID() })
    await updateTask(t.db, user, task.id, { status: "completed", dueTime: null })
    await createEvent(t.db, user, eventFields)

    // A fresh load, as after a page refresh.
    const data = await loadAppData(t.db, user)
    expect(data.courses).toEqual([expect.objectContaining({ code: "CSC215", color: "sky" })])
    expect(data.tasks).toEqual([expect.objectContaining({ id: task.id, status: "completed", dueTime: undefined })])
    expect(data.events).toEqual([expect.objectContaining({ title: "Soccer Practice", startTime: "10:30", endTime: "13:00" })])
  })

  it("deleting a course deletes its tasks and their study sessions", async () => {
    const { alice, a } = await twoStudents()
    await deleteCourse(t.db, alice, a.course.id)
    const data = await loadAppData(t.db, alice)
    expect(data.courses).toHaveLength(0)
    expect(data.tasks).toHaveLength(0)
    expect(data.studySessions).toHaveLength(0)
    expect(data.events).toHaveLength(1) // events aren't owned by a course
  })
})

describe("validation", () => {
  it("rejects a second course with the same code, however it's spaced", async () => {
    const user = await t.addUser()
    await createCourse(t.db, user, courseFields)
    await expect(createCourse(t.db, user, { ...courseFields, code: "csc 215" })).rejects.toBeInstanceOf(DuplicateError)
    // Another student can use the same code.
    const other = await t.addUser()
    await expect(createCourse(t.db, other, courseFields)).resolves.toBeTruthy()
  })

  it("the database rejects an event that ends before it starts", async () => {
    const user = await t.addUser()
    const error = await createEvent(t.db, user, { ...eventFields, startTime: "15:00", endTime: "14:00" }).catch(
      (e) => e
    )
    expect(toAppError(error).code).toBe("validation")
  })

  it("input rules reject bad statuses, priorities, types, dates and times", () => {
    const base = { ...taskFields(crypto.randomUUID()), id: crypto.randomUUID() }
    expect(createTaskSchema.safeParse(base).success).toBe(true)
    expect(createTaskSchema.safeParse({ ...base, status: "done" }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, priority: "urgent" }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, type: "homework" }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, dueDate: "2026-02-30" }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, dueTime: "25:00" }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, estimateMinutes: 0 }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...base, id: "t-a2" }).success).toBe(false)
    expect(updateTaskSchema.safeParse({ dueTime: null }).success).toBe(true)

    const event = { ...eventFields, id: crypto.randomUUID() }
    expect(createEventSchema.safeParse(event).success).toBe(true)
    expect(createEventSchema.safeParse({ ...event, type: "party" }).success).toBe(false)
    expect(createEventSchema.safeParse({ ...event, endTime: "10:00" }).success).toBe(false)
  })
})
