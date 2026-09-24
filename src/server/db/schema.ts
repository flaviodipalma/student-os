import { sql } from "drizzle-orm"
import {
  check,
  date,
  foreignKey,
  index,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { authUsers } from "drizzle-orm/supabase"

// The Student OS database. Every user-owned table has a user_id, and every query
// in src/server/services filters by it. Row Level Security is enabled on all
// tables with no policies, so Supabase's public API can't read them at all;
// only the server (DATABASE_URL) can.
//
// Dates are the student's local calendar dates ("YYYY-MM-DD") and times are
// wall-clock times ("HH:MM"), matching how the app shows them.

// Keep these enums in sync with the types in src/lib/types.ts.
export const courseColor = pgEnum("course_color", ["sky", "emerald", "violet", "orange", "rose"])
export const taskStatus = pgEnum("task_status", ["not_started", "in_progress", "completed"])
export const taskPriority = pgEnum("task_priority", ["low", "medium", "high", "critical"])
export const taskType = pgEnum("task_type", [
  "assignment",
  "exam",
  "quiz",
  "project",
  "paper",
  "reading",
  "lab",
  "presentation",
  "study",
  "other",
])
export const eventType = pgEnum("event_type", ["class", "sports", "work", "personal", "study"])
export const studySessionStatus = pgEnum("study_session_status", ["scheduled", "completed", "skipped"])
// Learning management systems Student OS can import from (see src/server/integrations/lms).
export const lmsProvider = pgEnum("lms_provider", ["canvas", "blackboard"])
export const lmsConnectionStatus = pgEnum("lms_connection_status", ["connected", "needs_reauth", "error"])
// How Student OS reads the LMS: OAuth + API, or the student's private calendar feed link.
// Where an external calendar event comes from: an LMS calendar feed or a personal calendar.
export const externalCalendarSource = pgEnum("external_calendar_source", ["canvas", "blackboard", "google", "outlook"])
export const calendarProvider = pgEnum("calendar_provider", ["google", "outlook"])
export const lmsConnectionMethod = pgEnum("lms_connection_method", ["oauth", "calendar_feed"])
export const notificationType = pgEnum("notification_type", [
  "task_due_soon",
  "task_overdue",
  "important_deadline",
  "study_session_upcoming",
  "study_session_missed",
  "event_upcoming",
  "daily_plan_ready",
])
export const feedbackKind = pgEnum("feedback_kind", ["bug", "confusing", "idea", "other"])
export const themePreference = pgEnum("theme_preference", ["light", "dark", "system"])
export const academicYear = pgEnum("academic_year", ["freshman", "sophomore", "junior", "senior", "graduate", "other"])

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

// Imported records remember their source, so a later sync recognises them
// (see src/lib/lms/sync-plan.ts):
//   external_source  which LMS ("canvas" | "blackboard")
//   external_id      the LMS's id for it, only meaningful together with the source
//   external_url     link back to it in the LMS
//   external_synced  the values as last synced from the LMS. Comparing them with
//                    the current record shows what the student changed since.
const externalSourceColumns = {
  externalSource: lmsProvider("external_source"),
  externalId: text("external_id"),
  externalUrl: text("external_url"),
  externalSynced: jsonb("external_synced").$type<Record<string, string | number | null>>(),
  externalSyncedAt: timestamp("external_synced_at", { withTimezone: true }),
}

// The User model. Sign-in details (email, password) live in Supabase's auth.users;
// this is the app's own record for that user, with the same id.
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    // e.g. "Fall 2026"
    academicTerm: text("academic_term").notNull().default(""),
    academicYear: academicYear("academic_year"),
    // New students go through onboarding first; this flips when they finish it.
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check("profiles_first_name_length", sql`char_length(${t.firstName}) <= 80`),
    check("profiles_last_name_length", sql`char_length(${t.lastName}) <= 80`),
    check("profiles_academic_term_length", sql`char_length(${t.academicTerm}) <= 60`),
  ]
).enableRLS()

