import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { scheduleBetween } from "@/lib/recurring"
import { externalCalendarEvents } from "../../db/schema"
import { NotFoundError } from "../../errors"
import { loadAppData } from "../../services/app-data"
import { createEvent } from "../../services/events"
import { listExternalEvents, removeExternalEventsFrom, setExternalEventHidden } from "../../services/external-events"
import { createTestDb } from "../../test-utils/test-db"
import { listLmsConnections, saveLmsFeedConnection } from "../lms/connections"
import { createCredentialVault } from "../lms/credential-vault"
import { syncBlackboardFeed } from "../lms/blackboard/feed-sync"
import { syncCanvasFeed } from "../lms/canvas/feed-sync"
import { syncExternalCalendar } from "./calendar-sync"

// Canvas and Blackboard calendar events through the real feed syncs and a real
// Postgres. Feeds are TEST FIXTURES shaped like each provider's calendar feed
// (Canvas: "event-calendar-event-<id>" UIDs, UTC times, calendar URL; Blackboard:
// PRODID -//Blackboard//EN, TZID times). No real LMS is contacted.

const vault = createCredentialVault(randomBytes(32))
const NOW = new Date("2026-09-23T12:00:00Z")
const NY = "America/New_York"
const CANVAS = "https://school.instructure.com"
const CANVAS_FEED = `${CANVAS}/feeds/calendars/user_abc123.ics`
const BLACKBOARD = "https://school.blackboard.com"
const BLACKBOARD_FEED = `${BLACKBOARD}/webapps/calendar/calendarFeed/0a1b2c3d4e5f6071/learn.ics`

const calendar = (prodId: string, events: string[][]) =>
  ["BEGIN:VCALENDAR", `PRODID:${prodId}`, "VERSION:2.0", ...events.flat(), "END:VCALENDAR"].join("\r\n")

// A Canvas calendar event (not an assignment), times in UTC like Canvas writes them.
const canvasEvent = (id: number, title: string, start: string, end: string, extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:event-calendar-event-${id}`,
  `SUMMARY:${title}`,
  `DTSTART;TZID=UTC:${start}`,
  `DTEND;TZID=UTC:${end}`,
  `URL;VALUE=URI:${CANVAS}/calendar?include_contexts=course_215&month=09&year=2026#calendar_event_${id}`,
  ...extra,
  "END:VEVENT",
]
// A Blackboard course calendar entry (not a gradable item), local times with TZID.
const blackboardEvent = (uid: string, title: string, start: string, end: string) => [
  "BEGIN:VEVENT",
  "DTSTAMP:20260923T193949Z",
  `DTSTART;TZID=America/New_York:${start}`,
  `DTEND;TZID=America/New_York:${end}`,
  `SUMMARY:${title}`,
  `UID:${uid}`,
  "DESCRIPTION:",
  "END:VEVENT",
]

function feed(initial: () => string) {
  const state = { text: initial, status: 200 }
  const fetchImpl = (async () =>
    new Response(state.status === 200 ? state.text() : "", { status: state.status, headers: { "Content-Type": "text/calendar" } })) as typeof fetch
  return { fetch: fetchImpl, state }
}

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

async function student(name = "Alex") {
  const user = await t.addUser(name)
  await saveLmsFeedConnection(t.db, user, "canvas", { baseUrl: CANVAS, feedUrl: CANVAS_FEED }, vault)
  await saveLmsFeedConnection(t.db, user, "blackboard", { baseUrl: BLACKBOARD, feedUrl: BLACKBOARD_FEED }, vault)
  return user
}
const syncCanvas = (user: string, server: ReturnType<typeof feed>, now = NOW) =>
  syncCanvasFeed(t.db, user, vault, { now, timeZone: NY, fetch: server.fetch })
const syncBlackboard = (user: string, server: ReturnType<typeof feed>, now = NOW) =>
  syncBlackboardFeed(t.db, user, vault, { now, timeZone: NY, fetch: server.fetch })

