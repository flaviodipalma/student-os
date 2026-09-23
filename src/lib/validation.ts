import { z } from "zod"
import { fromDateKey, toDateKey } from "@/lib/format"

// Input rules for everything the app saves. The server checks every request
// against these (the database has matching constraints as a second line).

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
  .refine((value) => toDateKey(fromDateKey(value)) === value, "Use a valid date.")
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time.")
const id = z.uuid("Invalid id.")

const priority = z.enum(["low", "medium", "high", "critical"])
const taskStatus = z.enum(["not_started", "in_progress", "completed"])
const taskType = z.enum([
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
const eventType = z.enum(["class", "sports", "work", "personal", "study"])
const sessionStatus = z.enum(["scheduled", "completed", "skipped"])

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

// ---- Courses

export const courseFields = z.object({
  code: z.string().trim().min(1, "Add a course code.").max(30, "Course codes are at most 30 characters."),
  name: z.string().trim().min(1, "Add a course name.").max(150, "Course names are at most 150 characters."),
  professor: z.string().trim().max(120).default(""),
  description: z.string().trim().max(600).default(""),
})
export const createCourseSchema = courseFields.extend({ id })
export const updateCourseSchema = courseFields.partial()

// ---- Tasks

export const taskFields = z.object({
  courseId: id,
  title: z.string().trim().min(1, "Give the task a title.").max(200, "Titles are at most 200 characters."),
  description: z.string().trim().max(2000).default(""),
  type: taskType,
  dueDate: dateKey,
  dueTime: timeOfDay.optional(),
  priority,
  // Optional: null = not estimated yet.
  estimateMinutes: z
    .int("Estimated duration must be a whole number of minutes.")
    .min(1, "Estimated duration must be at least 1 minute.")
    .max(10000, "That's more than 10,000 minutes. Split it into smaller tasks.")
    .nullable(),
  notes: z.string().trim().max(2000, "Keep notes under 2,000 characters.").optional(),
  status: taskStatus,
  plannedDate: dateKey.optional(),
})
export const createTaskSchema = taskFields.extend({ id })
// One task as entered in the form (no id yet).
export const taskInputSchema = taskFields
// null clears an optional field.
export const updateTaskSchema = taskFields
  .extend({ dueTime: timeOfDay.nullable().optional(), plannedDate: dateKey.nullable().optional() })
  .partial()

// ---- Events

export const eventFields = z.object({
  title: z.string().trim().min(1, "Give the event a title.").max(200),
  date: dateKey,
  startTime: timeOfDay,
  endTime: timeOfDay,
  type: eventType,
  description: z.string().trim().max(2000).optional(),
  courseId: id.optional(),
})
const endAfterStart = (value: { startTime?: string; endTime?: string }) =>
  !value.startTime || !value.endTime || minutesOf(value.endTime) > minutesOf(value.startTime)
const endAfterStartIssue = { message: "End time must be after the start time.", path: ["endTime"] }

export const createEventSchema = eventFields.extend({ id }).refine(endAfterStart, endAfterStartIssue)
// One event as entered in the form (no id yet).
export const eventInputSchema = eventFields.refine(endAfterStart, endAfterStartIssue)
export const updateEventSchema = eventFields
  .extend({ description: z.string().trim().max(2000).nullable().optional(), courseId: id.nullable().optional() })
  .partial()
  .refine(endAfterStart, endAfterStartIssue)

// ---- Study sessions

const sessionFields = z.object({
  taskId: id,
  date: dateKey,
  startTime: timeOfDay,
  endTime: timeOfDay,
  status: sessionStatus,
})
export const createSessionSchema = sessionFields.extend({ id }).refine(endAfterStart, endAfterStartIssue)
export const updateSessionSchema = sessionFields
  .omit({ taskId: true })
  .partial()
  .refine(endAfterStart, endAfterStartIssue)

export { id as idSchema, dateKey as dateKeySchema }

// The first problem, as a sentence for the student.
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Some of the details aren't valid."
}

// ---- Profile, preferences and weekly commitments (onboarding and Settings)

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, "Add your first name.").max(80, "That name is too long."),
  lastName: z.string().trim().max(80, "That name is too long.").default(""),
  academicTerm: z.string().trim().max(60, "Keep the term short, e.g. Fall 2026.").default(""),
  academicYear: z.enum(["freshman", "sophomore", "junior", "senior", "graduate", "other"]).nullable().default(null),
})

export const preferencesSchema = z
  .object({
    studyStart: timeOfDay,
    studyEnd: timeOfDay,
    maxStudyMinutesPerDay: z
      .int("Use whole minutes.")
      .min(15, "Plan at least 15 minutes of study a day.")
      .max(720, "That's more than 12 hours of study a day."),
    preferredBlockMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)], {
      error: "Pick a study block length of 30, 45, 60 or 90 minutes.",
    }),
    breakMinutes: z.int().min(0).max(60, "Breaks can be at most 60 minutes."),
  })
  .refine((p) => minutesOf(p.studyEnd) > minutesOf(p.studyStart), {
    message: "Your study window must end after it starts.",
    path: ["studyEnd"],
  })
  .refine((p) => minutesOf(p.studyEnd) - minutesOf(p.studyStart) >= 60, {
    message: "Make your study window at least an hour long.",
    path: ["studyEnd"],
  })

export const commitmentFields = z.object({
  title: z.string().trim().min(1, "Give the commitment a name.").max(100, "Keep the name under 100 characters."),
  daysOfWeek: z
    .array(z.int().min(0).max(6), { error: "Pick at least one day." })
    .min(1, "Pick at least one day.")
    .max(7)
    .refine((days) => new Set(days).size === days.length, "Each day can only be picked once."),
  startTime: timeOfDay,
  endTime: timeOfDay,
  type: eventType,
  description: z.string().trim().max(500, "Keep the description under 500 characters.").optional(),
  startDate: dateKey.optional(),
  endDate: dateKey.optional(),
})
const datesInOrder = (value: { startDate?: string | null; endDate?: string | null }) =>
  !value.startDate || !value.endDate || value.endDate >= value.startDate
const datesInOrderIssue = { message: "The end date can't be before the start date.", path: ["endDate"] }

export const createCommitmentSchema = commitmentFields
  .extend({ id })
  .refine(endAfterStart, endAfterStartIssue)
  .refine(datesInOrder, datesInOrderIssue)
// null clears an optional field.
export const updateCommitmentSchema = commitmentFields
  .extend({
    description: z.string().trim().max(500, "Keep the description under 500 characters.").nullable().optional(),
    startDate: dateKey.nullable().optional(),
    endDate: dateKey.nullable().optional(),
  })
  .partial()
  .refine(endAfterStart, endAfterStartIssue)
  .refine(datesInOrder, datesInOrderIssue)

// Everything collected in onboarding steps 1-3, saved together.
export const onboardingDetailsSchema = z.object({
  profile: profileSchema,
  preferences: preferencesSchema,
  commitments: z
    .array(commitmentFields.refine(endAfterStart, endAfterStartIssue).refine(datesInOrder, datesInOrderIssue))
    .max(30),
})

// One weekly commitment as entered in a form (no id yet).
export const commitmentInputSchema = commitmentFields
  .refine(endAfterStart, endAfterStartIssue)
  .refine(datesInOrder, datesInOrderIssue)
