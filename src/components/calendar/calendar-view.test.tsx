// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { scheduleBetween } from "@/lib/recurring"
import type { AcademicEvent, CalendarEvent, ExternalEventRecord, Task } from "@/lib/types"

// The Calendar with Student OS, Canvas and Blackboard events, rendered in a
// simulated browser. The app store is stubbed with the same schedule functions
// the real store uses (scheduleBetween + externalEventsAsCalendarItems).

const NY = "America/New_York"
const state = vi.hoisted(() => ({
  externalEvents: [] as ExternalEventRecord[],
  events: [] as CalendarEvent[],
  tasks: [] as Task[],
  academic: [] as AcademicEvent[],
  setExternalEventHidden: vi.fn(),
}))
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }))

vi.mock("@/lib/app-store", () => ({
  useAppStore: () => {
    const items = () => [...state.events, ...externalEventsAsCalendarItems(state.externalEvents, NY)]
    return {
      externalEvents: state.externalEvents,
      academicEvents: state.academic,
      tasks: state.tasks,
      timeZone: NY,
      setExternalEventHidden: state.setExternalEventHidden,
      scheduleBetween: (from: string, to: string) => scheduleBetween(items(), [], from, to),
      addEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      courses: [],
      getCourse: (id: string) => (id === "c1" ? { id: "c1", code: "CSC215", name: "Data Structures", professor: "", description: "", color: "sky" } : undefined),
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

const external = (id: string, source: ExternalEventRecord["source"], title: string, startsAt: string, endsAt: string, extra: Partial<ExternalEventRecord> = {}): ExternalEventRecord => ({
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

  it("Google Calendar and Outlook join the same calendar: labelled, filterable, read-only with their own link", async () => {
    state.externalEvents.push(
      external("g1", "google", "Dentist", "2026-09-29T20:00:00Z", "2026-09-29T21:00:00Z", { url: "https://www.google.com/calendar/event?eid=abc" }),
      external("o1", "outlook", "Team Meeting", "2026-09-29T21:30:00Z", "2026-09-29T22:15:00Z", { url: "https://outlook.office365.com/owa/?itemid=1" })
    )
    render(<CalendarView />)
    expect(block(/^Dentist, 4:00 PM – 5:00 PM, from Google Calendar/)).toBeTruthy()
    expect(block(/^Team Meeting, 5:30 PM – 6:15 PM, from Outlook/)).toBeTruthy()
    const user = userEvent.setup()
    const filters = screen.getByRole("group", { name: "Show events from" })
    expect(within(filters).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All",
      "Student OS",
      "Canvas",
      "Blackboard",
      "Google Calendar",
      "Outlook",
    ])
    await user.click(within(filters).getByRole("button", { name: "Google Calendar" }))
    expect(block(/^Dentist/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Team Meeting/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^CSC215 Exam/ })).toBeNull()

    await user.click(within(filters).getByRole("button", { name: "Outlook" }))
    await user.click(block(/^Team Meeting/))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/can only be changed in Outlook/)).toBeTruthy()
    expect(within(dialog).getByRole("link", { name: /Open in Outlook/ }).getAttribute("href")).toBe("https://outlook.office365.com/owa/?itemid=1")
    expect(within(dialog).queryByRole("textbox")).toBeNull()
  })

  it("without external calendars, no filters are shown", () => {
    state.externalEvents = []
    render(<CalendarView />)
    expect(screen.queryByRole("group", { name: "Show events from" })).toBeNull()
  })
})

describe("going to a date, and what's due", () => {
  const task = (id: string, dueDate: string, status: Task["status"] = "not_started") =>
    ({ id, courseId: "c1", title: `Project ${id}`, description: "", type: "project", dueDate, priority: "medium", estimateMinutes: 60, status }) as Task

  it("'Go to date' opens that day", async () => {
    state.tasks = []
    state.academic = []
    const user = userEvent.setup()
    render(<CalendarView />)
    const picker = screen.getByLabelText("Go to date")
    fireEvent.change(picker, { target: { value: "2026-12-03" } })
    void user
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Thursday, December 3, 2026")
  })

  it("tasks due show in the all-day row, as links to the task (done ones struck through), next to academic dates", () => {
    state.tasks = [task("1", "2026-09-30"), task("2", "2026-09-30", "completed"), task("3", "2026-11-11")]
    state.academic = [{ id: "a1", kind: "no_classes", title: "Fall break", startDate: "2026-09-30", endDate: "2026-09-30" }]
    render(<CalendarView initialDate="2026-09-30" />)
    const row = screen.getByRole("list", { name: /All day, Wednesday/ })
    expect(within(row).getByText("Fall break")).toBeTruthy()
    const due = within(row).getByRole("link", { name: /Due: CSC215 · Project 1/ })
    expect(due.getAttribute("href")).toBe("/tasks?task=1")
    expect(within(row).getByRole("link", { name: /Project 2 \(done\)/ }).className).toMatch(/line-through/)
    // Only that week's tasks.
    expect(screen.queryByText(/Project 3/)).toBeNull()
  })
})
