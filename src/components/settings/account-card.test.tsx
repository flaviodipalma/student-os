// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Sign-in buttons and Settings > Account, in a simulated browser. The auth
// actions are mocked (tested in src/app/actions/auth.test.ts).

vi.mock("@/app/actions/auth", () => ({
  continueWithProviderAction: vi.fn(),
  linkLoginMethodAction: vi.fn(),
  unlinkLoginMethodAction: vi.fn(),
  logOutAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/app-store", () => ({ useAppStore: () => ({ student: { firstName: "Alex", lastName: "Kim" } }) }))

const { SocialButtons } = await import("@/components/auth/social-buttons")
const { AccountCard } = await import("./account-card")

afterEach(cleanup)

describe("Continue with …", () => {
  it("one clearly labelled button per provider, in order", () => {
    render(<SocialButtons providers={["google", "microsoft", "apple"]} />)
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Continue with Google",
      "Continue with Microsoft",
      "Continue with Apple",
    ])
  })
})

describe("Settings > Account", () => {
  const account = {
    email: "abc123@privaterelay.appleid.com",
    createdAt: "2026-09-01T12:00:00Z",
    loginMethods: [{ identityId: "i-apple", method: "apple" as const, email: "abc123@privaterelay.appleid.com", addedAt: null }],
  }

  it("profile, login methods, and what can be added", () => {
    render(<AccountCard account={account} available={["google", "apple"]} />)
    expect(screen.getByText("Alex Kim")).toBeTruthy()
    expect(screen.getByText("September 1, 2026")).toBeTruthy()
    expect(screen.getByText("Apple private relay address (forwards to you)")).toBeTruthy()
    const rows = screen.getAllByRole("listitem")
    expect(within(rows[0]).getByText("Google")).toBeTruthy()
    expect(within(rows[0]).getByRole("button", { name: "Connect Google" })).toBeTruthy()
    expect(within(rows[1]).getByText("Not available yet")).toBeTruthy()
    expect(within(rows[1]).queryByRole("button")).toBeNull()
    expect(within(rows[2]).getByText("Connected")).toBeTruthy()
    // The only login method can't be removed.
    expect(screen.queryByRole("button", { name: "Remove Apple" })).toBeNull()
  })

  it("with two methods either can be removed; the outcome of linking is shown", () => {
    render(
      <AccountCard
        account={{ ...account, loginMethods: [...account.loginMethods, { identityId: "i-google", method: "google", email: "alex@gmail.com", addedAt: null }] }}
        available={["google", "apple"]}
        outcome={{ code: "linked", provider: "google" }}
      />
    )
    expect(screen.getByRole("status").textContent).toBe("Google is now a way to log in to your account.")
    expect(screen.getByRole("button", { name: "Remove Apple" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Remove Google" })).toBeTruthy()
  })

  it("errors from linking are plain messages; unknown codes show nothing", () => {
    const { unmount } = render(<AccountCard account={account} available={[]} outcome={{ code: "already-used" }} />)
    expect(screen.getByRole("alert").textContent).toBe("That account is already connected to a different Student OS account.")
    unmount()
    render(<AccountCard account={account} available={[]} outcome={{ code: "<script>" }} />)
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
