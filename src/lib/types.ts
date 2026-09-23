// Core data shapes. The mock data follows these today; the database will later.
// Dates are stored as "YYYY-MM-DD" strings and times as "HH:MM" (24h), the same
// shape a database date/time column and an <input type="date"> use.

export type CourseColor = "sky" | "emerald" | "violet" | "orange" | "rose"

// Learning management systems Student OS can import from.
export const lmsProviderIds = ["canvas", "blackboard"] as const
export type LmsProviderId = (typeof lmsProviderIds)[number]
export const lmsProviderNames: Record<LmsProviderId, string> = { canvas: "Canvas", blackboard: "Blackboard" }

// Set on courses and tasks imported from an LMS. The record is otherwise a
// normal course or task: the Dashboard, Tasks and Planner treat it the same.
export type ExternalSource = {
  provider: LmsProviderId
  // The LMS's own id for it.
  externalId: string
  // Link back to it in the LMS.
  url?: string
  // Tasks only: where the student stands in the LMS, as of the last sync.
  submissionStatus?: "not_submitted" | "submitted" | "graded" | "unknown"
}

export type Course = {
  id: string
  code: string
  name: string
  // Empty when unknown (e.g. a syllabus that doesn't name the professor).
  professor: string
  description: string
  color: CourseColor
  // Only on courses imported from an LMS.
  source?: ExternalSource
}

export type CourseInput = Omit<Course, "id" | "color" | "source">

export type Priority = "low" | "medium" | "high" | "critical"

export type TaskStatus = "not_started" | "in_progress" | "completed"

// "study" tasks are prep work (e.g. reviewing for a quiz), not graded deliverables.
export type TaskType =
  | "assignment"
  | "exam"
  | "quiz"
  | "project"
  | "paper"
  | "reading"
  | "lab"
  | "presentation"
  | "study"
  | "other"

export type Task = {
  id: string
  courseId: string
  title: string
  description: string
  type: TaskType
  dueDate: string
  dueTime?: string
  priority: Priority
  // Null when unknown (e.g. Canvas doesn't give one); the Planner uses a fallback.
  estimateMinutes: number | null
  status: TaskStatus
  // The day the student plans to work on it. Set by hand in the mock data for now;
  // the planner will fill this in later.
  plannedDate?: string
  // The student's own notes (imported tasks keep the LMS's description separately).
  notes?: string
  // Only on tasks imported from an LMS.
  source?: ExternalSource
}

// What the create/edit form produces.
export type TaskInput = Omit<Task, "id" | "source">

// Something that occupies time on the calendar. Events are single-day: they
// start and end on `date`. (Tasks are different: things to get done, with a due date.)
export type EventType = "class" | "sports" | "work" | "personal" | "study"

export type CalendarEvent = {
  id: string
  title: string
  date: string
  startTime: string
  endTime: string
  type: EventType
  description?: string
  // Optional link: a class belongs to a course.
  courseId?: string
  // Set only on calendar items that show a study session or a weekly commitment
  // (see src/lib/calendar-items.ts). Those aren't stored as events.
  sessionId?: string
  commitmentId?: string
  taskId?: string
  completed?: boolean
}

export type EventInput = Omit<CalendarEvent, "id" | "sessionId" | "commitmentId" | "taskId" | "completed">

// Time set aside to work on a task, stored when the student accepts, completes or
// skips a Planner suggestion. skipped = removed from that day's plan.
export type StudySessionStatus = "scheduled" | "completed" | "skipped"

export type StudySessionRecord = {
  id: string
  taskId: string
  date: string
  startTime: string
  endTime: string
  status: StudySessionStatus
}

// The signed-in student's profile.
export const academicYears = ["freshman", "sophomore", "junior", "senior", "graduate", "other"] as const
export type AcademicYear = (typeof academicYears)[number]

export type Student = {
  firstName: string
  lastName: string
  // e.g. "Fall 2026"
  academicTerm: string
  // Year in school; null when not set.
  academicYear: AcademicYear | null
  onboardingCompleted: boolean
}

export type ProfileInput = Omit<Student, "onboardingCompleted">

// How the student likes to study. Defaults live in src/lib/preferences.ts.
export type StudentPreferences = {
  // Planning window, "HH:MM".
  studyStart: string
  studyEnd: string
  maxStudyMinutesPerDay: number
  // 30, 45, 60 or 90.
  preferredBlockMinutes: number
  // Rest between study blocks (0 = no break).
  breakMinutes: number
}

// Something the student does every week at the same time (practice, work, a
// class). Stored once as a rule, not as individual events; the occurrences are
// worked out when needed (src/lib/recurring.ts). 0 = Sunday … 6 = Saturday.
export type RecurringCommitment = {
  id: string
  title: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  type: EventType
  description?: string
  // Optional first and last day (inclusive); unset = no limit.
  startDate?: string
  endDate?: string
}

export type RecurringCommitmentInput = Omit<RecurringCommitment, "id">
