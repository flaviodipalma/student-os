import { describe, expect, it } from "vitest"
import { toMinutes } from "@/lib/events"
import { createPlanner } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { scheduleBetween } from "@/lib/recurring"
import type { CalendarEvent, ExternalEventRecord, Task } from "@/lib/types"
import {
  externalEventsAsCalendarItems,
  normalizeExternalEvent,
  planExternalEvents,
  type ExternalCalendarEvent,
  type StoredExternalEvent,
} from "./external-events"

// External calendar events without any network or database: normalization,
// the sync plan, and turning instants into the student's local calendar items.

const NY = "America/New_York"
const at = (iso: string) => new Date(iso)

describe("normalizing an external event", () => {
  const base = { source: "canvas" as const, externalId: "calendar-event-9", title: "CSC215 Exam" }

  it("keeps what the source says, as UTC instants; missing optional fields stay null", () => {
    expect(normalizeExternalEvent({ ...base, start: at("2026-09-29T18:00:00Z"), end: at("2026-09-29T20:00:00Z") })).toEqual({
      event: {
        source: "canvas",
        externalId: "calendar-event-9",
        title: "CSC215 Exam",
        description: null,
        startsAt: "2026-09-29T18:00:00.000Z",
        endsAt: "2026-09-29T20:00:00.000Z",
        location: null,
        url: null,
      },
    })
    const full = normalizeExternalEvent({
      ...base,
      title: "  Office   hours ",
      description: " Bring questions ",
      start: at("2026-09-29T18:00:00Z"),
      durationMs: 30 * 60_000,
      location: " Tator Hall  201 ",
      url: "https://school.instructure.com/calendar",
    })
    expect(full).toMatchObject({
      event: { title: "Office hours", description: "Bring questions", endsAt: "2026-09-29T18:30:00.000Z", location: "Tator Hall 201" },
    })
  })

  it("skips what can't be a block of time, instead of guessing", () => {
    const skip = (raw: Partial<Parameters<typeof normalizeExternalEvent>[0]>) => normalizeExternalEvent({ ...base, start: null, ...raw })
    expect(skip({ title: " " })).toEqual({ skipped: "no-title" })
    expect(skip({ start: null, end: at("2026-09-29T20:00:00Z") })).toEqual({ skipped: "no-time" })
    expect(skip({ start: at("invalid"), end: at("2026-09-29T20:00:00Z") })).toEqual({ skipped: "no-time" })
    expect(skip({ start: at("2026-09-29T18:00:00Z") })).toEqual({ skipped: "no-time" }) // no end, no duration
    expect(skip({ start: at("2026-09-29T18:00:00Z"), end: at("2026-09-29T18:00:00Z") })).toEqual({ skipped: "no-length" })
    expect(skip({ start: at("2026-09-29T18:00:00Z"), end: at("2026-09-29T17:00:00Z") })).toEqual({ skipped: "no-length" })
    expect(skip({ start: at("2026-09-01T00:00:00Z"), end: at("2026-09-20T00:00:00Z") })).toEqual({ skipped: "too-long" })
    expect(skip({ allDay: true, start: at("2026-09-29T00:00:00Z"), end: at("2026-09-30T00:00:00Z") })).toEqual({ skipped: "all-day" })
  })
})

