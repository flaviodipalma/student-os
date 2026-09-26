// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Course, RecurringCommitment } from "@/lib/types"

// Class times on the course page, and the "not on your calendar yet" notice, in a
// simulated browser. The app store is mocked.

const stored = new Map<string, string>()
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
  clear: () => stored.clear(),
})

const DS: Course = { id: "c1", code: "CSC 215", name: "Data Structures", professor: "", description: "", color: "sky" }
const CALC: Course = { id: "c2", code: "MAT 141", name: "Calculus I", professor: "", description: "", color: "rose" }
const LECTURE: RecurringCommitment = {
  id: "r1",
  courseId: "c1",
  title: "CSC 215 · Data Structures",
  type: "class",
  daysOfWeek: [1, 3, 5],
  startTime: "10:00",
  endTime: "10:50",
  location: "Tator Hall 120",
  endDate: "2026-12-20",
}

const state = vi.hoisted(() => ({ courses: [] as Course[], commitments: [] as RecurringCommitment[], setClassTimes: vi.fn() }))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    today: "2026-09-25",
    courses: state.courses,
    recurringCommitments: state.commitments,
    setClassTimes: state.setClassTimes,
  }),
}))

const { ClassTimesCard, ClassTimesNotice } = await import("./class-times")

beforeEach(() => {
  stored.clear()
  state.courses = [DS, CALC]
  state.commitments = []
  state.setClassTimes.mockReset()
  state.setClassTimes.mockResolvedValue({ ok: true, data: [] })
  window.scrollTo = vi.fn()
})
afterEach(cleanup)

describe("class times on the course page", () => {
  it("lists them: days, times, room, until when", () => {
    state.commitments = [LECTURE]
    render(<ClassTimesCard course={DS} />)
    expect(screen.getByText("Mon, Wed, Fri · 10:00 AM – 10:50 AM")).toBeTruthy()
    expect(screen.getByText("Tator Hall 120")).toBeTruthy()
    expect(screen.getByText(/until Dec 20/)).toBeTruthy()
  })

  it("none yet: says what that means; adding two meetings saves both", async () => {
    const user = userEvent.setup()
    render(<ClassTimesCard course={DS} />)
    expect(screen.getByText(/isn't on your calendar, and the Planner may schedule study time during class/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Add class times" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(screen.getByRole("button", { name: "Tue" }))
    await user.click(screen.getByRole("button", { name: "Thu" }))
    fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "13:00" } })
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "14:15" } })
    await user.click(screen.getByRole("button", { name: /Add another time/ }))
    await user.click(screen.getAllByRole("button", { name: "Fri" })[1])
    await user.click(screen.getByRole("button", { name: "Save class times" }))
    expect(dialog).toBeTruthy()
    expect(state.setClassTimes).toHaveBeenCalledWith("c1", [
      { daysOfWeek: [2, 4], startTime: "13:00", endTime: "14:15", startDate: "2026-09-25", endDate: "2026-12-20" },
      { daysOfWeek: [5], startTime: "09:00", endTime: "09:50", startDate: "2026-09-25", endDate: "2026-12-20" },
    ])
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("an end before the start is explained next to the form, not saved", async () => {
    const user = userEvent.setup()
    render(<ClassTimesCard course={DS} />)
    await user.click(screen.getByRole("button", { name: "Add class times" }))
    await user.click(await screen.findByRole("button", { name: "Mon" }))
    fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "08:00" } })
    await user.click(screen.getByRole("button", { name: "Save class times" }))
    expect(screen.getByRole("alert").textContent).toMatch(/End time must be after the start time/)
    expect(state.setClassTimes).not.toHaveBeenCalled()
  })
})

describe("the notice", () => {
  it("counts courses without class times that weren't asked about; opens the one-at-a-time steps", async () => {
    state.commitments = [LECTURE]
    const user = userEvent.setup()
    render(<ClassTimesNotice />)
    expect(screen.getByText("MAT 141 isn't on your calendar yet.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Add class times" }))
    expect(await screen.findByText("Course 1 of 1")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Skip" }))
    await user.click(await screen.findByRole("button", { name: "Skip anyway" }))
    await waitFor(() => expect(screen.queryByText(/isn't on your calendar yet/)).toBeNull())
  })

  it("nothing to ask: no notice", () => {
    stored.set("student-os:class-times-asked", JSON.stringify(["c1", "c2"]))
    const { container } = render(<ClassTimesNotice />)
    expect(container.textContent).toBe("")
  })
})
