import "server-only"

import type {
  AppNotification,
  CalendarEvent,
  Course,
  ExternalEventRecord,
  LearningSettings,
  NotificationPreferences,
  RecurringCommitment,
  StudentPreferences,
  StudySessionRecord,
  Student,
  Task,
} from "@/lib/types"
import type { Database } from "../db/types"
import { listCourses } from "./courses"
import { listEvents } from "./events"
import { listExternalEvents } from "./external-events"
import { listNotifications } from "./notifications"
import { getLearningSettings, getNotificationPreferences, getPreferences } from "./preferences"
import { getProfile } from "./profiles"
import { listRecurringCommitments } from "./recurring-commitments"
import { listStudySessions } from "./study-sessions"
import { listTasks } from "./tasks"

export type AppData = {
  student: Student
  courses: Course[]
  tasks: Task[]
  events: CalendarEvent[]
  studySessions: StudySessionRecord[]
  preferences: StudentPreferences
  recurringCommitments: RecurringCommitment[]
  // Read-only copies of the student's Canvas / Blackboard calendar events (hidden ones included).
  externalEvents: ExternalEventRecord[]
  // Delivered reminders (not dismissed), newest first, and the student's reminder settings.
  notifications: AppNotification[]
  notificationPreferences: NotificationPreferences
  // Adaptive planning on/off, and since when history counts.
  learning: LearningSettings
}

// Everything the app shows for one user, loaded once per page load. The
// Dashboard, Calendar, Tasks, Courses and Planner all read from this.
export async function loadAppData(db: Database, userId: string): Promise<AppData> {
  const [
    student,
    courses,
    tasks,
    events,
    studySessions,
    preferences,
    recurringCommitments,
    externalEvents,
    notifications,
    notificationPreferences,
    learning,
  ] = await Promise.all([
    getProfile(db, userId),
    listCourses(db, userId),
    listTasks(db, userId),
    listEvents(db, userId),
    listStudySessions(db, userId),
    getPreferences(db, userId),
    listRecurringCommitments(db, userId),
    listExternalEvents(db, userId),
    listNotifications(db, userId),
    getNotificationPreferences(db, userId),
    getLearningSettings(db, userId),
  ])
  return {
    student,
    courses,
    tasks,
    events,
    studySessions,
    preferences,
    recurringCommitments,
    externalEvents,
    notifications,
    notificationPreferences,
    learning,
  }
}
