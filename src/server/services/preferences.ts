import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import type { ThemePreference } from "@/lib/theme"
import { DEFAULT_LEARNING_SETTINGS, type LearningSettings, type NotificationPreferences, type StudentPreferences } from "@/lib/types"
import { studentPreferences, studySessions, tasks } from "../db/schema"
import { NotFoundError } from "../errors"
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

// ---- Personalization (same row) ----------------------------------------------

const learningColumns = {
  enabled: studentPreferences.adaptivePlanning,
  since: studentPreferences.adaptiveSince,
  useEstimates: studentPreferences.learnEstimates,
  useStudyTimes: studentPreferences.learnStudyTimes,
  useWorkload: studentPreferences.learnWorkload,
  planningMode: studentPreferences.planningMode,
  preferredPeriods: studentPreferences.preferredPeriods,
  dismissedPatterns: studentPreferences.dismissedPatterns,
  ownEstimateTaskIds: studentPreferences.ownEstimateTaskIds,
}

export async function getLearningSettings(db: Database, userId: string): Promise<LearningSettings> {
  const [row] = await db.select(learningColumns).from(studentPreferences).where(eq(studentPreferences.userId, userId))
  return row ? (row as LearningSettings) : DEFAULT_LEARNING_SETTINGS
}

// The student's own choices (validated by the caller). Tasks named in
// ownEstimateTaskIds must be theirs (checked here).
export type LearningChanges = Partial<Omit<LearningSettings, "since">>

export async function saveLearningSettings(db: Database, userId: string, changes: LearningChanges): Promise<LearningSettings> {
  const values: Partial<typeof studentPreferences.$inferInsert> = {}
  if (changes.enabled !== undefined) values.adaptivePlanning = changes.enabled
  if (changes.useEstimates !== undefined) values.learnEstimates = changes.useEstimates
  if (changes.useStudyTimes !== undefined) values.learnStudyTimes = changes.useStudyTimes
  if (changes.useWorkload !== undefined) values.learnWorkload = changes.useWorkload
  if (changes.planningMode !== undefined) values.planningMode = changes.planningMode
  if (changes.preferredPeriods !== undefined) values.preferredPeriods = [...new Set(changes.preferredPeriods)]
  if (changes.dismissedPatterns !== undefined) values.dismissedPatterns = [...new Set(changes.dismissedPatterns)].slice(0, 50)
  if (changes.ownEstimateTaskIds !== undefined) {
    const ids = [...new Set(changes.ownEstimateTaskIds)]
    const own = ids.length
      ? await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.id, ids)))
      : []
    if (own.length !== ids.length) throw new NotFoundError("task")
    values.ownEstimateTaskIds = ids.slice(0, 500)
  }
  if (Object.keys(values).length > 0) {
    await db
      .insert(studentPreferences)
      .values({ userId, ...DEFAULT_STUDENT_PREFERENCES, ...values })
      .onConflictDoUpdate({ target: studentPreferences.userId, set: { ...values, updatedAt: new Date() } })
  }
  return getLearningSettings(db, userId)
}

// On/off (kept for callers that only switch learning).
export async function saveLearningEnabled(db: Database, userId: string, enabled: boolean): Promise<LearningSettings> {
  return saveLearningSettings(db, userId, { enabled })
}

// "Reset learning": history before `today` (the student's date) no longer counts,
// the recorded moves of study sessions are cleared, and turned-off patterns and
// per-task estimate choices are forgotten (they were about the old history).
// The student's explicit choices (mode, preferred times, switches) stay, and so
// do tasks, sessions and everything else.
export async function resetLearning(db: Database, userId: string, today: string): Promise<LearningSettings> {
  await db.transaction(async (tx) => {
    const reset = { adaptiveSince: today, dismissedPatterns: [], ownEstimateTaskIds: [] }
    await tx
      .insert(studentPreferences)
      .values({ userId, ...DEFAULT_STUDENT_PREFERENCES, ...reset })
      .onConflictDoUpdate({ target: studentPreferences.userId, set: { ...reset, updatedAt: new Date() } })
    await tx.update(studySessions).set({ rescheduleCount: 0, firstDate: null, firstStartTime: null }).where(eq(studySessions.userId, userId))
  })
  return getLearningSettings(db, userId)
}
