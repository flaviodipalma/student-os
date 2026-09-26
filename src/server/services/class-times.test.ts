import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { commitmentsOn } from "@/lib/recurring"
import { classTimesSchema } from "@/lib/validation"
import { recurringCommitments } from "../db/schema"
import { importCanvasFromExtension } from "../integrations/extension/canvas-import"
import { createTestDb } from "../test-utils/test-db"
import { createCourse, deleteCourse, getCourseForUser, listCourses, updateCourse } from "./courses"
import { saveOnboardingDetails } from "./onboarding"
import { createRecurringCommitment, listRecurringCommitments, setClassTimes } from "./recurring-commitments"

// A course's class times: "class" weekly commitments linked to the course, against
// a real Postgres.

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const LECTURE = { daysOfWeek: [5, 1, 3], startTime: "10:00", endTime: "10:50", location: "Tator Hall 120", startDate: "2026-09-25", endDate: "2026-12-20" }
const LAB = { daysOfWeek: [2], startTime: "14:00", endTime: "16:50" }

async function studentWithCourse(name = "Alex") {
  const user = await t.addUser(name)
  const course = await createCourse(t.db, user, { code: "CSC 215", name: "Data Structures", professor: "", description: "" })
  return { user, course }
}

describe("class times", () => {
  it("saves each weekly meeting as a class named after the course (several days, a room, until the semester ends)", async () => {
    const { user, course } = await studentWithCourse()
    const saved = await setClassTimes(t.db, user, course.id, [LECTURE, LAB])
    expect(saved).toEqual([
      expect.objectContaining({ courseId: course.id, title: "CSC 215 · Data Structures", type: "class", daysOfWeek: [1, 3, 5], startTime: "10:00", endTime: "10:50", location: "Tator Hall 120", endDate: "2026-12-20" }),
      expect.objectContaining({ courseId: course.id, type: "class", daysOfWeek: [2], startTime: "14:00", location: undefined }),
    ])
    expect(await listRecurringCommitments(t.db, user)).toHaveLength(2)
    // On the calendar: Monday Sep 28, with the course and room.
    expect(commitmentsOn(saved, "2026-09-28")).toEqual([
      expect.objectContaining({ title: "CSC 215 · Data Structures", startTime: "10:00", courseId: course.id, location: "Tator Hall 120", type: "class" }),
    ])
    expect(commitmentsOn(saved, "2026-12-21")).toEqual([])
  })

  it("saving again replaces them; an empty list takes the course off the calendar", async () => {
    const { user, course } = await studentWithCourse()
    await setClassTimes(t.db, user, course.id, [LECTURE, LAB])
    await setClassTimes(t.db, user, course.id, [LAB])
    expect((await listRecurringCommitments(t.db, user)).map((c) => c.daysOfWeek)).toEqual([[2]])
    await setClassTimes(t.db, user, course.id, [])
    expect(await listRecurringCommitments(t.db, user)).toEqual([])
  })

  it("follow the course: renamed with it, deleted with it", async () => {
    const { user, course } = await studentWithCourse()
    await setClassTimes(t.db, user, course.id, [LECTURE])
    await updateCourse(t.db, user, course.id, { name: "Data Structures & Algorithms" })
    expect((await listRecurringCommitments(t.db, user))[0].title).toBe("CSC 215 · Data Structures & Algorithms")
    await deleteCourse(t.db, user, course.id)
    expect(await listRecurringCommitments(t.db, user)).toEqual([])
  })

  it("only for the student's own course", async () => {
    const { course } = await studentWithCourse("Alex")
    const sam = await t.addUser("Sam")
    await expect(setClassTimes(t.db, sam, course.id, [LECTURE])).rejects.toThrow(/doesn.t exist/)
    // Not even by writing the row directly.
    await expect(t.db.insert(recurringCommitments).values({ userId: sam, courseId: course.id, title: "X", type: "class", daysOfWeek: [1], startTime: "10:00", endTime: "11:00" })).rejects.toThrow()
  })

  it("the student's other commitments are untouched, and onboarding's list doesn't remove class times", async () => {
    const { user, course } = await studentWithCourse()
    await createRecurringCommitment(t.db, user, { title: "Soccer practice", daysOfWeek: [2, 4], startTime: "16:00", endTime: "18:00", type: "sports" })
    await setClassTimes(t.db, user, course.id, [LECTURE])
    await setClassTimes(t.db, user, course.id, [LAB])
    await saveOnboardingDetails(t.db, user, {
      profile: { firstName: "Alex", lastName: "", schoolName: "", schoolDomain: null },
      preferences: DEFAULT_STUDENT_PREFERENCES,
      commitments: [{ title: "Work", daysOfWeek: [6], startTime: "09:00", endTime: "13:00", type: "work" }],
    })
    expect((await listRecurringCommitments(t.db, user)).map((c) => c.title).sort()).toEqual(["CSC 215 · Data Structures", "Work"])
  })

  it("an online course: no class times, and remembered on the course; adding times makes it in-person again", async () => {
    const { user, course } = await studentWithCourse()
    await setClassTimes(t.db, user, course.id, [LECTURE])
    expect(await setClassTimes(t.db, user, course.id, [], true)).toEqual([])
    expect(await listRecurringCommitments(t.db, user)).toEqual([])
    expect((await getCourseForUser(t.db, user, course.id)).online).toBe(true)
    await expect(setClassTimes(t.db, user, course.id, [LAB], true)).rejects.toThrow(/online course has no class times/)
    await setClassTimes(t.db, user, course.id, [LAB])
    expect((await getCourseForUser(t.db, user, course.id)).online).toBeUndefined()
  })

  it("the database keeps them classes, with a sensible room", async () => {
    const { user, course } = await studentWithCourse()
    const [row] = await setClassTimes(t.db, user, course.id, [LECTURE])
    await expect(t.db.update(recurringCommitments).set({ type: "sports" }).where(eq(recurringCommitments.id, row.id))).rejects.toThrow()
    await expect(t.db.update(recurringCommitments).set({ location: "x".repeat(101) }).where(eq(recurringCommitments.id, row.id))).rejects.toThrow()
  })
})