describe("Canvas calendar events", () => {
  it("imports calendar events (not as tasks), with location and a link to the student's Canvas", async () => {
    const user = await student()
    const server = feed(() =>
      calendar("-//Instructure//Canvas", [
        canvasEvent(9, "CSC215 Exam [CSC 215]", "20260929T180000", "20260929T200000", ["LOCATION:Tator Hall 201"]),
        ["BEGIN:VEVENT", "UID:event-calendar-event-10", "SUMMARY:No class", "DTSTART;VALUE=DATE:20261012", "END:VEVENT"],
      ])
    )
    const result = await syncCanvas(user, server)
    expect(result.calendarEvents).toEqual({ added: 1, updated: 0, removed: 0, skipped: 1, failed: 0 })
    expect(result.assignmentsCreated).toBe(0)

    const data = await loadAppData(t.db, user)
    expect(data.tasks).toEqual([])
    expect(data.externalEvents).toEqual([
      {
        id: expect.any(String),
        source: "canvas",
        title: "CSC215 Exam [CSC 215]",
        description: null,
        startsAt: "2026-09-29T18:00:00.000Z",
        endsAt: "2026-09-29T20:00:00.000Z",
        location: "Tator Hall 201",
        url: `${CANVAS}/calendar?include_contexts=course_215&month=09&year=2026#calendar_event_9`,
        hidden: false,
      },
    ])
    // 2:00-4:00 PM on the student's New York calendar.
    expect(externalEventsAsCalendarItems(data.externalEvents, NY)).toEqual([
      expect.objectContaining({ date: "2026-09-29", startTime: "14:00", endTime: "16:00", source: "canvas" }),
    ])
  })

  it("the same event twice -> one event; a new time updates it in place (2 PM -> 3 PM)", async () => {
    const user = await student()
    let start = "20260929T180000"
    let end = "20260929T200000"
    const server = feed(() => calendar("-//Instructure//Canvas", [canvasEvent(9, "CSC215 Exam", start, end)]))
    await syncCanvas(user, server)
    expect((await syncCanvas(user, server)).calendarEvents).toMatchObject({ added: 0, updated: 0 })
    const [before] = await listExternalEvents(t.db, user)

    start = "20260929T190000"
    end = "20260929T210000"
    expect((await syncCanvas(user, server)).calendarEvents).toMatchObject({ added: 0, updated: 1 })
    const after = await listExternalEvents(t.db, user)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, startsAt: "2026-09-29T19:00:00.000Z" })
  })

  it("an event deleted in Canvas is kept but no longer shown; an older one just ages out", async () => {
    const user = await student()
    let events = [
      canvasEvent(9, "Exam", "20260929T180000", "20260929T200000"),
      canvasEvent(8, "Past review", "20260901T180000", "20260901T200000"),
    ]
    const server = feed(() => calendar("-//Instructure//Canvas", events))
    await syncCanvas(user, server)
    events = []
    expect((await syncCanvas(user, server)).calendarEvents).toMatchObject({ removed: 1 })
    const rows = await t.db.select().from(externalCalendarEvents)
    expect(rows).toHaveLength(2) // nothing hard-deleted
    expect((await listExternalEvents(t.db, user)).map((e) => e.title)).toEqual(["Past review"])
  })
})

