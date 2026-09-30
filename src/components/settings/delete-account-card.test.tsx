// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ remove: vi.fn(), assign: vi.fn() }))
vi.mock("@/app/actions/auth", () => ({ deleteAccountAction: mocks.remove }))

const { DeleteAccountCard } = await import("./delete-account-card")
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function openDialog() {
  const user = userEvent.setup()
  render(<DeleteAccountCard />)
  await user.click(screen.getByRole("button", { name: "Delete account…" }))
  return user
}

describe("DeleteAccountCard", () => {
  it("asks for DELETE before the delete button works", async () => {
    const user = await openDialog()
    expect(screen.getByRole("alertdialog", { name: "Delete your account?" })).toBeTruthy()
    const confirm = screen.getByRole("button", { name: "Delete my account" }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "delet")
    expect(confirm.disabled).toBe(true)
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "e")
    expect(confirm.disabled).toBe(false)
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it("deletes, forgets this browser's saved keys and goes to the log-in page", async () => {
    vi.stubGlobal("location", { assign: mocks.assign })
    const stored: Record<string, string> = { "quadernio:class-times-asked": "[]", "other-site": "keep" }
    Object.defineProperty(stored, "removeItem", { value: (key: string) => delete stored[key] })
    vi.stubGlobal("localStorage", stored)
    mocks.remove.mockResolvedValue({ ok: true, data: null })
    const user = await openDialog()
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE")
    await user.click(screen.getByRole("button", { name: "Delete my account" }))
    expect(mocks.remove).toHaveBeenCalledWith("DELETE")
    expect(mocks.assign).toHaveBeenCalledWith("/login?deleted=1")
    expect(Object.keys(stored)).toEqual(["other-site"])
  })

  it("shows the server's message and stays open when deleting fails", async () => {
    mocks.remove.mockResolvedValue({ ok: false, code: "unavailable", error: "Quadernio can't reach its database right now." })
    const user = await openDialog()
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE")
    await user.click(screen.getByRole("button", { name: "Delete my account" }))
    expect((await screen.findByRole("alert")).textContent).toContain("can't reach its database")
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Delete my account" }) as HTMLButtonElement).disabled).toBe(false)
  })
})
