import "server-only"

import { eq } from "drizzle-orm"
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import type { ThemePreference } from "@/lib/theme"
import type { NotificationPreferences, StudentPreferences } from "@/lib/types"
import { studentPreferences } from "../db/schema"
import type { Database } from "../db/types"

const hhmm = (time: string) => time.slice(0, 5)

// The student's study preferences, or the defaults if they haven't saved any.
export async function getPreferences(db: Database, userId: string): Promise<StudentPreferences> {
  const [row] = await db.select().from(studentPreferences).where(eq(studentPreferences.userId, userId))
  if (!row) return DEFAULT_STUDENT_PREFERENCES
  return {
    studyStart: hhmm(row.studyStart),
    studyEnd: hhmm(row.studyEnd),
    maxStudyMinutesPerDay: row.maxStudyMinutesPerDay,
    preferredBlockMinutes: row.preferredBlockMinutes,
    breakMinutes: row.breakMinutes,
  }
}

// Creates or replaces the student's preferences (one row per student).
export async function savePreferences(
  db: Database,
  userId: string,
  preferences: StudentPreferences
): Promise<StudentPreferences> {
  await db
    .insert(studentPreferences)
    .values({ userId, ...preferences })
    .onConflictDoUpdate({ target: studentPreferences.userId, set: { ...preferences, updatedAt: new Date() } })
  return getPreferences(db, userId)
}

// ---- Notification preferences (same row as the study preferences) ----------------

export async function getNotificationPreferences(db: Database, userId: string): Promise<NotificationPreferences> {
  const [row] = await db.select().from(studentPreferences).where(eq(studentPreferences.userId, userId))
  if (!row) return DEFAULT_NOTIFICATION_PREFERENCES
  return {
    enabled: row.notificationsEnabled,
    taskReminders: row.remindTasks,
    studySessionReminders: row.remindStudySessions,
    eventReminders: row.remindEvents,
    overdueReminders: row.remindOverdue,
    dailyPlanReminder: row.remindDailyPlan,
    reminderMinutes: row.reminderMinutes,
    browserNotifications: row.browserNotifications,
  }
}

// Saves only the notification settings (study preferences stay as they are, or
// the defaults if the student hasn't saved any yet).
export async function saveNotificationPreferences(
  db: Database,
  userId: string,
  preferences: NotificationPreferences
): Promise<NotificationPreferences> {
  const values = {
    notificationsEnabled: preferences.enabled,
    remindTasks: preferences.taskReminders,
    remindStudySessions: preferences.studySessionReminders,
    remindEvents: preferences.eventReminders,
    remindOverdue: preferences.overdueReminders,
    remindDailyPlan: preferences.dailyPlanReminder,
    reminderMinutes: preferences.reminderMinutes,
    browserNotifications: preferences.browserNotifications,
  }
  await db
    .insert(studentPreferences)
    .values({ userId, ...DEFAULT_STUDENT_PREFERENCES, ...values })
    .onConflictDoUpdate({ target: studentPreferences.userId, set: { ...values, updatedAt: new Date() } })
  return getNotificationPreferences(db, userId)
}

// ---- Appearance (same row) -----------------------------------------------------

// The student's saved theme, or null if they've never chosen one.
export async function getThemePreference(db: Database, userId: string): Promise<ThemePreference | null> {
  const [row] = await db.select({ theme: studentPreferences.theme }).from(studentPreferences).where(eq(studentPreferences.userId, userId))
  return row?.theme ?? null
}

export async function saveThemePreference(db: Database, userId: string, theme: ThemePreference): Promise<ThemePreference> {
  await db
    .insert(studentPreferences)
    .values({ userId, ...DEFAULT_STUDENT_PREFERENCES, theme })
    .onConflictDoUpdate({ target: studentPreferences.userId, set: { theme, updatedAt: new Date() } })
  return theme
}