describe("hiding external events", () => {
  it("a hidden event stays hidden through syncs and changes, until restored", async () => {
    const user = await student()
    let title = "CSC215 Exam"
    const server = feed(() => calendar("-//Instructure//Canvas", [canvasEvent(9, title, "20260929T180000", "20260929T200000")]))
    await syncCanvas(user, server)
    const [event] = await listExternalEvents(t.db, user)
    await setExternalEventHidden(t.db, user, event.id, true)

    title = "CSC215 Exam (moved room)"
    expect((await syncCanvas(user, server)).calendarEvents).toMatchObject({ added: 0, updated: 1 })
    const [synced] = await listExternalEvents(t.db, user)
    expect(synced).toMatchObject({ id: event.id, title: "CSC215 Exam (moved room)", hidden: true })
    expect(externalEventsAsCalendarItems([synced], NY)).toEqual([])

    await setExternalEventHidden(t.db, user, event.id, false)
    expect(externalEventsAsCalendarItems(await listExternalEvents(t.db, user), NY)).toHaveLength(1)
  })

  it("students can only hide or see their own events", async () => {
    const alex = await student("Alex")
    const sam = await student("Sam")
    await syncCanvas(alex, feed(() => calendar("-//Instructure//Canvas", [canvasEvent(9, "Exam", "20260929T180000", "20260929T200000")])))
    const [event] = await listExternalEvents(t.db, alex)
    expect(await listExternalEvents(t.db, sam)).toEqual([])
    await expect(setExternalEventHidden(t.db, sam, event.id, true)).rejects.toBeInstanceOf(NotFoundError)
    expect((await listExternalEvents(t.db, alex))[0].hidden).toBe(false)
    // Removing a source only affects that student.
    await removeExternalEventsFrom(t.db, sam, "canvas")
    expect(await listExternalEvents(t.db, alex)).toHaveLength(1)
  })
})

describe("Canvas and Blackboard together", () => {
  const blackboardServer = () =>
    feed(() =>
      calendar("-//Blackboard//EN", [
        blackboardEvent("9", "Psychology Exam", "20260930T100000", "20260930T120000"),
        blackboardEvent("_blackboard.platform.calendar.CalendarEntry-_77_1", "Class Meeting", "20260930T140000", "20260930T151500"),
        // A gradable item: a deadline -> a task, not an event.
        blackboardEvent("_blackboard.platform.gradebook2.GradableItem-_1001_1", "Lab 4", "20260930T235900", "20260930T235900"),
      ])
    )

  it("both calendars, identical external ids, and the student's own events all coexist", async () => {
    const user = await student()
    // Canvas event id "9" and Blackboard event UID "9": different events.
    await syncCanvas(user, feed(() => calendar("-//Instructure//Canvas", [canvasEvent(9, "CSC215 Exam", "20260929T180000", "20260929T200000")])))
    const blackboard = await syncBlackboard(user, blackboardServer())
    expect(blackboard.calendarEvents).toMatchObject({ added: 2 })
    expect(blackboard.assignmentsCreated).toBe(1)
    // The student's own event with the same title and time as the Canvas one.
    await createEvent(t.db, user, { title: "CSC215 Exam", date: "2026-09-29", startTime: "14:00", endTime: "16:00", type: "class" })

    const data = await loadAppData(t.db, user)
    expect(data.externalEvents.map((e) => [e.source, e.title]).sort()).toEqual([
      ["blackboard", "Class Meeting"],
      ["blackboard", "Psychology Exam"],
      ["canvas", "CSC215 Exam"],
    ])
    const items = scheduleBetween([...data.events, ...externalEventsAsCalendarItems(data.externalEvents, NY)], [], "2026-09-29", "2026-09-30")
    expect(items.map((item) => [item.date, item.startTime, item.title, item.source ?? "student_os"]).sort()).toEqual([
      ["2026-09-29", "14:00", "CSC215 Exam", "canvas"],
      ["2026-09-29", "14:00", "CSC215 Exam", "student_os"],
      ["2026-09-30", "10:00", "Psychology Exam", "blackboard"],
      ["2026-09-30", "14:00", "Class Meeting", "blackboard"],
    ])

    // Syncing either again changes nothing and never touches the other's events.
    expect((await syncBlackboard(user, blackboardServer())).calendarEvents).toMatchObject({ added: 0, updated: 0, removed: 0 })
    await syncCanvas(user, feed(() => calendar("-//Instructure//Canvas", [])))
    expect((await listExternalEvents(t.db, user)).map((e) => e.source).sort()).toEqual(["blackboard", "blackboard"])
  })

  it("one calendar failing doesn't affect the other, or the events already imported", async () => {
    const user = await student()
    await syncCanvas(user, feed(() => calendar("-//Instructure//Canvas", [canvasEvent(9, "CSC215 Exam", "20260929T180000", "20260929T200000")])))
    const broken = feed(() => "")
    broken.state.status = 503
    await expect(syncCanvas(user, broken)).rejects.toThrow("Canvas is temporarily unavailable.")
    expect(await syncBlackboard(user, blackboardServer())).toMatchObject({ calendarEvents: { added: 2 } })

    const events = await listExternalEvents(t.db, user)
    expect(events.map((e) => e.source).sort()).toEqual(["blackboard", "blackboard", "canvas"])
    const connections = await listLmsConnections(t.db, user)
    expect(connections.find((c) => c.provider === "canvas")).toMatchObject({ lastSyncError: "Canvas is temporarily unavailable. Please try again." })
    expect(connections.find((c) => c.provider === "blackboard")).toMatchObject({ status: "connected", lastSyncError: null })
  })

  it("disconnecting one calendar stops showing its events only", async () => {
    const user = await student()
    await syncCanvas(user, feed(() => calendar("-//Instructure//Canvas", [canvasEvent(9, "CSC215 Exam", "20260929T180000", "20260929T200000")])))
    await syncBlackboard(user, blackboardServer())
    await removeExternalEventsFrom(t.db, user, "canvas")
    expect((await listExternalEvents(t.db, user)).map((e) => e.source)).toEqual(["blackboard", "blackboard"])
  })
})

