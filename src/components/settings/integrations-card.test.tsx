// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LmsSyncResult } from "@/lib/lms/types"
import type { LmsIntegrationStatus } from "@/server/integrations/lms/connections"

// The Canvas card in Settings > Integrations, rendered in a simulated browser.
// Server actions and navigation are mocked: this checks what the student sees
// and can do, not the sync itself (tested in src/server/integrations).

const mocks = vi.hoisted(() => ({
  syncLmsAction: vi.fn(),
  disconnectLmsAction: vi.fn(),
  refresh: vi.fn(),
  replaceCoursesAndTasks: vi.fn(),
}))
vi.mock("@/app/actions/integrations", () => ({
  syncLmsAction: mocks.syncLmsAction,
  disconnectLmsAction: mocks.disconnectLmsAction,
  connectCanvasAction: vi.fn(async () => ({ error: null })),
  connectCanvasFeedAction: vi.fn(async () => ({ error: null, connected: false })),
  connectBlackboardAction: vi.fn(async () => ({ error: null })),
  connectBlackboardFeedAction: vi.fn(async () => ({ error: null, connected: false })),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }))
vi.mock("@/lib/app-store", () => ({ useAppStore: () => ({ replaceCoursesAndTasks: mocks.replaceCoursesAndTasks }) }))

const { IntegrationsCard, formatSyncedAgo } = await import("./integrations-card")

const canvas = (connection: Partial<NonNullable<LmsIntegrationStatus["connection"]>> | null, configured = false): LmsIntegrationStatus[] => [
  {
    provider: "canvas",
    name: "Canvas",
    available: true,
    configured,
    connection: connection && {
      provider: "canvas",
      method: "oauth",
      status: "connected",
      connectedAt: "2026-09-23T10:00:00.000Z",
      lastSyncedAt: null,
      lastSyncError: null,
      ...connection,
    },
  },
  { provider: "blackboard", name: "Blackboard", available: true, configured: false, connection: null },
]

const withBlackboard = (
  connection: Partial<NonNullable<LmsIntegrationStatus["connection"]>> | null,
  configured = true,
  canvasConnection: Partial<NonNullable<LmsIntegrationStatus["connection"]>> | null = null
): LmsIntegrationStatus[] => [
  canvas(canvasConnection)[0],
  {
    provider: "blackboard",
    name: "Blackboard",
    available: true,
    configured,
    connection: connection && {
      provider: "blackboard",
      method: "oauth",
      status: "connected",
      connectedAt: "2026-09-23T10:00:00.000Z",
      lastSyncedAt: null,
      lastSyncError: null,
      ...connection,
    },
  },
]

