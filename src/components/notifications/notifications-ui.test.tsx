// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/preferences"
import type { AppNotification, NotificationPreferences } from "@/lib/types"

// The notification center, the Dashboard's "Needs attention", the Settings fields,
// and the browser-side store (sync + desktop notifications), in a simulated browser.
// Server actions are mocked: which reminders exist is tested in src/lib/notifications
// and src/server/services.

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  markRead: vi.fn(async () => ({ ok: true, data: null })),
  markAll: vi.fn(async () => ({ ok: true, data: null })),
  dismiss: vi.fn(async () => ({ ok: true, data: null })),
  savePrefs: vi.fn(),
  push: vi.fn(),
  warnings: [] as unknown[],
}))
vi.mock("@/lib/planner-store", () => ({ usePlan: () => ({ warnings: mocks.warnings }) }))
vi.mock("@/lib/task-store", () => ({ useTasks: () => ({ today: "2026-09-29", tasks: [] }) }))
vi.mock("@/app/actions/notifications", () => ({
  syncNotificationsAction: mocks.sync,
  markNotificationReadAction: mocks.markRead,
  markAllNotificationsReadAction: mocks.markAll,
  dismissNotificationAction: mocks.dismiss,
  updateNotificationPreferencesAction: mocks.savePrefs,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }))
vi.mock("@/lib/app-store", () => ({ useAppStore: () => ({ tasks: [], studySessions: [] }) }))
vi.mock("@/lib/feedback", () => ({ useFeedback: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }))
vi.mock("@/lib/clock", () => ({ useNow: () => new Date("2026-09-29T20:10:00Z") }))

const { NotificationProvider } = await import("@/lib/notification-store")
const { NotificationBell } = await import("./notification-center")
const { NeedsAttention } = await import("@/components/dashboard/needs-attention")
const { NotificationSettingsFields } = await import("@/components/settings/notification-settings-fields")

const note = (id: string, type: AppNotification["type"], message: string, extra: Partial<AppNotification> = {}): AppNotification => ({
  id,
  type,
  title: type,
  message,
  link: `/tasks?task=${id}`,
  scheduledFor: "2026-09-29T20:00:00.000Z",
  createdAt: "2026-09-29T20:00:00.000Z",
  readAt: null,
  relatedTaskId: id,
  relatedStudySessionId: null,
  relatedEventId: null,
  ...extra,
})
const list = [
  note("n1", "task_due_soon", "Psychology Paper is due tomorrow."),
  note("n2", "task_overdue", "Database Project was due yesterday."),
  note("n3", "study_session_upcoming", "Study session starting in 15 minutes: work on Essay.", { link: "/planner?date=2026-09-29" }),
  note("n4", "daily_plan_ready", "Your plan for today is ready: 2 study sessions.", { link: "/planner" }),
  note("n5", "event_upcoming", "Soccer Practice starts in 15 minutes.", { readAt: "2026-09-29T20:05:00.000Z", link: "/calendar?date=2026-09-29" }),
]

function withStore(ui: React.ReactNode, initial = list, prefs: Partial<NotificationPreferences> = {}) {
  return render(
    <NotificationProvider initial={initial} initialPreferences={{ ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs }}>
      {ui}
    </NotificationProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sync.mockImplementation(async () => ({ ok: true, data: { notifications: list, created: [] } }))
})
afterEach(cleanup)

describe("notification center", () => {
  it("shows the unread count, the reminders, and a useful action for each", async () => {
    withStore(<NotificationBell />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Notifications, 4 unread" }))
    const panel = await screen.findByRole("dialog")
    expect(within(panel).getByText("Database Project was due yesterday.")).toBeTruthy()
    const links = within(panel).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])
    expect(links).toEqual([
      ["Open task", "/tasks?task=n1"],
      ["Open task", "/tasks?task=n2"],
      ["Open study session", "/planner?date=2026-09-29"],
      ["Open planner", "/planner"],
      ["Open calendar", "/calendar?date=2026-09-29"],
    ])
    expect(within(panel).getAllByText("Unread")).toHaveLength(4)
    expect(within(panel).getAllByText("10 min ago").length).toBeGreaterThan(0)
  })

  it("mark as read, mark all as read, dismiss", async () => {
    withStore(<NotificationBell />)
    // Let the on-load sync finish first (its mocked reply would otherwise land mid-test).
    await waitFor(() => expect(mocks.sync).toHaveBeenCalled())
    await act(async () => {})
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /^Notifications/ }))
    const panel = await screen.findByRole("dialog")

    await user.click(within(panel).getAllByRole("button", { name: "Mark as read" })[0])
    expect(mocks.markRead).toHaveBeenCalledWith("n1")
    // (The bell is behind the open panel, so it's hidden from assistive tech meanwhile.)
    expect(screen.getByRole("button", { name: "Notifications, 3 unread", hidden: true })).toBeTruthy()

    await user.click(within(panel).getByRole("button", { name: "Dismiss: Database Project was due yesterday." }))
    expect(mocks.dismiss).toHaveBeenCalledWith("n2")
    expect(within(panel).queryByText("Database Project was due yesterday.")).toBeNull()

    await user.click(within(panel).getByRole("button", { name: /Mark all as read/ }))
    expect(mocks.markAll).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Notifications", hidden: true })).toBeTruthy()
  })

  it("opening a reminder marks it read", async () => {
    withStore(<NotificationBell />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /^Notifications/ }))
    const panel = await screen.findByRole("dialog")
    const link = within(panel).getAllByRole("link", { name: "Open task" })[1]
    link.addEventListener("click", (event) => event.preventDefault())
    await user.click(link)
    expect(mocks.markRead).toHaveBeenCalledWith("n2")
  })

  it("empty: says so", async () => {
    mocks.sync.mockImplementation(async () => ({ ok: true, data: { notifications: [], created: [] } }))
    withStore(<NotificationBell />, [])
    await userEvent.setup().click(screen.getByRole("button", { name: "Notifications" }))
    expect(await screen.findByText(/You're all caught up/)).toBeTruthy()
  })
})

