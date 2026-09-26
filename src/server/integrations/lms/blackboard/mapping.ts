import "server-only"

import { z } from "zod"
import type { LmsAssignment, LmsCourse, LmsSubmissionStatus } from "@/lib/lms/types"
import type { TaskType } from "@/lib/types"
import { sameOriginUrl } from "../base-url"
import { htmlToText, termDates, utcToLocalDue } from "../normalize"

// Blackboard Learn API objects -> Student OS's normalized LMS types. Only the
// fields Student OS uses are read (per the Learn REST API spec), each one
// checked. Anything malformed is left out rather than guessed; nothing Learn
// doesn't provide (estimates, priority, due dates) is invented.
//
//   course membership (GET v1/users/{id}/courses?expand=course)  -> LmsCourse
//   grade column      (GET v2/courses/{id}/gradebook/columns)    -> LmsAssignment
//   the student's grades and attempts                           -> submissionStatus

const text = z.string().nullish()

// A membership with its course expanded.
const blackboardMembership = z.object({
  courseId: z.string().min(1),
  courseRoleId: text,
  availability: z.object({ available: text }).partial().nullish(),
  course: z
    .object({
      id: z.string().min(1),
      courseId: text,
      name: text,
      description: text,
      organization: z.boolean().nullish(),
      availability: z.object({ available: text }).partial().nullish(),
      externalAccessUrl: text,
      // Added by the Student OS extension from the course's term (v1/terms), when readable.
      term: z.object({ start_at: text, end_at: text }).partial().nullish(),
    })
    .nullish(),
})

const blackboardColumn = z.object({
  id: z.string().min(1),
  name: text,
  displayName: text,
  description: text,
  externalGrade: z.boolean().nullish(),
  contentId: text,
  scoreProviderHandle: text,
  availability: z.object({ available: text }).partial().nullish(),
  grading: z.object({ type: text, due: text }).partial().nullish(),
})

const blackboardGrade = z.object({
  columnId: z.string().min(1),
  score: z.number().nullish(),
  text: text,
})

const blackboardAttempt = z.object({ status: text })

// Courses Student OS imports: ones the student takes (course role "Student"),
// that are open to them. Organizations (clubs, departments), courses they
// teach or assist in, and unavailable courses are left out.
export function blackboardCourseToLms(raw: unknown, baseUrl: string, timeZone?: string): LmsCourse | null {
  const parsed = blackboardMembership.safeParse(raw)
  if (!parsed.success || !parsed.data.course) return null
  const membership = parsed.data
  const course = parsed.data.course
  if (membership.courseRoleId !== "Student") return null
  if (membership.availability?.available && membership.availability.available !== "Yes") return null
  if (course.organization) return null
  // "Term" means available during the course's term (Learn hides it outside it).
  const available = course.availability?.available
  if (available && available !== "Yes" && available !== "Term") return null
  const name = course.name?.trim() || course.courseId?.trim()
  if (!name) return null
  return {
    provider: "blackboard",
    externalId: course.id,
    courseCode: course.courseId?.trim() || null,
    courseName: name,
    description: course.description ? htmlToText(course.description) || null : null,
    // Instructors are a separate, per-course request that students often can't make.
    instructor: null,
    url: sameOriginUrl(course.externalAccessUrl, baseUrl),
    ...(termDates(course.term?.start_at, course.term?.end_at, timeZone) ?? {}),
  }
}

export type BlackboardColumn = z.infer<typeof blackboardColumn>

// Grade columns that are real work for the student: visible to them, and not a
// total, a calculated column (averages, weighted totals) or the external grade.
export function parseBlackboardColumn(raw: unknown): BlackboardColumn | null {
  const parsed = blackboardColumn.safeParse(raw)
  if (!parsed.success) return null
  const column = parsed.data
  if (column.externalGrade) return null
  if (column.grading?.type === "Calculated") return null
  if (column.availability?.available === "No") return null
  if (!(column.displayName?.trim() || column.name?.trim())) return null
  return column
}

// Only columns graded from attempts (assignments, tests) have attempts to check.
export const isAttemptColumn = (column: BlackboardColumn) => column.grading?.type === "Attempts"

function typeOf(column: BlackboardColumn): TaskType {
  const handle = column.scoreProviderHandle?.toLowerCase() ?? ""
  if (/test|quiz|survey/.test(handle)) return "quiz"
  if (/forum|discussion|blog|journal|wiki/.test(handle)) return "other"
  return "assignment"
}

// The student's own grades for a course -> column id -> "graded" when a grade
// has actually been given (a score or a text grade). Learn's grade "status"
// field is documented as unreliable, so it isn't used.
export function gradedColumns(rawGrades: unknown[]): Set<string> {
  const graded = new Set<string>()
  for (const raw of rawGrades) {
    const parsed = blackboardGrade.safeParse(raw)
    if (!parsed.success) continue
    const grade = parsed.data
    if (typeof grade.score === "number" || grade.text?.trim()) graded.add(grade.columnId)
  }
  return graded
}

// Attempt statuses that mean the student turned the work in (Learn API spec).
const TURNED_IN = new Set(["NeedsGrading", "NeedsGradingAgain", "Completed", "InProgressAgain"])

// The student's own attempts on one column -> submitted / not submitted.
// An unreadable list is "unknown", never a guess.
export function attemptsStatus(rawAttempts: unknown[]): LmsSubmissionStatus {
  let readable = 0
  for (const raw of rawAttempts) {
    const parsed = blackboardAttempt.safeParse(raw)
    if (!parsed.success || !parsed.data.status) continue
    readable++
    if (TURNED_IN.has(parsed.data.status)) return "submitted"
  }
  return readable === rawAttempts.length ? "not_submitted" : "unknown"
}

export function blackboardAssignmentToLms(
  column: BlackboardColumn,
  courseExternalId: string,
  context: { timeZone: string | undefined; courseUrl: string | null; submissionStatus: LmsSubmissionStatus }
): LmsAssignment {
  // Classic courses use displayName; Ultra courses only have name.
  const title = (column.displayName?.trim() || column.name?.trim()) as string
  // No due date in Blackboard stays no due date (the sync reports it as skipped).
  const due = column.grading?.due ? utcToLocalDue(column.grading.due, context.timeZone) : null
  return {
    provider: "blackboard",
    externalId: column.id,
    courseExternalId,
    title,
    description: column.description ? htmlToText(column.description) || null : null,
    dueDate: due?.dueDate ?? null,
    dueTime: due?.dueTime ?? null,
    type: typeOf(column),
    // The API has no per-item student link; "Open in Blackboard" opens the course.
    url: context.courseUrl,
    estimatedMinutes: null,
    submissionStatus: context.submissionStatus,
  }
}
