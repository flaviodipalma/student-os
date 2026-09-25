import "server-only"

import { z } from "zod"
import type { LmsAssignment, LmsCourse, LmsSyncResult } from "@/lib/lms/types"
import { isValidTimeZone } from "@/lib/time-zone"
import type { Database } from "../../db/types"
import { canvasAssignmentToLms, canvasCourseToLms } from "../lms/canvas/mapping"
import { saveLmsExtensionConnection } from "../lms/connections"
import { LmsError } from "../lms/provider"
import { runSync } from "../lms/sync"
import { parseExtensionLmsBaseUrl } from "./base-url"

// A Canvas import sent by the Student OS browser extension. The extension reads
// Canvas with the student's own browser session:
//   GET /api/v1/courses?enrollment_type=student&enrollment_state=active&include[]=teachers&include[]=term
//   GET /api/v1/courses/:id/assignments?include[]=submission&order_by=due_at
// and sends the raw JSON here, for the courses the student chose. None of it is
// trusted: the Canvas address must be a public HTTPS address (base-url.ts), links
// must stay on it, and every course and assignment goes through the same validation
// as the OAuth adapter (canvas/mapping.ts), then the same sync.

export const MAX_IMPORT_COURSES = 100
export const MAX_IMPORT_ASSIGNMENTS_PER_COURSE = 500

const importSchema = z.object({
  baseUrl: z.string().max(255),
  // The browser's IANA time zone, for due dates (the same source as the app's time-zone cookie).
  timeZone: z.string().max(64).optional(),
  courses: z.array(z.unknown()).max(MAX_IMPORT_COURSES),
  // Canvas course id -> that course's assignments. A course the extension couldn't
  // read is left out, so its tasks aren't reported as gone from Canvas.
  assignments: z.record(z.string().max(32), z.array(z.unknown()).max(MAX_IMPORT_ASSIGNMENTS_PER_COURSE)),
})

export async function importCanvasFromExtension(
  db: Database,
  userId: string,
  payload: unknown,
  options: { now?: Date } = {}
): Promise<LmsSyncResult> {
  const parsed = importSchema.safeParse(payload)
  if (!parsed.success) throw new LmsError("That doesn't look like Canvas data. Update the extension and try again.")
  const data = parsed.data
  const baseUrl = parseExtensionLmsBaseUrl(data.baseUrl, "Canvas")
  const timeZone = isValidTimeZone(data.timeZone) ? data.timeZone : undefined

  const courses = data.courses.map((raw) => canvasCourseToLms(raw, baseUrl)).filter((course): course is LmsCourse => course !== null)
  const assignmentsFor = (courseId: string): LmsAssignment[] => {
    // Own property only: a course id like "__proto__" or "constructor" isn't a list.
    const raw = Object.hasOwn(data.assignments, courseId) ? data.assignments[courseId] : undefined
    if (!raw) throw new LmsError("The extension couldn't read this course's assignments.", "course")
    return raw
      .map((item) => canvasAssignmentToLms(item, courseId, { baseUrl, timeZone }))
      .filter((assignment): assignment is LmsAssignment => assignment !== null)
  }

  await saveLmsExtensionConnection(db, userId, "canvas", baseUrl)
  return runSync(db, userId, { provider: "canvas", name: "Canvas" }, { now: options.now, timeZone }, async () => ({
    provider: "canvas",
    name: "Canvas",
    // The student chooses which courses to send, so a course that isn't sent may just
    // be unchecked: it's never reported as gone from Canvas (its tasks stay either way).
    listsAllCourses: false,
    getCourses: async () => courses,
    getAssignments: async (courseId) => assignmentsFor(courseId),
  }))
}
