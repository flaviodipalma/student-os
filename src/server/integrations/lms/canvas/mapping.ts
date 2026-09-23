import "server-only"

import { z } from "zod"
import type { LmsAssignment, LmsCourse, LmsSubmissionStatus } from "@/lib/lms/types"
import type { TaskType } from "@/lib/types"
import { sameOriginUrl } from "../base-url"
import { htmlToText, utcToLocalDue } from "../normalize"

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

// Canvas descriptions are HTML; timestamps are ISO 8601 in UTC (shared LMS helpers).
export { htmlToText }
export const canvasDueToLocal = utcToLocalDue

// Only links to the student's own Canvas are kept ("Open in Canvas").
export const safeCanvasUrl = sameOriginUrl

// A course's page on the student's Canvas: Canvas's standard /courses/<id> address
// on the already-validated Canvas host (the Courses API doesn't return a link).
export function canvasCourseUrl(baseUrl: string, courseId: string): string | null {
  return /^\d+$/.test(courseId) ? `${baseUrl}/courses/${courseId}` : null
}

// Courses the student can actually use: not deleted, not hidden by date.
export function canvasCourseToLms(raw: unknown, baseUrl?: string): LmsCourse | null {
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
    url: baseUrl ? canvasCourseUrl(baseUrl, course.id) : null,
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
