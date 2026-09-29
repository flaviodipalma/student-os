// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AcademicEvent, AcademicEventInput } from "@/lib/types"

// Finding the academic calendar and reviewing it, in a simulated browser. The app
// store and the server (fetch) are mocked.

const EVENTS: AcademicEventInput[] = [
  { kind: "term", title: "Fall 2026", startDate: "2026-08-24", endDate: "2026-12-18", term: "Fall 2026" },
  { kind: "no_classes", title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07", term: "Fall 2026" },
  { kind: "other", title: "Pajama day", startDate: "2026-10-01", endDate: "2026-10-01", term: "Fall 2026" },
]
const state = vi.hoisted(() => ({ existing: [] as AcademicEvent[], replace: vi.fn() }))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    today: "2026-09-28",
    student: { firstName: "Alex", lastName: "", schoolName: "Quinnipiac University", schoolDomain: "qu.edu", onboardingCompleted: true },
    academicEvents: state.existing,
    replaceAcademicCalendar: state.replace,
  }),
}))

const { AcademicCalendarFinder } = await import("./academic-calendar-finder")

const fetchMock = vi.fn()
beforeEach(() => {
  state.existing = []
  state.replace.mockReset()
  state.replace.mockResolvedValue({ ok: true, data: [] })
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(cleanup)

const answer = (body: unknown) => fetchMock.mockResolvedValueOnce({ json: async () => body })

describe("finding the academic calendar", () => {
  it("found on the school's website: review it, remove what doesn't apply, save", async () => {
    answer({ ok: true, proposal: { status: "found", events: EVENTS, sources: ["https://www.qu.edu/academics/academic-calendar/fall-2026/"] } })
    const user = userEvent.setup()
    render(<AcademicCalendarFinder />)
    await user.click(screen.getByRole("button", { name: "Find it on qu.edu" }))
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect(form.get("mode")).toBe("school")
    expect(form.get("today")).toBe("2026-09-28")

    const review = await screen.findByRole("region", { name: "Review the calendar" })
    expect(review.textContent).toMatch(/Found on qu\.edu/)
    expect(screen.getByRole("link", { name: /www\.qu\.edu\/academics\/academic-calendar\/fall-2026/ })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Remove Pajama day" }))
    await user.click(screen.getByRole("button", { name: "Save this calendar" }))
    expect(state.replace).toHaveBeenCalledWith(EVENTS.slice(0, 2))
    await waitFor(() => expect(screen.queryByRole("region", { name: "Review the calendar" })).toBeNull())
  })

  it("replacing a calendar says so before saving", async () => {
    state.existing = [{ id: "e1", kind: "no_classes", title: "Old", startDate: "2026-09-01", endDate: "2026-09-01" }]
    answer({ ok: true, proposal: { status: "found", events: EVENTS, sources: [] } })
    const user = userEvent.setup()
    render(<AcademicCalendarFinder />)
    await user.click(screen.getByRole("button", { name: "Update from qu.edu" }))
    expect(await screen.findByText(/Saving replaces the 1 date in your academic calendar now/)).toBeTruthy()
  })

  it("not found: offers a link or a PDF; a link is read", async () => {
    answer({ ok: true, proposal: { status: "not_found" } })
    answer({ ok: true, proposal: { status: "found", events: EVENTS, sources: ["https://calendars.qu.edu/fall.pdf"] } })
    const user = userEvent.setup()
    render(<AcademicCalendarFinder />)
    await user.click(screen.getByRole("button", { name: "Find it on qu.edu" }))
    expect(await screen.findByText(/couldn't find the academic calendar on qu\.edu/)).toBeTruthy()
    await user.type(screen.getByLabelText("Link to your academic calendar"), "https://calendars.qu.edu/fall.pdf")
    await user.click(screen.getByRole("button", { name: "Read link" }))
    const form = fetchMock.mock.calls[1][1].body as FormData
    expect([form.get("mode"), form.get("url")]).toEqual(["link", "https://calendars.qu.edu/fall.pdf"])
    expect(await screen.findByText(/Found at that link/)).toBeTruthy()
  })

  it("a problem is explained", async () => {
    answer({ ok: false, message: "Quadernio is busy right now. Try again in a minute." })
    const user = userEvent.setup()
    render(<AcademicCalendarFinder />)
    await user.click(screen.getByRole("button", { name: "Find it on qu.edu" }))
    expect((await screen.findByRole("alert")).textContent).toBe("Quadernio is busy right now. Try again in a minute.")
  })
})
