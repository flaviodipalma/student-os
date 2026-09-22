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
  // Optional links. A class belongs to a course; a study session can be for a
  // specific task (that's how accepted Planner sessions are stored).
  courseId?: string
  taskId?: string
  // Study sessions only: the student marked this session as done.
  completed?: boolean
}

export type EventInput = Omit<CalendarEvent, "id">

export type Student = {
  firstName: string
}
