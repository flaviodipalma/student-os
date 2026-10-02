// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AnnouncementFinding, ClassCancellation, Course } from "@/lib/types"

// The Dashboard's "From your announcements" card. The app store is mocked.

const csc = { id: "c1", code: "CSC215", name: "Data Structures", color: "sky" } as Course
const psy = { id: "c2", code: "PS283", name: "Forensic Psychology", color: "rose" } as Course
const state = vi.hoisted(() => ({
  findings: [] as AnnouncementFinding[],
  cancellations: [] as ClassCancellation[],
  acceptFinding: vi.fn(async () => true),
  dismissFinding: vi.fn(),
  undoClassCancellation: vi.fn(),
}))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    today: "2026-10-05",
    courses: [csc, psy],
    getCourse: (id: string) => [csc, psy].find((course) => course.id === id),
    announcementFindings: state.findings,
    classCancellations: state.cancellations,
    acceptFinding: state.acceptFinding,
    dismissFinding: state.dismissFinding,
    undoClassCancellation: state.undoClassCancellation,
  }),
}))

const { AnnouncementFindings } = await import("./announcement-findings")
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const quiz: AnnouncementFinding = { id: "f1", courseId: "c1", kind: "quiz", title: "Quiz 3", date: "2026-10-08", time: "10:00", quote: "Quiz 3 is on Thursday at 10am.", status: "pending" }
const noClass: AnnouncementFinding = { id: "f2", courseId: "c2", kind: "no_class", title: "No class", date: "2026-10-06", status: "pending" }

describe("From your announcements", () => {
  it("each suggestion in words, with the announcement's own sentence; adding or dismissing it", async () => {
    state.findings = [quiz, noClass, { ...quiz, id: "old", date: "2026-10-01" }]
    state.cancellations = []
    render(<AnnouncementFindings />)
    expect(screen.getByText("Found in your courses' recent announcements. Nothing changes until you add it.")).toBeTruthy()
    const rows = screen.getAllByRole("listitem")
    // The past one isn't shown.
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain("QuizCSC215Quiz 3Thu, Oct 8 · 10:00 AM“Quiz 3 is on Thursday at 10am.”")
    expect(rows[1].textContent).toContain("No classPS283No classTue, Oct 6")

    const user = userEvent.setup()
    await user.click(within(rows[0]).getByRole("button", { name: "Add to tasks" }))
    expect(state.acceptFinding).toHaveBeenCalledWith("f1")
    await user.click(within(rows[1]).getByRole("button", { name: "Take off my schedule" }))
    expect(state.acceptFinding).toHaveBeenCalledWith("f2")
    await user.click(within(rows[1]).getByRole("button", { name: "Dismiss" }))
    expect(state.dismissFinding).toHaveBeenCalledWith("f2")
  })

  it("upcoming cancelled classes, each with Undo", async () => {
    state.findings = []
    state.cancellations = [
      { id: "x1", courseId: "c2", date: "2026-10-06", source: "announcement" },
      { id: "x2", courseId: "c1", date: "2026-10-01", source: "calendar" },
    ]
    render(<AnnouncementFindings />)
    expect(screen.getByText("Cancelled classes")).toBeTruthy()
    const [row] = screen.getAllByRole("listitem")
    expect(row.textContent).toContain("PS283 · No class Tue, Oct 6 · from an announcement")
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
    await userEvent.setup().click(within(row).getByRole("button", { name: "Undo" }))
    expect(state.undoClassCancellation).toHaveBeenCalledWith("x1")
  })

  it("nothing to suggest and no cancelled classes: no card", () => {
    state.findings = []
    state.cancellations = []
    const { container } = render(<AnnouncementFindings />)
    expect(container.textContent).toBe("")
  })
})
