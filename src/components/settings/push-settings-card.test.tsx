// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Settings > Push reminders in a simulated browser. The server actions and the
// browser's push APIs are faked.

const actions = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  removeDevice: vi.fn(),
  list: vi.fn(),
  test: vi.fn(),
}))
vi.mock("@/app/actions/push", () => ({
  savePushSubscriptionAction: actions.save,
  removePushSubscriptionAction: actions.remove,
  removePushDeviceAction: actions.removeDevice,
  listPushDevicesAction: actions.list,
  sendTestPushAction: actions.test,
}))
const feedback = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }))
vi.mock("@/lib/feedback", () => ({ useFeedback: () => feedback }))

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/this-device"
let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null
const pushManager = {
  getSubscription: async () => subscription,
  subscribe: vi.fn(async () => {
    subscription = { endpoint: ENDPOINT, toJSON: () => ({ keys: { p256dh: "BKey", auth: "auth" } }), unsubscribe: async () => true }
    return subscription
  }),
}

function browser({ permission = "default", userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36" } = {}) {
  const registration = { pushManager }
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: async () => registration, getRegistration: async () => registration, ready: Promise.resolve(registration) },
  })
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent })
  vi.stubGlobal("PushManager", function PushManager() {})
  const Notification = { permission, requestPermission: vi.fn(async () => ((Notification.permission = "granted"), "granted")) }
  vi.stubGlobal("Notification", Notification)
  window.matchMedia = () => ({ matches: false }) as MediaQueryList
  return Notification
}

async function load(vapidKey = "BPublicKey") {
  vi.resetModules()
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", vapidKey)
  return (await import("./push-settings-card")).PushSettingsCard
}

beforeEach(() => {
  subscription = null
  for (const fn of Object.values(actions)) fn.mockReset()
  actions.list.mockResolvedValue({ ok: true, data: [] })
  actions.save.mockResolvedValue({ ok: true, data: [{ id: "d1", device: "Chrome on Mac", addedAt: "", thisDevice: true }] })
  actions.remove.mockResolvedValue({ ok: true, data: [] })
  actions.test.mockResolvedValue({ ok: true, data: { sent: 1 } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("Push reminders", () => {
  it("turn on for this device: asks permission, saves it, then offers a test and turning off", async () => {
    const notification = browser()
    const PushSettingsCard = await load()
    const user = userEvent.setup()
    render(<PushSettingsCard />)
    await user.click(await screen.findByRole("button", { name: "Turn on for this device" }))
    expect(notification.requestPermission).toHaveBeenCalled()
    expect(actions.save).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: ENDPOINT, keys: { p256dh: "BKey", auth: "auth" }, device: "Chrome on Mac", timeZone: expect.any(String) })
    )
    expect(await screen.findByText("On for this device")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Send a test" }))
    expect(feedback.showSuccess).toHaveBeenLastCalledWith(expect.stringMatching(/^Test sent to 1 device\. Nothing showing up\?/))
    await user.click(screen.getByRole("button", { name: "Turn off" }))
    expect(actions.remove).toHaveBeenCalledWith(ENDPOINT)
    expect(await screen.findByRole("button", { name: "Turn on for this device" })).toBeTruthy()
  })

  it("other devices are listed, and can be removed", async () => {
    browser()
    actions.list.mockResolvedValue({ ok: true, data: [{ id: "d2", device: "Safari on iPhone", addedAt: "", thisDevice: false }] })
    actions.removeDevice.mockResolvedValue({ ok: true, data: [] })
    const PushSettingsCard = await load()
    const user = userEvent.setup()
    render(<PushSettingsCard />)
    await user.click(await screen.findByRole("button", { name: "Remove Safari on iPhone" }))
    expect(actions.removeDevice).toHaveBeenCalledWith("d2", undefined)
    await waitFor(() => expect(screen.queryByText("Safari on iPhone")).toBeNull())
  })

  it("iPhone in Safari: add to the home screen first", async () => {
    browser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1" })
    const PushSettingsCard = await load()
    render(<PushSettingsCard />)
    expect(await screen.findByText(/Add to Home Screen/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Turn on for this device" })).toBeNull()
  })

  it("blocked in the browser: says how to allow it", async () => {
    browser({ permission: "denied" })
    const PushSettingsCard = await load()
    render(<PushSettingsCard />)
    expect(await screen.findByText(/Notifications are blocked for Student OS/)).toBeTruthy()
  })

  it("not set up on the server: says so", async () => {
    browser()
    const PushSettingsCard = await load("")
    render(<PushSettingsCard />)
    expect(await screen.findByText(/aren't set up on this server yet/)).toBeTruthy()
  })
})
