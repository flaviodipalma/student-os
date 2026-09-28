// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Course, Task } from "@/lib/types"

// Selecting courses on the Courses page and changing them together. The app store is mocked.

const DS: Course = { id: "c1", code: "CSC215", name: "Data Structures", professor: "", description: "", color: "sky" }
const CALC: Course = { id: "c2", code: "MAT141", name: "Calculus I", professor: "", description: "", color: "rose" }
const PSY: Course = { id: "c3", code: "PS283", name: "Forensic Psych", professor: "", description: "", color: "violet", termStart: "2026-08-24", termEnd: "2026-12-18" }
const TASK = { id: "t1", courseId: "c1", title: "Project 1", status: "not_started", dueDate: "2026-10-10" } as Task

const state = vi.hoisted(() => ({ bulk: vi.fn() }))
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    academicEvents: [],
    today: "2026-09-26",
    courses: [DS, CALC, PSY],
    tasks: [TASK],
    calendarItems: [],
    recurringCommitments: [],
    bulkUpdateCourses: state.bulk,
  }),
}))

const { CourseGrid } = await import("./course-grid")

beforeEach(() => {
  state.bulk.mockReset()
  state.bulk.mockResolvedValue(true)
})
afterEach(cleanup)

describe("selecting courses", () => {
  it("cards are links until Select; then they're checkboxes, with Select all", async () => {
    const user = userEvent.setup()
    render(<CourseGrid />)
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(3)
    await user.click(screen.getByRole("button", { name: "Select" }))
    const boxes = screen.getAllByRole("checkbox")
    expect(boxes).toHaveLength(3)
    expect(screen.getByText("Select courses")).toBeTruthy()
    await user.click(boxes[0])
    expect(boxes[0].getAttribute("aria-checked")).toBe("true")
    expect(screen.getByText("1 course selected")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Select all" }))
    expect(screen.getByText("3 courses selected")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Clear selection" }))
    expect(screen.getByText("Select courses")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByRole("toolbar")).toBeNull()
  })

  it("delete several: asks first (saying how many tasks go with them), then deletes them together", async () => {
    const user = userEvent.setup()
    render(<CourseGrid />)
    await user.click(screen.getByRole("button", { name: "Select" }))
    await user.click(screen.getByRole("checkbox", { name: /CSC215/ }))
    await user.click(screen.getByRole("checkbox", { name: /MAT141/ }))
    await user.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/Delete 2 courses\?/)
    expect(dialog.textContent).toMatch(/their 1 task/)
    await user.click(screen.getByRole("button", { name: "Delete 2 courses" }))
    await waitFor(() => expect(state.bulk).toHaveBeenCalledWith(["c1", "c2"], { kind: "delete" }))
  })

  it("semester dates for all: starts from what a course has, saves them together", async () => {
    const user = userEvent.setup()
    render(<CourseGrid />)
    await user.click(screen.getByRole("button", { name: "Select" }))
    await user.click(screen.getByRole("checkbox", { name: /PS283/ }))
    await user.click(screen.getByRole("checkbox", { name: /CSC215/ }))
    await user.click(screen.getByRole("button", { name: "Edit" }))
    await user.click(await screen.findByRole("menuitem", { name: "Semester dates" }))
    // The first selected (in list order): CSC215 has no dates, so a guess.
    expect(screen.getByLabelText("First day of classes")).toHaveProperty("value", "2026-08-25")
    await user.click(screen.getByRole("button", { name: "Save dates" }))
    await waitFor(() => expect(state.bulk).toHaveBeenCalledWith(["c1", "c3"], { kind: "dates", from: "2026-08-25", until: "2026-12-20" }))
  })

  it("online, in person and color apply to all the selected courses", async () => {
    const user = userEvent.setup()
    render(<CourseGrid />)
    await user.click(screen.getByRole("button", { name: "Select" }))
    await user.click(screen.getByRole("button", { name: "Select all" }))
    await user.click(screen.getByRole("button", { name: "Edit" }))
    await user.click(await screen.findByRole("menuitem", { name: "Mark as online" }))
    expect(state.bulk).toHaveBeenCalledWith(["c1", "c2", "c3"], { kind: "online", online: true })
    await user.click(screen.getByRole("button", { name: "Edit" }))
    await user.click(await screen.findByRole("menuitem", { name: "Color" }))
    await user.click(await screen.findByRole("button", { name: "Orange" }))
    expect(state.bulk).toHaveBeenCalledWith(["c1", "c2", "c3"], { kind: "color", color: "orange" })
  })
})
