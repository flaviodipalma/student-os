import { describe, expect, it } from "vitest"
import type { CalendarEvent, RecurringCommitment } from "@/lib/types"
import { commitmentsBetween, commitmentsOn, formatDateRange, formatDays, occursOn, scheduleBetween } from "./recurring"

// 2026-09-21 is a Monday.
const MON = "2026-09-21"
const TUE = "2026-09-22"
const SUN = "2026-09-27"

const soccer: RecurringCommitment = {
  id: "soccer",
  title: "Soccer Practice",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "10:30",
  endTime: "13:00",
  type: "sports",
}
const csc215: RecurringCommitment = {
  id: "csc215",
  title: "CSC215",
  daysOfWeek: [1, 3],
  startTime: "14:00",
  endTime: "15:15",
  type: "class",
  description: "Room 204",
}
const work: RecurringCommitment = { id: "work", title: "Work", daysOfWeek: [6], startTime: "09:00", endTime: "13:00", type: "work" }

function event(date: string, startTime: string, endTime: string, id = `event-${date}-${startTime}`): CalendarEvent {
  return { id, title: "Dentist", date, startTime, endTime, type: "personal" }
}

describe("weekly commitment occurrences", () => {
  it("happen only on the chosen weekdays", () => {
    const week = commitmentsBetween([soccer, csc215, work], MON, SUN)
    const days = (id: string) => week.filter((item) => item.commitmentId === id).map((item) => item.date)
    expect(days("soccer")).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"])
    expect(days("csc215")).toEqual(["2026-09-21", "2026-09-23"])
    expect(days("work")).toEqual(["2026-09-26"])
  })

  it("copy the rule's times, type and description, and point back to it", () => {
    expect(commitmentsOn([csc215], MON)).toEqual([
      {
        id: "csc215@2026-09-21",
        commitmentId: "csc215",
        title: "CSC215",
        date: MON,
        startTime: "14:00",
        endTime: "15:15",
        type: "class",
        description: "Room 204",
      },
    ])
    expect(commitmentsOn([csc215], TUE)).toEqual([])
  })

  it("respect the start and end dates (both inclusive)", () => {
    const term = { ...csc215, startDate: "2026-09-23", endDate: "2026-12-09" }
    expect(occursOn(term, MON)).toBe(false) // a Monday before it starts
    expect(occursOn(term, "2026-09-23")).toBe(true) // the first day
    expect(occursOn(term, "2026-12-09")).toBe(true) // the last day (a Wednesday)
    expect(occursOn(term, "2026-12-14")).toBe(false) // a Monday after it ends
    expect(occursOn({ ...csc215, endDate: "2026-12-09" }, MON)).toBe(true) // no start date = already going
    expect(occursOn({ ...csc215, startDate: "2026-09-21" }, "2027-05-03")).toBe(true) // no end date = keeps going
  })

  it("give each occurrence a unique id, with no duplicates", () => {
    const month = commitmentsBetween([soccer, csc215, work], "2026-09-01", "2026-09-30")
    expect(new Set(month.map((item) => item.id)).size).toBe(month.length)
  })

  it("work across month and year boundaries", () => {
    const items = commitmentsBetween([work], "2026-12-28", "2027-01-10")
    expect(items.map((item) => item.date)).toEqual(["2027-01-02", "2027-01-09"])
  })
})

describe("scheduleBetween (Calendar, Dashboard and Planner page)", () => {
  const items = [event(MON, "08:00", "09:00"), event(TUE, "16:00", "17:00"), event("2026-10-05", "08:00", "09:00")]

  it("combines one-time events and weekly commitments for the range, sorted", () => {
    const monday = scheduleBetween(items, [soccer, csc215], MON, MON)
    expect(monday.map((item) => `${item.startTime} ${item.title}`)).toEqual([
      "08:00 Dentist",
      "10:30 Soccer Practice",
      "14:00 CSC215",
    ])
  })

  it("shows today's weekly commitments on the Dashboard's day", () => {
    const today = scheduleBetween([], [soccer, csc215, work], TUE, TUE)
    expect(today).toEqual([expect.objectContaining({ commitmentId: "soccer", date: TUE })])
  })

  it("keeps out one-time events from other days", () => {
    const week = scheduleBetween(items, [], MON, SUN)
    expect(week.map((item) => item.date)).toEqual([MON, TUE])
  })

  it("never shows a commitment twice, even if an occurrence is passed in again", () => {
    const stale = commitmentsOn([soccer], MON)
    const monday = scheduleBetween([...items, ...stale], [soccer], MON, MON)
    expect(monday.filter((item) => item.commitmentId === "soccer")).toHaveLength(1)
  })

  it("drops a commitment's weeks once it is deleted", () => {
    expect(scheduleBetween(items, [], MON, MON).some((item) => item.commitmentId)).toBe(false)
  })
})

describe("formatting", () => {
  it("names the days, Monday first", () => {
    expect(formatDays([3, 1])).toBe("Mon, Wed")
    expect(formatDays([0, 6])).toBe("Sat, Sun")
    expect(formatDays([1, 2, 3, 4, 5])).toBe("Weekdays")
    expect(formatDays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day")
  })

  it("describes the date range", () => {
    expect(formatDateRange({})).toBe("")
    expect(formatDateRange({ startDate: "2026-09-01" })).toBe("From Sep 1")
    expect(formatDateRange({ endDate: "2026-12-12" })).toBe("Until Dec 12")
    expect(formatDateRange({ startDate: "2026-09-01", endDate: "2026-12-12" })).toBe("Sep 1 – Dec 12")
  })
})
