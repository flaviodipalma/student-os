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
  estimateMinutes: z.int("Duration must be whole minutes.").min(1).max(10000),
  status: taskStatus,
  plannedDate: dateKey.optional(),
})
export const createTaskSchema = taskFields.extend({ id })
// null clears an optional field.
export const updateTaskSchema = taskFields
  .extend({ dueTime: timeOfDay.nullable().optional(), plannedDate: dateKey.nullable().optional() })
  .partial()

// ---- Events

const eventFields = z.object({
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
