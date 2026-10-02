import type { LmsProviderId, TaskType } from "@/lib/types"

// Normalized LMS data: what every provider adapter (Canvas, Blackboard, …)
// must turn its own API responses into. Nothing past the adapter ever sees a
// provider-specific shape, so the sync logic, and the rest of Quadernio,
// work the same whichever LMS the data came from.
//
// Dates and times follow the rest of the app: the student's local calendar
// date "YYYY-MM-DD" and wall-clock time "HH:MM". Adapters convert the LMS's
// timestamps into the student's time zone before returning them.

export type LmsCourse = {
  provider: LmsProviderId
  // The LMS's id for the course. Unique within the provider.
  externalId: string
  // e.g. "CSC 215" (may be missing; some LMSs only have a name).
  courseCode: string | null
  courseName: string
  description: string | null
  instructor: string | null
  url: string | null
  // The course's semester ("YYYY-MM-DD"), when the LMS has its dates.
  termStart?: string | null
  termEnd?: string | null
}

// Where the student stands on the assignment in the LMS. Recorded for
// reference; it never changes the Quadernio task's own status (see sync-plan.ts).
export type LmsSubmissionStatus = "not_submitted" | "submitted" | "graded" | "unknown"

export type LmsAssignment = {
  provider: LmsProviderId
  externalId: string
  // The course it belongs to (LmsCourse.externalId).
  courseExternalId: string
  title: string
  description: string | null
  // Null when the LMS has no due date; such assignments aren't imported as tasks
  // (every Quadernio task has a due date), and are reported as skipped.
  dueDate: string | null
  dueTime: string | null
  // Best guess at the kind of work; adapters default to "assignment".
  type: TaskType
  url: string | null
  // Only when the LMS states it; never guessed.
  estimatedMinutes: number | null
  submissionStatus: LmsSubmissionStatus
}

// What a sync did, shown to the student afterwards.
export type LmsSyncConflict = {
  taskId: string
  title: string
  field: "title" | "description" | "dueDate" | "dueTime"
  // What the student has now (kept), and what the LMS says.
  studentValue: string | null
  lmsValue: string | null
}

export type LmsSyncResult = {
  provider: LmsProviderId
  coursesCreated: number
  coursesUpdated: number
  // Couldn't be imported or read this time (see errors).
  coursesSkipped: number
  // Existing Quadernio courses (added by hand or from a syllabus) that were linked to the LMS course.
  coursesLinked: number
  assignmentsCreated: number
  assignmentsUpdated: number
  assignmentsLinked: number
  // No due date, or unchanged since the last sync.
  assignmentsSkipped: number
  // Of those: no due date in the LMS, so not imported (every task needs one).
  assignmentsWithoutDueDate: number
  // Imported tasks the LMS no longer lists. Kept as they are; the student decides.
  assignmentsMissing: number
  missing: { taskId: string; title: string }[]
  // Imported courses the LMS no longer lists (kept, like everything else).
  missingCourses: { courseId: string; name: string }[]
  // Tasks marked done because the LMS shows them turned in (see sync-plan.ts).
  assignmentsCompleted: number
  conflicts: LmsSyncConflict[]
  // Safe, student-facing messages.
  errors: string[]
  syncedAt: string
  // From the courses' calendars and announcements (see src/server/integrations/lms/course-extras.ts).
  calendarEventsAdded?: number
  classesCancelled?: number
  // New suggestions from announcements, waiting on the Dashboard.
  suggestions?: number
}

// An item on a course's calendar in the LMS (not an assignment: those are read separately).
export type LmsCalendarItem = {
  provider: LmsProviderId
  externalId: string
  courseExternalId: string
  title: string
  description: string | null
  // Real instants (ISO 8601). Null start: unusable. Null end: a point in time.
  startsAt: string | null
  endsAt: string | null
  // All-day items carry their own date ("YYYY-MM-DD") instead of times.
  allDayDate: string | null
  location: string | null
  url: string | null
}

// A course announcement, as plain text (read once by the AI for quizzes, exams,
// deadlines and cancelled classes).
export type LmsAnnouncement = {
  provider: LmsProviderId
  externalId: string
  courseExternalId: string
  title: string
  text: string
  postedAt: string | null
}
