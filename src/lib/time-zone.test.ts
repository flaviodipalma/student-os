import { describe, expect, it } from "vitest"
import { addDays, fromDateKey, toDateKey } from "@/lib/format"
import { commitmentsOn } from "@/lib/recurring"
import { dateFromWallClock, isValidTimeZone, wallClockIn } from "./time-zone"

// "Today" and "now" are the student's, whatever time zone the server runs in.
// 2026-09-23 00:30 UTC is still the evening of Sept 22 in New York.
const INSTANT = new Date(Date.UTC(2026, 8, 23, 0, 30))

describe("the student's time zone", () => {
  it("works out the student's wall-clock time and date", () => {
    expect(wallClockIn("America/New_York", INSTANT)).toEqual([2026, 8, 22, 20, 30, 0])
    expect(wallClockIn("Asia/Tokyo", INSTANT)).toEqual([2026, 8, 23, 9, 30, 0])
    expect(wallClockIn("UTC", INSTANT)).toEqual([2026, 8, 23, 0, 30, 0])
    // A server on UTC still gives a New York student Sept 22 as "today".
    expect(toDateKey(dateFromWallClock(wallClockIn("America/New_York", INSTANT)))).toBe("2026-09-22")
    expect(dateFromWallClock(wallClockIn("America/New_York", INSTANT)).getHours()).toBe(20)
  })

  it("falls back to the runtime's own zone for missing or bad values", () => {
    expect(isValidTimeZone("Europe/Rome")).toBe(true)
    expect(isValidTimeZone("Mars/Olympus")).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
    const local = wallClockIn("not a zone", INSTANT)
    expect(local).toEqual([
      INSTANT.getFullYear(),
      INSTANT.getMonth(),
      INSTANT.getDate(),
      INSTANT.getHours(),
      INSTANT.getMinutes(),
      INSTANT.getSeconds(),
    ])
  })

  it("keeps date-only deadlines as plain dates (no shifting across midnight)", () => {
    // Dates are "YYYY-MM-DD" strings end to end; they're read as local midnight, never UTC.
    for (const key of ["2026-01-01", "2026-03-08", "2026-11-01", "2026-12-31"]) {
      expect(toDateKey(fromDateKey(key))).toBe(key)
    }
    // Across the daylight-saving changes, adding days lands on the next calendar day.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08")
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09")
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02")
  })

  it("repeats weekly events on the right weekday across daylight-saving changes", () => {
    const sunday = { id: "c", title: "Work", daysOfWeek: [0], startTime: "09:00", endTime: "13:00", type: "work" as const }
    for (const date of ["2026-03-08", "2026-11-01", "2026-12-27"]) expect(commitmentsOn([sunday], date)).toHaveLength(1)
    expect(commitmentsOn([sunday], "2026-03-09")).toEqual([])
  })
})
