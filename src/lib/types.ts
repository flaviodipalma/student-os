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
// "other" is only for events from an external calendar whose kind isn't known
// (students pick one of the five types for their own events).
export type NativeEventType = "class" | "sports" | "work" | "personal" | "study"
export type EventType = NativeEventType | "other"

// Where a calendar item comes from. Student OS items (events, weekly commitments,
// study sessions) are the student's own; the others are read-only copies from an
// external calendar.
// Personal calendars a student can connect (Integrations > Calendars).
// Separate from signing in: logging in with Google never connects Google Calendar.
export const calendarProviderIds = ["google", "outlook"] as const
export type CalendarProviderId = (typeof calendarProviderIds)[number]
export const calendarProviderNames: Record<CalendarProviderId, string> = { google: "Google Calendar", outlook: "Outlook" }

export const externalCalendarSources = [...lmsProviderIds, ...calendarProviderIds] as const
export type ExternalCalendarSource = (typeof externalCalendarSources)[number]
export type EventSource = "student_os" | ExternalCalendarSource

export const eventSourceNames: Record<EventSource, string> = { student_os: "Student OS", ...lmsProviderNames, ...calendarProviderNames }

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
  // Study sessions done only partly: the minutes actually worked.
  completedMinutes?: number
  // Unset = Student OS. External items (see src/lib/calendar/external-events.ts)
  // also carry their stored event's id, and a location and link when the source has them.
  source?: EventSource
  externalEventId?: string
  location?: string
  url?: string
}

export type EventInput = Omit<
  CalendarEvent,
  | "id"
  | "sessionId"
  | "commitmentId"
  | "taskId"
  | "completed"
  | "completedMinutes"
  | "source"
  | "externalEventId"
  | "location"
  | "url"
  | "type"
> & { type: NativeEventType }

// An event copied from an external calendar, as the app loads it. Instants are
// ISO 8601 (UTC); `hidden` = the student hid it from Student OS.
export type ExternalEventRecord = {
  id: string
  source: ExternalCalendarSource
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  location: string | null
  url: string | null
  hidden: boolean
}

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
  // Partly done: the minutes actually worked (unset/null = the whole session).
  completedMinutes?: number | null
  // Adaptive planning: times moved, and where it was first planned (null = never moved).
  rescheduleCount?: number
  firstDate?: string | null
  firstStartTime?: string | null
}

// Personalization settings (Settings > Personalization; docs/personalization.md).
// Explicit choices (mode, preferred times) are the student's own and always win
// over anything learned; learned signals can be switched off one by one.
export const planningModes = ["balanced", "deadline-focus", "exam-focus", "light-day", "custom"] as const
export type PlanningMode = (typeof planningModes)[number]
export const studyPeriods = ["morning", "afternoon", "evening", "night"] as const
export type StudyPeriod = (typeof studyPeriods)[number]

export type LearningSettings = {
  // Learn from my planning history at all.
  enabled: boolean
  // Only history on or after this date counts ("Reset learning"); null = all of it.
  since: string | null
  // Which learned signals the Planner may use.
  useEstimates: boolean
  useStudyTimes: boolean
  useWorkload: boolean
  // The student's planning mode ("custom" = only my own settings, nothing learned).
  planningMode: PlanningMode
  // Times the student says they prefer (explicit: overrides learned times).
  preferredPeriods: StudyPeriod[]
  // Learned patterns the student turned off ("Don't use this").
  dismissedPatterns: string[]
  // Tasks where the student's own estimate is always used ("This estimate is wrong").
  ownEstimateTaskIds: string[]
}
export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  enabled: true,
  since: null,
  useEstimates: true,
  useStudyTimes: true,
  useWorkload: true,
  planningMode: "balanced",
  preferredPeriods: [],
  dismissedPatterns: [],
  ownEstimateTaskIds: [],
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
  type: NativeEventType
  description?: string
  // Optional first and last day (inclusive); unset = no limit.
  startDate?: string
  endDate?: string
}

export type RecurringCommitmentInput = Omit<RecurringCommitment, "id">

// ---- Notifications & reminders (see src/lib/notifications/README.md) ----------------

// Stored in the database as these values (TASK_DUE_SOON = "task_due_soon", ...).
// New kinds are added here and to the notification_type enum.
export const notificationTypes = [
  "task_due_soon",
  "task_overdue",
  "important_deadline",
  "study_session_upcoming",
  "study_session_missed",
  "event_upcoming",
  "daily_plan_ready",
] as const
export type NotificationType = (typeof notificationTypes)[number]

// How long before a due time / start time reminders come (minutes).
export const reminderMinuteOptions = [5, 15, 30, 60, 1440] as const

// Part of the student's preferences (same table and service as study preferences).
export type NotificationPreferences = {
  // Master switch: off = no reminders of any kind.
  enabled: boolean
  taskReminders: boolean
  studySessionReminders: boolean
  eventReminders: boolean
  overdueReminders: boolean
  dailyPlanReminder: boolean
  // One of reminderMinuteOptions.
  reminderMinutes: number
  // Also show new reminders as desktop notifications (needs the browser's permission).
  browserNotifications: boolean
}

// A reminder as the app shows it. Times are ISO 8601 instants.
export type AppNotification = {
  id: string
  type: NotificationType
  title: string
  message: string
  // In-app path to open (a task, the Planner day, the Calendar day).
  link: string
  scheduledFor: string
  createdAt: string
  readAt: string | null
  relatedTaskId: string | null
  relatedStudySessionId: string | null
  // A calendar item: "event:<id>", "commitment:<id>" or "external:<id>".
  relatedEventId: string | null
}
