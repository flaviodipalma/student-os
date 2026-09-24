import "server-only"

import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm"
import { generateNotifications } from "@/lib/notifications/generate"
import { createPlanner } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { dateFromWallClock, instantAt, wallClockIn } from "@/lib/time-zone"
import { toDateKey } from "@/lib/format"
import { scheduleBetween } from "@/lib/recurring"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { safeNextPath } from "@/lib/auth-providers"
import type { AppNotification } from "@/lib/types"
import { notifications } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"
import { listCourses } from "./courses"
import { listEvents } from "./events"
import { listExternalEvents } from "./external-events"
import { getLearningSettings, getNotificationPreferences, getPreferences } from "./preferences"
import { listRecurringCommitments } from "./recurring-commitments"
import { listStudySessions } from "./study-sessions"
import { listTasks } from "./tasks"

// The notification service. Every function is scoped to the signed-in student's id
// (from the session). Two separate steps:
//
//   generation  generateNotifications (src/lib/notifications/generate.ts): which
//               reminders are due now, from the student's data and the Planner
//   delivery    syncNotifications stores the due ones (once each: unique key),
//               and the app shows them (notification center, Dashboard, and
//               desktop notifications if the student allowed them)
//
// syncNotifications is what a scheduler would call (cron, background worker);
// today the open app calls it on load and every minute. See the README for why
// nothing is delivered while the app is closed.

type Row = typeof notifications.$inferSelect

const RECENT = 50
// Read or dismissed reminders are deleted after this long.
const KEEP_DAYS = 60

function toNotification(row: Row): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    // Only ever an in-app path (never another site), whatever is stored.
    link: safeNextPath(row.link) ?? "/dashboard",
    scheduledFor: row.scheduledFor.toISOString(),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    relatedTaskId: row.relatedTaskId,
    relatedStudySessionId: row.relatedStudySessionId,
    relatedEventId: row.relatedEventId,
  }
}

const mine = (userId: string) => eq(notifications.userId, userId)
// (Raw SQL values are sent as ISO strings with a cast: the production Postgres driver
// doesn't accept Date objects there.)

// Recent reminders that haven't been dismissed, most recently delivered first.
export async function listNotifications(db: Database, userId: string): Promise<AppNotification[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(mine(userId), isNull(notifications.dismissedAt)))
    .orderBy(desc(notifications.createdAt), desc(notifications.scheduledFor))
    .limit(RECENT)
  return rows.map(toNotification)
}

export async function markNotificationRead(db: Database, userId: string, id: string, now = new Date()): Promise<void> {
  const updated = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(notifications.id, id), mine(userId)))
    .returning({ id: notifications.id })
  if (updated.length === 0) throw new NotFoundError("notification")
}

export async function markAllNotificationsRead(db: Database, userId: string, now = new Date()): Promise<void> {
  await db.update(notifications).set({ readAt: now }).where(and(mine(userId), isNull(notifications.readAt)))
}

// Dismissed reminders disappear and are never created again (the row keeps its key).
export async function dismissNotification(db: Database, userId: string, id: string, now = new Date()): Promise<void> {
  const updated = await db
    .update(notifications)
    .set({ dismissedAt: now, readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(notifications.id, id), mine(userId)))
    .returning({ id: notifications.id })
  if (updated.length === 0) throw new NotFoundError("notification")
}

export type NotificationSync = {
  notifications: AppNotification[]
  // Ids created by this sync (new to the student: e.g. for a desktop notification).
  created: string[]
}

