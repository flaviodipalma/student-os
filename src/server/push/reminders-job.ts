import "server-only"

import { pushSubscriptions } from "../db/schema"
import type { Database } from "../db/types"
import { logger } from "../log"
import { syncNotifications } from "../services/notifications"
import { pushMessagesFor, pushTimeZone, pushToStudent, webPushSender, type PushSender } from "./index"

// The scheduled job behind push reminders (run every few minutes by a scheduler,
// POST /api/cron/reminders): for each student with push turned on somewhere,
// works out the reminders due now (the same syncNotifications the open app runs,
// in the time zone of their most recent device) and pushes the new ones. Safe to
// run as often as wanted: a reminder is stored, and so pushed, only once.

export type ReminderJobResult = { students: number; created: number; sent: number; removed: number; failed: number }

export async function runReminderJob(db: Database, options: { now?: Date; sender?: PushSender } = {}): Promise<ReminderJobResult> {
  const now = options.now ?? new Date()
  // Students with push on at least one device.
  const students = (await db.selectDistinct({ userId: pushSubscriptions.userId }).from(pushSubscriptions)).map((row) => row.userId)
  const result: ReminderJobResult = { students: students.length, created: 0, sent: 0, removed: 0, failed: 0 }
  for (const userId of students) {
    try {
      const timeZone = await pushTimeZone(db, userId)
      const sync = await syncNotifications(db, userId, { now, timeZone })
      result.created += sync.created.length
      const pushed = await pushToStudent(db, userId, await pushMessagesFor(db, userId, sync.created), options.sender ?? webPushSender, now)
      result.sent += pushed.sent
      result.removed += pushed.removed
    } catch (error) {
      // One student's problem doesn't stop the others.
      result.failed++
      logger.error("push", "reminder job failed for a student", { name: error instanceof Error ? error.name : typeof error })
    }
  }
  return result
}
