// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ASSISTANT_ERROR_MESSAGE, type PendingAction } from "@/lib/assistant"

// The Assistant page in a simulated browser. The server actions are mocked:
// what the Assistant answers is tested in src/server/assistant.

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  confirm: vi.fn(),
  applySaved: vi.fn(),
  push: vi.fn(),
}))
vi.mock("@/app/actions/assistant", () => ({ askAssistantAction: mocks.ask, confirmAssistantAction: mocks.confirm }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    today: "2026-09-22",
    tasks: [{ id: "11111111-1111-4111-8111-111111111111", title: "Database Project" }],
    applySaved: mocks.applySaved,
  }),
}))

const { AssistantView } = await import("./assistant-view")

const move: PendingAction = {
  action: { kind: "schedule-session", taskId: "11111111-1111-4111-8111-111111111111", date: "2026-09-23", startTime: "17:00", endTime: "17:45" },
  summary: "Schedule a “Database Project” study session tomorrow, 5:00 PM–5:45 PM.",
  confirmLabel: "Schedule session",
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe("Assistant page", () => {
  it("empty: suggested prompts that really ask the Assistant", async () => {
    mocks.ask.mockResolvedValue({ ok: true, data: { message: "You have 3 assignments due this week." } })
    render(<AssistantView initialContext={{}} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "What do I have due this week?" }))
    expect(mocks.ask).toHaveBeenCalledWith({ messages: [{ role: "user", content: "What do I have due this week?" }], context: {}, focusTaskId: undefined })
    expect(await screen.findByText("You have 3 assignments due this week.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "What do I have due this week?" })).toBeNull()
  })

  it("a proposed change waits for Confirm, then updates the app", async () => {
    mocks.ask.mockResolvedValue({ ok: true, data: { message: "Tomorrow at 5 PM is free. Move it there?", pending: move, focusTaskId: move.action.kind === "schedule-session" ? move.action.taskId : undefined } })
    const saved = { message: "Done. Your “Database Project” study session is now scheduled for tomorrow at 5:00 PM.", tasks: [], studySessions: [{ id: "s1" }] }
    mocks.confirm.mockResolvedValue({ ok: true, data: saved })
    render(<AssistantView initialContext={{}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Message Student OS"), "Move the session to tomorrow at 5{Enter}")
    expect(await screen.findByText(move.summary)).toBeTruthy()
    expect(mocks.confirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Schedule session" }))
    expect(mocks.confirm).toHaveBeenCalledWith(move.action)
    expect(await screen.findByText(saved.message)).toBeTruthy()
    expect(mocks.applySaved).toHaveBeenCalledWith(saved)
    expect(screen.getByText("Confirmed")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Schedule session" })).toBeNull()
  })

  it("typing “yes” confirms; “no” cancels without saving", async () => {
    mocks.ask.mockResolvedValue({ ok: true, data: { message: "Move it there?", pending: move } })
    mocks.confirm.mockResolvedValue({ ok: true, data: { message: "Done.", tasks: [], studySessions: [] } })
    render(<AssistantView initialContext={{}} />)
    const user = userEvent.setup()
    const input = screen.getByLabelText("Message Student OS")
    await user.type(input, "Move it{Enter}")
    await screen.findByText(move.summary)
    await user.type(input, "Yes.{Enter}")
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.ask).toHaveBeenCalledTimes(1)

    await user.type(input, "Move it again{Enter}")
    await waitFor(() => expect(screen.getAllByText(move.summary)).toHaveLength(2))
    await user.type(input, "no{Enter}")
    expect(await screen.findByText("Okay, I didn't change anything.")).toBeTruthy()
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it("a change that can't be saved any more says why", async () => {
    mocks.ask.mockResolvedValue({ ok: true, data: { message: "Move it there?", pending: move } })
    mocks.confirm.mockResolvedValue({ ok: false, code: "validation", error: "That time isn't free: it overlaps with Club meeting (7:30 PM–9:00 PM)." })
    render(<AssistantView initialContext={{}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Message Student OS"), "Move it{Enter}")
    await user.click(await screen.findByRole("button", { name: "Schedule session" }))
    expect(await screen.findByText("I couldn't save that: That time isn't free: it overlaps with Club meeting (7:30 PM–9:00 PM).")).toBeTruthy()
    expect(mocks.applySaved).not.toHaveBeenCalled()
  })

  it("errors: the friendly message and Try again (never internals)", async () => {
    mocks.ask.mockResolvedValueOnce({ ok: false, code: "unavailable", error: "raw provider error" })
    mocks.ask.mockResolvedValueOnce({ ok: true, data: { message: "Back again." } })
    render(<AssistantView initialContext={{}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Message Student OS"), "hi{Enter}")
    expect((await screen.findByRole("alert")).textContent).toContain(ASSISTANT_ERROR_MESSAGE)
    expect(screen.queryByText(/raw provider error/)).toBeNull()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Back again.")).toBeTruthy()
    expect(mocks.ask).toHaveBeenLastCalledWith(expect.objectContaining({ messages: [{ role: "user", content: "hi" }] }))
  })

  it("opened from a task: shows it, sends its id (only), and follow-ups keep the focus", async () => {
    mocks.ask.mockResolvedValue({ ok: true, data: { message: "About 45 minutes.", focusTaskId: "11111111-1111-4111-8111-111111111111" } })
    render(<AssistantView initialContext={{ taskId: "11111111-1111-4111-8111-111111111111" }} />)
    expect(screen.getByText("About: Database Project")).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "How much work is left on Database Project?" }))
    expect(mocks.ask).toHaveBeenCalledWith(
      expect.objectContaining({ context: { taskId: "11111111-1111-4111-8111-111111111111" }, focusTaskId: "11111111-1111-4111-8111-111111111111" })
    )
  })

  it("new conversation clears it (and it's kept across visits until then)", async () => {
    mocks.ask.mockResolvedValue({ ok: true, data: { message: "Nothing due." } })
    const first = render(<AssistantView initialContext={{}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Message Student OS"), "What's due?{Enter}")
    await screen.findByText("Nothing due.")
    first.unmount()

    render(<AssistantView initialContext={{}} />)
    expect(screen.getByText("Nothing due.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "New conversation" }))
    expect(screen.queryByText("Nothing due.")).toBeNull()
    expect(screen.getByText("Try asking")).toBeTruthy()
  })
})
