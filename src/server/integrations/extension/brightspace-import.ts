import "server-only"

import { z } from "zod"
import type { LmsAssignment, LmsCourse, LmsSyncResult } from "@/lib/lms/types"
import { isValidTimeZone } from "@/lib/time-zone"
import type { Database } from "../../db/types"
import {
  brightspaceCourseToLms,
  brightspaceFolderToLms,
  brightspaceQuizToLms,
  parseBrightspaceFolder,
  parseBrightspaceQuiz,
  submissionsStatus,
  type BrightspaceFolder,
  type BrightspaceQuiz,
} from "../lms/brightspace/mapping"
import { saveLmsExtensionConnection } from "../lms/connections"
import { LmsError } from "../lms/provider"
import { runSync } from "../lms/sync"
import { parseExtensionLmsBaseUrl } from "./base-url"

// A D2L Brightspace import sent by the Quadernio browser extension, which reads
// Brightspace's API with the student's own browser session (Brightspace's own pages
// use it the same way), for the courses the student chose:
//   GET /d2l/api/lp/{v}/enrollments/myenrollments/          -> courses
//   GET /d2l/api/lp/{v}/courses/{orgUnitId}                  -> each course's semester dates
//   GET /d2l/api/le/{v}/{orgUnitId}/dropbox/folders/         -> folders (assignments, due dates)
//   GET /d2l/api/le/{v}/{orgUnitId}/dropbox/folders/{id}/submissions/mysubmissions/
//                                                            -> submissions (recent folders only)
//   GET /d2l/api/le/{v}/{orgUnitId}/quizzes/                 -> quizzes
// None of it is trusted: the address must be a public HTTPS address (base-url.ts),
// links are built on it from numeric ids, and everything goes through
// brightspace/mapping.ts, then the same sync as Canvas and Blackboard.

export const MAX_BRIGHTSPACE_COURSES = 100
export const MAX_BRIGHTSPACE_ITEMS_PER_COURSE = 500
export const MAX_BRIGHTSPACE_SUBMISSION_LISTS = 300

const courseId = z.string().regex(/^\d{1,18}$/)
const importSchema = z.object({
  baseUrl: z.string().max(255),
  timeZone: z.string().max(64).optional(),
  // Enrollments (OrgUnit + Access), each with its course offering's dates when read.
  courses: z.array(z.unknown()).max(MAX_BRIGHTSPACE_COURSES),
  // Course (org unit) id -> its assignment folders. A course the extension couldn't
  // read is left out, so its tasks aren't reported as gone from Brightspace.
  folders: z.record(courseId, z.array(z.unknown()).max(MAX_BRIGHTSPACE_ITEMS_PER_COURSE)),
  // Course id -> its quizzes. Missing: quizzes aren't open to students there.
  quizzes: z.record(courseId, z.array(z.unknown()).max(MAX_BRIGHTSPACE_ITEMS_PER_COURSE)).optional(),
  // Folder id -> the student's submission records for it (recent folders only).
  submissions: z
    .record(courseId, z.array(z.unknown()).max(20))
    .refine((lists) => Object.keys(lists).length <= MAX_BRIGHTSPACE_SUBMISSION_LISTS)
    .optional(),
})

// Own properties only: an id like "__proto__" or "constructor" isn't a list.
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record && Object.hasOwn(record, key) ? record[key] : undefined

export async function importBrightspaceFromExtension(
  db: Database,
  userId: string,
  payload: unknown,
  options: { now?: Date } = {}
): Promise<LmsSyncResult> {
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) throw new LmsError("That doesn't look like Brightspace D2L data. Update the extension and try again.")
  const data = parsed.data
  const baseUrl = parseExtensionLmsBaseUrl(data.baseUrl, "Brightspace D2L")
  const timeZone = isValidTimeZone(data.timeZone) ? data.timeZone : undefined

  const courses = data.courses
    .map((raw) => brightspaceCourseToLms(raw, baseUrl, timeZone))
    .filter((course): course is LmsCourse => course !== null)

  const assignmentsFor = (orgUnitId: string): LmsAssignment[] => {
    const folders = own(data.folders, orgUnitId)
    if (!folders) throw new LmsError("The extension couldn't read this course's assignments.", "course")
    const fromFolders = folders
      .map(parseBrightspaceFolder)
      .filter((folder): folder is BrightspaceFolder => folder !== null)
      .map((folder) => {
        const submissions = own(data.submissions, folder.Id)
        return brightspaceFolderToLms(folder, orgUnitId, {
          baseUrl,
          timeZone,
          submissionStatus: submissions ? submissionsStatus(submissions) : "unknown",
        })
      })
    const fromQuizzes = (own(data.quizzes, orgUnitId) ?? [])
      .map(parseBrightspaceQuiz)
      .filter((item): item is BrightspaceQuiz => item !== null)
      .map((item) => brightspaceQuizToLms(item, orgUnitId, { baseUrl, timeZone }))
    return [...fromFolders, ...fromQuizzes]
  }

  await saveLmsExtensionConnection(db, userId, "brightspace", baseUrl)
  return runSync(db, userId, { provider: "brightspace", name: "Brightspace D2L" }, { now: options.now, timeZone }, async () => ({
    provider: "brightspace",
    name: "Brightspace D2L",
    // The student chooses which courses to send: one that isn't sent may just be unchecked.
    listsAllCourses: false,
    getCourses: async () => courses,
    getAssignments: async (orgUnitId) => assignmentsFor(orgUnitId),
  }))
}
