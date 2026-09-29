import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deviceLabel, isPushServiceUrl, pushSubscriptionSchema } from "@/lib/push"
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/preferences"
import { createTestDb } from "../test-utils/test-db"
import { createCourse } from "../services/courses"
import { saveNotificationPreferences } from "../services/preferences"
import { createTask } from "../services/tasks"
import { listPushDevices, pushTimeZone, pushToStudent, removePushSubscription, savePushSubscription, touchPushSubscription, type PushSender } from "./index"
import { runReminderJob } from "./reminders-job"

// Push reminders against a real Postgres, with a fake push service (nothing leaves
// the machine).

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const NY = "America/New_York"
const NOW = new Date("2026-09-29T20:00:00Z") // 4:00 PM in New York
const device = (n: number, timeZone = NY) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: `BKey${n}`, auth: `auth${n}` },
  timeZone,
  device: "Chrome on Mac",
})

// A student with a project due at 4:30 PM (a "due soon" reminder at 4:00 PM).
async function student(name = "Alex") {
  const user = await t.addUser(name)
  const course = await createCourse(t.db, user, { code: "CSC215", name: "Data Structures", professor: "", description: "" })
  await createTask(t.db, user, {
    courseId: course.id,
    title: "Database Project",
    description: "",
    type: "project",
    dueDate: "2026-09-29",
    dueTime: "16:30",
    priority: "medium",
    estimateMinutes: 60,
    status: "not_started",
  })
  await saveNotificationPreferences(t.db, user, { ...DEFAULT_NOTIFICATION_PREFERENCES, dailyPlanReminder: false })
  return user
}

const fakeService = () => {
  const sent: { endpoint: string; title: string; body: string; url: string; tag: string }[] = []
  const sender: PushSender = async (target, message) => void sent.push({ endpoint: target.endpoint, ...message })
  return { sent, sender }
}

describe("devices", () => {
  it("a device is saved once (refreshing it updates it), listed as the student's, and removed", async () => {
    const alex = await student()
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(1)))
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse({ ...device(1), timeZone: "Europe/Rome" }))
    expect(await listPushDevices(t.db, alex, device(1).endpoint)).toEqual([expect.objectContaining({ device: "Chrome on Mac", thisDevice: true })])
    expect(await pushTimeZone(t.db, alex)).toBe("Europe/Rome")
    await touchPushSubscription(t.db, alex, device(1).endpoint, "America/Chicago")
    expect(await pushTimeZone(t.db, alex)).toBe("America/Chicago")
    await removePushSubscription(t.db, alex, device(1).endpoint)
    expect(await listPushDevices(t.db, alex)).toEqual([])
  })

  it("another student can't see or remove it; a shared browser moves to whoever turns push on last", async () => {
    const alex = await student("Alex")
    const sam = await student("Sam")
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(1)))
    expect(await listPushDevices(t.db, sam)).toEqual([])
    await removePushSubscription(t.db, sam, device(1).endpoint)
    expect(await listPushDevices(t.db, alex)).toHaveLength(1)
    await savePushSubscription(t.db, sam, pushSubscriptionSchema.parse(device(1)))
    expect(await listPushDevices(t.db, alex)).toEqual([])
    expect(await listPushDevices(t.db, sam)).toHaveLength(1)
  })
})

describe("sending", () => {
  it("to every device; ones the push service says are gone are removed", async () => {
    const alex = await student()
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(1)))
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(2)))
    const sender: PushSender = async (target) => {
      if (target.endpoint.endsWith("device-2")) throw Object.assign(new Error("gone"), { statusCode: 410 })
    }
    const result = await pushToStudent(t.db, alex, [{ title: "T", body: "B", url: "/tasks", tag: "k" }], sender)
    expect(result).toEqual({ sent: 1, removed: 1 })
    expect((await listPushDevices(t.db, alex)).map((d) => d.id)).toHaveLength(1)
  })

  it("a temporary failure keeps the device", async () => {
    const alex = await student()
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(1)))
    const sender: PushSender = async () => {
      throw Object.assign(new Error("busy"), { statusCode: 503 })
    }
    expect(await pushToStudent(t.db, alex, [{ title: "T", body: "B", url: "/", tag: "k" }], sender)).toEqual({ sent: 0, removed: 0 })
    expect(await listPushDevices(t.db, alex)).toHaveLength(1)
  })
})

