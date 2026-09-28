import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { toAcademicEvents } from "@/lib/academic-calendar-ai/schema"
import { CalendarReadError, MockAcademicCalendarAI } from "@/lib/ai/academic-calendar-ai"
import { createTestDb } from "../test-utils/test-db"
import { calendarFromLink, calendarFromSchoolWebsite } from "./index"
import type { PageFetcher } from "./safe-fetch"

// A school's calendar: found once, read by the (fake) AI, shared by its students.

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const TODAY = "2026-09-28"
const PAGE = `<h1>Academic Calendar</h1><ul>${["Aug 24", "Sep 7", "Nov 2", "Nov 25", "Dec 14", "Dec 18"].map((d) => `<li>Something ${d}, 2026</li>`).join("")}</ul>`

function schoolSite(domain: string, body = PAGE) {
  const fetchPage = vi.fn<PageFetcher>(async (url) =>
    url === `https://www.${domain}/academic-calendar/` ? { url, contentType: "text/html", body: Buffer.from(body) } : null
  )
  return fetchPage
}

describe("from the school's website", () => {
  it("found and read once, then shared: the next student gets it without fetching or AI", async () => {
    const fetchPage = schoolSite("qu.edu")
    const ai = new MockAcademicCalendarAI()
    const read = vi.spyOn(ai, "readCalendar")
    const first = await calendarFromSchoolWebsite(t.db, "qu.edu", { today: TODAY, schoolName: "Quinnipiac University", fetchPage, ai })
    expect(first).toMatchObject({ status: "found", sources: ["https://www.qu.edu/academic-calendar/"] })
    expect(first.status === "found" && first.events.find((e) => e.kind === "term")).toMatchObject({ title: "Fall 2026", startDate: "2026-08-24" })
    const calls = fetchPage.mock.calls.length
    const second = await calendarFromSchoolWebsite(t.db, "qu.edu", { today: TODAY, schoolName: "Quinnipiac University", fetchPage, ai })
    expect(second).toEqual(first)
    expect(fetchPage.mock.calls.length).toBe(calls)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("read again after a month", async () => {
    const fetchPage = schoolSite("month.edu")
    const ai = new MockAcademicCalendarAI()
    const read = vi.spyOn(ai, "readCalendar")
    await calendarFromSchoolWebsite(t.db, "month.edu", { today: TODAY, schoolName: "X", fetchPage, ai, now: new Date("2026-09-28T12:00:00Z") })
    await calendarFromSchoolWebsite(t.db, "month.edu", { today: "2026-10-30", schoolName: "X", fetchPage, ai, now: new Date("2026-10-30T12:00:00Z") })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("not found: remembered for a week (not searched again right away)", async () => {
    const fetchPage = vi.fn<PageFetcher>(async () => null)
    const deps = { today: TODAY, schoolName: "Nowhere", fetchPage, ai: new MockAcademicCalendarAI() }
    expect(await calendarFromSchoolWebsite(t.db, "nowhere.edu", { ...deps, now: new Date("2026-09-28T12:00:00Z") })).toEqual({ status: "not_found" })
    const calls = fetchPage.mock.calls.length
    expect(await calendarFromSchoolWebsite(t.db, "nowhere.edu", { ...deps, now: new Date("2026-10-01T12:00:00Z") })).toEqual({ status: "not_found" })
    expect(fetchPage.mock.calls.length).toBe(calls)
    await calendarFromSchoolWebsite(t.db, "nowhere.edu", { ...deps, now: new Date("2026-10-06T12:00:00Z") })
    expect(fetchPage.mock.calls.length).toBeGreaterThan(calls)
  })

  it("an AI failure isn't remembered (trying again later can work)", async () => {
    const fetchPage = schoolSite("busy.edu")
    const failing = { readCalendar: vi.fn(async () => { throw new CalendarReadError("busy") }) }
    await expect(calendarFromSchoolWebsite(t.db, "busy.edu", { today: TODAY, schoolName: "Busy", fetchPage, ai: failing })).rejects.toThrow(CalendarReadError)
    const ok = await calendarFromSchoolWebsite(t.db, "busy.edu", { today: TODAY, schoolName: "Busy", fetchPage, ai: new MockAcademicCalendarAI() })
    expect(ok.status).toBe("found")
  })

  it("pages that turn out not to be a calendar: not found", async () => {
    const fetchPage = schoolSite("events.edu", PAGE + "NOT A CALENDAR")
    expect(await calendarFromSchoolWebsite(t.db, "events.edu", { today: TODAY, schoolName: "E", fetchPage, ai: new MockAcademicCalendarAI() })).toEqual({ status: "not_found" })
  })
})

describe("from a pasted link", () => {
  it("read for this student, and not shared", async () => {
    const fetchPage = vi.fn<PageFetcher>(async (url) => ({ url, contentType: "text/html", body: Buffer.from(PAGE) }))
    const result = await calendarFromLink("https://calendars.example.com/qu.pdf", { today: TODAY, schoolName: "Q", fetchPage, ai: new MockAcademicCalendarAI() })
    expect(result).toMatchObject({ status: "found", sources: ["https://calendars.example.com/qu.pdf"] })
    expect(fetchPage).toHaveBeenCalledWith("https://calendars.example.com/qu.pdf", expect.not.objectContaining({ domain: expect.anything() }))
  })
})

describe("checking the AI's answer", () => {
  const item = { term: "Fall 2026", kind: "no_classes", title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07" }
  it("keeps well-formed items; drops malformed, long-past and repeated ones", () => {
    const events = toAcademicEvents(
      {
        found: true,
        items: [
          item,
          item,
          { ...item, title: "Backwards", startDate: "2026-10-10", endDate: "2026-10-01" },
          { ...item, title: "Bad date", startDate: "Sept 7" },
          { ...item, kind: "party" },
          { ...item, title: "Long ago", startDate: "2025-01-10", endDate: "2025-01-10" },
          { ...item, title: " " },
        ],
      },
      TODAY
    )
    expect(events).toEqual([{ kind: "no_classes", title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07", term: "Fall 2026" }])
  })

  it("'not a calendar', or a malformed answer: nothing", () => {
    expect(toAcademicEvents({ found: false, items: [item] }, TODAY)).toEqual([])
    expect(toAcademicEvents({ items: "nope" }, TODAY)).toEqual([])
    expect(toAcademicEvents(null, TODAY)).toEqual([])
  })
})

describe("with the fake AI configured (tests, demos)", () => {
  it("no website visit, and nothing stored in the shared cache", async () => {
    vi.stubEnv("ACADEMIC_CALENDAR_AI_PROVIDER", "mock")
    try {
      const fetchPage = vi.fn<PageFetcher>(async () => null)
      const result = await calendarFromSchoolWebsite(t.db, "demo.edu", { today: TODAY, schoolName: "Demo", fetchPage })
      expect(result.status).toBe("found")
      expect(fetchPage).not.toHaveBeenCalled()
      const { schoolCalendars } = await import("../db/schema")
      const { eq } = await import("drizzle-orm")
      expect(await t.db.select().from(schoolCalendars).where(eq(schoolCalendars.domain, "demo.edu"))).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