describe("the sync plan", () => {
  const incoming = (externalId: string, overrides: Partial<ExternalCalendarEvent> = {}): ExternalCalendarEvent => ({
    source: "canvas",
    externalId,
    title: `Event ${externalId}`,
    description: null,
    startsAt: "2026-09-29T18:00:00.000Z",
    endsAt: "2026-09-29T20:00:00.000Z",
    location: null,
    url: null,
    ...overrides,
  })
  const stored = (id: string, event: ExternalCalendarEvent, removedAt: string | null = null): StoredExternalEvent => ({ ...event, id, removedAt })
  const options = { source: "canvas" as const, missingFrom: at("2026-09-23T12:00:00Z") }

  it("first sync creates; the same events again change nothing", () => {
    const events = [incoming("1"), incoming("2")]
    expect(planExternalEvents([], events, options).map((a) => a.kind)).toEqual(["create", "create"])
    const saved = events.map((event, i) => stored(`row-${i}`, event))
    expect(planExternalEvents(saved, events, options)).toEqual([])
  })

  it("a changed event is updated in place (2:00 PM -> 3:00 PM), never duplicated", () => {
    const saved = [stored("row-1", incoming("1"))]
    const moved = incoming("1", { startsAt: "2026-09-29T19:00:00.000Z", endsAt: "2026-09-29T21:00:00.000Z" })
    expect(planExternalEvents(saved, [moved], options)).toEqual([{ kind: "update", id: "row-1", event: moved }])
  })

  it("a missing event is removed only if it hadn't ended; one that comes back is shown again", () => {
    const upcoming = stored("row-1", incoming("1"))
    const past = stored("row-2", incoming("2", { startsAt: "2026-09-01T18:00:00.000Z", endsAt: "2026-09-01T19:00:00.000Z" }))
    expect(planExternalEvents([upcoming, past], [], options)).toEqual([{ kind: "remove", id: "row-1" }])
    const gone = stored("row-1", incoming("1"), "2026-09-20T00:00:00.000Z")
    expect(planExternalEvents([gone], [incoming("1")], options)).toEqual([{ kind: "update", id: "row-1", event: incoming("1") }])
    expect(planExternalEvents([gone], [], options)).toEqual([]) // already removed
  })

  it("only touches its own source, and a repeated id in one feed counts once", () => {
    const blackboard = stored("row-bb", { ...incoming("1"), source: "blackboard" })
    const actions = planExternalEvents([blackboard], [incoming("1"), incoming("1", { title: "Repeat" })], options)
    expect(actions).toEqual([{ kind: "create", event: incoming("1") }])
  })
})

describe("external events on the student's calendar", () => {
  const record = (startsAt: string, endsAt: string, overrides: Partial<ExternalEventRecord> = {}): ExternalEventRecord => ({
    id: "ext-1",
    source: "canvas",
    title: "CSC215 Exam",
    description: null,
    startsAt,
    endsAt,
    location: null,
    url: null,
    hidden: false,
    ...overrides,
  })
  const slots = (items: CalendarEvent[]) => items.map((item) => [item.date, item.startTime, item.endTime])

  it("shows at local times in the student's time zone, with its source; type is neutral", () => {
    const [item] = externalEventsAsCalendarItems([record("2026-09-29T18:00:00Z", "2026-09-29T20:00:00Z")], NY)
    expect(item).toMatchObject({ date: "2026-09-29", startTime: "14:00", endTime: "16:00", type: "other", source: "canvas", externalEventId: "ext-1" })
    const la = externalEventsAsCalendarItems([record("2026-09-29T18:00:00Z", "2026-09-29T20:00:00Z")], "America/Los_Angeles")
    expect(slots(la)).toEqual([["2026-09-29", "11:00", "13:00"]])
    expect(slots(externalEventsAsCalendarItems([record("2026-09-29T18:00:00Z", "2026-09-29T20:00:00Z")], "UTC"))).toEqual([
      ["2026-09-29", "18:00", "20:00"],
    ])
  })

  it("follows daylight saving time (no fixed offsets)", () => {
    // 9 AM New York on both sides of the November 1, 2026 change (EDT -4, then EST -5).
    expect(slots(externalEventsAsCalendarItems([record("2026-10-31T13:00:00Z", "2026-10-31T14:00:00Z")], NY))).toEqual([
      ["2026-10-31", "09:00", "10:00"],
    ])
    expect(slots(externalEventsAsCalendarItems([record("2026-11-02T14:00:00Z", "2026-11-02T15:00:00Z")], NY))).toEqual([
      ["2026-11-02", "09:00", "10:00"],
    ])
    // The night clocks fall back: 1:30 AM EDT until 1:30 AM EST is one real hour.
    expect(slots(externalEventsAsCalendarItems([record("2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z")], NY))).toEqual([
      ["2026-11-01", "01:30", "02:30"],
    ])
    // The night clocks spring forward (March 8, 2026): 1:30 AM EST until 3:30 AM EDT (2:xx doesn't exist).
    expect(slots(externalEventsAsCalendarItems([record("2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z")], NY))).toEqual([
      ["2026-03-08", "01:30", "03:30"],
    ])
  })

  it("splits an event crossing midnight across both days; one ending at midnight stays on its day", () => {
    const late = externalEventsAsCalendarItems([record("2026-09-30T02:00:00Z", "2026-09-30T05:00:00Z")], NY) // 10 PM - 1 AM
    expect(slots(late)).toEqual([
      ["2026-09-29", "22:00", "24:00"],
      ["2026-09-30", "00:00", "01:00"],
    ])
    expect(new Set(late.map((item) => item.id)).size).toBe(2)
    expect(slots(externalEventsAsCalendarItems([record("2026-09-30T02:00:00Z", "2026-09-30T04:00:00Z")], NY))).toEqual([
      ["2026-09-29", "22:00", "24:00"],
    ])
  })

  it("hidden events aren't on the calendar", () => {
    expect(externalEventsAsCalendarItems([record("2026-09-29T18:00:00Z", "2026-09-29T20:00:00Z", { hidden: true })], NY)).toEqual([])
  })

  it("Canvas, Blackboard and Student OS events sit side by side, even with the same title and time", () => {
    const external = externalEventsAsCalendarItems(
      [
        record("2026-09-29T18:00:00Z", "2026-09-29T20:00:00Z", { id: "canvas-1" }),
        record("2026-09-29T18:00:00Z", "2026-09-29T20:00:00Z", { id: "bb-1", source: "blackboard" }),
      ],
      NY
    )
    const own: CalendarEvent = { id: "own-1", title: "CSC215 Exam", date: "2026-09-29", startTime: "14:00", endTime: "16:00", type: "class" }
    const day = scheduleBetween([own, ...external], [], "2026-09-29", "2026-09-29")
    expect(day.map((item) => item.source ?? "student_os").sort()).toEqual(["blackboard", "canvas", "student_os"])
  })
})

