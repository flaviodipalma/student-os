// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LmsIntegrationStatus } from "@/server/integrations/lms/connections"

// Canvas and Blackboard on the Integrations page, rendered in a simulated browser.
// They connect only through the browser extension, so the page shows the status,
// how to connect, and Disconnect. Server actions and navigation are mocked.

const mocks = vi.hoisted(() => ({ disconnectLmsAction: vi.fn(), refresh: vi.fn() }))
vi.mock("@/app/actions/integrations", () => ({ disconnectLmsAction: mocks.disconnectLmsAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }))
vi.mock("@/lib/app-store", () => ({ useAppStore: () => ({}) }))

const { IntegrationsCard, formatSyncedAgo } = await import("./integrations-card")

type Connection = NonNullable<LmsIntegrationStatus["connection"]>
const connection = (provider: "canvas" | "blackboard", overrides: Partial<Connection> = {}): Connection => ({
  provider,
  status: "connected",
  connectedAt: "2026-09-23T10:00:00.000Z",
  lastSyncedAt: new Date().toISOString(),
  lastSyncError: null,
  ...overrides,
})
const lms = (canvas: Connection | null = null, blackboard: Connection | null = null): LmsIntegrationStatus[] => [
  { provider: "canvas", name: "Canvas", connection: canvas },
  { provider: "blackboard", name: "Blackboard", connection: blackboard },
]
const row = (name: string) => screen.getByText(name, { selector: "p.font-medium" }).closest("li") as HTMLElement

beforeEach(() => {
  mocks.disconnectLmsAction.mockReset()
  mocks.refresh.mockReset()
})
afterEach(cleanup)

describe("Canvas and Blackboard: through the browser extension only", () => {
  it("not connected: explains the extension; no forms, links to paste or sign-in buttons", () => {
    render(<IntegrationsCard integrations={lms()} timeZone="UTC" />)
    expect(screen.getByText(/Connect with the Student OS browser extension/)).toBeTruthy()
    expect(within(row("Canvas")).getByText(/Not connected · open Canvas, click the Student OS extension/)).toBeTruthy()
    expect(within(row("Blackboard")).getByText(/Not connected · open Blackboard/)).toBeTruthy()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    expect(document.body.textContent).not.toMatch(/calendar feed|calendar link|sign in with/i)
  })

  it("connected: 'Through the browser extension · last synced', and no Sync now here", () => {
    render(<IntegrationsCard integrations={lms(connection("canvas"), connection("blackboard", { lastSyncedAt: null }))} timeZone="UTC" />)
    expect(within(row("Canvas")).getByText("Connected")).toBeTruthy()
    expect(within(row("Canvas")).getByText(/Through the browser extension · last synced/)).toBeTruthy()
    expect(within(row("Blackboard")).getByText(/Through the browser extension · nothing imported yet/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Sync now|Import/ })).toBeNull()
  })

  it("Disconnect asks first, explains how syncing starts again, then disconnects that LMS", async () => {
    const user = userEvent.setup()
    mocks.disconnectLmsAction.mockResolvedValue({ ok: true, data: null })
    render(<IntegrationsCard integrations={lms(null, connection("blackboard"))} timeZone="UTC" />)
    await user.click(within(row("Blackboard")).getByRole("button", { name: "Disconnect" }))
    expect(screen.getByText(/until you click Sync now in the extension again/)).toBeTruthy()
    expect(mocks.disconnectLmsAction).not.toHaveBeenCalled()
    await user.click(screen.getAllByRole("button", { name: "Disconnect" }).at(-1)!)
    expect(mocks.disconnectLmsAction).toHaveBeenCalledWith("blackboard")
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it("needs attention: shows the last sync's message (safe text only)", () => {
    render(<IntegrationsCard integrations={lms(connection("canvas", { status: "error", lastSyncError: "Syncing with Canvas failed. Please try again." }))} timeZone="UTC" />)
    expect(within(row("Canvas")).getByText("Needs attention")).toBeTruthy()
    expect(within(row("Canvas")).getByRole("alert").textContent).toMatch(/Syncing with Canvas failed/)
  })

  it("says so when the connections couldn't be loaded", () => {
    render(<IntegrationsCard integrations={null} timeZone="UTC" />)
    expect(screen.getByText(/couldn't load your integrations/)).toBeTruthy()
  })
})

describe("'last synced' wording", () => {
  const now = new Date("2026-09-23T12:00:00Z")
  const ago = (minutes: number) => formatSyncedAgo(new Date(now.getTime() - minutes * 60_000), now, "the date")
  it("is relative for today, the date after that", () => {
    expect(ago(0)).toBe("just now")
    expect(ago(1)).toBe("1 minute ago")
    expect(ago(45)).toBe("45 minutes ago")
    expect(ago(120)).toBe("2 hours ago")
    expect(ago(60 * 30)).toBe("the date")
  })
})