// How the student likes to study (one row per student). Students without a row
// use the defaults in src/lib/preferences.ts.
export const studentPreferences = pgTable(
  "student_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    studyStart: time("study_start").notNull(),
    studyEnd: time("study_end").notNull(),
    maxStudyMinutesPerDay: integer("max_study_minutes_per_day").notNull(),
    preferredBlockMinutes: integer("preferred_block_minutes").notNull(),
    breakMinutes: integer("break_minutes").notNull(),
    // Notification preferences (see src/lib/notifications). Defaults: on, 30 min ahead.
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    remindTasks: boolean("remind_tasks").notNull().default(true),
    remindStudySessions: boolean("remind_study_sessions").notNull().default(true),
    remindEvents: boolean("remind_events").notNull().default(true),
    remindOverdue: boolean("remind_overdue").notNull().default(true),
    remindDailyPlan: boolean("remind_daily_plan").notNull().default(true),
    reminderMinutes: integer("reminder_minutes").notNull().default(30),
    browserNotifications: boolean("browser_notifications").notNull().default(false),
    // Appearance: Light / Dark / System. Null = never chosen (the device's cookie decides).
    theme: themePreference("theme"),
    // Adaptive planning: learn from the student's own history (on by default).
    // Only history on or after `adaptive_since` counts (set by "Reset learning").
    adaptivePlanning: boolean("adaptive_planning").notNull().default(true),
    adaptiveSince: date("adaptive_since"),
    ...timestamps,
  },
  (t) => [
    check("student_preferences_window", sql`${t.studyEnd} > ${t.studyStart}`),
    check("student_preferences_reminder_minutes", sql`${t.reminderMinutes} in (5, 15, 30, 60, 1440)`),
    check("student_preferences_max_study", sql`${t.maxStudyMinutesPerDay} between 15 and 720`),
    check("student_preferences_block", sql`${t.preferredBlockMinutes} in (30, 45, 60, 90)`),
    check("student_preferences_break", sql`${t.breakMinutes} between 0 and 60`),
  ]
).enableRLS()

