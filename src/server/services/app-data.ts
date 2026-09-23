import type {
  CalendarEvent,
  Course,
  RecurringCommitment,
  StudentPreferences,
  StudySessionRecord,
  Student,
  Task,
} from "@/lib/types"
import type { Database } from "../db/types"
import { listCourses } from "./courses"
import { listEvents } from "./events"
import { getPreferences } from "./preferences"
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
}

// Everything the app shows for one user, loaded once per page load. The
// Dashboard, Calendar, Tasks, Courses and Planner all read from this.
export async function loadAppData(db: Database, userId: string): Promise<AppData> {
  const [student, courses, tasks, events, studySessions, preferences, recurringCommitments] = await Promise.all([
    getProfile(db, userId),
    listCourses(db, userId),
    listTasks(db, userId),
    listEvents(db, userId),
    listStudySessions(db, userId),
    getPreferences(db, userId),
    listRecurringCommitments(db, userId),
  ])
  return { student, courses, tasks, events, studySessions, preferences, recurringCommitments }
}
