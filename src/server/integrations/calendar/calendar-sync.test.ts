import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { externalEventsAsCalendarItems, type ExternalCalendarEvent } from "@/lib/calendar/external-events"
import { scheduleBetween } from "@/lib/recurring"
import { externalCalendarEvents } from "../../db/schema"
import { NotFoundError } from "../../errors"
import { loadAppData } from "../../services/app-data"
import { createEvent } from "../../services/events"
import { listExternalEvents, removeExternalEventsFrom, setExternalEventHidden } from "../../services/external-events"
import { createTestDb } from "../../test-utils/test-db"
import { syncExternalCalendar } from "./calendar-sync"

// The calendar sync service against a real Postgres: normalized events (what the
// Google Calendar and Outlook adapters produce, see providers.test.ts) saved for
// one student. TEST FIXTURES; no calendar is contacted.

const NOW = new Date("2026-09-23T12:00:00Z")
const NY = "America/New_York"

const event = (externalId: string, title: string, startsAt: string, endsAt: string, extra: Partial<ExternalCalendarEvent> = {}): ExternalCalendarEvent => ({
  source: "google",
  externalId,
  title,
  description: null,
  startsAt,
  endsAt,
  location: null,
  url: null,
  ...extra,
})
const exam = (extra: Partial<ExternalCalendarEvent> = {}) =>
  event("9", "CSC215 Exam", "2026-09-29T18:00:00.000Z", "2026-09-29T20:00:00.000Z", extra)

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const sync = (user: string, source: "google" | "outlook", events: ExternalCalendarEvent[], now = NOW) =>
  syncExternalCalendar(t.db, user, source, events.map((e) => ({ ...e, source })), { now })

describe("calendar events", () => {
  it("imports events (not as tasks), shown in the student's time zone", async () => {
    const user = await t.addUser()
    const result = await sync(user, "google", [exam({ location: "Tator Hall 201", url: "https://www.google.com/calendar/event?eid=abc" })])
    expect(result).toEqual({ added: 1, updated: 0, removed: 0, skipped: 0, failed: 0 })

    const data = await loadAppData(t.db, user)
    expect(data.tasks).toEqual([])
    expect(data.externalEvents).toEqual([
      {
        id: expect.any(String),
        source: "google",
        title: "CSC215 Exam",
        description: null,
        startsAt: "2026-09-29T18:00:00.000Z",
        endsAt: "2026-09-29T20:00:00.000Z",
        location: "Tator Hall 201",
        url: "https://www.google.com/calendar/event?eid=abc",
        hidden: false,
      },
    ])
    // 2:00-4:00 PM on the student's New York calendar.
    expect(externalEventsAsCalendarItems(data.externalEvents, NY)).toEqual([
      expect.objectContaining({ date: "2026-09-29", startTime: "14:00", endTime: "16:00", source: "google" }),
    ])
  })

  it("the same event twice -> one event; a new time updates it in place (2 PM -> 3 PM)", async () => {
    const user = await t.addUser()
    await sync(user, "google", [exam()])
    expect(await sync(user, "google", [exam()])).toMatchObject({ added: 0, updated: 0 })
    const [before] = await listExternalEvents(t.db, user)

    expect(await sync(user, "google", [exam({ startsAt: "2026-09-29T19:00:00.000Z", endsAt: "2026-09-29T21:00:00.000Z" })])).toMatchObject({ added: 0, updated: 1 })
    const after = await listExternalEvents(t.db, user)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, startsAt: "2026-09-29T19:00:00.000Z" })
  })

  it("an event deleted in the calendar is kept but no longer shown; an older one just ages out", async () => {
    const user = await t.addUser()
    await sync(user, "google", [exam(), event("8", "Past review", "2026-09-01T18:00:00.000Z", "2026-09-01T20:00:00.000Z")])
    expect(await sync(user, "google", [])).toMatchObject({ removed: 1 })
    expect(await t.db.select().from(externalCalendarEvents)).toHaveLength(2) // nothing hard-deleted
    expect((await listExternalEvents(t.db, user)).map((e) => e.title)).toEqual(["Past review"])
  })
})

