import { describe, expect, it } from "vitest"
import { academicHeadsUp } from "./academic-calendar"
import type { AcademicEvent } from "./types"

// "At school" on the Dashboard: what's going on and coming up (Quinnipiac's real Fall 2026).

const E = (id: string, kind: AcademicEvent["kind"], title: string, startDate: string, endDate = startDate): AcademicEvent => ({ id, kind, title, startDate, endDate })
const CALENDAR = [
  E("t1", "term", "Fall 2026", "2026-08-24", "2026-12-12"),
  E("t2", "term", "Spring 2027", "2027-01-25", "2027-05-14"),
  E("e1", "no_classes", "Labor Day", "2026-09-07"),
  E("e2", "deadline", "Last day to withdraw", "2026-10-30"),
  E("e3", "no_classes", "No classes (Thanksgiving)", "2026-11-23", "2026-11-28"),
  E("e4", "exams", "Final examination period", "2026-12-07", "2026-12-12"),
  E("e5", "other", "Final grades due", "2026-12-14"),
]
const at = (today: string) => academicHeadsUp(CALENDAR, today).map((item) => [item.when, item.title, item.days])

describe("heads-up", () => {
  it("a deadline and a break coming up, soonest first", () => {
    expect(at("2026-10-26")).toEqual([["soon", "Last day to withdraw", 4]])
    expect(at("2026-11-16")).toEqual([["soon", "No classes (Thanksgiving)", 7]])
  })

  it("during a break: no classes until it ends", () => {
    expect(at("2026-11-25")).toEqual([
      ["now", "No classes (Thanksgiving)", 3],
      ["soon", "Final examination period", 12],
    ])
  })

  it("near the end of the semester: finals coming, the semester ending (other dates aren't shown)", () => {
    expect(at("2026-12-01")).toEqual([
      ["soon", "Final examination period", 6],
      ["ends", "Fall 2026", 11],
    ])
    expect(at("2026-12-09")).toEqual([
      ["now", "Final examination period", 3],
      ["ends", "Fall 2026", 3],
    ])
  })

  it("a semester starting soon; nothing in a quiet week", () => {
    expect(at("2027-01-18")).toEqual([["soon", "Spring 2027", 7]])
    expect(at("2026-09-28")).toEqual([])
  })
})
