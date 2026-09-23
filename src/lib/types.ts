// Core data shapes. The mock data follows these today; the database will later.
// Dates are stored as "YYYY-MM-DD" strings and times as "HH:MM" (24h), the same
// shape a database date/time column and an <input type="date"> use.

export type CourseColor = "sky" | "emerald" | "violet" | "orange" | "rose"

export type Course = {
  id: string
  code: string
  name: string
  // Empty when unknown (e.g. a syllabus that doesn't name the professor).
  professor: string
  description: string
  color: CourseColor
}

export type CourseInput = Omit<Course, "id" | "color">

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
  estimateMinutes: number
  status: TaskStatus
  // The day the student plans to work on it. Set by hand in the mock data for now;
  // the planner will fill this in later.
  plannedDate?: string
}

// What the create/edit form produces.
export type TaskInput = Omit<Task, "id">

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

// Something the student does every week at the same time (practice, work, a club).
// Stored once as a rule, not as individual events. 0 = Sunday … 6 = Saturday.
export type RecurringCommitment = {
  id: string
  title: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  type: EventType
}

export type RecurringCommitmentInput = Omit<RecurringCommitment, "id">
