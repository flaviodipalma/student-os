// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CalendarIntegrationStatus } from "@/server/integrations/calendar/connections"

// Integrations > Calendars in a simulated browser. Server actions are
// mocked (tested in src/app/actions/calendar-integrations.test.ts).

const mocks = vi.hoisted(() => ({ sync: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), replaceExternalEvents: vi.fn(), refresh: vi.fn() }))
vi.mock("@/app/actions/calendar-integrations", () => ({
  syncCalendarAction: mocks.sync,
  disconnectCalendarAction: mocks.disconnect,
  connectCalendarAction: mocks.connect,
}))
vi.mock("@/app/actions/integrations", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock("@/lib/app-store", () => ({ useAppStore: () => ({ replaceExternalEvents: mocks.replaceExternalEvents }) }))

const { CalendarConnections } = await import("./calendar-connections")

const google = (connection: CalendarIntegrationStatus["connection"], configured = true): CalendarIntegrationStatus => ({
  provider: "google",
  name: "Google Calendar",
  configured,
  connection,
})
const outlook: CalendarIntegrationStatus = { provider: "outlook", name: "Outlook", configured: true, connection: null }
const connected = { status: "connected" as const, accountEmail: "alex@gmail.com", connectedAt: "2026-09-22T10:00:00Z", lastSyncedAt: "2026-09-22T10:00:00Z", lastSyncError: null }

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("Calendars on the Integrations page", () => {
  it("not connected: Connect for each; not set up on the server: said plainly, no button", () => {
    render(<CalendarConnections calendars={[google(null, false), outlook]} outcomes={{}} timeZone="America/New_York" />)
    const [g, o] = screen.getAllByRole("listitem")
    expect(within(g).getByText("Google Calendar isn't set up on this server yet.")).toBeTruthy()
    expect(within(g).queryByRole("button")).toBeNull()
    expect(within(o).getByRole("button", { name: "Connect Outlook" })).toBeTruthy()
  })

  it("connected: account, Sync now with a summary, Disconnect with a confirmation", async () => {
    mocks.sync.mockResolvedValue({ ok: true, data: { result: { added: 12, updated: 3, removed: 1, skipped: 0, failed: 0 }, externalEvents: [{ id: "e" }], status: [] } })
    mocks.disconnect.mockResolvedValue({ ok: true, data: { externalEvents: [] } })
    render(<CalendarConnections calendars={[google(connected), outlook]} outcomes={{ google: "connected" }} timeZone="America/New_York" />)
    expect(screen.getByText("Google Calendar connected. Its events are now in your Student OS calendar.")).toBeTruthy()
    const g = screen.getAllByRole("listitem")[0]
    expect(within(g).getByText("Connected")).toBeTruthy()
    expect(within(g).getByText(/alex@gmail\.com/)).toBeTruthy()

    const user = userEvent.setup()
    await user.click(within(g).getByRole("button", { name: "Sync now" }))
    expect(mocks.sync).toHaveBeenCalledWith("google")
    const summary = await screen.findByText("Google Calendar synced.")
    expect(summary.parentElement?.textContent).toMatch(/12 events added.*3 events updated.*1 event removed/)
    expect(mocks.replaceExternalEvents).toHaveBeenCalledWith([{ id: "e" }])

    await user.click(within(g).getByRole("button", { name: "Disconnect" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Canvas and Blackboard, tasks, courses and study sessions stay/)).toBeTruthy()
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }))
    expect(mocks.disconnect).toHaveBeenCalledWith("google")
  })

  it("needs attention: the safe reason and Reconnect; a failed sync shows its message", async () => {
    mocks.sync.mockResolvedValue({ ok: false, code: "validation", error: "Outlook is receiving too many requests right now. Please try again in a few minutes." })
    const expired = { ...connected, status: "needs_reauth" as const, lastSyncError: "Your Outlook connection expired or was removed. Please connect Outlook again." }
    render(<CalendarConnections calendars={[google(connected), { ...outlook, connection: expired }]} outcomes={{ outlook: "denied" }} timeZone={undefined} />)
    expect(screen.getByText("Outlook access was canceled. Nothing was connected.")).toBeTruthy()
    const o = screen.getAllByRole("listitem")[1]
    expect(within(o).getByText("Needs attention")).toBeTruthy()
    expect(within(o).getByText(/connection expired or was removed/)).toBeTruthy()
    expect(within(o).getByRole("button", { name: "Reconnect Outlook" })).toBeTruthy()
    await userEvent.setup().click(within(o).getByRole("button", { name: "Sync now" }))
    expect(await within(o).findByText(/too many requests/)).toBeTruthy()
  })
})
