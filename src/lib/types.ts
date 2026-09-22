// Core data shapes. The mock data follows these today; the database will later.
// Dates are stored as "YYYY-MM-DD" strings and times as "HH:MM" (24h), the same
// shape a database date/time column and an <input type="date"> use.

export type CourseColor = "sky" | "emerald" | "violet" | "orange"

export type Course = {
  id: string
  code: string
  name: string
  professor: string
  description: string
  color: CourseColor
}

export type Priority = "low" | "medium" | "high" | "critical"

export type TaskStatus = "not_started" | "in_progress" | "completed"

// "study" tasks are prep work (e.g. reviewing for a quiz), not graded deliverables.
export type TaskType =
  | "assignment"
  | "exam"
  | "quiz"
  | "project"
  | "reading"
  | "lab"
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

// fixed = classes, practice, anything at a set time; study = planned work; free = open time.
export type ScheduleKind = "fixed" | "study" | "free"

export type ScheduleBlock = {
  id: string
  kind: ScheduleKind
  title: string
  start: Date
  end: Date
  category?: string
  location?: string
  courseId?: string
}

export type DayLoad = {
  date: string
  fixedHours: number
  studyHours: number
  freeHours: number
}

export type Student = {
  firstName: string
}