describe("the scheduled job", () => {
  it("works out due reminders for students with push on, in their device's time zone, and pushes new ones once", async () => {
    const alex = await student("Alex")
    await student("Sam") // no push device: skipped (their reminders come when they open the app)
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(1)))
    const { sent, sender } = fakeService()

    const first = await runReminderJob(t.db, { now: NOW, sender })
    expect(first).toMatchObject({ students: 1, created: 1, sent: 1, failed: 0 })
    expect(sent[0]).toMatchObject({
      endpoint: device(1).endpoint,
      title: "Due soon",
      body: "Database Project is due in 30 minutes.",
      url: expect.stringMatching(/^\/tasks\?task=/),
      tag: expect.stringMatching(/^[0-9a-f-]{36}$/), // the reminder's id (the app's desktop notification uses it too)
    })
    // Running again (every few minutes) pushes nothing twice.
    expect(await runReminderJob(t.db, { now: new Date(NOW.getTime() + 5 * 60_000), sender })).toMatchObject({ created: 0, sent: 0 })
    expect(sent).toHaveLength(1)
  })

  it("in another time zone, the same moment isn't 'due soon'", async () => {
    const alex = await student()
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(1, "Asia/Tokyo")))
    const { sent, sender } = fakeService()
    await runReminderJob(t.db, { now: NOW, sender })
    expect(sent.filter((m) => m.title === "Due soon")).toEqual([])
  })

  it("notifications turned off: nothing is pushed", async () => {
    const alex = await student()
    await saveNotificationPreferences(t.db, alex, { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false })
    await savePushSubscription(t.db, alex, pushSubscriptionSchema.parse(device(1)))
    const { sent, sender } = fakeService()
    await runReminderJob(t.db, { now: NOW, sender })
    expect(sent).toEqual([])
  })
})

describe("what a browser may register", () => {
  it("only real push services' addresses (the server sends requests to them)", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) expect(isPushServiceUrl(ok), ok).toBe(true)
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://localhost/push",
      "https://169.254.169.254/latest",
      "https://fcm.googleapis.com:8443/x",
      "not a url",
    ]) expect(isPushServiceUrl(bad), bad).toBe(false)
    expect(pushSubscriptionSchema.safeParse({ ...device(1), keys: { p256dh: "<script>", auth: "x" } }).success).toBe(false)
  })

  it("device names", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone")
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe("Chrome on Mac")
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Edge on Windows")
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15) Firefox/140.0")).toBe("Firefox on Android")
  })
})

describe("the job's address", () => {
  const OLD = process.env.CRON_SECRET
  afterEach(() => {
    process.env.CRON_SECRET = OLD
    vi.resetModules()
  })

  async function call(authorization?: string) {
    vi.doMock("@/server/db", () => ({ getDb: () => t.db }))
    const { POST } = await import("@/app/api/cron/reminders/route")
    return POST(new Request("http://localhost/api/cron/reminders", { method: "POST", headers: authorization ? { authorization } : {} }))
  }

  it("off without CRON_SECRET; only the right secret runs it", async () => {
    delete process.env.CRON_SECRET
    expect((await call("Bearer anything")).status).toBe(503)
    process.env.CRON_SECRET = "s".repeat(40)
    expect((await call()).status).toBe(401)
    expect((await call(`Bearer ${"x".repeat(40)}`)).status).toBe(401)
    const ok = await call(`Bearer ${"s".repeat(40)}`)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ students: 0, failed: 0 })
  })
})