describe("hiding external events", () => {
  it("a hidden event stays hidden through syncs and changes, until restored", async () => {
    const user = await t.addUser()
    await sync(user, "google", [exam()])
    const [saved] = await listExternalEvents(t.db, user)
    await setExternalEventHidden(t.db, user, saved.id, true)

    expect(await sync(user, "google", [exam({ title: "CSC215 Exam (moved room)" })])).toMatchObject({ added: 0, updated: 1 })
    const [synced] = await listExternalEvents(t.db, user)
    expect(synced).toMatchObject({ id: saved.id, title: "CSC215 Exam (moved room)", hidden: true })
    expect(externalEventsAsCalendarItems([synced], NY)).toEqual([])

    await setExternalEventHidden(t.db, user, saved.id, false)
    expect(externalEventsAsCalendarItems(await listExternalEvents(t.db, user), NY)).toHaveLength(1)
  })

  it("students can only hide or see their own events", async () => {
    const alex = await t.addUser("Alex")
    const sam = await t.addUser("Sam")
    await sync(alex, "google", [exam()])
    const [saved] = await listExternalEvents(t.db, alex)
    expect(await listExternalEvents(t.db, sam)).toEqual([])
    await expect(setExternalEventHidden(t.db, sam, saved.id, true)).rejects.toBeInstanceOf(NotFoundError)
    expect((await listExternalEvents(t.db, alex))[0].hidden).toBe(false)
    // Removing a source only affects that student.
    await removeExternalEventsFrom(t.db, sam, "google")
    expect(await listExternalEvents(t.db, alex)).toHaveLength(1)
  })
})

describe("two calendars together", () => {
  it("both calendars, identical external ids, and the student's own events all coexist", async () => {
    const user = await t.addUser()
    // Google event id "9" and Outlook event id "9": different events.
    await sync(user, "google", [exam()])
    const outlook = [
      event("9", "Psychology Exam", "2026-09-30T14:00:00.000Z", "2026-09-30T16:00:00.000Z"),
      event("77", "Class Meeting", "2026-09-30T18:00:00.000Z", "2026-09-30T19:15:00.000Z"),
    ]
    expect(await sync(user, "outlook", outlook)).toMatchObject({ added: 2 })
    // The student's own event with the same title and time as the Google one.
    await createEvent(t.db, user, { title: "CSC215 Exam", date: "2026-09-29", startTime: "14:00", endTime: "16:00", type: "class" })

    const data = await loadAppData(t.db, user)
    const items = scheduleBetween([...data.events, ...externalEventsAsCalendarItems(data.externalEvents, NY)], [], "2026-09-29", "2026-09-30")
    expect(items.map((item) => [item.date, item.startTime, item.title, item.source ?? "student_os"]).sort()).toEqual([
      ["2026-09-29", "14:00", "CSC215 Exam", "google"],
      ["2026-09-29", "14:00", "CSC215 Exam", "student_os"],
      ["2026-09-30", "10:00", "Psychology Exam", "outlook"],
      ["2026-09-30", "14:00", "Class Meeting", "outlook"],
    ])

    // Syncing either again changes nothing and never touches the other's events.
    expect(await sync(user, "outlook", outlook)).toMatchObject({ added: 0, updated: 0, removed: 0 })
    await sync(user, "google", [])
    expect((await listExternalEvents(t.db, user)).map((e) => e.source).sort()).toEqual(["outlook", "outlook"])
  })

  it("disconnecting one calendar stops showing its events only", async () => {
    const user = await t.addUser()
    await sync(user, "google", [exam()])
    await sync(user, "outlook", [event("77", "Class Meeting", "2026-09-30T18:00:00.000Z", "2026-09-30T19:15:00.000Z")])
    await removeExternalEventsFrom(t.db, user, "google")
    expect((await listExternalEvents(t.db, user)).map((e) => e.source)).toEqual(["outlook"])
  })
})

describe("the calendar sync service", () => {
  it("one bad event is skipped and reported; the rest are saved", async () => {
    const user = await t.addUser()
    // Ends before it starts (the adapters never produce it; the database refuses it too).
    const bad = event("b", "Bad", "2026-09-29T20:00:00.000Z", "2026-09-29T18:00:00.000Z")
    const result = await sync(user, "google", [event("a", "Good", "2026-09-29T18:00:00.000Z", "2026-09-29T20:00:00.000Z"), bad])
    expect(result).toMatchObject({ added: 1, failed: 1 })
    expect((await listExternalEvents(t.db, user)).map((e) => e.title)).toEqual(["Good"])
  })
})