describe("the calendar sync service", () => {
  it("one bad event is skipped and reported; the rest are saved", async () => {
    const user = await t.addUser()
    const good = {
      source: "canvas" as const,
      externalId: "a",
      title: "Good",
      description: null,
      startsAt: "2026-09-29T18:00:00.000Z",
      endsAt: "2026-09-29T20:00:00.000Z",
      location: null,
      url: null,
    }
    // Ends before it starts (can't come from the parsers; the database refuses it too).
    const bad = { ...good, externalId: "b", startsAt: "2026-09-29T20:00:00.000Z", endsAt: "2026-09-29T18:00:00.000Z" }
    const result = await syncExternalCalendar(t.db, user, "canvas", [good, bad], { now: NOW })
    expect(result).toMatchObject({ added: 1, failed: 1 })
    expect((await listExternalEvents(t.db, user)).map((e) => e.title)).toEqual(["Good"])
  })

  it("a malformed feed event (no end, bad time) is skipped, the valid ones imported", async () => {
    const user = await student()
    const server = feed(() =>
      calendar("-//Instructure//Canvas", [
        ["BEGIN:VEVENT", "UID:event-calendar-event-1", "SUMMARY:No end", "DTSTART;TZID=UTC:20260929T180000", "END:VEVENT"],
        ["BEGIN:VEVENT", "UID:event-calendar-event-2", "SUMMARY:Bad time", "DTSTART;TZID=UTC:2026-09-29", "DTEND;TZID=UTC:20260929T190000", "END:VEVENT"],
        ["BEGIN:VEVENT", "UID:event-calendar-event-3", "SUMMARY:Unknown zone", "DTSTART;TZID=Mars/Olympus:20260929T180000", "DTEND;TZID=Mars/Olympus:20260929T190000", "END:VEVENT"],
        canvasEvent(4, "Fine", "20260929T180000", "20260929T190000", ["URL:javascript:alert(1)"]),
      ])
    )
    const result = await syncCanvas(user, server)
    expect(result.calendarEvents).toMatchObject({ added: 1, skipped: 3, failed: 0 })
    const [event] = await listExternalEvents(t.db, user)
    expect(event.title).toBe("Fine")
    // A javascript: link is never kept (the event's last URL line is the one read).
    expect(event.url).toBeNull()
  })

  it("links to anywhere but the student's own LMS are dropped", async () => {
    const user = await student()
    const server = feed(() =>
      calendar("-//Instructure//Canvas", [
        [
          "BEGIN:VEVENT",
          "UID:event-calendar-event-5",
          "SUMMARY:Phishy",
          "DTSTART;TZID=UTC:20260929T180000",
          "DTEND;TZID=UTC:20260929T190000",
          "URL:https://evil.example.com/login",
          "END:VEVENT",
        ],
      ])
    )
    await syncCanvas(user, server)
    expect((await listExternalEvents(t.db, user))[0].url).toBeNull()
  })
})
