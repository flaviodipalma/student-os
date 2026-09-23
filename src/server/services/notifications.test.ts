import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { notifications } from "../db/schema"
import { NotFoundError } from "../errors"
import { syncExternalCalendar } from "../integrations/calendar/calendar-sync"
import { createTestDb } from "../test-utils/test-db"
import { loadAppData } from "./app-data"
import { createCourse } from "./courses"
import { createEvent } from "./events"
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  syncNotifications,
} from "./notifications"
import { getNotificationPreferences, getPreferences, saveNotificationPreferences, savePreferences } from "./preferences"
import { createStudySession, updateStudySession } from "./study-sessions"
import { createTask, deleteTask, updateTask } from "./tasks"

// Reminders through the real service and a real Postgres: what gets stored,
// that nothing is stored twice, that changes to the student's work are followed,
// and that every student only ever sees their own.

const NY = "America/New_York"
// Tuesday, September 29, 2026, 4:00 PM in New York.
const NOW = new Date("2026-09-29T20:00:00Z")
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

async function student(name = "Alex") {
  const user = await t.addUser(name)
  const course = await createCourse(t.db, user, { code: "CSC215", name: "Data Structures", professor: "", description: "" })
  const task = await createTask(t.db, user, {
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
  // The daily plan reminder has its own test; off here so each test sees only its own reminders.
  await saveNotificationPreferences(t.db, user, { ...DEFAULT_NOTIFICATION_PREFERENCES, dailyPlanReminder: false })
  return { user, course, task }
}
const sync = (user: string, now = NOW, timeZone = NY) => syncNotifications(t.db, user, { now, timeZone })

describe("delivering reminders", () => {
  it("stores the reminders that are due, scoped to the student, and lists them", async () => {
    const { user, task } = await student()
    const result = await sync(user)
    expect(result.created).toHaveLength(1)
    expect(result.notifications).toEqual([
      expect.objectContaining({
        type: "task_due_soon",
        title: "Due soon",
        message: "Database Project is due in 30 minutes.",
        link: `/tasks?task=${task.id}`,
        relatedTaskId: task.id,
        readAt: null,
      }),
    ])
    const [row] = await t.db.select().from(notifications)
    expect(row.userId).toBe(user)
    expect((await loadAppData(t.db, user)).notifications).toHaveLength(1)
  })

  it("never twice: many page loads, syncs and planner recalculations give one reminder", async () => {
    const { user } = await student()
    await Promise.all([sync(user), sync(user), sync(user)]) // several tabs at once
    for (let i = 0; i < 5; i++) expect((await sync(user, at(i))).created).toEqual([])
    expect(await t.db.select().from(notifications)).toHaveLength(1)
  })

  it("the same external event across several calendar syncs: one reminder", async () => {
    const { user } = await student()
    await updateTask(t.db, user, (await loadAppData(t.db, user)).tasks[0].id, { status: "completed" })
    const event = {
      source: "canvas" as const,
      externalId: "calendar-event-9",
      title: "CSC215",
      description: null,
      startsAt: "2026-09-29T20:20:00.000Z",
      endsAt: "2026-09-29T21:35:00.000Z",
      location: null,
      url: null,
    }
    for (let i = 0; i < 3; i++) {
      await syncExternalCalendar(t.db, user, "canvas", [event], { now: NOW })
      await sync(user)
    }
    const stored = await t.db.select().from(notifications)
    expect(stored.map((n) => [n.type, n.message, n.relatedEventId])).toEqual([["event_upcoming", "CSC215 starts in 20 minutes.", expect.stringMatching(/^external:/)]])
  })

  it("a dismissed reminder is never created again", async () => {
    const { user } = await student()
    const [reminder] = (await sync(user)).notifications
    await dismissNotification(t.db, user, reminder.id)
    expect((await sync(user, at(5))).notifications).toEqual([])
    expect((await sync(user, at(10))).created).toEqual([])
  })
})

describe("following changes to the student's work", () => {
  it("task completed: its unread reminders go away and nothing new comes", async () => {
    const { user, task } = await student()
    await sync(user)
    await updateTask(t.db, user, task.id, { status: "completed" })
    expect((await sync(user, at(1))).notifications).toEqual([])
    expect((await sync(user, at(60))).created).toEqual([]) // no overdue reminder either
  })

  it("due date changed: the reminder follows the new deadline", async () => {
    const { user, task } = await student()
    await updateTask(t.db, user, task.id, { dueTime: "17:30" })
    expect((await sync(user)).created).toEqual([]) // now due in 90 minutes
    const later = await sync(user, at(60))
    expect(later.notifications.map((n) => n.message)).toEqual(["Database Project is due in 30 minutes."])
  })

  it("an unread reminder that went out of date is cleared (time changed, or the moment passed); read ones stay", async () => {
    const { user, task } = await student()
    await sync(user) // "due in 30 minutes" (for 4:30 PM)
    await updateTask(t.db, user, task.id, { dueTime: "16:20" })
    const moved = await sync(user, at(1))
    expect(moved.notifications.map((n) => n.message)).toEqual(["Database Project is due in 19 minutes."])

    // Read, then the task passes its due time: the read one stays, the overdue one arrives.
    await markNotificationRead(t.db, user, moved.notifications[0].id)
    const overdue = await sync(user, at(25))
    expect(overdue.notifications.map((n) => n.type)).toEqual(["task_overdue", "task_due_soon"])
  })

  it("study session: upcoming, moved (follows the new time), missed, completed", async () => {
    const { user, task } = await student()
    await updateTask(t.db, user, task.id, { dueDate: "2026-10-05" })
    const session = await createStudySession(t.db, user, { taskId: task.id, date: "2026-09-29", startTime: "16:15", endTime: "17:15", status: "scheduled" })
    expect((await sync(user)).notifications.map((n) => n.type)).toEqual(["study_session_upcoming"])

    // Moved to 6 PM: the reminder comes again for the new time.
    await updateStudySession(t.db, user, session.id, { startTime: "18:00", endTime: "19:00" })
    const moved = await sync(user, at(100))
    expect(moved.created).toHaveLength(1)
    expect(moved.notifications[0].message).toBe("Study session starting in 20 minutes: work on Database Project.")

    // It ends and is still "scheduled": missed (and never marked done by itself).
    const missed = await sync(user, at(185))
    expect(missed.notifications[0]).toMatchObject({ type: "study_session_missed" })
    expect((await loadAppData(t.db, user)).studySessions[0].status).toBe("scheduled")

    // Marked done: its unread reminders are cleared.
    await updateStudySession(t.db, user, session.id, { status: "completed" })
    expect((await sync(user, at(190))).notifications.filter((n) => n.relatedStudySessionId)).toEqual([])
  })

  it("the student's own event gets a reminder (weekly commitments: see generate.test.ts)", async () => {
    const { user, task } = await student()
    await updateTask(t.db, user, task.id, { status: "completed" })
    await createEvent(t.db, user, { title: "Soccer Practice", date: "2026-09-29", startTime: "16:15", endTime: "18:00", type: "sports" })
    const result = await sync(user)
    expect(result.notifications.map((n) => n.message)).toEqual(["Soccer Practice starts in 15 minutes."])
  })

  it("deleting a task deletes its reminders", async () => {
    const { user, task } = await student()
    await sync(user)
    await deleteTask(t.db, user, task.id)
    expect(await t.db.select().from(notifications)).toEqual([])
  })
})

describe("preferences", () => {
  it("defaults, saved alongside the study preferences without changing them", async () => {
    const { user } = await student()
    expect(await getNotificationPreferences(t.db, await t.addUser("New"))).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    await savePreferences(t.db, user, { ...DEFAULT_STUDENT_PREFERENCES, studyStart: "09:00" })
    const saved = await saveNotificationPreferences(t.db, user, { ...DEFAULT_NOTIFICATION_PREFERENCES, reminderMinutes: 60, overdueReminders: false })
    expect(saved).toMatchObject({ reminderMinutes: 60, overdueReminders: false })
    expect((await getPreferences(t.db, user)).studyStart).toBe("09:00")
  })

  it("turning notifications off stops new reminders", async () => {
    const { user } = await student()
    await saveNotificationPreferences(t.db, user, { ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false })
    expect((await sync(user)).created).toEqual([])
  })

  it("a different timing (1 hour) and the daily plan reminder from the Planner", async () => {
    const { user, task } = await student()
    await updateTask(t.db, user, task.id, { dueTime: "17:00" })
    await saveNotificationPreferences(t.db, user, { ...DEFAULT_NOTIFICATION_PREFERENCES, reminderMinutes: 60 })
    const result = await sync(user)
    expect(result.notifications.map((n) => [n.type, n.message]).sort()).toEqual([
      ["daily_plan_ready", expect.stringMatching(/^Your plan for today is ready: \d+ study sessions?/)],
      ["task_due_soon", "Database Project is due in 1 hour."],
    ])
    // Once a day.
    expect((await sync(user, at(30))).created).toEqual([])
  })

  it("in the student's time zone", async () => {
    const { user } = await student()
    // Same instant, but in Tokyo the task (4:30 PM Sept 29 local) is long overdue.
    const tokyo = await sync(user, NOW, "Asia/Tokyo")
    expect(tokyo.notifications.map((n) => n.type)).toEqual(["task_overdue"])
  })
})

describe("each student's notifications are their own", () => {
  it("can't list, read or dismiss another student's reminders", async () => {
    const alex = await student("Alex")
    const sam = await student("Sam")
    const [reminder] = (await sync(alex.user)).notifications
    expect(await listNotifications(t.db, sam.user)).toEqual([])
    await expect(markNotificationRead(t.db, sam.user, reminder.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(dismissNotification(t.db, sam.user, reminder.id)).rejects.toBeInstanceOf(NotFoundError)
    await markAllNotificationsRead(t.db, sam.user)
    const [still] = await listNotifications(t.db, alex.user)
    expect(still).toMatchObject({ id: reminder.id, readAt: null })

    await markNotificationRead(t.db, alex.user, reminder.id)
    expect((await listNotifications(t.db, alex.user))[0].readAt).not.toBeNull()
  })

  it("a reminder can't point at another student's task (database-enforced)", async () => {
    const alex = await student("Alex")
    const sam = await student("Sam")
    await expect(
      t.db.insert(notifications).values({
        userId: sam.user,
        type: "task_due_soon",
        dedupeKey: "x",
        title: "x",
        message: "x",
        link: "/tasks",
        scheduledFor: NOW,
        relatedTaskId: alex.task.id,
      })
    ).rejects.toThrow()
  })

  it("links are always inside Student OS (database-enforced)", async () => {
    const { user } = await student()
    for (const link of ["https://evil.example.com", "//evil.example.com", "javascript:alert(1)"]) {
      await expect(
        t.db.insert(notifications).values({ userId: user, type: "daily_plan_ready", dedupeKey: link, title: "x", message: "x", link, scheduledFor: NOW })
      ).rejects.toThrow()
    }
  })
})
