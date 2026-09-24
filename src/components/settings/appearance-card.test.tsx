// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Settings > Appearance in a simulated browser: the choice applies at once and is
// saved to the account (the action is mocked).

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock("@/app/actions/settings", () => ({ updateThemeAction: mocks.save }))

const { ThemeProvider } = await import("@/components/theme/theme-provider")
const { AppearanceCard } = await import("./appearance-card")
const { ThemeMenu } = await import("@/components/theme/theme-menu")

beforeEach(() => {
  mocks.save.mockReset()
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  document.cookie = "sos-theme=; max-age=0; path=/"
  document.documentElement.className = ""
})
afterEach(cleanup)

const renderCard = () =>
  render(
    <ThemeProvider>
      <AppearanceCard />
    </ThemeProvider>
  )

describe("Appearance", () => {
  it("three choices as radio buttons; System is the default and explained", () => {
    renderCard()
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy()
    expect(screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["light", "dark", "system"])
    expect((screen.getByRole("radio", { name: "System" }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/System follows your device's appearance setting \(light right now\)/)).toBeTruthy()
  })

  it("Dark applies immediately (no reload) and is saved", async () => {
    mocks.save.mockResolvedValue({ ok: true, data: "dark" })
    renderCard()
    await userEvent.setup().click(screen.getByRole("radio", { name: "Dark" }))
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.cookie).toContain("sos-theme=dark")
    expect(mocks.save).toHaveBeenCalledWith("dark")
    expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText("Student OS always uses the dark theme.")).toBeTruthy()
  })

  it("keyboard: arrow keys move between choices", async () => {
    mocks.save.mockResolvedValue({ ok: true, data: "light" })
    renderCard()
    const user = userEvent.setup()
    await user.click(screen.getByRole("radio", { name: "Light" }))
    await user.keyboard("{ArrowRight}")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("if saving fails, it still applies on this device and says so", async () => {
    mocks.save.mockResolvedValue({ ok: false, code: "database", error: "x" })
    renderCard()
    await userEvent.setup().click(screen.getByRole("radio", { name: "Light" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/applies on this device, but we couldn't save it/)
    expect(document.cookie).toContain("sos-theme=light")
  })
})

describe("theme menu (next to the notifications)", () => {
  it("opens a menu with Light / Dark / System; choosing applies and saves", async () => {
    mocks.save.mockResolvedValue({ ok: true, data: "dark" })
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Theme: System" }))
    const items = await screen.findAllByRole("menuitemradio")
    expect(items.map((item) => item.textContent)).toEqual(["Light", "Dark", "System"])
    expect(items[2].getAttribute("aria-checked")).toBe("true")
    await user.click(items[1])
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(mocks.save).toHaveBeenCalledWith("dark")
    expect(screen.getByRole("button", { name: "Theme: Dark" })).toBeTruthy()
  })
})
