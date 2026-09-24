// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ send: vi.fn(), success: vi.fn() }))
vi.mock("@/app/actions/feedback", () => ({ sendFeedbackAction: mocks.send }))
vi.mock("next/navigation", () => ({ usePathname: () => "/planner", useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/lib/feedback", () => ({ useFeedback: () => ({ showSuccess: mocks.success, showError: vi.fn() }) }))

const { SendFeedback } = await import("./send-feedback")
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Send feedback dialog", () => {
  it("sends the kind, message and current page, then thanks the student", async () => {
    mocks.send.mockResolvedValue({ ok: true, data: null })
    render(<SendFeedback />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Send feedback" }))
    await user.click(screen.getByRole("radio", { name: "An idea" }))
    await user.type(screen.getByLabelText("Message"), "Let me drag study sessions")
    await user.click(screen.getByRole("button", { name: "Send" }))
    expect(mocks.send).toHaveBeenCalledWith({ kind: "idea", message: "Let me drag study sessions", page: "/planner" })
    expect(mocks.success).toHaveBeenCalledWith("Thanks! Your feedback was sent.")
  })

  it("an empty message is explained next to the field, nothing is sent", async () => {
    render(<SendFeedback />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Send feedback" }))
    await user.click(screen.getByRole("button", { name: "Send" }))
    expect(screen.getByRole("alert").textContent).toBe("Write a few words first.")
    expect(screen.getByLabelText("Message").getAttribute("aria-invalid")).toBe("true")
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
