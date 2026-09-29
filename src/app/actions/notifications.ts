"use server"

import type { ActionResult } from "@/lib/action-result"
import type { NotificationPreferences } from "@/lib/types"
import { idSchema, notificationPreferencesSchema } from "@/lib/validation"
import { parse, runAction } from "@/server/actions"
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
  syncNotifications,
  type NotificationSync,
} from "@/server/services/notifications"
import { saveNotificationPreferences } from "@/server/services/preferences"
import { pushMessagesFor, pushToStudent } from "@/server/push"
import { getStudentTimeZone } from "@/server/student-clock"

// Server actions for reminders. The student is always the signed-in user; ids from
// the browser only ever match that student's own notifications.

// Generates any reminders due now (in the student's time zone) and returns the list.
// New ones are also pushed to the student's other devices with push on.
export async function syncNotificationsAction(): Promise<ActionResult<NotificationSync>> {
  return runAction(async ({ db, userId }) => {
    const sync = await syncNotifications(db, userId, { timeZone: await getStudentTimeZone() })
    if (sync.created.length > 0) await pushToStudent(db, userId, await pushMessagesFor(db, userId, sync.created))
    return sync
  })
}

export async function markNotificationReadAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await markNotificationRead(db, userId, parse(idSchema, id))
    return null
  })
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await markAllNotificationsRead(db, userId)
    return null
  })
}

export async function dismissNotificationAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await dismissNotification(db, userId, parse(idSchema, id))
    return null
  })
}

export async function updateNotificationPreferencesAction(input: unknown): Promise<ActionResult<NotificationPreferences>> {
  return runAction(({ db, userId }) => saveNotificationPreferences(db, userId, parse(notificationPreferencesSchema, input)))
}