// Generates the reminders due now and stores the new ones. Safe to call any
// number of times (page loads, tabs, syncs, a scheduler): a reminder with the
// same key is never stored twice. Reminders that no longer apply (their task was
// completed, their session done, an upcoming time changed or passed) are
// dismissed if still unread.
export async function syncNotifications(
  db: Database,
  userId: string,
  options: { now?: Date; timeZone?: string } = {}
): Promise<NotificationSync> {
  const now = options.now ?? new Date()
  const timeZone = options.timeZone
  const [prefs, study, tasks, courses, events, studySessions, commitments, externalEvents] = await Promise.all([
    getNotificationPreferences(db, userId),
    getPreferences(db, userId),
    listTasks(db, userId),
    listCourses(db, userId),
    listEvents(db, userId),
    listStudySessions(db, userId),
    listRecurringCommitments(db, userId),
    listExternalEvents(db, userId),
  ])

  // Today's plan comes from the Planner itself (the same input the app uses).
  // The reminder comes once a day, from the start of the study window, so the
  // Planner only runs when that reminder is actually due (not on every sync).
  let plan: { studySessions: number; events: number } | null = null
  const localNow = dateFromWallClock(wallClockIn(timeZone, now))
  const today = toDateKey(localNow)
  const planReminderDue =
    prefs.enabled &&
    prefs.dailyPlanReminder &&
    now.getTime() >= instantAt(today, study.studyStart, timeZone).getTime() &&
    (await db.select({ id: notifications.id }).from(notifications).where(and(mine(userId), eq(notifications.dedupeKey, `daily_plan_ready:${today}`))).limit(1))
      .length === 0
  if (planReminderDue) {
    const learning = await getLearningSettings(db, userId)
    const daily = createPlanner(
      plannerInputFor({ tasks, courses, events, studySessions, recurringCommitments: commitments, preferences: study, externalEvents, timeZone, learning }, localNow)
    ).planFor(today)
    const dayEvents = scheduleBetween([...events, ...externalEventsAsCalendarItems(externalEvents, timeZone)], commitments, today, today)
    plan = { studySessions: daily.suggestions.length + daily.existingSessions.length, events: dayEvents.length }
  }

  const desired = generateNotifications({
    now,
    timeZone,
    preferences: prefs,
    studyStart: study.studyStart,
    tasks,
    studySessions,
    events,
    commitments,
    externalEvents,
    plan,
  })

  const created = desired.length
    ? await db
        .insert(notifications)
        .values(
          desired.map((n) => ({
            userId,
            type: n.type,
            dedupeKey: n.key,
            title: n.title,
            message: n.message,
            link: n.link,
            scheduledFor: n.scheduledFor,
            relatedTaskId: n.relatedTaskId,
            relatedStudySessionId: n.relatedStudySessionId,
            relatedEventId: n.relatedEventId,
          }))
        )
        .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
        .returning({ id: notifications.id })
    : []

  // Out of date: an unread "coming up" reminder that isn't current any more (the
  // due time or start time changed, the timing setting changed, or the moment
  // passed). Read ones stay as history; overdue, missed and daily plan reminders
  // aren't affected (they don't go stale the same way).
  const current = desired.map((n) => n.key)
  await db
    .update(notifications)
    .set({ dismissedAt: now })
    .where(
      and(
        mine(userId),
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
        inArray(notifications.type, ["task_due_soon", "important_deadline", "study_session_upcoming", "event_upcoming"]),
        current.length > 0 ? notInArray(notifications.dedupeKey, current) : undefined
      )
    )

  // No longer relevant: reminders about tasks now completed, or sessions no longer scheduled.
  const doneTasks = tasks.filter((task) => task.status === "completed").map((task) => task.id)
  const closedSessions = studySessions.filter((session) => session.status !== "scheduled").map((session) => session.id)
  const resolved = [
    doneTasks.length > 0 && inArray(notifications.relatedTaskId, doneTasks),
    closedSessions.length > 0 && inArray(notifications.relatedStudySessionId, closedSessions),
  ].filter((condition) => condition !== false)
  if (resolved.length > 0) {
    await db
      .update(notifications)
      .set({ dismissedAt: now })
      .where(and(mine(userId), isNull(notifications.readAt), isNull(notifications.dismissedAt), or(...resolved)))
  }

  // Housekeeping: old read or dismissed reminders.
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000)
  await db
    .delete(notifications)
    .where(and(mine(userId), lt(notifications.scheduledFor, cutoff), or(sql`${notifications.readAt} is not null`, sql`${notifications.dismissedAt} is not null`)))

  return { notifications: await listNotifications(db, userId), created: created.map((row) => row.id) }
}
