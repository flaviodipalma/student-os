// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StudySession, WhatNow } from "@/lib/planner"
import type { Task } from "@/lib/types"

// "What should I do now?" and the study session dialogs, in a simulated browser.
// The planner's answer is mocked: how it's worked out is tested in src/lib/planner.

const mocks = vi.hoisted(() => ({
  answer: null as unknown as WhatNow,
  accept: vi.fn(),
  complete: vi.fn(),
  reschedule: vi.fn(),
}))
vi.mock("@/lib/planner-store", () => ({
  useWhatNow: () => mocks.answer,
  usePlanActions: () => ({ accept: mocks.accept, complete: mocks.complete, reschedule: mocks.reschedule }),
}))
vi.mock("@/lib/task-store", () => ({ useTasks: () => ({ today: "2026-09-22", tasks: [] }) }))
vi.mock("@/lib/course-store", () => ({ useCourses: () => ({ getCourse: () => ({ code: "CSC215" }) }) }))

const { WhatNowCard } = await import("./what-now-card")
const { PartlyDoneDialog, RescheduleDialog } = await import("./session-dialogs")

const task: Task = {
  id: "t1",
  courseId: "c1",
  title: "Database Project",
  description: "",
  type: "project",
  dueDate: "2026-09-25",
  priority: "high",
  estimateMinutes: 180,
  status: "in_progress",
}
const suggestion: StudySession = { id: "t1@2026-09-22T16:00", taskId: "t1", date: "2026-09-22", startTime: "16:00", endTime: "17:00", status: "suggested" }
const onOpenTask = vi.fn()

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("What should I do now?", () => {
  it("free now: the task, the free time, task details, 'Why this?' and actions", async () => {
    mocks.answer = {
      kind: "work",
      task,
      session: suggestion,
      availableMinutes: 45,
      details: { remainingMinutes: 45, estimateMissing: false },
      reasons: ["Due in 3 days", "High priority", "You have 45m free right now"],
    }
    render(<WhatNowCard onOpenTask={onOpenTask} />)
    expect(screen.getByText("Work on Database Project")).toBeTruthy()
    expect(screen.getByText(/You have 45m available right now/)).toBeTruthy()
    expect(screen.getByText("CSC215 · Due Friday · High priority · ~45m remaining")).toBeTruthy()

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Why this?" }))
    expect(screen.getByText("You have 45m free right now")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: /Start now/ }))
    expect(mocks.accept).toHaveBeenCalledWith(suggestion)
    await user.click(screen.getByRole("button", { name: /Open task/ }))
    expect(onOpenTask).toHaveBeenCalledWith(task)
  })

  it("busy (a Canvas event): no study; when it ends and what's next", () => {
    mocks.answer = {
      kind: "busy",
      event: { id: "e", title: "CSC215", date: "2026-09-22", startTime: "14:00", endTime: "15:15", type: "other", source: "canvas" },
      until: "15:15",
      next: { date: "2026-09-22", startTime: "16:00", endTime: "17:00", task, session: suggestion },
    }
    render(<WhatNowCard onOpenTask={onOpenTask} />)
    expect(screen.getByText("You're busy right now: CSC215 (Canvas) ends at 3:15 PM.")).toBeTruthy()
    expect(screen.getByText("Next recommended: Database Project at 4:00 PM (1h).")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Start now/ })).toBeNull()
  })

  it("no time now: the next opportunity (tomorrow)", () => {
    mocks.answer = {
      kind: "no-time",
      reason: "limit-reached",
      next: { date: "2026-09-23", startTime: "18:00", endTime: "19:00", task, session: { ...suggestion, date: "2026-09-23" } },
    }
    render(<WhatNowCard onOpenTask={onOpenTask} />)
    expect(screen.getByText("You've reached today's study limit.")).toBeTruthy()
    expect(screen.getByText("Next opportunity: Database Project tomorrow at 6:00 PM (1h).")).toBeTruthy()
  })

  it("all caught up", () => {
    mocks.answer = { kind: "done", reason: "all-done", next: null }
    render(<WhatNowCard onOpenTask={onOpenTask} />)
    expect(screen.getByText("You're all caught up.")).toBeTruthy()
  })
})

describe("study session dialogs", () => {
  const scheduled: StudySession = { ...suggestion, id: "s1", eventId: "s1", status: "scheduled", startTime: "16:00", endTime: "17:30" }

  it("Partly done: saves the minutes worked (the rest is planned again)", async () => {
    render(<PartlyDoneDialog session={scheduled} taskTitle="Database Project" open onOpenChange={() => {}} />)
    const user = userEvent.setup()
    const input = screen.getByLabelText("Minutes worked")
    await user.clear(input)
    await user.type(input, "45")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(mocks.complete).toHaveBeenCalledWith(scheduled, 45)
  })

  it("Partly done: refuses more than the session's length", async () => {
    render(<PartlyDoneDialog session={scheduled} taskTitle="Database Project" open onOpenChange={() => {}} />)
    const user = userEvent.setup()
    const input = screen.getByLabelText("Minutes worked")
    await user.clear(input)
    await user.type(input, "200")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(screen.getByText("Enter the minutes you worked, from 1 to 90.")).toBeTruthy()
  })

  it("Reschedule: moves the session; the end must be after the start", async () => {
    render(<RescheduleDialog session={scheduled} taskTitle="Database Project" minDate="2026-09-22" open onOpenChange={() => {}} />)
    const user = userEvent.setup()
    const end = screen.getByLabelText("End")
    await user.clear(end)
    await user.type(end, "15:00")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(screen.getByRole("alert").textContent).toBe("The session must end after it starts.")
    await user.clear(end)
    await user.type(end, "17:15")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(mocks.reschedule).toHaveBeenCalledWith(scheduled, { date: "2026-09-22", startTime: "16:00", endTime: "17:15" })
  })
})
