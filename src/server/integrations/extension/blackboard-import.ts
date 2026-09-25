import "server-only"

import { z } from "zod"
import type { LmsAssignment, LmsCourse, LmsSubmissionStatus, LmsSyncResult } from "@/lib/lms/types"
import { isValidTimeZone } from "@/lib/time-zone"
import type { Database } from "../../db/types"
import {
  attemptsStatus,
  blackboardAssignmentToLms,
  blackboardCourseToLms,
  gradedColumns,
  isAttemptColumn,
  parseBlackboardColumn,
  type BlackboardColumn,
} from "../lms/blackboard/mapping"
import { saveLmsExtensionConnection } from "../lms/connections"
import { LmsError } from "../lms/provider"
import { runSync } from "../lms/sync"
import { parseExtensionLmsBaseUrl } from "./base-url"

// A Blackboard Learn import sent by the Student OS browser extension, which reads
// Learn's REST API with the student's own browser session (Blackboard's own pages
// use it the same way), for the courses the student chose:
//   GET v1/users/me, v1/users/{id}/courses?expand=course    -> courses
//   GET v1/courses/{id}/users?role=Instructor&expand=user   -> instructors (names only)
//   GET v2/courses/{id}/gradebook/columns                   -> columns (assignments, due dates)
//   GET v2/courses/{id}/gradebook/users/{id}                -> grades (the student's own)
//   GET v2/courses/{id}/gradebook/columns/{id}/attempts     -> attempts (recent ones only)
// None of it is trusted: the address must be a public HTTPS address (base-url.ts),
// links must stay on it, and everything goes through the OAuth adapter's validation
// (blackboard/mapping.ts), then the same sync.

export const MAX_BLACKBOARD_COURSES = 100
export const MAX_BLACKBOARD_COLUMNS_PER_COURSE = 500
// Attempt lists the extension may send (it looks up recent assignments only, like the OAuth adapter).
export const MAX_BLACKBOARD_ATTEMPT_LISTS = 300

const importSchema = z.object({
  baseUrl: z.string().max(255),
  // The browser's IANA time zone, for due dates (the same source as the app's time-zone cookie).
  timeZone: z.string().max(64).optional(),
  // Course memberships with their course expanded.
  courses: z.array(z.unknown()).max(MAX_BLACKBOARD_COURSES),
  // Course id -> its instructors' names (the course's professor). Missing: no professor.
  instructors: z.record(z.string().max(40), z.array(z.string().trim().min(1).max(100)).max(10)).optional(),
  // Course id -> its grade columns. A course the extension couldn't read is left out,
  // so its tasks aren't reported as gone from Blackboard.
  columns: z.record(z.string().max(40), z.array(z.unknown()).max(MAX_BLACKBOARD_COLUMNS_PER_COURSE)),
  // Course id -> the student's grades there. Missing: submission status unknown.
  grades: z.record(z.string().max(40), z.array(z.unknown()).max(MAX_BLACKBOARD_COLUMNS_PER_COURSE)).optional(),
  // Column id -> the student's attempts on it.
  attempts: z
    .record(z.string().max(40), z.array(z.unknown()).max(100))
    .refine((lists) => Object.keys(lists).length <= MAX_BLACKBOARD_ATTEMPT_LISTS)
    .optional(),
})

// Own properties only: an id like "__proto__" or "constructor" isn't a list.
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record && Object.hasOwn(record, key) ? record[key] : undefined

export async function importBlackboardFromExtension(
  db: Database,
  userId: string,
  payload: unknown,
  options: { now?: Date } = {}
): Promise<LmsSyncResult> {
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) throw new LmsError("That doesn't look like Blackboard data. Update the extension and try again.")
  const data = parsed.data
  const baseUrl = parseExtensionLmsBaseUrl(data.baseUrl, "Blackboard")
  const timeZone = isValidTimeZone(data.timeZone) ? data.timeZone : undefined

  const courses = data.courses
    .map((raw) => blackboardCourseToLms(raw, baseUrl))
    .filter((course): course is LmsCourse => course !== null)
    // Co-taught courses list every instructor ("Jane Smith, Ali Khan").
    .map((course) => ({ ...course, instructor: own(data.instructors, course.externalId)?.join(", ") || null }))
  const courseUrls = new Map(courses.map((course) => [course.externalId, course.url]))

  // The same conservative rules as the OAuth adapter: "graded" only with a real
  // grade, "submitted" only with a turned-in attempt, "unknown" whenever Blackboard
  // didn't say (grades not sent, attempts not looked up).
  const statusOf = (column: BlackboardColumn, graded: Set<string> | null): LmsSubmissionStatus => {
    if (graded?.has(column.id)) return "graded"
    const attempts = isAttemptColumn(column) ? own(data.attempts, column.id) : undefined
    return attempts ? attemptsStatus(attempts) : "unknown"
  }

  const assignmentsFor = (courseId: string): LmsAssignment[] => {
    const raw = own(data.columns, courseId)
    if (!raw) throw new LmsError("The extension couldn't read this course's assignments.", "course")
    const grades = own(data.grades, courseId)
    const graded = grades ? gradedColumns(grades) : null
    return raw
      .map(parseBlackboardColumn)
      .filter((column): column is BlackboardColumn => column !== null)
      .map((column) =>
        blackboardAssignmentToLms(column, courseId, {
          timeZone,
          courseUrl: courseUrls.get(courseId) ?? null,
          submissionStatus: statusOf(column, graded),
        })
      )
  }

  await saveLmsExtensionConnection(db, userId, "blackboard", baseUrl)
  return runSync(db, userId, { provider: "blackboard", name: "Blackboard" }, { now: options.now, timeZone }, async () => ({
    provider: "blackboard",
    name: "Blackboard",
    // The student chooses which courses to send, so one that isn't sent may just be
    // unchecked: it's never reported as gone (its tasks stay either way).
    listsAllCourses: false,
    getCourses: async () => courses,
    getAssignments: async (courseId) => assignmentsFor(courseId),
  }))
}