// Something the student does every week at the same time. Stored once as a rule;
// the Planner, Calendar and Dashboard work out the individual occurrences when
// needed (src/lib/recurring.ts), so no per-week rows are ever stored.
export const recurringCommitments = pgTable(
  "recurring_commitments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // 0 = Sunday ... 6 = Saturday
    daysOfWeek: smallint("days_of_week").array().notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    type: eventType("type").notNull(),
    description: text("description"),
    // Optional first and last day it happens (inclusive). Null = no limit.
    startDate: date("start_date"),
    endDate: date("end_date"),
    ...timestamps,
  },
  (t) => [
    index("recurring_commitments_user_id_idx").on(t.userId),
    check("recurring_commitments_dates", sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`),
    check("recurring_commitments_description_length", sql`char_length(${t.description}) <= 500`),
    check("recurring_commitments_end_after_start", sql`${t.endTime} > ${t.startTime}`),
    check("recurring_commitments_title_length", sql`char_length(btrim(${t.title})) between 1 and 100`),
    check(
      "recurring_commitments_days",
      sql`cardinality(${t.daysOfWeek}) between 1 and 7 and ${t.daysOfWeek} <@ array[0,1,2,3,4,5,6]::smallint[]`
    ),
  ]
).enableRLS()

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    courseCode: text("course_code").notNull(),
    courseName: text("course_name").notNull(),
    professor: text("professor").notNull().default(""),
    description: text("description").notNull().default(""),
    color: courseColor("color").notNull(),
    // Where the course was imported from (null = added by the student or from a syllabus).
    ...externalSourceColumns,
    ...timestamps,
  },
  (t) => [
    index("courses_user_id_idx").on(t.userId),
    // One Student OS course per LMS course, per student.
    unique("courses_user_external_key").on(t.userId, t.externalSource, t.externalId),
    check("courses_external_pair", sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
    // Lets tasks reference (course, owner) so a task can't point at another user's course.
    unique("courses_id_user_id_key").on(t.id, t.userId),
    unique("courses_user_id_course_code_key").on(t.userId, t.courseCode),
    check("courses_code_length", sql`char_length(btrim(${t.courseCode})) between 1 and 30`),
    check("courses_name_length", sql`char_length(btrim(${t.courseName})) between 1 and 150`),
  ]
).enableRLS()

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    type: taskType("type").notNull().default("assignment"),
    dueDate: date("due_date").notNull(),
    dueTime: time("due_time"),
    priority: taskPriority("priority").notNull().default("medium"),
    // Null = not estimated (e.g. imported from an LMS that doesn't say); the Planner then
    // uses a fallback length and asks the student to add one.
    estimatedMinutes: integer("estimated_minutes"),
    // The student's own notes. Never synced from or to an LMS (unlike description).
    notes: text("notes").notNull().default(""),
    status: taskStatus("status").notNull().default("not_started"),
    plannedDate: date("planned_date"),
    // Where the task was imported from (null = added by the student or from a syllabus).
    ...externalSourceColumns,
    ...timestamps,
  },
  (t) => [
    index("tasks_user_id_due_date_idx").on(t.userId, t.dueDate),
    // One Student OS task per LMS assignment, per student.
    unique("tasks_user_external_key").on(t.userId, t.externalSource, t.externalId),
    check("tasks_external_pair", sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
    index("tasks_course_id_idx").on(t.courseId),
    unique("tasks_id_user_id_key").on(t.id, t.userId),
    // The course must belong to the same user. Deleting a course deletes its tasks.
    foreignKey({
      name: "tasks_course_owner_fk",
      columns: [t.courseId, t.userId],
      foreignColumns: [courses.id, courses.userId],
    }).onDelete("cascade"),
    check("tasks_title_length", sql`char_length(btrim(${t.title})) between 1 and 200`),
    check("tasks_estimated_minutes_range", sql`${t.estimatedMinutes} between 1 and 10000`),
  ]
).enableRLS()

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    type: eventType("type").notNull(),
    description: text("description"),
    // Optional link to a course (ownership is checked by the service layer).
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("events_user_id_date_idx").on(t.userId, t.date),
    check("events_end_after_start", sql`${t.endTime} > ${t.startTime}`),
    check("events_title_length", sql`char_length(btrim(${t.title})) between 1 and 200`),
  ]
).enableRLS()

// A block of time for working on a task, created when the student accepts (or
// completes, or skips) a Planner suggestion.
export const studySessions = pgTable(
  "study_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    // skipped = the student removed this task from that day's plan.
    status: studySessionStatus("status").notNull().default("scheduled"),
    // Minutes actually worked, for a session done only partly ("45 of 90 minutes").
    // Null = the whole session. Only meaningful when completed.
    completedMinutes: integer("completed_minutes"),
    // Adaptive planning (src/lib/adaptive): how often the session was moved, and
    // where it was first planned (null = never moved). Nothing else is recorded.
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    firstDate: date("first_date"),
    firstStartTime: time("first_start_time"),
    ...timestamps,
  },
  (t) => [
    index("study_sessions_user_id_date_idx").on(t.userId, t.date),
    index("study_sessions_task_id_idx").on(t.taskId),
    // The task must belong to the same user. Deleting a task deletes its sessions.
    foreignKey({
      name: "study_sessions_task_owner_fk",
      columns: [t.taskId, t.userId],
      foreignColumns: [tasks.id, tasks.userId],
    }).onDelete("cascade"),
    check("study_sessions_end_after_start", sql`${t.endTime} > ${t.startTime}`),
    check("study_sessions_completed_minutes", sql`${t.completedMinutes} between 1 and 720`),
  ]
).enableRLS()

// A record that a syllabus was imported. Only metadata: the PDF and its text are
// never stored.
export const syllabusImports = pgTable(
  "syllabus_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    itemsFound: integer("items_found").notNull(),
    itemsImported: integer("items_imported").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("syllabus_imports_user_id_idx").on(t.userId)]
).enableRLS()

// A student's connection to a learning management system (one per provider).
// Access and refresh tokens are stored ENCRYPTED (AES-256-GCM, see
// src/server/integrations/lms/credential-vault.ts), never in plain text, and
// never leave the server. Disconnecting deletes the row; imported courses and
// tasks stay, as normal Student OS data.
export const lmsConnections = pgTable(
  "lms_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    provider: lmsProvider("provider").notNull(),
    method: lmsConnectionMethod("method").notNull().default("oauth"),
    // The student's id in the LMS, if the provider reports one.
    externalUserId: text("external_user_id"),
    // Institution-specific LMS address (Canvas and Blackboard are hosted per school).
    baseUrl: text("base_url"),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    // Calendar-feed connections: the student's private feed link, ENCRYPTED like a token
    // (anyone with the link can read their calendar).
    feedUrlEncrypted: text("feed_url_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: lmsConnectionStatus("status").notNull().default("connected"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // A safe, student-facing message about the last failed sync (never provider internals).
    lastSyncError: text("last_sync_error"),
    ...timestamps,
  },
  (t) => [unique("lms_connections_user_provider_key").on(t.userId, t.provider)]
).enableRLS()

// A student's connection to a personal calendar (Google Calendar, Outlook), one
// per provider. Separate from login: signing in with Google or Microsoft never
// creates one; the student connects a calendar in Settings > Integrations.
// Tokens are ENCRYPTED with the same credential vault as LMS tokens and never
// leave the server. Disconnecting deletes the row (and its tokens); the
// calendar's events are marked removed.
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    provider: calendarProvider("provider").notNull(),
    // The calendar account's own id and address (shown as "Connected as ...").
    externalAccountId: text("external_account_id"),
    accountEmail: text("account_email"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    // The permissions the student granted (space-separated), e.g. read-only calendar.
    scopes: text("scopes"),
    status: lmsConnectionStatus("status").notNull().default("connected"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // A safe, student-facing message about the last failed sync (never provider internals).
    lastSyncError: text("last_sync_error"),
    ...timestamps,
  },
  (t) => [unique("calendar_connections_user_provider_key").on(t.userId, t.provider)]
).enableRLS()

// Events copied from a student's external calendar (Canvas, Blackboard, Google
// Calendar, Outlook). Read-only
// copies: Student OS never changes the original. One row per (student, source,
// external id), so re-syncing never duplicates, and Canvas "123" and Blackboard
// "123" are different rows. Times are real instants (timestamptz); they're shown
// in the student's time zone. See src/lib/calendar/external-events.ts.
export const externalCalendarEvents = pgTable(
  "external_calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    source: externalCalendarSource("source").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location"),
    url: text("url"),
    // The student hid it from Student OS (kept hidden through later syncs).
    hidden: boolean("hidden").notNull().default(false),
    // When it disappeared from the provider (not shown; comes back if it reappears).
    removedAt: timestamp("removed_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("external_calendar_events_user_source_key").on(t.userId, t.source, t.externalId),
    index("external_calendar_events_user_starts_idx").on(t.userId, t.startsAt),
    check("external_calendar_events_end_after_start", sql`${t.endsAt} > ${t.startsAt}`),
    check("external_calendar_events_title_length", sql`char_length(btrim(${t.title})) between 1 and 200`),
  ]
).enableRLS()

// Reminders delivered to a student (see src/lib/notifications). A row is created
// only when a reminder is due, once: (user, dedupe_key) is unique, so page loads,
// syncs and re-plans can't create it twice, and a dismissed one never comes back.
// Deleting the related task or study session deletes its reminders.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    // Stable identity of the reminder, e.g. "task_due_soon:<task>:<due instant>:<minutes>".
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    // In-app path (e.g. /tasks?task=<id>); never an external URL.
    link: text("link").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    relatedTaskId: uuid("related_task_id"),
    relatedStudySessionId: uuid("related_study_session_id").references(() => studySessions.id, { onDelete: "cascade" }),
    // A calendar item reference: "event:<id>", "commitment:<id>" or "external:<id>".
    relatedEventId: text("related_event_id"),
    ...timestamps,
  },
  (t) => [
    unique("notifications_user_dedupe_key").on(t.userId, t.dedupeKey),
    index("notifications_user_scheduled_idx").on(t.userId, t.scheduledFor),
    // Deleting a task or study session removes its reminders (foreign keys): these
    // keep that from scanning every reminder.
    index("notifications_related_task_idx").on(t.relatedTaskId),
    index("notifications_related_session_idx").on(t.relatedStudySessionId),
    // The related task must be the same student's.
    foreignKey({
      name: "notifications_task_owner_fk",
      columns: [t.relatedTaskId, t.userId],
      foreignColumns: [tasks.id, tasks.userId],
    }).onDelete("cascade"),
    check("notifications_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check("notifications_message_length", sql`char_length(${t.message}) between 1 and 500`),
    check("notifications_link_internal", sql`${t.link} like '/%' and ${t.link} not like '//%'`),
  ]
).enableRLS()

// Beta feedback ("Send feedback" in the navigation). Only the student's own
// words, the kind, and the page they were on (a path, no query string). Read by
// the team in the Supabase dashboard; the app never shows it to anyone else.
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: feedbackKind("kind").notNull(),
    message: text("message").notNull(),
    page: text("page"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("feedback_created_idx").on(t.createdAt),
    check("feedback_message_length", sql`char_length(btrim(${t.message})) between 1 and 2000`),
    check("feedback_page_path", sql`${t.page} is null or (${t.page} like '/%' and char_length(${t.page}) <= 200)`),
  ]
).enableRLS()