describe("Dashboard: Needs attention", () => {
  it("the Planner's warnings (with a severity in words) plus reminders about something starting soon", () => {
    mocks.warnings = [
      { id: "overdue", kind: "overdue", severity: "high", message: "Database Project is overdue.", taskIds: ["n2"], action: "view-task" },
      { id: "no-estimate", kind: "no-estimate", severity: "low", message: "Essay has no time estimate.", taskIds: ["x"] },
    ]
    withStore(<NeedsAttention />)
    const items = screen.getAllByRole("listitem").map((item) => item.textContent)
    expect(items[0]).toContain("Urgent")
    expect(items[0]).toContain("Database Project is overdue.")
    // Low-value notes stay on the Planner page; overdue / deadline reminders aren't repeated.
    expect(screen.queryByText("Essay has no time estimate.")).toBeNull()
    expect(screen.queryByText("Database Project was due yesterday.")).toBeNull()
    expect(screen.getByText("Study session starting in 15 minutes: work on Essay.")).toBeTruthy()
    expect(screen.getByText("Psychology Paper is due tomorrow.")).toBeTruthy()
    expect(screen.getAllByRole("link", { name: "Open task" })[0].getAttribute("href")).toBe("/tasks?task=n2")
  })

  it("nothing to show: no card", () => {
    mocks.warnings = []
    const { container } = withStore(<NeedsAttention />, [list[3], list[4]])
    expect(container.innerHTML).toBe("")
  })
})

describe("the store", () => {
  it("syncs on load and shows desktop notifications for new reminders only when allowed and the tab is hidden", async () => {
    const shown: string[] = []
    class FakeNotification {
      static permission = "granted"
      onclick: (() => void) | null = null
      constructor(title: string, options: { body: string }) {
        shown.push(`${title}: ${options.body}`)
      }
      close() {}
    }
    vi.stubGlobal("Notification", FakeNotification)
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
    mocks.sync.mockImplementation(async () => ({ ok: true, data: { notifications: list, created: ["n2"] } }))

    withStore(<NotificationBell />, [], { browserNotifications: true })
    await waitFor(() => expect(mocks.sync).toHaveBeenCalled())
    await waitFor(() => expect(shown).toEqual(["task_overdue: Database Project was due yesterday."]))

    // Turned off: nothing on the desktop.
    cleanup()
    shown.length = 0
    withStore(<NotificationBell />, [], { browserNotifications: false })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(shown).toEqual([])
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
    vi.unstubAllGlobals()
  })
})

describe("Settings: notification fields", () => {
  function Fields({ initial = DEFAULT_NOTIFICATION_PREFERENCES }: { initial?: NotificationPreferences }) {
    const [value, setValue] = React.useState(initial)
    return (
      <>
        <NotificationSettingsFields value={value} onChange={setValue} />
        <pre data-testid="value">{JSON.stringify(value)}</pre>
      </>
    )
  }
  const value = () => JSON.parse(screen.getByTestId("value").textContent ?? "{}") as NotificationPreferences
  const checkbox = (label: string) => screen.getByRole("checkbox", { name: label })

  it("each reminder kind, and turning everything off", async () => {
    render(<Fields />)
    const user = userEvent.setup()
    await user.click(checkbox("Overdue task reminders"))
    expect(value().overdueReminders).toBe(false)
    await user.click(checkbox("Notifications"))
    expect(value().enabled).toBe(false)
    expect(checkbox("Task due reminders").getAttribute("aria-disabled") ?? String((checkbox("Task due reminders") as HTMLButtonElement).disabled)).toMatch(/true/)
  })

  it("asks the browser for permission only when desktop notifications are turned on", async () => {
    const requestPermission = vi.fn(async () => "granted")
    vi.stubGlobal("Notification", { permission: "default", requestPermission })
    render(<Fields />)
    expect(requestPermission).not.toHaveBeenCalled()
    await userEvent.setup().click(checkbox("Enable desktop notifications"))
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(value().browserNotifications).toBe(true)
    vi.unstubAllGlobals()
  })

  it("blocked by the browser: stays off, explains, and the app works without it", async () => {
    vi.stubGlobal("Notification", { permission: "denied", requestPermission: vi.fn() })
    render(<Fields />)
    await userEvent.setup().click(checkbox("Enable desktop notifications"))
    expect(value().browserNotifications).toBe(false)
    expect(screen.getByText(/blocked for this site/).getAttribute("role")).toBe("status")
    vi.unstubAllGlobals()
  })
})

import * as React from "react"
