import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sql } from "drizzle-orm"
import { academicEventSchema } from "@/lib/validation"
import { createTestDb } from "../test-utils/test-db"
import { createAcademicEvent, deleteAcademicEvent, listAcademicEvents, replaceAcademicEvents, updateAcademicEvent } from "./academic-calendar"
import { createCourse } from "./courses"
import { listRecurringCommitments, setClassTimes } from "./recurring-commitments"

// The academic calendar, against a real Postgres.

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const LABOR_DAY = { kind: "no_classes" as const, title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07", term: "Fall 2026" }
const FALL = { kind: "term" as const, title: "Fall 2026", startDate: "2026-08-24", endDate: "2026-12-18", term: "Fall 2026" }

describe("academic calendar", () => {
  it("add, list (in date order), change and remove the student's own dates", async () => {
    const alex = await t.addUser("Alex")
    const labor = await createAcademicEvent(t.db, alex, LABOR_DAY)
    await createAcademicEvent(t.db, alex, FALL)
    expect((await listAcademicEvents(t.db, alex)).map((event) => event.title)).toEqual(["Fall 2026", "Labor Day"])
    await updateAcademicEvent(t.db, alex, labor.id, { ...LABOR_DAY, title: "Labor Day (no classes)" })
    await deleteAcademicEvent(t.db, alex, labor.id)
    expect((await listAcademicEvents(t.db, alex)).map((event) => event.title)).toEqual(["Fall 2026"])
  })

  it("nobody else's calendar can be read or changed", async () => {
    const alex = await t.addUser("Alex")
    const sam = await t.addUser("Sam")
    const labor = await createAcademicEvent(t.db, alex, LABOR_DAY)
    expect(await listAcademicEvents(t.db, sam)).toEqual([])
    await expect(updateAcademicEvent(t.db, sam, labor.id, FALL)).rejects.toThrow()
    await expect(deleteAcademicEvent(t.db, sam, labor.id)).rejects.toThrow()
    expect(await listAcademicEvents(t.db, alex)).toHaveLength(1)
  })

  it("class times come with the days they skip; replacing the calendar replaces them", async () => {
    const alex = await t.addUser("Alex")
    const course = await createCourse(t.db, alex, { code: "CSC215", name: "Data Structures", professor: "", description: "" })
    await setClassTimes(t.db, alex, course.id, [{ daysOfWeek: [1, 3, 5], startTime: "10:00", endTime: "10:50" }])
    await replaceAcademicEvents(t.db, alex, [FALL, LABOR_DAY])
    expect((await listRecurringCommitments(t.db, alex))[0].skipDates).toEqual(["2026-09-07"])
    await replaceAcademicEvents(t.db, alex, [FALL])
    expect((await listRecurringCommitments(t.db, alex))[0]).not.toHaveProperty("skipDates")
  })

  it("input rules, and the database checks behind them", async () => {
    expect(academicEventSchema.safeParse({ ...LABOR_DAY, endDate: "2026-09-01" }).error?.issues[0].message).toMatch(/can't be before/)
    expect(academicEventSchema.safeParse({ ...FALL, endDate: "2028-01-01" }).error?.issues[0].message).toMatch(/more than a year/)
    expect(academicEventSchema.safeParse({ ...LABOR_DAY, title: " " }).success).toBe(false)
    expect(academicEventSchema.safeParse({ ...LABOR_DAY, kind: "party" }).success).toBe(false)
    expect(academicEventSchema.parse({ ...LABOR_DAY, term: "  " }).term).toBeUndefined()
    const alex = await t.addUser("Alex")
    await expect(t.db.execute(sql`insert into academic_events (user_id, kind, title, start_date, end_date) values (${alex}, 'term', 'X', '2026-12-01', '2026-01-01')`)).rejects.toThrow()
  })
})
