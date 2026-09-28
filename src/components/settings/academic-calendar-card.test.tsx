// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AcademicEvent } from "@/lib/types"

// Settings > Academic calendar in a simulated browser. The app store is mocked.

const FALL: AcademicEvent = { id: "t1", kind: "term", title: "Fall 2026", startDate: "2026-08-24", endDate: "2026-12-18", term: "Fall 2026" }
const LABOR_DAY: AcademicEvent = { id: "e1", kind: "no_classes", title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07", term: "Fall 2026" }

const state = vi.hoisted(() => ({ events: [] as AcademicEvent[], add: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    academicEvents: state.events,
    student: { firstName: "Alex", lastName: "", schoolName: "Quinnipiac University", schoolDomain: "qu.edu", onboardingCompleted: true },
    addAcademicEvent: state.add,
    updateAcademicEvent: state.update,
    deleteAcademicEvent: state.remove,
  }),
}))

const { AcademicCalendarCard } = await import("./academic-calendar-card")

beforeEach(() => {
  state.events = []
  for (const fn of [state.add, state.update, state.remove]) fn.mockReset()
  state.add.mockResolvedValue({ ok: true, data: LABOR_DAY })
  state.update.mockResolvedValue({ ok: true, data: LABOR_DAY })
})
afterEach(cleanup)

describe("Settings > Academic calendar", () => {
  it("empty: says so, naming the school's website", () => {
    render(<AcademicCalendarCard />)
    expect(screen.getByText(/No academic calendar yet/).textContent).toMatch(/qu\.edu/)
  })

  it("lists dates by semester with what they are, in words", () => {
    state.events = [FALL, LABOR_DAY]
    render(<AcademicCalendarCard />)
    const fall = screen.getByRole("region", { name: "Fall 2026" })
    expect(within(fall).getByText("Semester")).toBeTruthy()
    expect(within(fall).getByText("Aug 24, 2026 – Dec 18, 2026")).toBeTruthy()
    expect(within(fall).getByText("No classes")).toBeTruthy()
    expect(within(fall).getByText("Sep 7")).toBeTruthy()
  })

  it("add a one-day holiday: the last day defaults to the first", async () => {
    state.events = [FALL]
    const user = userEvent.setup()
    render(<AcademicCalendarCard />)
    await user.click(screen.getByRole("button", { name: "Add a date" }))
    await user.type(screen.getByLabelText("Name"), "Labor Day")
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-09-07" } })
    // The semester is suggested from the ones already there.
    expect(screen.getByLabelText(/Semester/)).toHaveProperty("value", "Fall 2026")
    await user.click(screen.getByRole("button", { name: "Add date" }))
    expect(state.add).toHaveBeenCalledWith({ kind: "no_classes", title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07", term: "Fall 2026" })
  })

  it("explains mistakes; edits and removes", async () => {
    state.events = [LABOR_DAY]
    const user = userEvent.setup()
    render(<AcademicCalendarCard />)
    await user.click(screen.getByRole("button", { name: "Edit Labor Day" }))
    fireEvent.change(screen.getByLabelText(/Last day/), { target: { value: "2026-09-01" } })
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(screen.getByRole("alert").textContent).toMatch(/can't be before the first day/)
    expect(state.update).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/Last day/), { target: { value: "2026-09-08" } })
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(state.update).toHaveBeenCalledWith("e1", expect.objectContaining({ endDate: "2026-09-08" }))
    await user.click(screen.getByRole("button", { name: "Remove Labor Day" }))
    expect(state.remove).toHaveBeenCalledWith("e1")
  })
})