describe("the Planner and external events", () => {
  const TUESDAY = "2026-09-29"
  const task: Task = {
    id: "task-1",
    courseId: "course-1",
    title: "Essay",
    description: "",
    type: "assignment",
    dueDate: "2026-10-02",
    priority: "high",
    estimateMinutes: 240,
    status: "not_started",
  }
  const external = (id: string, source: "canvas" | "blackboard", startsAt: string, endsAt: string, hidden = false): ExternalEventRecord => ({
    id,
    source,
    title: id,
    description: null,
    startsAt,
    endsAt,
    location: null,
    url: null,
    hidden,
  })
  const data = (externalEvents: ExternalEventRecord[]) => ({
    tasks: [task],
    courses: [],
    events: [{ id: "soccer", title: "Soccer Practice", date: TUESDAY, startTime: "10:30", endTime: "13:00", type: "sports" as const }],
    studySessions: [],
    recurringCommitments: [],
    preferences: DEFAULT_STUDENT_PREFERENCES,
    externalEvents,
    timeZone: NY,
  })
  const busy = (items: { startTime: string; endTime: string }[]) =>
    items.map((item) => [toMinutes(item.startTime), toMinutes(item.endTime)] as const)
  const overlaps = (a: readonly [number, number], b: readonly [number, number]) => a[0] < b[1] && b[0] < a[1]

  it("treats Canvas and Blackboard events as busy time, like the student's own", () => {
    const events = [
      external("CSC215", "canvas", "2026-09-29T18:00:00Z", "2026-09-29T19:15:00Z"), // 2:00-3:15 PM
      external("SER225", "blackboard", "2026-09-29T20:00:00Z", "2026-09-29T21:15:00Z"), // 4:00-5:15 PM
    ]
    const plan = createPlanner(plannerInputFor(data(events), new Date(2026, 8, 29, 8, 0))).planFor(TUESDAY)
    const blocked = busy([
      { startTime: "10:30", endTime: "13:00" },
      { startTime: "14:00", endTime: "15:15" },
      { startTime: "16:00", endTime: "17:15" },
    ])
    expect(plan.suggestions.length).toBeGreaterThan(0)
    for (const suggestion of busy(plan.suggestions)) for (const range of blocked) expect(overlaps(suggestion, range)).toBe(false)
  })

  it("a hidden external event no longer blocks study time", () => {
    const visible = createPlanner(
      plannerInputFor(data([external("Exam", "canvas", "2026-09-29T12:00:00Z", "2026-09-29T23:00:00Z")]), new Date(2026, 8, 29, 8, 0))
    ).planFor(TUESDAY)
    const hidden = createPlanner(
      plannerInputFor(data([external("Exam", "canvas", "2026-09-29T12:00:00Z", "2026-09-29T23:00:00Z", true)]), new Date(2026, 8, 29, 8, 0))
    ).planFor(TUESDAY)
    // The event covers 8 AM - 7 PM New York time.
    const inEvent = (plan: typeof visible) => busy(plan.suggestions).some((range) => overlaps(range, [8 * 60, 19 * 60]))
    expect(visible.suggestions.length).toBeGreaterThan(0)
    expect(inEvent(visible)).toBe(false)
    expect(inEvent(hidden)).toBe(true)
  })
})
