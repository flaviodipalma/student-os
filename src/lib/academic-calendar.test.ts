import { describe, expect, it } from "vitest"
import { academicItemsOn, noClassDates, semesterFor, withAcademicCalendar } from "./academic-calendar"
import { commitmentsBetween } from "./recurring"
import type { AcademicEvent, RecurringCommitment } from "./types"

// The academic calendar and class times (Quinnipiac's real Fall 2026 dates).

const FALL: AcademicEvent = { id: "t1", kind: "term", title: "Fall 2026", startDate: "2026-08-24", endDate: "2026-12-18", term: "Fall 2026" }
const SPRING: AcademicEvent = { id: "t2", kind: "term", title: "Spring 2027", startDate: "2027-01-25", endDate: "2027-05-14", term: "Spring 2027" }
const LABOR_DAY: AcademicEvent = { id: "e1", kind: "no_classes", title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07", term: "Fall 2026" }
const THANKSGIVING: AcademicEvent = { id: "e2", kind: "no_classes", title: "Thanksgiving break", startDate: "2026-11-25", endDate: "2026-11-29", term: "Fall 2026" }
const FINALS: AcademicEvent = { id: "e3", kind: "exams", title: "Final exams", startDate: "2026-12-14", endDate: "2026-12-18", term: "Fall 2026" }
const WITHDRAW: AcademicEvent = { id: "e4", kind: "deadline", title: "Last day to withdraw", startDate: "2026-11-02", endDate: "2026-11-02", term: "Fall 2026" }
const CALENDAR = [SPRING, FINALS, THANKSGIVING, FALL, WITHDRAW, LABOR_DAY]

const lecture: RecurringCommitment = {
  id: "r1",
  courseId: "c1",
  title: "CSC215 · Data Structures",
  type: "class",
  daysOfWeek: [1, 3, 5],
  startTime: "10:00",
  endTime: "10:50",
  startDate: "2026-08-24",
  endDate: "2026-12-18",
}
const soccer: RecurringCommitment = { id: "r2", title: "Soccer", type: "sports", daysOfWeek: [1], startTime: "16:00", endTime: "18:00" }

describe("days without classes", () => {
  it("breaks, holidays and the exam period, every day of them (deadlines and semesters don't count)", () => {
    expect(noClassDates(CALENDAR)).toEqual([
      "2026-09-07",
      "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29",
      "2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18",
    ])
  })

  it("class times skip them; the student's other commitments don't", () => {
    const [classes, sports] = withAcademicCalendar([lecture, soccer], CALENDAR)
    const days = (commitment: RecurringCommitment, from: string, to: string) => commitmentsBetween([commitment], from, to).map((item) => item.date)
    // Labor Day (Monday) has no class; the rest of that week does.
    expect(days(classes, "2026-09-07", "2026-09-11")).toEqual(["2026-09-09", "2026-09-11"])
    // Thanksgiving week: Monday only. Finals week: none.
    expect(days(classes, "2026-11-23", "2026-11-29")).toEqual(["2026-11-23"])
    expect(days(classes, "2026-12-14", "2026-12-18")).toEqual([])
    // Soccer still happens on Labor Day.
    expect(days(sports, "2026-09-07", "2026-09-07")).toEqual(["2026-09-07"])
    expect(sports).not.toHaveProperty("skipDates")
  })

  it("without a calendar, classes are unchanged", () => {
    expect(withAcademicCalendar([lecture], [])).toEqual([lecture])
  })
})

describe("the semester for class times", () => {
  it("the one going on, else the next, else the latest", () => {
    expect(semesterFor(CALENDAR, "2026-09-28")?.title).toBe("Fall 2026")
    expect(semesterFor(CALENDAR, "2027-01-05")?.title).toBe("Spring 2027")
    expect(semesterFor(CALENDAR, "2027-06-01")?.title).toBe("Spring 2027")
    expect(semesterFor([LABOR_DAY], "2026-09-28")).toBeUndefined()
  })
})

describe("the calendar's all-day row", () => {
  it("a semester on its first and last day; breaks and exams on each of their days", () => {
    expect(academicItemsOn(CALENDAR, "2026-08-24").map((item) => item.label)).toEqual(["Fall 2026 begins"])
    expect(academicItemsOn(CALENDAR, "2026-09-15")).toEqual([])
    expect(academicItemsOn(CALENDAR, "2026-11-27").map((item) => [item.kind, item.label])).toEqual([["no_classes", "Thanksgiving break"]])
    expect(academicItemsOn(CALENDAR, "2026-12-18").map((item) => item.label)).toEqual(["Fall 2026 ends", "Final exams"])
  })
})
