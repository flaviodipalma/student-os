import { sql } from "drizzle-orm"
import {
  check,
  date,
  foreignKey,
  index,
  boolean,
  integer,
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
export const academicYear = pgEnum("academic_year", ["freshman", "sophomore", "junior", "senior", "graduate", "other"])

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
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
    ...timestamps,
  },
  (t) => [
    check("student_preferences_window", sql`${t.studyEnd} > ${t.studyStart}`),
    check("student_preferences_max_study", sql`${t.maxStudyMinutesPerDay} between 15 and 720`),
    check("student_preferences_block", sql`${t.preferredBlockMinutes} in (30, 45, 60, 90)`),
    check("student_preferences_break", sql`${t.breakMinutes} between 0 and 60`),
  ]
).enableRLS()

// Something the student does every week at the same time. Stored once as a rule;
// the Planner and Calendar work out the individual occurrences when needed.
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
    ...timestamps,
  },
  (t) => [
    index("recurring_commitments_user_id_idx").on(t.userId),
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
    ...timestamps,
  },
  (t) => [
    index("courses_user_id_idx").on(t.userId),
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
    estimatedMinutes: integer("estimated_minutes").notNull(),
    status: taskStatus("status").notNull().default("not_started"),
    plannedDate: date("planned_date"),
    ...timestamps,
  },
  (t) => [
    index("tasks_user_id_due_date_idx").on(t.userId, t.dueDate),
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