describe("semester dates from Canvas", () => {
  it("an imported course keeps its semester's dates (for its class times)", async () => {
    const user = await t.addUser("Alex")
    await importCanvasFromExtension(t.db, user, {
      baseUrl: "https://school.instructure.com",
      timeZone: "America/New_York",
      courses: [{ id: 215, name: "Data Structures", course_code: "CSC 215", term: { name: "Fall 2026", start_at: "2026-08-31T04:00:00Z", end_at: "2026-12-19T04:59:59Z" } }],
      assignments: { "215": [] },
    })
    const [course] = await listCourses(t.db, user)
    expect(course).toMatchObject({ code: "CSC 215", termStart: "2026-08-31", termEnd: "2026-12-18" })
  })
})

describe("class times input", () => {
  const check = (times: unknown) => classTimesSchema.safeParse(times)
  it("needs at least one day, an end after the start, and at most 10 times", () => {
    expect(check([LECTURE, LAB]).success).toBe(true)
    expect(check([{ ...LAB, daysOfWeek: [] }]).error?.issues[0].message).toBe("Pick at least one day.")
    expect(check([{ ...LAB, endTime: "13:00" }]).error?.issues[0].message).toBe("End time must be after the start time.")
    expect(check([{ ...LAB, daysOfWeek: [7] }]).success).toBe(false)
    expect(check([{ ...LECTURE, endDate: "2026-09-01" }]).success).toBe(false)
    expect(check(Array(11).fill(LAB)).success).toBe(false)
    expect(check([{ ...LAB, location: "x".repeat(101) }]).success).toBe(false)
  })
})
