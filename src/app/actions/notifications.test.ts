import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { createCourse } from "@/server/services/courses"
import { listNotifications } from "@/server/services/notifications"
import { createTask } from "@/server/services/tasks"
import { createTestDb } from "@/server/test-utils/test-db"

// The notification server actions, as the browser calls them. The student comes
// from the (mocked) verified session; ids from the browser only match their own.

const session = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown }))
vi.mock("@/server/auth", () => ({
  getCurrentUser: async () => (session.userId ? { id: session.userId, email: null } : null),
}))
vi.mock("@/server/db", () => ({ getDb: () => session.db }))
vi.mock("@/server/student-clock", () => ({ getStudentTimeZone: async () => "America/New_York" }))

const {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  syncNotificationsAction,
  updateNotificationPreferencesAction,
} = await import("./notifications")

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  session.db = t.db as Database
})
afterEach(() => {
  session.userId = null
  return t.close()
})

// A student with a task due in 10 minutes (so a reminder is due now).
async function studentWithReminder(name: string) {
  const user = await t.addUser(name)
  const course = await createCourse(t.db, user, { code: "CSC215", name: "Data Structures", professor: "", description: "" })
  const soon = new Date(Date.now() + 10 * 60_000)
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(soon)
  const part = (type: string) => local.find((p) => p.type === type)!.value
  await createTask(t.db, user, {
    courseId: course.id,
    title: "Database Project",
    description: "",
    type: "project",
    dueDate: `${part("year")}-${part("month")}-${part("day")}`,
    dueTime: `${part("hour")}:${part("minute")}`,
    priority: "medium",
    estimateMinutes: 60,
    status: "not_started",
  })
  return user
}

describe("notification actions", () => {
  it("need a signed-in student", async () => {
    expect(await syncNotificationsAction()).toMatchObject({ ok: false, code: "unauthorized" })
    expect(await markAllNotificationsReadAction()).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("sync, read and dismiss the student's own reminders", async () => {
    session.userId = await studentWithReminder("Alice")
    const synced = await syncNotificationsAction()
    if (!synced.ok) throw new Error(synced.error)
    const reminder = synced.data.notifications.find((n) => n.type === "task_due_soon")!
    expect(reminder.message).toMatch(/^Database Project is due in \d+ minutes\.$/)
    expect(await markNotificationReadAction(reminder.id)).toEqual({ ok: true, data: null })
    expect(await dismissNotificationAction(reminder.id)).toEqual({ ok: true, data: null })
    expect((await listNotifications(t.db, session.userId)).map((n) => n.id)).not.toContain(reminder.id)
  })

  it("never touch another student's reminders, and refuse bad input", async () => {
    const alice = await studentWithReminder("Alice")
    session.userId = alice
    const synced = await syncNotificationsAction()
    if (!synced.ok) throw new Error(synced.error)
    const reminder = synced.data.notifications[0]

    session.userId = await t.addUser("Bob")
    expect(await markNotificationReadAction(reminder.id)).toMatchObject({ ok: false, code: "not-found" })
    expect(await dismissNotificationAction(reminder.id)).toMatchObject({ ok: false, code: "not-found" })
    expect(await markAllNotificationsReadAction()).toEqual({ ok: true, data: null })
    expect(await syncNotificationsAction()).toMatchObject({ ok: true, data: { notifications: [] } })
    expect(await markNotificationReadAction("not-a-uuid")).toMatchObject({ ok: false, code: "validation" })
    expect((await listNotifications(t.db, alice))[0]).toMatchObject({ id: reminder.id, readAt: null })
  })

  it("save notification preferences, validated", async () => {
    session.userId = await t.addUser("Alice")
    const prefs = {
      enabled: true,
      taskReminders: true,
      studySessionReminders: false,
      eventReminders: true,
      overdueReminders: true,
      dailyPlanReminder: false,
      reminderMinutes: 15,
      browserNotifications: false,
    }
    expect(await updateNotificationPreferencesAction(prefs)).toEqual({ ok: true, data: prefs })
    expect(await updateNotificationPreferencesAction({ ...prefs, reminderMinutes: 7 })).toMatchObject({ ok: false, code: "validation" })
    expect(await updateNotificationPreferencesAction({ ...prefs, enabled: "yes" })).toMatchObject({ ok: false, code: "validation" })
  })
})