const result = (overrides: Partial<LmsSyncResult> = {}): LmsSyncResult => ({
  provider: "canvas",
  coursesCreated: 2,
  coursesUpdated: 0,
  coursesLinked: 0,
  coursesSkipped: 0,
  assignmentsCreated: 8,
  assignmentsUpdated: 3,
  assignmentsLinked: 0,
  assignmentsSkipped: 1,
  assignmentsWithoutDueDate: 1,
  assignmentsCompleted: 0,
  assignmentsMissing: 0,
  missing: [],
  missingCourses: [],
  conflicts: [],
  errors: [],
  syncedAt: new Date().toISOString(),
  ...overrides,
})

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("Canvas in Settings", () => {
  it("shows the connection and when it last synced", async () => {
    render(<IntegrationsCard integrations={canvas({ lastSyncedAt: new Date().toISOString() })} outcomes={{}} timeZone="UTC" />)
    expect(screen.getByText("Connected")).toBeTruthy()
    expect(await screen.findByText("just now")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Disconnect/ })).toBeTruthy()
  })

  it("offers 'Import Canvas data' before the first sync", () => {
    render(<IntegrationsCard integrations={canvas({})} outcomes={{ canvas: "connected" }} timeZone="UTC" />)
    expect(screen.getByText(/Canvas connected\./)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Import Canvas data/ })).toBeTruthy()
  })

  it("syncs once (no double submit), shows progress, then the summary", async () => {
    let finish!: (value: unknown) => void
    mocks.syncLmsAction.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    render(<IntegrationsCard integrations={canvas({ lastSyncedAt: new Date().toISOString() })} outcomes={{}} timeZone="UTC" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: /Sync now/ }))
    const busy = screen.getByRole("button", { name: /Syncing with Canvas/ }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    await user.click(busy)
    expect(mocks.syncLmsAction).toHaveBeenCalledTimes(1)

    finish({ ok: true, data: { result: result(), courses: [], tasks: [] } })
    expect(await screen.findByText("Canvas sync complete.")).toBeTruthy()
    for (const line of ["2 courses added", "8 assignments added as tasks", "3 assignments updated", "1 assignment without a due date in Canvas weren't imported"]) {
      expect(screen.getByText(line)).toBeTruthy()
    }
    expect(mocks.replaceCoursesAndTasks).toHaveBeenCalledWith([], [])
    expect(mocks.refresh).toHaveBeenCalled()
    expect((screen.getByRole("button", { name: /Sync now/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("shows issues and kept changes without technical details", async () => {
    mocks.syncLmsAction.mockResolvedValue({
      ok: true,
      data: {
        result: result({
          assignmentsCompleted: 1,
          errors: ["Biology: Canvas didn't allow Student OS to read this course."],
          conflicts: [{ taskId: "t", title: "Essay", field: "dueDate", studentValue: "2026-09-27", lmsValue: "2026-09-26" }],
          missingCourses: [{ courseId: "c", name: "Algebra" }],
        }),
        courses: [],
        tasks: [],
      },
    })
    render(<IntegrationsCard integrations={canvas({ lastSyncedAt: new Date().toISOString() })} outcomes={{}} timeZone="UTC" />)
    await userEvent.setup().click(screen.getByRole("button", { name: /Sync now/ }))
    expect(await screen.findByText("Canvas sync completed with some issues.")).toBeTruthy()
    expect(screen.getByText("1 task marked done (submitted in Canvas)")).toBeTruthy()
    expect(screen.getByText(/Essay: you set the due date to 2026-09-27; Canvas now says 2026-09-26/)).toBeTruthy()
    expect(screen.getByText("Algebra")).toBeTruthy()
    expect(screen.getByText("Biology: Canvas didn't allow Student OS to read this course.")).toBeTruthy()
  })

  it("shows a simple error and lets the student try again", async () => {
    mocks.syncLmsAction.mockResolvedValue({ ok: false, error: "Canvas is busy right now. Please try again in a few minutes.", code: "validation" })
    render(<IntegrationsCard integrations={canvas({ lastSyncedAt: new Date().toISOString() })} outcomes={{}} timeZone="UTC" />)
    await userEvent.setup().click(screen.getByRole("button", { name: /Sync now/ }))
    expect((await screen.findByRole("alert")).textContent).toContain("Canvas is busy right now")
    await waitFor(() => expect((screen.getByRole("button", { name: /Sync now/ }) as HTMLButtonElement).disabled).toBe(false))
  })

  it("asks for a new feed link when the connection needs attention", () => {
    render(
      <IntegrationsCard
        integrations={canvas({ method: "calendar_feed", status: "needs_reauth", lastSyncError: "This Canvas calendar feed link no longer works. Paste a new one from Canvas." })}
        outcomes={{}}
        timeZone="UTC"
      />
    )
    expect(screen.getByText("Needs attention")).toBeTruthy()
    expect(screen.getByText(/feed link no longer works/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Update feed link/ })).toBeTruthy()
  })

  it("not connected: the feed link first, and 'sign in' only when the school's key is set up", () => {
    const { rerender } = render(<IntegrationsCard integrations={canvas(null)} outcomes={{}} timeZone="UTC" />)
    expect(screen.getByLabelText("Your Canvas Calendar Feed link")).toBeTruthy()
    expect(screen.queryByText(/Or sign in with Canvas/)).toBeNull()
    rerender(<IntegrationsCard integrations={canvas(null, true)} outcomes={{}} timeZone="UTC" />)
    expect(screen.getByText(/Or sign in with Canvas/)).toBeTruthy()
    expect(screen.getByLabelText("Your Blackboard calendar link")).toBeTruthy()
  })

  it("never renders a token or feed link (only safe summaries reach it)", () => {
    const { container } = render(<IntegrationsCard integrations={canvas({ lastSyncedAt: new Date().toISOString() })} outcomes={{}} timeZone="UTC" />)
    expect(container.innerHTML).not.toMatch(/token|feeds\/calendars\/user_[A-Za-z0-9]/)
  })
})

describe("Blackboard in Settings", () => {
  it("without server sign-in: offers the calendar link only (no admin approval needed)", () => {
    render(<IntegrationsCard integrations={withBlackboard(null, false)} outcomes={{}} timeZone="UTC" />)
    expect(screen.getByLabelText("Your Blackboard calendar link")).toBeTruthy()
    expect(screen.getByText(/Share Calendar/)).toBeTruthy()
    expect(screen.queryByLabelText("Your school's Blackboard address")).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
  })

  it("with server sign-in: the calendar link first, then 'sign in with Blackboard'", () => {
    render(<IntegrationsCard integrations={withBlackboard(null)} outcomes={{}} timeZone="UTC" />)
    expect(screen.getByLabelText("Your Blackboard calendar link")).toBeTruthy()
    expect(screen.getByText(/Or sign in with Blackboard/)).toBeTruthy()
    expect(screen.getByLabelText("Your school's Blackboard address")).toBeTruthy()
  })

  it("connected through the calendar link: says so, and asks for a new link when it stops working", () => {
    const { rerender } = render(
      <IntegrationsCard integrations={withBlackboard({ method: "calendar_feed", lastSyncedAt: new Date().toISOString() })} outcomes={{}} timeZone="UTC" />
    )
    expect(screen.getByText(/Through your calendar link/)).toBeTruthy()
    rerender(
      <IntegrationsCard
        integrations={withBlackboard({ method: "calendar_feed", status: "needs_reauth", lastSyncError: "This Blackboard calendar link no longer works. Copy a new one from Blackboard." })}
        outcomes={{}}
        timeZone="UTC"
      />
    )
    expect(screen.getByText(/calendar link no longer works/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Update feed link/ })).toBeTruthy()
  })

  it("after the callback: 'Blackboard connected' and 'Import Blackboard data'", () => {
    render(<IntegrationsCard integrations={withBlackboard({})} outcomes={{ blackboard: "connected" }} timeZone="UTC" />)
    expect(screen.getByText(/Blackboard connected\./)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Import Blackboard data/ })).toBeTruthy()
  })

  it("explains an unapproved app, a canceled sign-in and a failed one", () => {
    const { rerender } = render(<IntegrationsCard integrations={withBlackboard(null)} outcomes={{ blackboard: "not_approved" }} timeZone="UTC" />)
    expect(screen.getByRole("alert").textContent).toBe(
      "Your school hasn't enabled Student OS in Blackboard yet. Ask your Blackboard administrator to approve it."
    )
    rerender(<IntegrationsCard integrations={withBlackboard(null)} outcomes={{ blackboard: "denied" }} timeZone="UTC" />)
    expect(screen.getByRole("alert").textContent).toBe("Blackboard authorization was canceled.")
    rerender(<IntegrationsCard integrations={withBlackboard(null)} outcomes={{ blackboard: "<script>" }} timeZone="UTC" />)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("syncs Blackboard (not Canvas) and shows the summary in Blackboard's words", async () => {
    mocks.syncLmsAction.mockResolvedValue({ ok: true, data: { result: result({ provider: "blackboard" }), courses: [], tasks: [] } })
    render(
      <IntegrationsCard
        integrations={withBlackboard({ lastSyncedAt: new Date().toISOString() }, true, { lastSyncedAt: new Date().toISOString() })}
        outcomes={{}}
        timeZone="UTC"
      />
    )
    const [, blackboardSync] = screen.getAllByRole("button", { name: /Sync now/ })
    await userEvent.setup().click(blackboardSync)
    expect(mocks.syncLmsAction).toHaveBeenCalledWith("blackboard")
    expect(await screen.findByText("Blackboard sync complete.")).toBeTruthy()
    expect(screen.getByText("1 assignment without a due date in Blackboard weren't imported")).toBeTruthy()
    expect(screen.getAllByText("Connected")).toHaveLength(2)
  })

  it("needs attention: shows the reason and offers to reconnect or disconnect", () => {
    render(
      <IntegrationsCard
        integrations={withBlackboard({ status: "needs_reauth", lastSyncError: "Your Blackboard connection expired. Please reconnect." })}
        outcomes={{}}
        timeZone="UTC"
      />
    )
    expect(screen.getByText("Needs attention")).toBeTruthy()
    expect(screen.getByText("Your Blackboard connection expired. Please reconnect.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Disconnect/ })).toBeTruthy()
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
