// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { scheduleBetween } from "@/lib/recurring"
import type { CalendarEvent, ExternalEventRecord } from "@/lib/types"

// The Calendar with Student OS, Canvas and Blackboard events, rendered in a
// simulated browser. The app store is stubbed with the same schedule functions
// the real store uses (scheduleBetween + externalEventsAsCalendarItems).

const NY = "America/New_York"
const state = vi.hoisted(() => ({
  externalEvents: [] as ExternalEventRecord[],
  events: [] as CalendarEvent[],
  setExternalEventHidden: vi.fn(),
}))

vi.mock("@/lib/app-store", () => ({
  useAppStore: () => {
    const items = () => [...state.events, ...externalEventsAsCalendarItems(state.externalEvents, NY)]
    return {
      externalEvents: state.externalEvents,
      timeZone: NY,
      setExternalEventHidden: state.setExternalEventHidden,
      scheduleBetween: (from: string, to: string) => scheduleBetween(items(), [], from, to),
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      courses: [],
      getCourse: vi.fn(),
      recurringCommitments: [],
      getCommitment: vi.fn(),
      addCommitment: vi.fn(),
      updateCommitment: vi.fn(),
      deleteCommitment: vi.fn(),
      studySessions: [],
      addStudySession: vi.fn(),
      updateStudySession: vi.fn(),
      deleteStudySession: vi.fn(),
    }
  },
}))
// Tuesday, September 29, 2026, 8 AM (the student's time).
vi.mock("@/lib/clock", () => ({ useNow: () => new Date(2026, 8, 29, 8, 0) }))
vi.mock("@/lib/use-media-query", () => ({ useMediaQuery: () => false }))

const { CalendarView } = await import("./calendar-view")

const external = (id: string, source: "canvas" | "blackboard", title: string, startsAt: string, endsAt: string, extra: Partial<ExternalEventRecord> = {}): ExternalEventRecord => ({
  id,
  source,
  title,
  description: null,
  startsAt,
  endsAt,
  location: null,
  url: null,
  hidden: false,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.events = [{ id: "own-1", title: "Soccer Practice", date: "2026-09-29", startTime: "10:30", endTime: "13:00", type: "sports" }]
  state.externalEvents = [
    external("c1", "canvas", "CSC215 Exam", "2026-09-29T18:00:00Z", "2026-09-29T20:00:00Z", {
      url: "https://school.instructure.com/calendar#calendar_event_9",
      location: "Tator Hall 201",
    }),
    external("b1", "blackboard", "Psychology Exam", "2026-09-30T14:00:00Z", "2026-09-30T16:00:00Z"),
    external("b2", "blackboard", "Old meeting", "2026-09-28T14:00:00Z", "2026-09-28T15:00:00Z", { hidden: true }),
  ]
})
afterEach(cleanup)

const block = (name: RegExp) => screen.getByRole("button", { name })

describe("Calendar with external events", () => {
  it("shows every source together in the week view, each labeled", () => {
    render(<CalendarView />)
    expect(block(/^Soccer Practice, .*Sports/)).toBeTruthy()
    expect(block(/^CSC215 Exam, 2:00 PM – 4:00 PM, from Canvas/)).toBeTruthy()
    expect(block(/^Psychology Exam, 10:00 AM – 12:00 PM, from Blackboard/)).toBeTruthy()
    // Hidden events aren't on the grid.
    expect(screen.queryByRole("button", { name: /^Old meeting/ })).toBeNull()
    expect(within(block(/^CSC215 Exam/)).getByText(/· Canvas/)).toBeTruthy()
  })

  it("filters by source (default All)", async () => {
    render(<CalendarView />)
    const user = userEvent.setup()
    const filters = screen.getByRole("group", { name: "Show events from" })
    expect(within(filters).getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true")

    await user.click(within(filters).getByRole("button", { name: "Canvas" }))
    expect(screen.queryByRole("button", { name: /^Soccer Practice/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Psychology Exam/ })).toBeNull()
    expect(block(/^CSC215 Exam/)).toBeTruthy()

    await user.click(within(filters).getByRole("button", { name: "Student OS" }))
    expect(block(/^Soccer Practice/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^CSC215 Exam/ })).toBeNull()

    await user.click(within(filters).getByRole("button", { name: "Blackboard" }))
    expect(block(/^Psychology Exam/)).toBeTruthy()
  })

  it("an external event opens read-only details: source, link, and 'Hide from Student OS' (no editing)", async () => {
    render(<CalendarView />)
    const user = userEvent.setup()
    await user.click(block(/^CSC215 Exam/))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/From Canvas/)).toBeTruthy()
    expect(within(dialog).getByText("Tator Hall 201")).toBeTruthy()
    const link = within(dialog).getByRole("link", { name: /Open in Canvas/ })
    expect(link.getAttribute("href")).toBe("https://school.instructure.com/calendar#calendar_event_9")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
    expect(within(dialog).queryByRole("textbox")).toBeNull()
    expect(within(dialog).queryByRole("button", { name: /Delete|Save/ })).toBeNull()

    await user.click(within(dialog).getByRole("button", { name: "Hide from Student OS" }))
    expect(state.setExternalEventHidden).toHaveBeenCalledWith("c1", true)
  })

  it("never renders an unsafe link", async () => {
    state.externalEvents[0].url = "javascript:alert(1)"
    render(<CalendarView />)
    await userEvent.setup().click(block(/^CSC215 Exam/))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByRole("link")).toBeNull()
  })

  it("lists hidden events and restores one", async () => {
    render(<CalendarView />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "1 hidden" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Old meeting")).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Restore" }))
    expect(state.setExternalEventHidden).toHaveBeenCalledWith("b2", false)
  })

  it("the Day view shows only that day's events, from every source", async () => {
    render(<CalendarView />)
    await userEvent.setup().click(screen.getByRole("button", { name: "day" }))
    expect(block(/^Soccer Practice/)).toBeTruthy()
    expect(block(/^CSC215 Exam/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Psychology Exam/ })).toBeNull() // Wednesday
  })

  it("without external calendars, no filters are shown", () => {
    state.externalEvents = []
    render(<CalendarView />)
    expect(screen.queryByRole("group", { name: "Show events from" })).toBeNull()
  })
})
