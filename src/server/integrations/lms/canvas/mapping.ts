import "server-only"

import { z } from "zod"
import { toDateKey } from "@/lib/format"
import type { LmsAssignment, LmsCourse, LmsSubmissionStatus } from "@/lib/lms/types"
import { dateFromWallClock, wallClockIn } from "@/lib/time-zone"
import type { TaskType } from "@/lib/types"

// Canvas API objects -> Student OS's normalized LMS types. Only the fields
// Student OS uses are read (per the Canvas Courses and Assignments API docs),
// each one checked. Anything malformed is left out rather than guessed; nothing
// Canvas doesn't provide (estimates, priority, due dates) is invented.

const id = z.union([z.number(), z.string().min(1)]).transform(String)

const canvasCourse = z.object({
  id,
  name: z.string().nullish(),
  course_code: z.string().nullish(),
  workflow_state: z.string().nullish(),
  access_restricted_by_date: z.boolean().nullish(),
  public_description: z.string().nullish(),
  teachers: z.array(z.object({ display_name: z.string().nullish() }).passthrough()).nullish(),
})

const canvasAssignment = z.object({
  id,
  course_id: id.nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  due_at: z.string().nullish(),
  html_url: z.string().nullish(),
  submission_types: z.array(z.string()).nullish(),
  is_quiz_assignment: z.boolean().nullish(),
  quiz_id: id.nullish(),
  published: z.boolean().nullish(),
  submission: z.object({ workflow_state: z.string().nullish() }).passthrough().nullish(),
})

// HTML fragment (Canvas descriptions) -> plain text.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

// Canvas timestamps are ISO 8601 in UTC -> the student's local date and time.
// Without a known time zone, the server's is used.
export function canvasDueToLocal(dueAt: string, timeZone: string | undefined): { dueDate: string; dueTime: string } | null {
  const instant = new Date(dueAt)
  if (Number.isNaN(instant.getTime())) return null
  const local = dateFromWallClock(wallClockIn(timeZone, instant))
  const hh = String(local.getHours()).padStart(2, "0")
  const mm = String(local.getMinutes()).padStart(2, "0")
  return { dueDate: toDateKey(local), dueTime: `${hh}:${mm}` }
}

// Only links to the student's own Canvas are kept ("Open in Canvas").
export function safeCanvasUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.origin === baseUrl && parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
}

// Courses the student can actually use: not deleted, not hidden by date.
export function canvasCourseToLms(raw: unknown): LmsCourse | null {
  const parsed = canvasCourse.safeParse(raw)
  if (!parsed.success) return null
  const course = parsed.data
  if (course.access_restricted_by_date) return null
  if (course.workflow_state === "deleted") return null
  const name = course.name?.trim() || course.course_code?.trim()
  if (!name) return null
  return {
    provider: "canvas",
    externalId: course.id,
    courseCode: course.course_code?.trim() || null,
    courseName: name,
    description: course.public_description ? htmlToText(course.public_description) || null : null,
    instructor: course.teachers?.map((t) => t.display_name?.trim()).find(Boolean) ?? null,
    // The Courses API doesn't return a course link, so none is made up.
    url: null,
  }
}

function typeOf(assignment: z.infer<typeof canvasAssignment>): TaskType {
  if (assignment.is_quiz_assignment || assignment.quiz_id || assignment.submission_types?.includes("online_quiz")) return "quiz"
  if (assignment.submission_types?.includes("discussion_topic")) return "other"
  return "assignment"
}

function submissionStatusOf(state: string | null | undefined): LmsSubmissionStatus {
  if (state === "graded") return "graded"
  if (state === "submitted" || state === "pending_review") return "submitted"
  if (state === "unsubmitted") return "not_submitted"
  return "unknown"
}

export function canvasAssignmentToLms(
  raw: unknown,
  courseExternalId: string,
  context: { baseUrl: string; timeZone: string | undefined }
): LmsAssignment | null {
  const parsed = canvasAssignment.safeParse(raw)
  if (!parsed.success) return null
  const assignment = parsed.data
  if (assignment.published === false) return null
  const title = assignment.name?.trim()
  if (!title) return null
  // No due date in Canvas stays no due date (the sync reports it as skipped).
  const due = assignment.due_at ? canvasDueToLocal(assignment.due_at, context.timeZone) : null
  return {
    provider: "canvas",
    externalId: assignment.id,
    courseExternalId,
    title,
    description: assignment.description ? htmlToText(assignment.description) || null : null,
    dueDate: due?.dueDate ?? null,
    dueTime: due?.dueTime ?? null,
    type: typeOf(assignment),
    url: safeCanvasUrl(assignment.html_url, context.baseUrl),
    estimatedMinutes: null,
    submissionStatus: submissionStatusOf(assignment.submission?.workflow_state),
  }
}
